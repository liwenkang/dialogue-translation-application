import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "./constants";

const validLangCodes = SUPPORTED_LANGUAGES.map((l) => l.code) as [
  string,
  ...string[],
];

export const langCodeSchema = z.enum(validLangCodes);

export const translateTextSchema = z.object({
  text: z
    .string()
    .min(1, "Text must not be empty")
    .max(10000, "Text must not exceed 10000 characters"),
  sourceLang: langCodeSchema,
  targetLang: langCodeSchema,
});

export const translateStreamSchema = translateTextSchema.extend({
  requestId: z.string().min(1).max(200),
});

export const saveMessageSchema = z.object({
  text: z
    .string()
    .min(1, "Text must not be empty")
    .max(10000, "Text must not exceed 10000 characters"),
  detectedLang: z.string().min(1).max(10),
  inputType: z.enum(["keyboard", "voice"]),
  translation: z.string().optional(),
  targetLang: z.string().max(10).optional(),
});

export const updateTranslationSchema = z.object({
  messageId: z.string().uuid(),
  translation: z.string().max(50000),
  targetLang: langCodeSchema,
});

export const checkModelSchema = z.object({
  sourceLang: langCodeSchema,
  targetLang: langCodeSchema,
});

export const installPairSchema = z.object({
  sourceLang: langCodeSchema,
  targetLang: langCodeSchema,
});

export const deletePairSchema = z.object({
  sourceLang: langCodeSchema,
  targetLang: langCodeSchema,
});

export const checkInstalledSchema = z.object({
  targetLang: langCodeSchema,
});

export const installModelSchema = z.object({
  targetLang: langCodeSchema,
});

export const deleteMessageSchema = z.object({
  messageId: z.string().uuid(),
});

export const exportMessagesSchema = z.object({
  format: z.enum(["txt", "csv"]),
});
