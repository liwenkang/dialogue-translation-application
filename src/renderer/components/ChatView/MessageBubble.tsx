import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, StreamingTranslationChunk } from "../../../shared/types";
import { SUPPORTED_LANGUAGES, STREAMING_TRANSLATION_THRESHOLD } from "../../../shared/constants";
import type { LanguageCode } from "../../../shared/constants";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { showToast } from "../Toast/Toast";
import { ERROR_MESSAGES } from "../../../shared/error-messages";

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showRetranslatePicker, setShowRetranslatePicker] = useState(false);
  const [streamingTranslation, setStreamingTranslation] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const translatingIds = useMessageStore((s) => s.translatingIds);
  const { updateMessage, setTranslating } = useMessageStore();
  const { openModelManager } = useSettingsStore();
  const isTranslating = translatingIds.has(message.id);

  const langLabel =
    SUPPORTED_LANGUAGES.find((l) => l.code === message.detectedLang)
      ?.nativeName ?? message.detectedLang;

  const timeStr = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Close picker on outside click
  useEffect(() => {
    if (!showRetranslatePicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowRetranslatePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRetranslatePicker]);

  const handleOpenRetranslatePicker = () => {
    if (isTranslating) return;
    setShowRetranslatePicker(true);
  };

  const handleCopyTranslation = async () => {
    if (message.translation) {
      await navigator.clipboard.writeText(message.translation);
      setCopied(true);
      showToast(ERROR_MESSAGES.COPIED);
      setTimeout(() => setCopied(false), 1500);
    }
  };


  const handleRetranslate = useCallback(
    async (newTargetLang: LanguageCode) => {
      setShowRetranslatePicker(false);
      if (isTranslating) return;
      if (newTargetLang === message.detectedLang) return;

      // Check model availability
      try {
        const availability = await window.electronAPI.checkTranslationModel(
          message.detectedLang,
          newTargetLang,
        );
        if (!availability.available) {
          openModelManager(message.detectedLang);
          return;
        }
      } catch {
        return;
      }

      setTranslating(message.id, true);

      // Use chunked translation for long text or text with sentence boundaries.
      const shouldUseStreamingTranslation =
        /[。！？.!?\n]/.test(message.text) ||
        message.text.trim().length >= STREAMING_TRANSLATION_THRESHOLD;
      if (shouldUseStreamingTranslation) {
        const requestId = `retranslate-${message.id}-${Date.now()}`;
        setStreamingTranslation("");
        let accumulated = "";

        let resolveDone: (() => void) | null = null;
        const donePromise = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });

        const cleanup = window.electronAPI.onTranslationStreamChunk(
          (chunk: StreamingTranslationChunk) => {
            if (chunk.requestId !== requestId) return;
            accumulated += (accumulated ? " " : "") + chunk.translatedChunk;
            setStreamingTranslation(accumulated);
            if (chunk.done) {
              cleanup();
              resolveDone?.();
            }
          },
        );

        try {
          await window.electronAPI.translateStream(
            message.text,
            message.detectedLang,
            newTargetLang,
            requestId,
          );

          // Wait for the final chunk with done=true, with a 10s timeout fallback
          await Promise.race([
            donePromise,
            new Promise<void>((resolve) => setTimeout(resolve, 10000)),
          ]);
          const finalTranslation = accumulated;
          setStreamingTranslation(null);

          if (finalTranslation) {
            await window.electronAPI.updateTranslation(
              message.id,
              finalTranslation,
              newTargetLang,
            );
            const updatedAt = Date.now();
            updateMessage(message.id, {
              translation: finalTranslation,
              targetLang: newTargetLang,
              updatedAt,
            });
          }
        } catch (err) {
          console.error("Streaming retranslation failed:", err);
          showToast(ERROR_MESSAGES.TRANSLATION_FAILED);
          setStreamingTranslation(null);
          cleanup();
        } finally {
          setTranslating(message.id, false);
        }
      } else {
        // Single sentence — use regular translation
        try {
          const result = await window.electronAPI.translate(
            message.text,
            message.detectedLang,
            newTargetLang,
          );
          await window.electronAPI.updateTranslation(
            message.id,
            result.text,
            newTargetLang,
          );
          const updatedAt = Date.now();
          updateMessage(message.id, {
            translation: result.text,
            targetLang: newTargetLang,
            updatedAt,
          });
        } catch (err) {
          console.error("Retranslation failed:", err);
          showToast(ERROR_MESSAGES.TRANSLATION_FAILED);
        } finally {
          setTranslating(message.id, false);
        }
      }
    },
    [message, isTranslating, updateMessage, setTranslating, openModelManager],
  );

  // Display text for translation: streaming or final
  const displayTranslation =
    streamingTranslation !== null ? streamingTranslation : message.translation;

  return (
    <div className="max-w-[85%] ml-auto">
      {/* Main bubble */}
      <div
        className="bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-3 shadow-sm cursor-pointer transition-opacity hover:opacity-95"
        onClick={handleOpenRetranslatePicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpenRetranslatePicker();
          }
        }}
        role="button"
        tabIndex={0}
        title="点击重新翻译为其他语言"
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.text}
        </p>
      </div>

      {/* Translating indicator */}
      {isTranslating && (
        <div className="mt-1 bg-white dark:bg-gray-700 rounded-2xl rounded-tr-md px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-600">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <svg
              className="animate-spin w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            正在翻译...
          </div>
        </div>
      )}

      {/* Translation bubble */}
      {displayTranslation && (
        <div className="mt-1 bg-white dark:bg-gray-700 rounded-2xl rounded-tr-md px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-600 animate-translation-reveal">
          <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
            {displayTranslation}
            {streamingTranslation !== null && isTranslating && (
              <span className="inline-block w-1.5 h-4 bg-blue-400/70 ml-0.5 animate-pulse align-text-bottom" />
            )}
          </p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">
              →{" "}
              {SUPPORTED_LANGUAGES.find((l) => l.code === message.targetLang)
                ?.nativeName ?? message.targetLang}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyTranslation();
                }}
                className="text-xs text-blue-400 hover:text-blue-500 transition-colors"
              >
                {copied ? "✓ 已复制" : "复制译文"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meta info + retranslate */}
      <div className="flex items-center justify-end gap-2 mt-1 px-1 relative">
        <span className="text-xs text-gray-400">
          {message.inputType === "voice" ? "🎤" : "⌨️"} {langLabel}
        </span>
        <span className="text-xs text-gray-400">{timeStr}</span>
        <button
          onClick={() => setShowRetranslatePicker((v) => !v)}
          disabled={isTranslating}
          className="text-xs text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40"
          title="重新翻译为其他语言"
        >
          🔄
        </button>
        {/* Language picker popup */}
        {showRetranslatePicker && (
          <div
            ref={pickerRef}
            className="absolute right-0 top-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 z-50 min-w-[120px] max-h-[300px] overflow-y-auto lang-dropdown-list"
          >
            <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
              翻译为...
            </div>
            {SUPPORTED_LANGUAGES.filter(
              (l) => l.code !== message.detectedLang,
            ).map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleRetranslate(lang.code)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors ${
                  lang.code === message.targetLang
                    ? "text-blue-500 font-medium"
                    : "text-gray-700 dark:text-gray-200"
                }`}
              >
                {lang.nativeName}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
