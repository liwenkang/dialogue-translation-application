import { useRef, useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";

// Translation context buffering delay (ms)
const TRANSLATION_BUFFER_MS = 1200;
// Max transient-failure retries for model availability check per session
const MAX_AVAILABILITY_CHECK_RETRIES = 3;

export interface StreamingTranslationHandle {
  bufferForTranslation: (segment: string) => void;
  getCommittedTranslation: () => string;
  waitForQueue: () => Promise<void>;
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
  const availabilityCheckRetriesRef = useRef(0);
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

      // Model availability check with retry for transient errors
      if (translationAvailabilityRef.current === "unknown") {
        if (availabilityCheckRetriesRef.current >= MAX_AVAILABILITY_CHECK_RETRIES) {
          translationAvailabilityRef.current = "unavailable";
          return;
        }
        try {
          const availability = await window.electronAPI.checkTranslationModel(
            sourceLang,
            targetLang,
          );
          if (!availability.available) {
            // Model genuinely not installed — permanent for this session
            translationAvailabilityRef.current = "unavailable";
            console.warn(`Translation model not available for ${sourceLang} → ${targetLang}`);
            return;
          }
          translationAvailabilityRef.current = "available";
        } catch {
          // Transient error (e.g. service still starting) — stay "unknown" to retry
          availabilityCheckRetriesRef.current++;
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

  // Wait for all queued translation work to complete
  const waitForQueue = useCallback(
    () => translationQueueRef.current,
    [],
  );

  const reset = useCallback(() => {
    committedTranslationRef.current = "";
    translationQueueRef.current = Promise.resolve();
    translationAvailabilityRef.current = "unknown";
    availabilityCheckRetriesRef.current = 0;
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
    waitForQueue,
    reset,
    cleanup,
  };
}
