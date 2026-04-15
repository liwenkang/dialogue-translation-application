import { WhisperService } from "./whisper.service";
import type {
  StreamingRecognitionPartial,
  StreamingRecognitionCommit,
} from "../../shared/types";

const SAMPLE_RATE = 16000;
const MIN_RECOGNITION_WINDOW_MS = 1200;
const REGULAR_RECOGNITION_INTERVAL_MS = 2500;
const MAX_AUDIO_DURATION_MS = 15000;
const SILENCE_THRESHOLD = 0.008;
const SILENCE_DURATION_MS = 600;
const OVERLAP_SAMPLES = Math.floor(SAMPLE_RATE * 1.0); // 1s overlap after trim
const MIN_SPEECH_RMS = 0.005; // Minimum RMS to consider audio has speech
// Adaptive noise floor
const NOISE_FLOOR_WINDOW = 30;
const NOISE_FLOOR_MULTIPLIER = 3.5;
const MIN_SILENCE_THRESHOLD = 0.003;
// Language stabilization
const LANGUAGE_VOTE_WINDOW = 8;
// Backpressure: max audio buffer size (60s at 16kHz)
const MAX_AUDIO_BUFFER_SAMPLES = SAMPLE_RATE * 60;
// Max concurrent recognition requests across all sessions
const MAX_CONCURRENT_RECOGNITIONS = 1;

interface SessionState {
  sessionId: string;
  audioBuffer: Float32Array;
  audioLength: number;
  committedText: string;
  draftText: string;
  lastHypothesis: string;
  detectedLanguage: string;
  segmentIndex: number;
  lastRecognitionAt: number;
  silenceStartAt: number | null;
  hasSpeech: boolean;
  isProcessing: boolean;
  skipPrefixComparison: boolean;
  // Adaptive noise floor
  noiseFloorSamples: number[];
  adaptiveThreshold: number;
  // Language stabilization
  languageVotes: string[];
  // Request versioning: monotonic counter to detect stale results
  requestVersion: number;
  // Track pending request version for cancellation
  pendingRequestVersion: number;
}

type PartialCallback = (data: StreamingRecognitionPartial) => void;
type CommitCallback = (data: StreamingRecognitionCommit) => void;

export class StreamingRecognitionService {
  private sessions = new Map<string, SessionState>();
  private whisperService: WhisperService;
  private onPartial: PartialCallback | null = null;
  private onCommit: CommitCallback | null = null;
  private checkIntervals = new Map<string, ReturnType<typeof setInterval>>();
  // Global concurrency control
  private activeRecognitions = 0;

  constructor(whisperService: WhisperService) {
    this.whisperService = whisperService;
  }

  setCallbacks(onPartial: PartialCallback, onCommit: CommitCallback): void {
    this.onPartial = onPartial;
    this.onCommit = onCommit;
  }

  startSession(): string {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    const state: SessionState = {
      sessionId,
      audioBuffer: new Float32Array(SAMPLE_RATE * 30),
      audioLength: 0,
      committedText: "",
      draftText: "",
      lastHypothesis: "",
      detectedLanguage: "",
      segmentIndex: 0,
      lastRecognitionAt: Date.now(),
      silenceStartAt: null,
      hasSpeech: false,
      isProcessing: false,
      skipPrefixComparison: false,
      noiseFloorSamples: [],
      adaptiveThreshold: SILENCE_THRESHOLD,
      languageVotes: [],
      requestVersion: 0,
      pendingRequestVersion: 0,
    };

    this.sessions.set(sessionId, state);

    const interval = setInterval(() => this.checkAndTrigger(sessionId), 200);
    this.checkIntervals.set(sessionId, interval);

    return sessionId;
  }

  handleAudioChunk(sessionId: string, audioData: Float32Array): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    // Backpressure: if buffer exceeds max, force commit and trim
    if (state.audioLength + audioData.length > MAX_AUDIO_BUFFER_SAMPLES) {
      this.forceCommitAndTrim(state);
    }

    // Grow buffer if needed
    if (state.audioLength + audioData.length > state.audioBuffer.length) {
      const newBuffer = new Float32Array(
        Math.max(state.audioBuffer.length * 2, state.audioLength + audioData.length),
      );
      newBuffer.set(state.audioBuffer.subarray(0, state.audioLength));
      state.audioBuffer = newBuffer;
    }

    state.audioBuffer.set(audioData, state.audioLength);
    state.audioLength += audioData.length;

    // VAD: compute RMS energy with adaptive noise floor
    const rms = this.computeRMS(audioData);
    state.noiseFloorSamples.push(rms);
    if (state.noiseFloorSamples.length > NOISE_FLOOR_WINDOW) {
      state.noiseFloorSamples.shift();
    }
    const sorted = [...state.noiseFloorSamples].sort((a, b) => a - b);
    const noiseFloor =
      sorted[Math.floor(sorted.length * 0.1)] ?? MIN_SILENCE_THRESHOLD;
    state.adaptiveThreshold = Math.max(
      MIN_SILENCE_THRESHOLD,
      Math.min(noiseFloor * NOISE_FLOOR_MULTIPLIER, SILENCE_THRESHOLD * 2),
    );

    if (rms < state.adaptiveThreshold) {
      if (state.silenceStartAt === null) {
        state.silenceStartAt = Date.now();
      }
    } else {
      state.silenceStartAt = null;
      state.hasSpeech = true;
    }
  }

  async endSession(
    sessionId: string,
  ): Promise<{ text: string; language: string }> {
    const state = this.sessions.get(sessionId);
    if (!state) return { text: "", language: "" };

    // Clear the periodic check
    const interval = this.checkIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(sessionId);
    }

    // Wait for any in-flight recognition
    while (state.isProcessing) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Do a final recognition on all remaining audio
    if (state.audioLength > 0) {
      await this.runRecognition(sessionId);
    }

    // Combine committed + draft as final text
    const finalText = (state.committedText + state.draftText).trim();
    const language = state.detectedLanguage || "unknown";

    this.sessions.delete(sessionId);

    return { text: finalText, language };
  }

  cleanup(): void {
    for (const interval of this.checkIntervals.values()) {
      clearInterval(interval);
    }
    this.checkIntervals.clear();
    this.sessions.clear();
  }

  private computeRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  private checkAndTrigger(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.isProcessing) return;

    // Global concurrency check: skip if too many recognitions are in flight
    if (this.activeRecognitions >= MAX_CONCURRENT_RECOGNITIONS) return;

    const audioLengthMs = (state.audioLength / SAMPLE_RATE) * 1000;
    const timeSinceLastRecognition = Date.now() - state.lastRecognitionAt;
    const isSilent =
      state.silenceStartAt !== null &&
      Date.now() - state.silenceStartAt >= SILENCE_DURATION_MS;

    const shouldTrigger =
      audioLengthMs >= MIN_RECOGNITION_WINDOW_MS &&
      (timeSinceLastRecognition >= REGULAR_RECOGNITION_INTERVAL_MS ||
        (isSilent && audioLengthMs >= MIN_RECOGNITION_WINDOW_MS) ||
        audioLengthMs >= MAX_AUDIO_DURATION_MS);

    if (shouldTrigger) {
      this.runRecognition(sessionId);
    }
  }

  private async runRecognition(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.isProcessing) return;

    state.isProcessing = true;
    state.lastRecognitionAt = Date.now();
    state.segmentIndex++;
    // Bump request version: used to detect stale results
    state.requestVersion++;
    const thisRequestVersion = state.requestVersion;
    this.activeRecognitions++;

    try {
      const audioDurationMs = (state.audioLength / SAMPLE_RATE) * 1000;

      // If audio is too long, force commit and trim
      if (audioDurationMs > MAX_AUDIO_DURATION_MS) {
        this.forceCommitAndTrim(state);
      }

      // Skip recognition if no speech detected in the buffer
      const audioToProcess = state.audioBuffer.slice(0, state.audioLength);
      const overallRms = this.computeRMS(audioToProcess);
      if (overallRms < MIN_SPEECH_RMS && !state.hasSpeech) {
        return;
      }

      const wavBuffer = this.encodeWAV(audioToProcess, SAMPLE_RATE);
      const result = await this.whisperService.transcribe(
        Buffer.from(wavBuffer),
      );

      // Stale result check: if a newer request was issued, discard this result
      if (state.requestVersion !== thisRequestVersion) {
        return;
      }

      if (!result.text.trim()) {
        return;
      }

      const newFullText = result.text.trim();

      // Language stabilization via majority voting
      if (result.language && result.language !== "unknown") {
        state.languageVotes.push(result.language);
        if (state.languageVotes.length > LANGUAGE_VOTE_WINDOW) {
          state.languageVotes.shift();
        }
        const langCounts = new Map<string, number>();
        for (const lang of state.languageVotes) {
          langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
        }
        let maxCount = 0;
        for (const [lang, count] of langCounts) {
          if (count > maxCount) {
            maxCount = count;
            state.detectedLanguage = lang;
          }
        }
      } else {
        state.detectedLanguage = result.language || state.detectedLanguage;
      }

      this.updateTextState(state, newFullText);

      this.onPartial?.({
        sessionId,
        segmentIndex: state.segmentIndex,
        language: state.detectedLanguage,
        committedText: state.committedText,
        draftText: state.draftText,
      });
    } catch (err) {
      console.error("Streaming recognition error:", err);
    } finally {
      state.isProcessing = false;
      this.activeRecognitions = Math.max(0, this.activeRecognitions - 1);
    }
  }

  private updateTextState(state: SessionState, newFullText: string): void {
    if (state.skipPrefixComparison) {
      // After a trim, treat everything as draft until next comparison
      state.draftText = newFullText;
      state.lastHypothesis = newFullText;
      state.skipPrefixComparison = false;
      return;
    }

    const stablePrefix = state.lastHypothesis
      ? this.findStablePrefix(state.lastHypothesis, newFullText)
      : "";

    if (newFullText.startsWith(state.committedText)) {
      // Normal case: committed text is still a valid prefix
      if (stablePrefix.length > state.committedText.length) {
        const committedDelta = stablePrefix.substring(
          state.committedText.length,
        );
        state.committedText = stablePrefix;

        this.onCommit?.({
          sessionId: state.sessionId,
          segmentIndex: state.segmentIndex,
          committedDelta,
          committedText: state.committedText,
          language: state.detectedLanguage,
        });
      }
      state.draftText = newFullText.substring(state.committedText.length);
    } else {
      // Rare case: Whisper changed earlier text, reset committed
      state.committedText = stablePrefix;
      state.draftText = newFullText.substring(stablePrefix.length);
    }

    state.lastHypothesis = newFullText;
  }

  private findStablePrefix(prev: string, curr: string): string {
    let i = 0;
    const minLen = Math.min(prev.length, curr.length);
    while (i < minLen && prev[i] === curr[i]) {
      i++;
    }

    if (i === 0) return "";

    // If matched up to the end of the shorter string, it's a valid prefix
    if (i >= minLen) return curr.substring(0, i);

    // Don't cut in the middle of a non-CJK word: back up to word boundary
    const charBeforeCut = curr[i - 1];
    const isCJK =
      /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(
        charBeforeCut,
      );

    if (!isCJK) {
      while (
        i > 0 &&
        !/[\s，。？！,.?!；;：:、\n]/.test(curr[i - 1])
      ) {
        i--;
      }
    }

    return curr.substring(0, i);
  }

  private forceCommitAndTrim(state: SessionState): void {
    // Commit all current text
    if (state.draftText) {
      const committedDelta = state.draftText;
      state.committedText += state.draftText;
      state.draftText = "";

      this.onCommit?.({
        sessionId: state.sessionId,
        segmentIndex: state.segmentIndex,
        committedDelta,
        committedText: state.committedText,
        language: state.detectedLanguage,
      });
    }

    // Trim audio buffer, keep overlap
    const keepSamples = Math.min(state.audioLength, OVERLAP_SAMPLES);
    const newBuffer = new Float32Array(state.audioBuffer.length);
    newBuffer.set(
      state.audioBuffer.subarray(
        state.audioLength - keepSamples,
        state.audioLength,
      ),
    );
    state.audioBuffer = newBuffer;
    state.audioLength = keepSamples;

    // Reset hypothesis for fresh comparison
    state.lastHypothesis = "";
    state.skipPrefixComparison = true;

    this.onPartial?.({
      sessionId: state.sessionId,
      segmentIndex: state.segmentIndex,
      language: state.detectedLanguage,
      committedText: state.committedText,
      draftText: state.draftText,
    });
  }

  private encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return buffer;
  }
}
