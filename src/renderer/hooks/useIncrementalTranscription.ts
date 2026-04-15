import { useRef, useCallback } from "react";
import { cleanWhisperOutput } from "../../shared/whisper-utils";
import {
  TARGET_SAMPLE_RATE,
  computeRMS,
  encodeWAV,
  resampleAudio,
  detectPunctuationStyle,
  trimLeadingSeparators,
  ensureEndingPunctuation,
  findIncrementalTail,
  joinCommittedSegments,
  findStablePrefix,
  getMajorityLanguage,
  replaceFinalPunctuation,
} from "./streaming-audio-utils";

// VAD parameters
const SILENCE_RMS_THRESHOLD = 0.01;
const SILENCE_TRIGGER_MS = 700;
const PERIODIC_TRIGGER_MS = 3000;
const MIN_AUDIO_FOR_TRANSCRIPTION_MS = 500;
const NOISE_FLOOR_SAMPLES = 30;
const NOISE_FLOOR_MULTIPLIER = 3.5;
const MIN_SILENCE_THRESHOLD = 0.003;
const LANGUAGE_VOTE_WINDOW = 8;
const MIN_TRANSCRIPTION_INTERVAL_MS = 800;

type TranscriptionTrigger = "silence" | "periodic";

export interface TranscriptionCallbacks {
  onCommit: (segment: string, language: string) => void;
  onDraftUpdate: (committed: string, draft: string) => void;
}

export interface IncrementalTranscriptionHandle {
  startVAD: (
    getRecentBuffers: () => Float32Array[],
    getAllAudio: () => Float32Array,
    inputSampleRate: () => number,
    stoppedRef: React.MutableRefObject<boolean>,
    markBuffersCommitted?: () => void,
    checkAndClearBuffersDropped?: () => boolean,
  ) => void;
  stopVAD: () => void;
  doFinalTranscription: (
    getAllAudio: () => Float32Array,
    inputSampleRate: number,
    getUncommittedAudio?: () => Float32Array,
  ) => Promise<{ fullText: string; language: string } | null>;
  getCommittedText: () => string;
  getLanguage: () => string;
  waitForTranscription: () => Promise<void>;
  reset: () => void;
}

export function useIncrementalTranscription(
  callbacks: TranscriptionCallbacks,
): IncrementalTranscriptionHandle {
  // VAD state
  const silenceStartRef = useRef<number | null>(null);
  const noiseFloorRef = useRef<number[]>([]);
  const adaptiveThresholdRef = useRef(SILENCE_RMS_THRESHOLD);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transcription state
  const lastTranscribeTimeRef = useRef(0);
  const lastTranscribedLenRef = useRef(0);
  const isTranscribingRef = useRef(false);
  const rawCommittedTextRef = useRef("");
  const punctuatedCommittedTextRef = useRef("");
  const latestLanguageRef = useRef("unknown");
  const previousHypothesisRef = useRef("");
  const languageVotesRef = useRef<string[]>([]);
  const markBuffersCommittedRef = useRef<(() => void) | null>(null);
  const checkBuffersDroppedRef = useRef<(() => boolean) | null>(null);

  const transcribeAccumulated = useCallback(
    async (
      trigger: TranscriptionTrigger,
      getAllAudio: () => Float32Array,
      inputSampleRate: () => number,
      stoppedRef: React.MutableRefObject<boolean>,
    ) => {
      if (isTranscribingRef.current || stoppedRef.current) return;

      // Check if audio buffers were dropped by backpressure
      if (checkBuffersDroppedRef.current?.()) {
        rawCommittedTextRef.current = "";
        previousHypothesisRef.current = "";
        lastTranscribedLenRef.current = 0;
      }

      const timeSinceLast = Date.now() - lastTranscribeTimeRef.current;
      if (trigger === "periodic" && timeSinceLast < MIN_TRANSCRIPTION_INTERVAL_MS) return;

      const allAudio = getAllAudio();
      const audioLengthMs =
        (allAudio.length / inputSampleRate()) * 1000;
      if (audioLengthMs < MIN_AUDIO_FOR_TRANSCRIPTION_MS) return;
      if (allAudio.length === lastTranscribedLenRef.current) return;

      isTranscribingRef.current = true;
      lastTranscribedLenRef.current = allAudio.length;
      lastTranscribeTimeRef.current = Date.now();

      try {
        const resampled = await resampleAudio(
          allAudio,
          inputSampleRate(),
          TARGET_SAMPLE_RATE,
        );
        const wav = encodeWAV(resampled, TARGET_SAMPLE_RATE);
        const result = await window.electronAPI.transcribe(wav);

        if (stoppedRef.current) return;

        const text = cleanWhisperOutput(result?.text?.trim() || "");
        if (text) {
          // Language stabilization via majority voting
          if (result.language && result.language !== "unknown") {
            languageVotesRef.current.push(result.language);
            if (languageVotesRef.current.length > LANGUAGE_VOTE_WINDOW) {
              languageVotesRef.current.shift();
            }
            latestLanguageRef.current = getMajorityLanguage(languageVotesRef.current);
          }

          const styles = detectPunctuationStyle(text, latestLanguageRef.current);
          const rawTail = findIncrementalTail(rawCommittedTextRef.current, text);

          if (trigger === "silence" && rawTail) {
            const committedSegment = ensureEndingPunctuation(rawTail, styles.clause);
            rawCommittedTextRef.current = text;
            punctuatedCommittedTextRef.current = joinCommittedSegments(
              punctuatedCommittedTextRef.current,
              committedSegment,
            );
            callbacks.onCommit(committedSegment, latestLanguageRef.current);
            callbacks.onDraftUpdate(punctuatedCommittedTextRef.current, "");
            previousHypothesisRef.current = text;
            markBuffersCommittedRef.current?.();
            return;
          }

          // Periodic: use two-round consistency to commit stable portions
          if (previousHypothesisRef.current) {
            const stablePrefix = findStablePrefix(
              previousHypothesisRef.current,
              text,
            );
            if (stablePrefix.length > rawCommittedTextRef.current.length) {
              const newStable = trimLeadingSeparators(
                stablePrefix.substring(rawCommittedTextRef.current.length),
              );
              if (newStable) {
                const committedSegment = ensureEndingPunctuation(
                  newStable,
                  styles.clause,
                );
                rawCommittedTextRef.current = stablePrefix;
                punctuatedCommittedTextRef.current = joinCommittedSegments(
                  punctuatedCommittedTextRef.current,
                  committedSegment,
                );
                callbacks.onCommit(committedSegment, latestLanguageRef.current);
              }
            }
          }
          previousHypothesisRef.current = text;

          const draftTail = trimLeadingSeparators(
            text.substring(rawCommittedTextRef.current.length),
          );
          callbacks.onDraftUpdate(punctuatedCommittedTextRef.current, draftTail);
        }
      } catch (err) {
        console.error("Intermediate transcription error:", err);
      } finally {
        isTranscribingRef.current = false;
      }
    },
    [callbacks],
  );

  const startVAD = useCallback(
    (
      getRecentBuffers: () => Float32Array[],
      getAllAudio: () => Float32Array,
      inputSampleRate: () => number,
      stoppedRef: React.MutableRefObject<boolean>,
      markBuffersCommitted?: () => void,
      checkAndClearBuffersDropped?: () => boolean,
    ) => {
      markBuffersCommittedRef.current = markBuffersCommitted ?? null;
      checkBuffersDroppedRef.current = checkAndClearBuffersDropped ?? null;
      lastTranscribeTimeRef.current = Date.now();

      const vadInterval = setInterval(() => {
        if (stoppedRef.current) return;

        const recentBuffers = getRecentBuffers();
        if (recentBuffers.length === 0) return;

        const recentLen = recentBuffers.reduce((s, b) => s + b.length, 0);
        const recent = new Float32Array(recentLen);
        let off = 0;
        for (const b of recentBuffers) {
          recent.set(b, off);
          off += b.length;
        }
        const rms = computeRMS(recent);

        // Update adaptive noise floor
        noiseFloorRef.current.push(rms);
        if (noiseFloorRef.current.length > NOISE_FLOOR_SAMPLES) {
          noiseFloorRef.current.shift();
        }
        const sorted = [...noiseFloorRef.current].sort((a, b) => a - b);
        const noiseFloor =
          sorted[Math.floor(sorted.length * 0.1)] ?? MIN_SILENCE_THRESHOLD;
        adaptiveThresholdRef.current = Math.max(
          MIN_SILENCE_THRESHOLD,
          Math.min(noiseFloor * NOISE_FLOOR_MULTIPLIER, SILENCE_RMS_THRESHOLD * 2),
        );

        const now = Date.now();

        if (rms < adaptiveThresholdRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          }
          const silenceDuration = now - silenceStartRef.current;
          if (
            silenceDuration >= SILENCE_TRIGGER_MS &&
            !isTranscribingRef.current
          ) {
            silenceStartRef.current = null;
            transcribeAccumulated("silence", getAllAudio, inputSampleRate, stoppedRef);
          }
        } else {
          silenceStartRef.current = null;
        }

        // Periodic fallback
        const timeSinceLastTranscribe =
          now - lastTranscribeTimeRef.current;
        if (
          timeSinceLastTranscribe >= PERIODIC_TRIGGER_MS &&
          !isTranscribingRef.current
        ) {
          transcribeAccumulated("periodic", getAllAudio, inputSampleRate, stoppedRef);
        }
      }, 100);
      vadIntervalRef.current = vadInterval;
    },
    [transcribeAccumulated],
  );

  const stopVAD = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
  }, []);

  const waitForTranscription = useCallback(async () => {
    while (isTranscribingRef.current) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }, []);

  const doFinalTranscription = useCallback(
    async (
      getAllAudio: () => Float32Array,
      inputSampleRate: number,
      getUncommittedAudio?: () => Float32Array,
    ): Promise<{ fullText: string; language: string } | null> => {
      const cleanedCommitted = cleanWhisperOutput(punctuatedCommittedTextRef.current);

      // Sliding window: transcribe only uncommitted audio and combine with committed text
      if (getUncommittedAudio) {
        const uncommittedAudio = getUncommittedAudio();

        if (uncommittedAudio.length === 0) {
          if (cleanedCommitted) {
            const styles = detectPunctuationStyle(cleanedCommitted, latestLanguageRef.current);
            return {
              fullText: replaceFinalPunctuation(cleanedCommitted, styles.sentence) || cleanedCommitted,
              language: latestLanguageRef.current,
            };
          }
          return null;
        }

        const resampled = await resampleAudio(uncommittedAudio, inputSampleRate, TARGET_SAMPLE_RATE);
        const wav = encodeWAV(resampled, TARGET_SAMPLE_RATE);
        const result = await window.electronAPI.transcribe(wav);
        const tailText = cleanWhisperOutput(result?.text?.trim() || "");
        const lang = result?.language || latestLanguageRef.current;

        if (cleanedCommitted && tailText) {
          const styles = detectPunctuationStyle(tailText, lang);
          const combined = joinCommittedSegments(
            cleanedCommitted,
            ensureEndingPunctuation(tailText, styles.sentence),
          );
          return { fullText: combined || cleanedCommitted, language: lang };
        }
        if (cleanedCommitted) {
          const styles = detectPunctuationStyle(cleanedCommitted, lang);
          return {
            fullText: replaceFinalPunctuation(cleanedCommitted, styles.sentence) || cleanedCommitted,
            language: lang,
          };
        }
        if (tailText) {
          const styles = detectPunctuationStyle(tailText, lang);
          return { fullText: ensureEndingPunctuation(tailText, styles.sentence), language: lang };
        }
        return null;
      }

      // Fallback: full-audio approach
      const allAudio = getAllAudio();
      if (allAudio.length === 0) return null;

      const resampled = await resampleAudio(
        allAudio,
        inputSampleRate,
        TARGET_SAMPLE_RATE,
      );
      const wav = encodeWAV(resampled, TARGET_SAMPLE_RATE);
      const result = await window.electronAPI.transcribe(wav);

      const finalRawText = cleanWhisperOutput(result?.text?.trim() || "");
      const cleanedCommittedFallback = cleanWhisperOutput(punctuatedCommittedTextRef.current);
      const styles = detectPunctuationStyle(
        finalRawText,
        result?.language || latestLanguageRef.current,
      );
      const finalTail = findIncrementalTail(
        rawCommittedTextRef.current,
        finalRawText,
      );
      const finalText = finalRawText
        ? finalTail
          ? joinCommittedSegments(
              cleanedCommittedFallback,
              ensureEndingPunctuation(finalTail, styles.sentence),
            ) || ensureEndingPunctuation(finalRawText, styles.sentence)
          : replaceFinalPunctuation(
              cleanedCommittedFallback,
              styles.sentence,
            ) || ensureEndingPunctuation(finalRawText, styles.sentence)
        : replaceFinalPunctuation(
            cleanedCommittedFallback,
            styles.sentence,
          );

      if (finalText) {
        return {
          fullText: finalText,
          language: result.language,
        };
      }
      return null;
    },
    [],
  );

  const getCommittedText = useCallback(() => punctuatedCommittedTextRef.current, []);
  const getLanguage = useCallback(() => latestLanguageRef.current, []);

  const reset = useCallback(() => {
    silenceStartRef.current = null;
    noiseFloorRef.current = [];
    adaptiveThresholdRef.current = SILENCE_RMS_THRESHOLD;
    lastTranscribeTimeRef.current = 0;
    lastTranscribedLenRef.current = 0;
    isTranscribingRef.current = false;
    rawCommittedTextRef.current = "";
    punctuatedCommittedTextRef.current = "";
    latestLanguageRef.current = "unknown";
    previousHypothesisRef.current = "";
    languageVotesRef.current = [];
    markBuffersCommittedRef.current = null;
    checkBuffersDroppedRef.current = null;
  }, []);

  return {
    startVAD,
    stopVAD,
    doFinalTranscription,
    getCommittedText,
    getLanguage,
    waitForTranscription,
    reset,
  };
}
