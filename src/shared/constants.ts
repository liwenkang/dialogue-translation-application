export const SUPPORTED_LANGUAGES = [
  { code: "zh", name: "中文", nativeName: "中文" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

/**
 * Maps language pair "{source}-{target}" to HuggingFace model ID.
 * All translation goes through English as pivot, so we only need X↔en pairs.
 */
export const OPUS_MT_MODELS: Record<string, string> = {
  "zh-en": "Helsinki-NLP/opus-mt-zh-en",
  "en-zh": "Helsinki-NLP/opus-mt-en-zh",
  "ja-en": "Helsinki-NLP/opus-mt-ja-en",
  "en-ja": "Helsinki-NLP/opus-tatoeba-en-ja",
  "ko-en": "Helsinki-NLP/opus-mt-tc-big-ko-en",
  "en-ko": "Helsinki-NLP/opus-mt-tc-big-en-ko",
  "fr-en": "Helsinki-NLP/opus-mt-tc-big-fr-en",
  "en-fr": "Helsinki-NLP/opus-mt-tc-big-en-fr",
  "de-en": "Helsinki-NLP/opus-mt-de-en",
  "en-de": "Helsinki-NLP/opus-mt-en-de",
  "ru-en": "Helsinki-NLP/opus-mt-ru-en",
  "en-ru": "Helsinki-NLP/opus-mt-en-ru",
  "es-en": "Helsinki-NLP/opus-mt-es-en",
  "en-es": "Helsinki-NLP/opus-mt-tc-big-en-es",
  "it-en": "Helsinki-NLP/opus-mt-tc-big-it-en",
  "en-it": "Helsinki-NLP/opus-mt-tc-big-en-it",
};

export const APP_NAME = "Dialogue Translation";

export const DEFAULT_TARGET_LANG: LanguageCode = "en";

export const DB_NAME = "dialogue-translation.db";

export const MAX_MESSAGE_LENGTH = 5000;

export const WHISPER_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

export const WHISPER_MODEL_FILENAME = "ggml-base.bin";

export const WHISPER_MODEL_SIZE = 148_000_000; // ~148MB

// SHA256 checksum for ggml-base.bin (from whisper.cpp releases)
export const WHISPER_MODEL_SHA256 =
  "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";

// HuggingFace mirror for users in China
export const HF_OFFICIAL_BASE_URL = "https://huggingface.co";
export const HF_MIRROR_BASE_URL = "https://hf-mirror.com";

// Streaming translation: minimum text length before triggering chunked translation (renderer-side)
export const STREAMING_TRANSLATION_THRESHOLD = 20;

// Streaming translation: max chars per chunk for the translation service (main-side fallback)
export const STREAMING_CHUNK_MAX_CHARS = 80;
