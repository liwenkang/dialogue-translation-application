import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import type {
  Message,
  ElectronAPI,
  StreamingTranslationChunk,
  StreamingRecognitionPartial,
  StreamingRecognitionCommit,
} from "../shared/types";

const electronAPI: ElectronAPI = {
  // App
  getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_PLATFORM),
  getMicrophoneAccessStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.APP.GET_MICROPHONE_ACCESS_STATUS),
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke(IPC_CHANNELS.APP.REQUEST_MICROPHONE_ACCESS),

  // Storage
  getMessages: (limit?: number, beforeTimestamp?: number) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.STORAGE.GET_MESSAGES,
      limit,
      beforeTimestamp,
    ),
  saveMessage: (message: Omit<Message, "id" | "createdAt" | "updatedAt">) =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE.SAVE_MESSAGE, message),
  updateTranslation: (
    messageId: string,
    translation: string,
    targetLang: string,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.STORAGE.UPDATE_TRANSLATION,
      messageId,
      translation,
      targetLang,
    ),
  clearMessages: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE.CLEAR_MESSAGES),
  deleteMessage: (messageId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE.DELETE_MESSAGE, messageId),
  exportMessages: (format: "txt" | "csv") => {
    if (format !== "txt" && format !== "csv") {
      return Promise.reject(new Error(`Invalid export format: ${format}`));
    }
    return ipcRenderer.invoke(IPC_CHANNELS.STORAGE.EXPORT_MESSAGES, format);
  },

  // Translate
  translate: (text: string, sourceLang: string, targetLang: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.TRANSLATE.TEXT,
      text,
      sourceLang,
      targetLang,
    ),
  translateStream: (
    text: string,
    sourceLang: string,
    targetLang: string,
    requestId: string,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.TRANSLATE.TEXT_STREAM,
      text,
      sourceLang,
      targetLang,
      requestId,
    ),
  onTranslationStreamChunk: (
    callback: (chunk: StreamingTranslationChunk) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      chunk: StreamingTranslationChunk,
    ) => callback(chunk);
    ipcRenderer.on(IPC_CHANNELS.TRANSLATE.TEXT_STREAM_CHUNK, handler);
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.TRANSLATE.TEXT_STREAM_CHUNK,
        handler,
      );
    };
  },
  detectLanguage: (text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE.DETECT_LANGUAGE, text),
  checkTranslationModel: (sourceLang: string, targetLang: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.TRANSLATE.CHECK_MODEL,
      sourceLang,
      targetLang,
    ),

  // Whisper
  transcribe: (audioBuffer: ArrayBuffer) =>
    ipcRenderer.invoke(IPC_CHANNELS.WHISPER.TRANSCRIBE, audioBuffer),
  transcribeSegment: (audioBuffer: ArrayBuffer, segmentIndex: number) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.WHISPER.STREAM_SEGMENT,
      audioBuffer,
      segmentIndex,
    ),
  checkWhisperAvailability: () =>
    ipcRenderer.invoke(IPC_CHANNELS.WHISPER.CHECK_AVAILABILITY),

  // Streaming recognition
  streamStart: () => ipcRenderer.invoke(IPC_CHANNELS.WHISPER.STREAM_START),
  streamAudio: (sessionId: string, audioData: Float32Array) => {
    // Validate input types before sending to main process
    if (typeof sessionId !== "string" || !sessionId) return;
    if (!(audioData instanceof Float32Array)) return;
    // Cap buffer size to prevent memory abuse (~10s of 48kHz mono audio)
    const maxSamples = 48000 * 10;
    const safeData =
      audioData.length > maxSamples
        ? audioData.slice(0, maxSamples)
        : audioData;
    ipcRenderer.send(
      IPC_CHANNELS.WHISPER.STREAM_AUDIO,
      sessionId,
      safeData.buffer.slice(
        safeData.byteOffset,
        safeData.byteOffset + safeData.byteLength,
      ),
    );
  },
  streamEnd: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WHISPER.STREAM_END, sessionId),
  onStreamPartial: (callback: (data: StreamingRecognitionPartial) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: StreamingRecognitionPartial,
    ) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.WHISPER.STREAM_PARTIAL, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.WHISPER.STREAM_PARTIAL, handler);
    };
  },
  onStreamCommit: (callback: (data: StreamingRecognitionCommit) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: StreamingRecognitionCommit,
    ) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.WHISPER.STREAM_COMMIT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.WHISPER.STREAM_COMMIT, handler);
    };
  },

  // Audio
  startRecording: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO.START_RECORDING),
  stopRecording: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO.STOP_RECORDING),
  onRecordingStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) =>
      callback(status);
    ipcRenderer.on(IPC_CHANNELS.AUDIO.STATUS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUDIO.STATUS, handler);
    };
  },
  onToggleRecording: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.AUDIO.TOGGLE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUDIO.TOGGLE, handler);
    };
  },

  // Model (stub for Phase 4 - except whisper download)
  downloadModel: (modelId: string) => {
    // Whitelist valid model IDs
    const allowedModels = ["whisper-base"];
    if (!allowedModels.includes(modelId)) {
      return Promise.reject(new Error(`Invalid model ID: ${modelId}`));
    }
    return ipcRenderer.invoke(IPC_CHANNELS.MODEL.DOWNLOAD, modelId);
  },
  getModelStatus: (modelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MODEL.STATUS, modelId),
  onDownloadProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) =>
      callback(progress);
    ipcRenderer.on(IPC_CHANNELS.MODEL.DOWNLOAD_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MODEL.DOWNLOAD_PROGRESS, handler);
    };
  },

  // Translation Model Install
  checkTranslationInstalled: (targetLang: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE.CHECK_INSTALLED, targetLang),
  installTranslationModel: (targetLang: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE.INSTALL_MODEL, targetLang),
  installTranslationPair: (sourceLang: string, targetLang: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.TRANSLATE.INSTALL_PAIR,
      sourceLang,
      targetLang,
    ),
  deleteTranslationPair: (sourceLang: string, targetLang: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.TRANSLATE.DELETE_PAIR,
      sourceLang,
      targetLang,
    ),
  getAllModelStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSLATE.ALL_MODEL_STATUS),
  onInstallModelProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) =>
      callback(progress);
    ipcRenderer.on(IPC_CHANNELS.TRANSLATE.INSTALL_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.TRANSLATE.INSTALL_PROGRESS,
        handler,
      );
    };
  },

  // Performance
  getPerformanceReport: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PERFORMANCE.GET_REPORT),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
