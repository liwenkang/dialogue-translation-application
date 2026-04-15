// Pure utility functions shared across streaming audio hooks

const TARGET_SAMPLE_RATE = 16000;

export { TARGET_SAMPLE_RATE };

export function detectPunctuationStyle(text: string, language?: string) {
  const eastAsian =
    language === "zh" ||
    language === "ja" ||
    /[\u4e00-\u9fff\u3040-\u30ff]/.test(text);

  return eastAsian
    ? { clause: "，", sentence: "。" }
    : { clause: ",", sentence: "." };
}

export function trimLeadingSeparators(text: string): string {
  return text.replace(/^[\s，。！？、,.!?;:]+/, "").trimStart();
}

export function trimTrailingSeparators(text: string): string {
  return text.replace(/[\s，。！？、,.!?;:]+$/u, "").trimEnd();
}

export function ensureEndingPunctuation(
  text: string,
  punctuation: string,
): string {
  const trimmed = trimTrailingSeparators(text);
  if (!trimmed) {
    return "";
  }
  return `${trimmed}${punctuation}`;
}

export function replaceFinalPunctuation(text: string, punctuation: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return "";
  }

  if (/[，。！？、,.!?;:]+$/u.test(trimmed)) {
    return `${trimmed.replace(/[，。！？、,.!?;:]+$/u, "")}${punctuation}`;
  }

  return `${trimmed}${punctuation}`;
}

export function findIncrementalTail(baseText: string, nextText: string): string {
  if (!baseText) {
    return nextText.trim();
  }

  if (nextText.startsWith(baseText)) {
    return trimLeadingSeparators(nextText.slice(baseText.length));
  }

  let prefixLength = 0;
  const maxLength = Math.min(baseText.length, nextText.length);
  while (
    prefixLength < maxLength &&
    baseText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength++;
  }

  return trimLeadingSeparators(nextText.slice(prefixLength));
}

export function joinCommittedSegments(current: string, segment: string): string {
  if (!current) {
    return segment;
  }
  return `${current}${segment}`;
}

function isCJKChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

export function findStablePrefix(prev: string, curr: string): string {
  const minLen = Math.min(prev.length, curr.length);
  let matchEnd = 0;
  while (matchEnd < minLen && prev[matchEnd] === curr[matchEnd]) {
    matchEnd++;
  }
  if (matchEnd === 0) return "";
  if (matchEnd >= minLen) return curr.substring(0, matchEnd);

  // If last matched char is CJK, it's a valid boundary
  if (isCJKChar(curr[matchEnd - 1])) {
    return curr.substring(0, matchEnd);
  }

  // For non-CJK, back up to word boundary (space or punctuation)
  let adjusted = matchEnd;
  while (
    adjusted > 0 &&
    !/[\s，。？！,.?!；;：:、\n]/.test(curr[adjusted - 1])
  ) {
    adjusted--;
  }
  return curr.substring(0, adjusted || 0);
}

export function getMajorityLanguage(votes: string[]): string {
  if (votes.length === 0) return "unknown";
  const counts = new Map<string, number>();
  for (const lang of votes) {
    if (lang && lang !== "unknown") {
      counts.set(lang, (counts.get(lang) || 0) + 1);
    }
  }
  let maxCount = 0;
  let majority = votes[votes.length - 1] || "unknown";
  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      majority = lang;
    }
  }
  return majority;
}

export function computeRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Encode Float32 PCM samples to 16-bit WAV format
 */
export function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
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

/**
 * Resample audio using OfflineAudioContext (high quality).
 */
export async function resampleAudio(
  samples: Float32Array,
  inputRate: number,
  outputRate: number,
): Promise<Float32Array> {
  if (inputRate === outputRate) return samples;
  const outputLength = Math.ceil(
    (samples.length / inputRate) * outputRate,
  );
  if (outputLength <= 0) return new Float32Array(0);

  const offlineCtx = new OfflineAudioContext(1, outputLength, outputRate);
  const buffer = offlineCtx.createBuffer(1, samples.length, inputRate);
  buffer.getChannelData(0).set(samples);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
