import { describe, it, expect } from "vitest";
import { cleanWhisperOutput } from "../whisper-utils";

describe("cleanWhisperOutput", () => {
  it("should remove sentence-level duplication (said once, transcribed twice)", () => {
    expect(
      cleanWhisperOutput("你好吗,请把我刚才说的话翻译一下，请把我刚才说的话翻译一下，"),
    ).toBe("你好吗,请把我刚才说的话翻译一下，");
  });

  it("should remove English sentence duplication when exactly repeated", () => {
    // Exact back-to-back repetition (as Whisper may produce)
    expect(
      cleanWhisperOutput("how are you today, how are you today, "),
    ).toBe("how are you today,");
  });

  it("should not modify text without duplication", () => {
    expect(cleanWhisperOutput("你好吗，今天天气怎么样？")).toBe(
      "你好吗，今天天气怎么样？",
    );
  });

  it("should preserve short legitimate repeated patterns", () => {
    expect(cleanWhisperOutput("好的好的")).toBe("好的好的");
  });

  it("should remove 3+ consecutive short repeats", () => {
    // Minimum group size is 2 chars, so "哈哈" x4 + leftover "哈" → "哈哈哈"
    expect(cleanWhisperOutput("哈哈哈哈哈哈哈哈哈")).toBe("哈哈哈");
    // Clean 3+ consecutive repeats of multi-char phrases
    expect(cleanWhisperOutput("好的好的好的好的")).toBe("好的");
  });

  it("should not modify normal sentences", () => {
    expect(cleanWhisperOutput("Hello, how are you?")).toBe(
      "Hello, how are you?",
    );
  });

  it("should remove bracketed annotations", () => {
    expect(cleanWhisperOutput("[BLANK_AUDIO] Hello")).toBe("Hello");
    expect(cleanWhisperOutput("[sad music] test")).toBe("test");
  });

  it("should remove hallucinated filler phrases", () => {
    expect(cleanWhisperOutput("Hello. Thanks for watching")).toBe("Hello.");
  });

  it("should handle triple+ sentence repeats", () => {
    expect(
      cleanWhisperOutput("这是一句话。这是一句话。这是一句话。"),
    ).toBe("这是一句话。");
  });

  it("should handle empty input", () => {
    expect(cleanWhisperOutput("")).toBe("");
  });
});
