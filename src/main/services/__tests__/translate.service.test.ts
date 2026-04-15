import { describe, it, expect, vi } from "vitest";

// Mock electron app
vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/test",
    getAppPath: () => "/tmp/test-app",
  },
}));

const { TranslateService } = await import(
  "../translate.service"
);

describe("TranslateService.splitIntoSentences", () => {
  const service = new TranslateService();

  it("should return empty array for empty string", () => {
    expect(service.splitIntoSentences("")).toEqual([]);
  });

  it("should return empty array for whitespace-only string", () => {
    expect(service.splitIntoSentences("   ")).toEqual([]);
  });

  it("should split on Chinese sentence-ending punctuation", () => {
    const result = service.splitIntoSentences("你好。世界！");
    expect(result).toEqual(["你好。", "世界！"]);
  });

  it("should split on English sentence-ending punctuation", () => {
    const result = service.splitIntoSentences("Hello. World!");
    expect(result).toEqual(["Hello.", "World!"]);
  });

  it("should split on newlines", () => {
    const result = service.splitIntoSentences("Line one.\nLine two.");
    expect(result).toEqual(["Line one.", "Line two."]);
  });

  it("should handle short text without sentence boundaries", () => {
    const result = service.splitIntoSentences("Hi");
    expect(result).toEqual(["Hi"]);
  });

  it("should split long segments without sentence boundaries by clause punctuation", () => {
    const result = service.splitIntoSentences(
      "这是一段很长的文本内容需要被正确的分割开来以确保翻译质量不会受到影响，包含了很多不同的内容和信息在里面需要逐一处理，还有更多的内容和文字在后面等待着被翻译成其他语言以便于国际化使用",
    );
    // Should be split by clause punctuation (，)
    expect(result.length).toBeGreaterThan(1);
    // Joined result should contain all original content
    const joined = result.join("");
    expect(joined.replace(/\s/g, "")).toContain("这是一段很长的文本");
  });

  it("should handle mixed Chinese and English", () => {
    const result = service.splitIntoSentences("Hello世界。你好World！");
    expect(result).toEqual(["Hello世界。", "你好World！"]);
  });
});
