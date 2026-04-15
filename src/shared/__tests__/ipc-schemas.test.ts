import { describe, it, expect } from "vitest";
import {
  translateTextSchema,
  translateStreamSchema,
  saveMessageSchema,
  updateTranslationSchema,
  checkModelSchema,
} from "../../shared/ipc-schemas";

describe("IPC Schemas", () => {
  describe("translateTextSchema", () => {
    it("should accept valid input", () => {
      const result = translateTextSchema.parse({
        text: "Hello",
        sourceLang: "en",
        targetLang: "zh",
      });
      expect(result.text).toBe("Hello");
    });

    it("should reject empty text", () => {
      expect(() =>
        translateTextSchema.parse({
          text: "",
          sourceLang: "en",
          targetLang: "zh",
        }),
      ).toThrow();
    });

    it("should reject text exceeding max length", () => {
      expect(() =>
        translateTextSchema.parse({
          text: "a".repeat(10001),
          sourceLang: "en",
          targetLang: "zh",
        }),
      ).toThrow();
    });

    it("should reject invalid language code", () => {
      expect(() =>
        translateTextSchema.parse({
          text: "Hello",
          sourceLang: "invalid",
          targetLang: "zh",
        }),
      ).toThrow();
    });
  });

  describe("translateStreamSchema", () => {
    it("should accept valid input with requestId", () => {
      const result = translateStreamSchema.parse({
        text: "Hello",
        sourceLang: "en",
        targetLang: "zh",
        requestId: "req-123",
      });
      expect(result.requestId).toBe("req-123");
    });

    it("should reject empty requestId", () => {
      expect(() =>
        translateStreamSchema.parse({
          text: "Hello",
          sourceLang: "en",
          targetLang: "zh",
          requestId: "",
        }),
      ).toThrow();
    });
  });

  describe("saveMessageSchema", () => {
    it("should accept valid keyboard message", () => {
      const result = saveMessageSchema.parse({
        text: "Hello",
        detectedLang: "en",
        inputType: "keyboard",
      });
      expect(result.inputType).toBe("keyboard");
    });

    it("should accept valid voice message with translation", () => {
      const result = saveMessageSchema.parse({
        text: "Hello",
        detectedLang: "en",
        inputType: "voice",
        translation: "你好",
        targetLang: "zh",
      });
      expect(result.translation).toBe("你好");
    });

    it("should reject invalid inputType", () => {
      expect(() =>
        saveMessageSchema.parse({
          text: "Hello",
          detectedLang: "en",
          inputType: "invalid",
        }),
      ).toThrow();
    });
  });

  describe("updateTranslationSchema", () => {
    it("should accept valid UUID messageId", () => {
      const result = updateTranslationSchema.parse({
        messageId: "550e8400-e29b-41d4-a716-446655440000",
        translation: "Hello",
        targetLang: "en",
      });
      expect(result.messageId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("should reject non-UUID messageId", () => {
      expect(() =>
        updateTranslationSchema.parse({
          messageId: "not-a-uuid",
          translation: "Hello",
          targetLang: "en",
        }),
      ).toThrow();
    });
  });

  describe("checkModelSchema", () => {
    it("should accept valid language pair", () => {
      const result = checkModelSchema.parse({
        sourceLang: "zh",
        targetLang: "en",
      });
      expect(result.sourceLang).toBe("zh");
      expect(result.targetLang).toBe("en");
    });

    it("should reject unsupported language", () => {
      expect(() =>
        checkModelSchema.parse({
          sourceLang: "xx",
          targetLang: "en",
        }),
      ).toThrow();
    });
  });
});
