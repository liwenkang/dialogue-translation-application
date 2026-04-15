import { detect } from "tinyld";
import { SUPPORTED_LANGUAGES } from "./constants";

const MIN_TINYLD_LENGTH = 5;
const supportedCodes: Set<string> = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

/**
 * Unified language detection for both keyboard and voice input.
 *
 * Priority:
 *  1. CJK script heuristic (regex) — most reliable for CJK texts
 *  2. whisperHint (if provided and not "unknown") — useful for non-CJK voice input
 *  3. tinyld fallback — only for texts >= MIN_TINYLD_LENGTH chars
 *  4. Default to "en"
 */
export function detectLanguage(text: string, whisperHint?: string): string {
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
  const hasHiraganaKatakana = /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
  const hasKorean = /[\uac00-\ud7af]/.test(text);

  // Japanese: presence of hiragana/katakana is definitive
  if (hasHiraganaKatakana) return "ja";

  // Korean: presence of Hangul is definitive
  if (hasKorean) return "ko";

  // Chinese: CJK ideographs without Japanese kana or Korean
  if (hasCJK) return "zh";

  // For non-CJK text, prefer Whisper's language hint (voice input)
  if (whisperHint && whisperHint !== "unknown" && supportedCodes.has(whisperHint))
    return whisperHint;

  // tinyld for longer non-CJK text
  if (text.trim().length >= MIN_TINYLD_LENGTH) {
    const detected = detect(text);
    // Only accept tinyld result if it is a supported language
    if (detected && supportedCodes.has(detected)) return detected;
  }

  return "en";
}
