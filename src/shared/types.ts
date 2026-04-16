export interface Message {
  id: string;
  text: string;
  detectedLang: string;
  inputType: "keyboard" | "voice";
  translation?: string;
  targetLang?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TranslationResult {
  text: string;
  sourceLang: string;
  targetLang: string;
}

export interface DownloadProgress {
  modelId: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface ModelInstallProgress {
  pair: string;
  status: "downloading" | "converting" | "done" | "error";
  progress: number;
  message?: string;
}

export interface WhisperAvailability {
  binaryAvailable: boolean;
  modelAvailable: boolean;
}

export type MediaAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export interface TranslationModelStatus {
  available: boolean;
  direct: boolean;
  pivot: boolean;
}

export interface ModelPairStatus {
  source: string;
  target: string;
  installed: boolean;
}

export interface StreamingTranscription {
  segmentIndex: number;
  text: string;
  language: string;
  isFinal: boolean;
}

export interface StreamingTranslationChunk {
  requestId: string;
  chunkIndex: number;
  totalChunks: number;
  originalChunk: string;
  translatedChunk: string;
  done: boolean;
}

export interface StreamingRecognitionPartial {
  sessionId: string;
  segmentIndex: number;
  language: string;
  committedText: string;
  draftText: string;
}

export interface StreamingRecognitionCommit {
  sessionId: string;
  segmentIndex: number;
  committedDelta: string;
  committedText: string;
  language: string;
}

export interface ElectronAPI {
  // App
  getPlatform: () => Promise<string>;
  getMicrophoneAccessStatus: () => Promise<MediaAccessStatus>;
  requestMicrophoneAccess: () => Promise<boolean>;

  // Storage
  getMessages: (limit?: number, beforeTimestamp?: number) => Promise<Message[]>;
  saveMessage: (
    message: Omit<Message, "id" | "createdAt" | "updatedAt">,
  ) => Promise<Message>;
  updateTranslation: (
    messageId: string,
    translation: string,
    targetLang: string,
  ) => Promise<void>;
  clearMessages: () => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  exportMessages: (format: "txt" | "csv") => Promise<string>;

  // Translate
  translate: (
    text: string,
    sourceLang: string,
    targetLang: string,
  ) => Promise<TranslationResult>;
  translateStream: (
    text: string,
    sourceLang: string,
    targetLang: string,
    requestId: string,
  ) => Promise<void>;
  onTranslationStreamChunk: (
    callback: (chunk: StreamingTranslationChunk) => void,
  ) => () => void;
  detectLanguage: (text: string) => Promise<string>;
  checkTranslationModel: (
    sourceLang: string,
    targetLang: string,
  ) => Promise<TranslationModelStatus>;

  // Whisper
  transcribe: (
    audioBuffer: ArrayBuffer,
  ) => Promise<{ text: string; language: string }>;
  transcribeSegment: (
    audioBuffer: ArrayBuffer,
    segmentIndex: number,
  ) => Promise<StreamingTranscription>;
  checkWhisperAvailability: () => Promise<WhisperAvailability>;

  // Streaming recognition
  streamStart: () => Promise<{ sessionId: string }>;
  streamAudio: (sessionId: string, audioData: Float32Array) => void;
  streamEnd: (sessionId: string) => Promise<{ text: string; language: string }>;
  onStreamPartial: (
    callback: (data: StreamingRecognitionPartial) => void,
  ) => () => void;
  onStreamCommit: (
    callback: (data: StreamingRecognitionCommit) => void,
  ) => () => void;

  // Audio
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  onRecordingStatus: (callback: (status: string) => void) => () => void;
  onToggleRecording: (callback: () => void) => () => void;

  // Model
  downloadModel: (modelId: string) => Promise<void>;
  getModelStatus: (modelId: string) => Promise<string>;
  onDownloadProgress: (
    callback: (progress: DownloadProgress) => void,
  ) => () => void;

  // Translation Model Install
  checkTranslationInstalled: (
    targetLang: string,
  ) => Promise<{
    installed: boolean;
    missing: { source: string; target: string }[];
  }>;
  installTranslationModel: (targetLang: string) => Promise<void>;
  installTranslationPair: (
    sourceLang: string,
    targetLang: string,
  ) => Promise<void>;
  deleteTranslationPair: (
    sourceLang: string,
    targetLang: string,
  ) => Promise<void>;
  getAllModelStatus: () => Promise<ModelPairStatus[]>;
  onInstallModelProgress: (
    callback: (progress: ModelInstallProgress) => void,
  ) => () => void;

  // Performance
  getPerformanceReport: () => Promise<string>;

  // Settings
  getHfMirrorEnabled: () => Promise<boolean>;
  setHfMirrorEnabled: (enabled: boolean) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
