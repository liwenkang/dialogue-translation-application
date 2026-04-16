import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useStreamingAudio } from "../../hooks/useStreamingAudio";
import VoiceButton from "./VoiceButton";
import { showToast } from "../Toast/Toast";
import { ERROR_MESSAGES } from "../../../shared/error-messages";
import { detectLanguage } from "../../../shared/language-detection";
import { MAX_MESSAGE_LENGTH, STREAMING_TRANSLATION_THRESHOLD } from "../../../shared/constants";

export default function InputArea() {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { addMessage, updateMessage, setTranslating } =
    useMessageStore();
  const { translationEnabled, targetLang } = useSettingsStore();

  const {
    isRecording,
    isTranscribing,
    error: audioError,
    startStreaming,
    stopStreaming,
    clearError,
  } = useStreamingAudio();

  // Auto-translate a message if translation is enabled
  const autoTranslate = useCallback(
    async (messageId: string, messageText: string, sourceLang: string) => {
      if (!translationEnabled) return;
      if (sourceLang === targetLang) return;

      // Check model availability before attempting translation
      try {
        const availability = await window.electronAPI.checkTranslationModel(
          sourceLang,
          targetLang,
        );
        if (!availability.available) {
          console.warn(
            `Translation model not available for ${sourceLang} → ${targetLang}`,
          );
          showToast(`翻译模型不可用：${sourceLang} → ${targetLang}`);
          return;
        }
      } catch {
        // If check fails, skip translation silently
        return;
      }

      setTranslating(messageId, true);

      // Use chunked translation for long text or text with sentence boundaries.
      const shouldUseStreamingTranslation =
        /[。！？.!?\n]/.test(messageText) ||
        messageText.trim().length >= STREAMING_TRANSLATION_THRESHOLD;
      if (shouldUseStreamingTranslation) {
        const requestId = `auto-${messageId}-${Date.now()}`;
        let accumulated = "";
        let resolveDone: (() => void) | null = null;
        const donePromise = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });

        const cleanup = window.electronAPI.onTranslationStreamChunk(
          (chunk) => {
            if (chunk.requestId !== requestId) return;
            accumulated += (accumulated ? " " : "") + chunk.translatedChunk;
            // Update message with partial translation as it streams in
            updateMessage(messageId, {
              translation: accumulated,
              targetLang,
            });
            if (chunk.done) {
              cleanup();
              resolveDone?.();
            }
          },
        );

        try {
          await window.electronAPI.translateStream(
            messageText,
            sourceLang,
            targetLang,
            requestId,
          );
          // Wait for the final chunk with done=true, with a 10s timeout fallback
          await Promise.race([
            donePromise,
            new Promise<void>((resolve) => setTimeout(resolve, 10000)),
          ]);
          if (accumulated) {
            await window.electronAPI.updateTranslation(
              messageId,
              accumulated,
              targetLang,
            );
          }
        } catch (err) {
          console.error("Streaming auto-translation failed:", err);
          showToast(ERROR_MESSAGES.TRANSLATION_FAILED);
          cleanup();
        } finally {
          setTranslating(messageId, false);
        }
      } else {
        // Single sentence — regular translation
        try {
          const result = await window.electronAPI.translate(
            messageText,
            sourceLang,
            targetLang,
          );
          await window.electronAPI.updateTranslation(
            messageId,
            result.text,
            targetLang,
          );
          updateMessage(messageId, {
            translation: result.text,
            targetLang,
          });
        } catch (err) {
          console.error("Auto-translation failed:", err);
          showToast(ERROR_MESSAGES.TRANSLATION_FAILED);
        } finally {
          setTranslating(messageId, false);
        }
      }
    },
    [translationEnabled, targetLang, updateMessage, setTranslating],
  );

  // Toggle recording with availability check — uses streaming recognition
  const handleVoiceToggle = useCallback(async () => {
    if (isRecording) {
      // Stop streaming — awaits final recognition
      const result = await stopStreaming();

      if (result && result.fullText) {
        const finalText = result.fullText;

        // Detect language using Whisper hint for voice input
        const detectedLang = detectLanguage(finalText, result.language);

        try {
          const savedMessage = await window.electronAPI.saveMessage({
            text: finalText,
            detectedLang,
            inputType: "voice",
            // Preserve streaming translation if available
            ...(result.committedTranslation ? {
              translation: result.committedTranslation,
              targetLang,
            } : {}),
          });
          addMessage(savedMessage);
          // Only auto-translate if no streaming translation was captured
          if (!result.committedTranslation) {
            autoTranslate(savedMessage.id, finalText, detectedLang).catch((err) => {
              console.error("Auto-translate error:", err);
            });
          }
        } catch (err) {
          console.error("Failed to save voice message:", err);
          showToast(ERROR_MESSAGES.VOICE_SAVE_FAILED);
        }
      }
    } else {
      try {
        const availability =
          await window.electronAPI.checkWhisperAvailability();
        if (!availability.modelAvailable) {
          const shouldDownload = confirm(
            "Whisper 语音识别模型尚未下载（约148MB）。\n是否立即下载？",
          );
          if (shouldDownload) {
            await window.electronAPI.downloadModel("whisper-base");
          }
          return;
        }
        if (!availability.binaryAvailable) {
          showToast(ERROR_MESSAGES.WHISPER_NOT_FOUND);
          return;
        }

        // Start streaming recognition
        await startStreaming();
      } catch (err) {
        console.error("Failed to start recording:", err);
      }
    }
  }, [
    isRecording,
    startStreaming,
    stopStreaming,
    addMessage,
    autoTranslate,
  ]);

  // Listen for global shortcut toggle (Cmd/Ctrl+Shift+Space)
  const handleVoiceToggleRef = useRef(handleVoiceToggle);
  handleVoiceToggleRef.current = handleVoiceToggle;

  useEffect(() => {
    const cleanup = window.electronAPI.onToggleRecording(() => {
      handleVoiceToggleRef.current();
    });
    return cleanup;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      showToast(`消息长度不能超过 ${MAX_MESSAGE_LENGTH} 个字符`);
      return;
    }

    setIsSending(true);
    try {
      // Unified language detection for keyboard input
      const detectedLang = detectLanguage(trimmed);
      const savedMessage = await window.electronAPI.saveMessage({
        text: trimmed,
        detectedLang,
        inputType: "keyboard",
      });
      addMessage(savedMessage);
      setText("");

      // Auto-resize textarea back
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      // Auto-translate if enabled (non-blocking, catch to avoid unhandled rejection)
      autoTranslate(savedMessage.id, trimmed, detectedLang).catch((err) => {
        console.error("Auto-translate error:", err);
      });
    } catch (err) {
      console.error("Failed to send message:", err);
      showToast(ERROR_MESSAGES.SAVE_MESSAGE_FAILED);
    } finally {
      setIsSending(false);
    }
  }, [text, isSending, addMessage, autoTranslate]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip during IME composition (e.g. Chinese/Japanese input on Windows)
    if (e.nativeEvent.isComposing || e.key === "Process") return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  };

  return (
    <div
      className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div className="flex items-end gap-2">
        <VoiceButton
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          error={audioError}
          onClick={handleVoiceToggle}
          onClearError={clearError}
        />

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="输入文字... (Enter 发送, Shift+Enter 换行)"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          disabled={isSending}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || isSending}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
          title="发送"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
