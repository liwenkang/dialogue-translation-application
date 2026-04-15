import { useRef, useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";

// Translation context buffering delay (ms)
const TRANSLATION_BUFFER_MS = 1200;

export interface StreamingTranslationHandle {
  bufferForTranslation: (segment: string) => void;
  getCommittedTranslation: () => string;
  reset: () => void;
  cleanup: () => void;
}

export function useStreamingTranslation(
  stoppedRef: React.MutableRefObject<boolean>,
  languageGetter: () => string,
  onTranslationUpdate: (translation: string) => void,
): StreamingTranslationHandle {
  const committedTranslationRef = useRef("");
  const translationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const translationAvailabilityRef = useRef<"unknown" | "available" | "unavailable">("unknown");
  const translationBufferRef = useRef("");
  const translationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appendCommittedTranslation = useCallback(
    (translatedSegment: string) => {
      const trimmed = translatedSegment.trim();
      if (!trimmed) return;

      const targetLang = useSettingsStore.getState().targetLang;
      committedTranslationRef.current = committedTranslationRef.current
        ? targetLang === "zh"
          ? `${committedTranslationRef.current}${trimmed}`
          : `${committedTranslationRef.current} ${trimmed}`
        : trimmed;

      onTranslationUpdate(committedTranslationRef.current);
    },
    [onTranslationUpdate],
  );

  const flushTranslationBuffer = useCallback(() => {
    const buffered = translationBufferRef.current.trim();
    translationBufferRef.current = "";
    if (translationTimerRef.current) {
      clearTimeout(translationTimerRef.current);
      translationTimerRef.current = null;
    }
    if (!buffered) return;

    translationQueueRef.current = translationQueueRef.current.then(async () => {
      if (stoppedRef.current) return;

      const {
        translationEnabled,
        targetLang,
      } = useSettingsStore.getState();
      const sourceLang = languageGetter();

      if (
        !translationEnabled ||
        !sourceLang ||
        sourceLang === "unknown" ||
        sourceLang === targetLang
      ) {
        return;
      }

      if (translationAvailabilityRef.current === "unknown") {
        try {
          const availability = await window.electronAPI.checkTranslationModel(
            sourceLang,
            targetLang,
          );
          if (!availability.available) {
            translationAvailabilityRef.current = "unavailable";
            console.warn(`Translation model not available for ${sourceLang} → ${targetLang}`);
            return;
          }
          translationAvailabilityRef.current = "available";
        } catch {
          return;
        }
      }

      if (translationAvailabilityRef.current !== "available") return;

      try {
        const translated = await window.electronAPI.translate(
          buffered,
          sourceLang,
          targetLang,
        );
        if (stoppedRef.current) return;
        appendCommittedTranslation(translated.text);
      } catch (err) {
        console.error("Streaming committed translation failed:", err);
      }
    });
  }, [stoppedRef, languageGetter, appendCommittedTranslation]);

  const bufferForTranslation = useCallback(
    (segment: string) => {
      const trimmed = segment.trim();
      if (!trimmed) return;

      translationBufferRef.current += trimmed;

      if (translationTimerRef.current) {
        clearTimeout(translationTimerRef.current);
        translationTimerRef.current = null;
      }

      // Flush immediately on sentence boundary or sufficient length
      const buffer = translationBufferRef.current;
      if (/[。！？.!?\n]/.test(buffer) || buffer.length >= 30) {
        flushTranslationBuffer();
        return;
      }

      // Otherwise wait for more text to accumulate
      translationTimerRef.current = setTimeout(() => {
        flushTranslationBuffer();
      }, TRANSLATION_BUFFER_MS);
    },
    [flushTranslationBuffer],
  );

  const getCommittedTranslation = useCallback(
    () => committedTranslationRef.current,
    [],
  );

  const reset = useCallback(() => {
    committedTranslationRef.current = "";
    translationQueueRef.current = Promise.resolve();
    translationAvailabilityRef.current = "unknown";
    translationBufferRef.current = "";
    if (translationTimerRef.current) {
      clearTimeout(translationTimerRef.current);
      translationTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (translationTimerRef.current) {
      clearTimeout(translationTimerRef.current);
      translationTimerRef.current = null;
    }
    translationBufferRef.current = "";
  }, []);

  return {
    bufferForTranslation,
    getCommittedTranslation,
    reset,
    cleanup,
  };
}
