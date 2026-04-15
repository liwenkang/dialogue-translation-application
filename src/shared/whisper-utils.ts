/**
 * Remove common Whisper hallucination artifacts from output text.
 * Shared between main process and renderer to avoid duplication.
 */
export function cleanWhisperOutput(text: string): string {
  if (!text) return text;

  // Remove [BLANK_AUDIO], [silence], [sad music], [background noise], etc.
  let cleaned = text.replace(/\[BLANK_AUDIO\]/gi, "");
  // Remove any bracketed or parenthesized annotations (e.g. [sad music], (applause), [background noise])
  cleaned = cleaned.replace(/\[(?:[^\]]{0,30})\]/g, "");
  cleaned = cleaned.replace(/\((?:[^)]{0,30})\)/g, "");

  // Remove common Whisper hallucinated filler phrases
  cleaned = cleaned.replace(
    /\b(thanks?\s+for\s+watching|please\s+subscribe|like\s+and\s+subscribe|see\s+you\s+next\s+time)\b[.!]?/gi,
    "",
  );

  // Remove hallucinated measurements (e.g. "1/2 oz.", "½ oz", "1/4 cup")
  cleaned = cleaned.replace(
    /[½¼¾]?\s*\d*\s*\/?\s*\d+\s*(oz|ounce|cup|tbsp|tsp|ml|lb|kg|mg|g)\b\.?/gi,
    "",
  );

  // Remove repetitive hallucination patterns (e.g. repeated punctuation or filler)
  cleaned = cleaned.replace(/(\.\.\.|…){2,}/g, "...");

  // Remove repeated identical short phrases (3+ consecutive repeats of 2-20 char phrases)
  cleaned = cleaned.replace(/(.{2,20}?)\1{2,}/g, "$1");

  // Collapse excessive whitespace left after removals
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  return cleaned.trim();
}
