import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  systemPreferences,
} from "electron";
import path from "path";
import { StorageService } from "./services/storage.service";
import { WhisperService } from "./services/whisper.service";
import { ModelManagerService } from "./services/model-manager.service";
import { TranslateService } from "./services/translate.service";
import { TranslateModelService } from "./services/translate-model.service";
import { PerformanceService } from "./services/performance.service";
import { StreamingRecognitionService } from "./services/streaming-recognition.service";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { OPUS_MT_MODELS } from "../shared/constants";
import fs from "fs";
import {
  translateTextSchema,
  translateStreamSchema,
  saveMessageSchema,
  updateTranslationSchema,
  checkModelSchema,
  installPairSchema,
  deletePairSchema,
  checkInstalledSchema,
  installModelSchema,
  deleteMessageSchema,
  exportMessagesSchema,
} from "../shared/ipc-schemas";
import { RateLimiter } from "./utils/rate-limiter";
import type { MediaAccessStatus } from "../shared/types";

// Rate limiters: max 3 translation requests per second, 5 storage writes per second
const translateLimiter = new RateLimiter(3, 1000);
const storageLimiter = new RateLimiter(5, 1000);

let mainWindow: BrowserWindow | null = null;
let storageService: StorageService;
let whisperService: WhisperService;
let modelManagerService: ModelManagerService;
let translateService: TranslateService;
let translateModelService: TranslateModelService;
let performanceService: PerformanceService;
let streamingRecognitionService: StreamingRecognitionService;

function createWindow() {
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: isMac
      ? undefined
      : { color: "#ffffff", symbolColor: "#1f2937", height: 40 },
    show: false,
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  // App IPC
  ipcMain.handle(IPC_CHANNELS.APP.GET_PLATFORM, () => process.platform);
  ipcMain.handle(
    IPC_CHANNELS.APP.GET_MICROPHONE_ACCESS_STATUS,
    (): MediaAccessStatus => {
      if (process.platform !== "darwin") {
        return "granted";
      }
      return systemPreferences.getMediaAccessStatus("microphone");
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.APP.REQUEST_MICROPHONE_ACCESS,
    async (): Promise<boolean> => {
      if (process.platform !== "darwin") {
        return true;
      }
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status === "granted") {
        return true;
      }
      if (status === "denied" || status === "restricted") {
        return false;
      }
      return systemPreferences.askForMediaAccess("microphone");
    },
  );

  // Storage IPC
  ipcMain.handle(
    IPC_CHANNELS.STORAGE.GET_MESSAGES,
    async (_event, limit?: number, beforeTimestamp?: number) => {
      return storageService.getMessages(limit, beforeTimestamp);
    },
  );

  ipcMain.handle(IPC_CHANNELS.STORAGE.SAVE_MESSAGE, async (_event, message) => {
    if (!storageLimiter.tryAcquire()) {
      throw new Error("Rate limit exceeded for save message");
    }
    const parsed = saveMessageSchema.parse(message);
    return storageService.saveMessage(parsed);
  });

  ipcMain.handle(
    IPC_CHANNELS.STORAGE.UPDATE_TRANSLATION,
    async (_event, messageId, translation, targetLang) => {
      if (!storageLimiter.tryAcquire()) {
        throw new Error("Rate limit exceeded for update translation");
      }
      const parsed = updateTranslationSchema.parse({
        messageId,
        translation,
        targetLang,
      });
      return storageService.updateTranslation(
        parsed.messageId,
        parsed.translation,
        parsed.targetLang,
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.STORAGE.CLEAR_MESSAGES, async () => {
    return storageService.clearMessages();
  });

  ipcMain.handle(
    IPC_CHANNELS.STORAGE.DELETE_MESSAGE,
    async (_event, messageId: string) => {
      if (!storageLimiter.tryAcquire()) {
        throw new Error("Rate limit exceeded for delete message");
      }
      const parsed = deleteMessageSchema.parse({ messageId });
      return storageService.deleteMessage(parsed.messageId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.STORAGE.EXPORT_MESSAGES,
    async (_event, format: string) => {
      const parsed = exportMessagesSchema.parse({ format });
      return storageService.exportMessages(parsed.format);
    },
  );

  // Whisper IPC
  ipcMain.handle(IPC_CHANNELS.WHISPER.CHECK_AVAILABILITY, async () => {
    return whisperService.checkAvailability();
  });

  ipcMain.handle(
    IPC_CHANNELS.WHISPER.TRANSCRIBE,
    async (_event, audioBuffer: ArrayBuffer) => {
      const endTimer = performanceService.startTimer("whisper:transcribe");
      const result = await whisperService.transcribe(Buffer.from(audioBuffer));
      endTimer();
      return result;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WHISPER.STREAM_SEGMENT,
    async (_event, audioBuffer: ArrayBuffer, segmentIndex: number) => {
      const endTimer = performanceService.startTimer(
        `whisper:stream-segment-${segmentIndex}`,
      );
      const result = await whisperService.transcribe(Buffer.from(audioBuffer));
      endTimer();
      return {
        segmentIndex,
        text: result.text,
        language: result.language,
        isFinal: true,
      };
    },
  );

  // Streaming recognition IPC
  ipcMain.handle(IPC_CHANNELS.WHISPER.STREAM_START, async () => {
    const sessionId = streamingRecognitionService.startSession();
    return { sessionId };
  });

  ipcMain.on(
    IPC_CHANNELS.WHISPER.STREAM_AUDIO,
    (_event, sessionId: string, audioData: ArrayBuffer | Float32Array) => {
      const float32 =
        audioData instanceof Float32Array
          ? audioData
          : new Float32Array(audioData);
      streamingRecognitionService.handleAudioChunk(sessionId, float32);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WHISPER.STREAM_END,
    async (_event, sessionId: string) => {
      return streamingRecognitionService.endSession(sessionId);
    },
  );

  // Model IPC
  ipcMain.handle(
    IPC_CHANNELS.MODEL.DOWNLOAD,
    async (_event, modelId: string) => {
      if (!mainWindow) throw new Error("No main window");
      if (modelId === "whisper-base") {
        await modelManagerService.downloadWhisperModel(mainWindow, isHfMirrorEnabled());
      }
    },
  );

  // Translate IPC
  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.CHECK_MODEL,
    async (_event, sourceLang: string, targetLang: string) => {
      // Validate language codes — invalid codes are definitely unavailable
      let parsed;
      try {
        parsed = checkModelSchema.parse({ sourceLang, targetLang });
      } catch {
        return { available: false, direct: false, pivot: false };
      }
      // Let service-start errors propagate so renderer can retry
      return await translateService.checkModelAvailability(
        parsed.sourceLang,
        parsed.targetLang,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.TEXT,
    async (_event, text: string, sourceLang: string, targetLang: string) => {
      if (!translateLimiter.tryAcquire()) {
        throw new Error("Rate limit exceeded for translation");
      }
      const parsed = translateTextSchema.parse({
        text,
        sourceLang,
        targetLang,
      });
      const endTimer = performanceService.startTimer("translate:text");
      const translation = await translateService.translate(
        parsed.text,
        parsed.sourceLang,
        parsed.targetLang,
      );
      endTimer();
      return {
        text: translation,
        sourceLang: parsed.sourceLang,
        targetLang: parsed.targetLang,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.TEXT_STREAM,
    async (
      _event,
      text: string,
      sourceLang: string,
      targetLang: string,
      requestId: string,
    ) => {
      if (!translateLimiter.tryAcquire()) {
        throw new Error("Rate limit exceeded for streaming translation");
      }
      const parsed = translateStreamSchema.parse({
        text,
        sourceLang,
        targetLang,
        requestId,
      });
      await translateService.translateStream(
        parsed.text,
        parsed.sourceLang,
        parsed.targetLang,
        (chunk) => {
          if (mainWindow) {
            mainWindow.webContents.send(
              IPC_CHANNELS.TRANSLATE.TEXT_STREAM_CHUNK,
              {
                requestId: parsed.requestId,
                ...chunk,
              },
            );
          }
        },
      );
    },
  );

  // Translation model install IPC
  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.CHECK_INSTALLED,
    async (_event, targetLang: string) => {
      const parsed = checkInstalledSchema.parse({ targetLang });
      const missing = translateModelService
        .getMissingModels("zh", parsed.targetLang)
        .concat(
          translateModelService.getMissingModels("en", parsed.targetLang),
        );
      // Deduplicate
      const seen = new Set<string>();
      const unique = missing.filter((p) => {
        const key = `${p.source}-${p.target}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { installed: unique.length === 0, missing: unique };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.INSTALL_MODEL,
    async (_event, targetLang: string) => {
      if (!mainWindow) throw new Error("No main window");
      const parsed = installModelSchema.parse({ targetLang });
      await translateModelService.installModelsForLanguage(
        parsed.targetLang,
        mainWindow,
        isHfMirrorEnabled(),
      );
      // Restart translate service to pick up new models
      await translateService.stop();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.INSTALL_PAIR,
    async (_event, sourceLang: string, targetLang: string) => {
      if (!mainWindow) throw new Error("No main window");
      const parsed = installPairSchema.parse({ sourceLang, targetLang });
      await translateModelService.installModel(
        parsed.sourceLang,
        parsed.targetLang,
        mainWindow,
        isHfMirrorEnabled(),
      );
      // Restart translate service to pick up new models
      await translateService.stop();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSLATE.DELETE_PAIR,
    async (_event, sourceLang: string, targetLang: string) => {
      const parsed = deletePairSchema.parse({ sourceLang, targetLang });
      translateModelService.deleteModel(parsed.sourceLang, parsed.targetLang);
      // Restart translate service so it drops the cached model
      await translateService.stop();
    },
  );

  ipcMain.handle(IPC_CHANNELS.TRANSLATE.ALL_MODEL_STATUS, async () => {
    const statuses: { source: string; target: string; installed: boolean }[] =
      [];
    for (const pair of Object.keys(OPUS_MT_MODELS)) {
      const [source, target] = pair.split("-");
      statuses.push({
        source,
        target,
        installed: translateModelService.isModelInstalled(source, target),
      });
    }
    return statuses;
  });

  // Settings IPC
  const settingsPath = path.join(app.getPath("userData"), "settings.json");

  function readSettings(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      return {};
    }
  }

  function writeSettings(settings: Record<string, unknown>): void {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  }

  function isHfMirrorEnabled(): boolean {
    return readSettings().hfMirror === true;
  }

  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET_HF_MIRROR, async () => {
    return isHfMirrorEnabled();
  });

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.SET_HF_MIRROR,
    async (_event, enabled: boolean) => {
      const settings = readSettings();
      settings.hfMirror = !!enabled;
      writeSettings(settings);
    },
  );

  // Performance IPC
  ipcMain.handle(IPC_CHANNELS.PERFORMANCE.GET_REPORT, async () => {
    return performanceService.getReport();
  });

  ipcMain.handle(IPC_CHANNELS.PERFORMANCE.TAKE_SNAPSHOT, async () => {
    const snapshot = performanceService.takeSnapshot("manual");
    return snapshot;
  });
}

app.whenReady().then(() => {
  performanceService = new PerformanceService();
  performanceService.takeSnapshot("app-start");

  storageService = new StorageService();
  whisperService = new WhisperService();
  modelManagerService = new ModelManagerService(
    path.join(app.getPath("userData"), "models"),
  );
  translateService = new TranslateService();
  translateModelService = new TranslateModelService();
  streamingRecognitionService = new StreamingRecognitionService(whisperService);
  streamingRecognitionService.setCallbacks(
    (data) => {
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.WHISPER.STREAM_PARTIAL, data);
      }
    },
    (data) => {
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.WHISPER.STREAM_COMMIT, data);
      }
    },
  );
  registerIpcHandlers();
  createWindow();

  performanceService.takeSnapshot("app-ready");

  // Pre-warm whisper server so model is loaded before first use
  whisperService.preWarm().catch((err) => {
    console.warn("Whisper pre-warm failed:", err);
  });

  // Pre-warm translate service so it is ready before first streaming translation
  translateService.start().catch((err) => {
    console.warn("Translate service pre-warm failed:", err);
  });

  // Register global shortcut for voice recording toggle
  const shortcutRegistered = globalShortcut.register(
    "CmdOrCtrl+Shift+Space",
    () => {
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.AUDIO.TOGGLE);
      }
    },
  );

  if (!shortcutRegistered) {
    console.warn(
      "Failed to register global shortcut CmdOrCtrl+Shift+Space — " +
        "it may conflict with another application. " +
        "Voice toggle is still available via the in-app button.",
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  streamingRecognitionService?.cleanup();
  translateService?.stop();
  whisperService?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
