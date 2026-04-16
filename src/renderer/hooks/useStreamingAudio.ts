import { useState, useRef, useCallback, useMemo } from "react";
import { useMessageStore } from "../stores/messageStore";
import { useAudioCapture } from "./useAudioCapture";
import { useIncrementalTranscription } from "./useIncrementalTranscription";
import type { TranscriptionCallbacks } from "./useIncrementalTranscription";
import { useStreamingTranslation } from "./useStreamingTranslation";

interface UseStreamingAudioReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  startStreaming: () => Promise<void>;
  stopStreaming: () => Promise<{
    fullText: string;
    language: string;
    committedTranslation: string;
  } | null>;
  error: string | null;
  clearError: () => void;
}

/**
 * Facade hook for streaming audio: composes useAudioCapture,
 * useIncrementalTranscription, and useStreamingTranslation.
 */
export function useStreamingAudio(): UseStreamingAudioReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);

  const sessionIdRef = useRef("");

  const capture = useAudioCapture();

  // Translation update callback — pushes to Zustand store
  const onTranslationUpdate = useCallback((translation: string) => {
    useMessageStore.getState().setStreamingState(
      sessionIdRef.current,
      transcription.getCommittedText(),
      "",
      translation,
    );
  }, []);

  const translation = useStreamingTranslation(
    capture.stoppedRef,
    () => transcription.getLanguage(),
    onTranslationUpdate,
  );

  // Transcription callbacks — wire commit/draft into store + translation
  const transcriptionCallbacks: TranscriptionCallbacks = useMemo(
    () => ({
      onCommit: (segment: string, _language: string) => {
        translation.bufferForTranslation(segment);
      },
      onDraftUpdate: (committed: string, draft: string) => {
        useMessageStore.getState().setStreamingState(
          sessionIdRef.current,
          committed,
          draft,
          translation.getCommittedTranslation(),
        );
      },
    }),
    [translation],
  );

  const transcription = useIncrementalTranscription(transcriptionCallbacks);

  const startStreaming = useCallback(async () => {
    // Reset all sub-hooks
    transcription.reset();
    translation.reset();

    const sid = `streaming-${Date.now()}`;
    sessionIdRef.current = sid;

    try {
      await capture.start();
    } catch {
      // Error already set in capture hook
      useMessageStore.getState().setStreamingState(null);
      return;
    }

    // Start VAD-based transcription
    transcription.startVAD(
      () => capture.getRecentBuffers(5),
      capture.getAllAudio,
      capture.inputSampleRate,
      capture.stoppedRef,
      capture.markBuffersCommitted,
      capture.checkAndClearBuffersDropped,
    );

    // Set streaming state
    useMessageStore.getState().setStreamingState(sid, "", "", "");
  }, [capture, transcription, translation]);

  const stopStreaming = useCallback(async (): Promise<{
    fullText: string;
    language: string;
    committedTranslation: string;
  } | null> => {
    setIsTranscribing(true);

    // Stop VAD
    transcription.stopVAD();

    // Clean up translation buffer (flush any remaining buffered text)
    translation.cleanup();

    // Wait for any in-flight transcription
    await transcription.waitForTranscription();

    // Wait for all queued translation work to finish before capturing
    await translation.waitForQueue();

    // Capture committed translation after queue drains
    const capturedTranslation = translation.getCommittedTranslation();

    // Stop audio capture (sets stoppedRef = true)
    await capture.stop();

    // Final transcription with all accumulated audio
    try {
      const result = await transcription.doFinalTranscription(
        capture.getAllAudio,
        capture.inputSampleRate(),
        capture.getUncommittedAudio,
      );

      // Reset all state
      transcription.reset();
      translation.reset();
      useMessageStore.getState().setStreamingState(null);
      setIsTranscribing(false);

      if (result) {
        return {
          fullText: result.fullText,
          language: result.language,
          committedTranslation: capturedTranslation,
        };
      }
      return null;
    } catch (err) {
      console.error("Final transcription failed:", err);
      transcription.reset();
      translation.reset();
      useMessageStore.getState().setStreamingState(null);
      setIsTranscribing(false);
      return null;
    }
  }, [capture, transcription, translation]);

  return {
    isRecording: capture.isRecording,
    isTranscribing,
    startStreaming,
    stopStreaming,
    error: capture.error,
    clearError: capture.clearError,
  };
}
