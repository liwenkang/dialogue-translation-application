import { useState, useRef, useCallback } from "react";

/**
 * Encode Float32 PCM samples to 16-bit WAV format
 */
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");

  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

export function useAudio() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const resolveStopRef = useRef<((wav: ArrayBuffer) => void) | null>(null);
  const rejectStopRef = useRef<((err: Error) => void) | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();

          // Decode the recorded audio
          const audioCtx = new AudioContext();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          await audioCtx.close();

          // Resample to 16kHz mono using OfflineAudioContext
          const targetSampleRate = 16000;
          const offlineCtx = new OfflineAudioContext(
            1,
            Math.ceil(audioBuffer.duration * targetSampleRate),
            targetSampleRate,
          );
          const source = offlineCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineCtx.destination);
          source.start();
          const resampled = await offlineCtx.startRendering();

          // Encode to WAV
          const wav = encodeWAV(resampled.getChannelData(0), targetSampleRate);
          resolveStopRef.current?.(wav);
        } catch (err) {
          rejectStopRef.current?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      };

      mediaRecorder.start(100); // collect data every 100ms
      setIsRecording(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("麦克风权限被拒绝，请在系统设置中允许访问麦克风");
      } else {
        setError("无法访问麦克风");
      }
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<{
    text: string;
    language: string;
  } | null> => {
    if (!mediaRecorderRef.current || !isRecording) return null;

    setIsRecording(false);
    setIsTranscribing(true);

    try {
      // Wait for MediaRecorder to produce WAV data
      const wavBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        resolveStopRef.current = resolve;
        rejectStopRef.current = reject;
        mediaRecorderRef.current!.stop();
      });

      // Release microphone
      streamRef.current?.getTracks().forEach((t) => t.stop());

      // Send WAV to main process for Whisper transcription
      const result = await window.electronAPI.transcribe(wavBuffer);
      return result;
    } catch (err) {
      console.error("Transcription error:", err);
      setError("语音识别失败，请重试");
      return null;
    } finally {
      setIsTranscribing(false);
      resolveStopRef.current = null;
      rejectStopRef.current = null;
    }
  }, [isRecording]);

  return {
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
    clearError: useCallback(() => setError(null), []),
  };
}
