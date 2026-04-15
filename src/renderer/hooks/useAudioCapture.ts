import { useState, useRef, useCallback } from "react";
import { ERROR_MESSAGES } from "../../shared/error-messages";

// Backpressure: max audio buffer (~120s at 48kHz native)
const MAX_AUDIO_BUFFERS = 6000;

export interface AudioCaptureHandle {
  isRecording: boolean;
  stoppedRef: React.MutableRefObject<boolean>;
  inputSampleRate: () => number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getAllAudio: () => Float32Array;
  getRecentBuffers: (count: number) => Float32Array[];
  getUncommittedAudio: () => Float32Array;
  markBuffersCommitted: () => void;
  checkAndClearBuffersDropped: () => boolean;
  error: string | null;
  clearError: () => void;
}

export function useAudioCapture(): AudioCaptureHandle {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const allBuffers = useRef<Float32Array[]>([]);
  const stoppedRef = useRef(false);
  const inputSampleRateRef = useRef(48000);
  const committedBufferCountRef = useRef(0);
  const buffersDroppedFlagRef = useRef(false);

  const getAllAudio = useCallback((): Float32Array => {
    const totalLength = allBuffers.current.reduce(
      (sum, b) => sum + b.length,
      0,
    );
    if (totalLength === 0) return new Float32Array(0);

    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of allBuffers.current) {
      combined.set(buf, offset);
      offset += buf.length;
    }
    return combined;
  }, []);

  const getRecentBuffers = useCallback((count: number): Float32Array[] => {
    return allBuffers.current.slice(-count);
  }, []);

  const getUncommittedAudio = useCallback((): Float32Array => {
    const uncommitted = allBuffers.current.slice(
      committedBufferCountRef.current,
    );
    const totalLength = uncommitted.reduce((sum, b) => sum + b.length, 0);
    if (totalLength === 0) return new Float32Array(0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of uncommitted) {
      combined.set(buf, offset);
      offset += buf.length;
    }
    return combined;
  }, []);

  const markBuffersCommitted = useCallback(() => {
    committedBufferCountRef.current = allBuffers.current.length;
  }, []);

  const checkAndClearBuffersDropped = useCallback((): boolean => {
    if (buffersDroppedFlagRef.current) {
      buffersDroppedFlagRef.current = false;
      return true;
    }
    return false;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    stoppedRef.current = false;
    allBuffers.current = [];
    committedBufferCountRef.current = 0;
    buffersDroppedFlagRef.current = false;

    try {
      const permissionStatus =
        await window.electronAPI.getMicrophoneAccessStatus();
      if (permissionStatus === "not-determined") {
        const granted = await window.electronAPI.requestMicrophoneAccess();
        if (!granted) {
          setError(ERROR_MESSAGES.MIC_PERMISSION_DENIED);
          throw new DOMException("Microphone access denied", "NotAllowedError");
        }
      } else if (
        permissionStatus === "denied" ||
        permissionStatus === "restricted"
      ) {
        setError(ERROR_MESSAGES.MIC_PERMISSION_DENIED);
        throw new DOMException("Microphone access denied", "NotAllowedError");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      inputSampleRateRef.current = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      await audioCtx.audioWorklet.addModule("./audio-capture-processor.js");
      const workletNode = new AudioWorkletNode(
        audioCtx,
        "audio-capture-processor",
      );
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        if (stoppedRef.current) return;
        // Backpressure: prefer discarding already-committed buffers
        if (allBuffers.current.length >= MAX_AUDIO_BUFFERS) {
          if (committedBufferCountRef.current > 0) {
            allBuffers.current = allBuffers.current.slice(
              committedBufferCountRef.current,
            );
            committedBufferCountRef.current = 0;
            buffersDroppedFlagRef.current = true;
          }
          // If still over limit after removing committed, drop oldest half as fallback
          if (allBuffers.current.length >= MAX_AUDIO_BUFFERS) {
            const keepFrom = Math.floor(allBuffers.current.length / 2);
            allBuffers.current = allBuffers.current.slice(keepFrom);
            buffersDroppedFlagRef.current = true;
          }
        }
        allBuffers.current.push(e.data.audioData as Float32Array);
      };

      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start audio capture:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(ERROR_MESSAGES.MIC_PERMISSION_DENIED);
      } else {
        setError(
          `${ERROR_MESSAGES.MIC_ACCESS_FAILED}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  }, []);

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    setIsRecording(false);

    workletNodeRef.current?.port.postMessage({ command: "stop" });
    workletNodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    if (audioCtxRef.current?.state !== "closed") {
      try {
        await audioCtxRef.current?.close();
      } catch {
        // ignore
      }
    }

    workletNodeRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
  }, []);

  const clearBuffers = useCallback(() => {
    allBuffers.current = [];
  }, []);

  return {
    isRecording,
    stoppedRef,
    inputSampleRate: useCallback(() => inputSampleRateRef.current, []),
    start,
    stop,
    getAllAudio,
    getRecentBuffers,
    getUncommittedAudio,
    markBuffersCommitted,
    checkAndClearBuffersDropped,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
