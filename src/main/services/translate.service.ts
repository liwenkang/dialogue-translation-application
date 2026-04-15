import { ChildProcess, spawn } from "child_process";
import path from "path";
import readline from "readline";
import { app } from "electron";
import { STREAMING_CHUNK_MAX_CHARS } from "../../shared/constants";

interface TranslateResponse {
  id: number;
  success: boolean;
  translation?: string;
  message?: string;
  error?: string;
  error_type?: string;
  available?: boolean;
  direct?: boolean;
  pivot?: boolean;
}

const STREAMING_CHUNK_MAX_CHARS_LEGACY = STREAMING_CHUNK_MAX_CHARS;

export class TranslateService {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private startupPromise: Promise<void> | null = null;
  private pendingRequests: Map<
    number,
    {
      resolve: (value: TranslateResponse) => void;
      reject: (reason: Error) => void;
    }
  > = new Map();
  private requestId = 0;
  private isReady = false;
  private restartAttempts = 0;
  private static readonly MAX_RESTART_ATTEMPTS = 3;
  private isRestarting = false;

  private getModelsDir(): string {
    return path.join(app.getPath("userData"), "models", "opus-mt");
  }

  private getServerBinary(): string {
    const fs = require("fs");

    // In development, use the Python script directly
    const devScript = path.join(
      app.getAppPath(),
      "native",
      "ctranslate2",
      "translate_server.py",
    );
    if (fs.existsSync(devScript)) {
      return devScript;
    }

    // In production, use the frozen binary from extraResources
    const binaryName =
      process.platform === "win32"
        ? "translate-server.exe"
        : "translate-server";
    return path.join(process.resourcesPath, "translate-server", binaryName);
  }

  private isDev(): boolean {
    const fs = require("fs");
    return fs.existsSync(
      path.join(
        app.getAppPath(),
        "native",
        "ctranslate2",
        "translate_server.py",
      ),
    );
  }

  private getDevPython(): string {
    const fs = require("fs");
    const isWin = process.platform === "win32";
    const venvPython = isWin
      ? path.join(
          app.getAppPath(),
          ".pyinstaller-venv",
          "Scripts",
          "python.exe",
        )
      : path.join(app.getAppPath(), ".pyinstaller-venv", "bin", "python3");
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
    return "python3";
  }

  async start(): Promise<void> {
    if (this.isReady && this.process && !this.process.killed) {
      return;
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    const serverBinary = this.getServerBinary();
    const modelsDir = this.getModelsDir();

    // In dev mode, launch via venv python; in production, run the frozen binary directly
    const spawnArgs: [string, string[]] = this.isDev()
      ? [this.getDevPython(), [serverBinary, modelsDir]]
      : [serverBinary, [modelsDir]];

    this.startupPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      const finishStartup = (error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(startupTimeout);
        this.startupPromise = null;

        if (error) {
          this.isReady = false;
          this.process?.stdin?.end();
          if (this.process && !this.process.killed) {
            this.process.kill();
          }
          this.rl?.close();
          this.process = null;
          this.rl = null;
          reject(error);
          return;
        }

        this.isReady = true;
        resolve();
      };

      this.process = spawn(spawnArgs[0], spawnArgs[1], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          KMP_DUPLICATE_LIB_OK: "TRUE",
          OMP_NUM_THREADS: "4",
        },
      });

      this.rl = readline.createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      // Handle first line (ready signal)
      let gotReady = false;

      this.rl.on("line", (line: string) => {
        try {
          const response: TranslateResponse = JSON.parse(line);

          if (!gotReady && response.id === 0 && response.success) {
            gotReady = true;
            finishStartup();
            return;
          }

          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          }
        } catch (err) {
          console.error("Failed to parse translate response:", line);
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        console.error("[translate-server]", data.toString());
      });

      this.process.on("error", (err) => {
        this.isReady = false;
        if (!gotReady) {
          finishStartup(err);
        }
      });

      this.process.on("exit", (code) => {
        const exitedProcess = this.process;
        this.isReady = false;
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(
            new Error(`Translation process exited with code ${code}`),
          );
          this.pendingRequests.delete(id);
        }

        this.process = null;
        this.rl = null;

        if (!gotReady) {
          finishStartup(
            new Error(
              `Translation process exited before startup completed (code ${code})`,
            ),
          );
          return;
        }

        // Auto-restart on unexpected exit (not from explicit stop())
        if (exitedProcess && !exitedProcess.killed) {
          this.scheduleRestart();
        }
      });

      // Timeout for startup
      const startupTimeout = setTimeout(() => {
        if (!gotReady) {
          finishStartup(new Error("Translation service startup timeout"));
        }
      }, 30000);
    });

    return this.startupPromise;
  }

  private scheduleRestart(): void {
    if (
      this.isRestarting ||
      this.restartAttempts >= TranslateService.MAX_RESTART_ATTEMPTS
    ) {
      console.error(
        `[translate-server] Max restart attempts (${TranslateService.MAX_RESTART_ATTEMPTS}) reached, giving up`,
      );
      return;
    }

    this.isRestarting = true;
    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, this.restartAttempts) * 1000;
    this.restartAttempts++;
    console.log(
      `[translate-server] Scheduling restart attempt ${this.restartAttempts} in ${delay}ms`,
    );

    setTimeout(async () => {
      try {
        this.process = null;
        this.rl = null;
        this.isReady = false;
        await this.start();
        console.log("[translate-server] Restarted successfully");
        this.restartAttempts = 0;
      } catch (err) {
        console.error("[translate-server] Restart failed:", err);
      } finally {
        this.isRestarting = false;
      }
    }, delay);
  }

  private sendRequest(
    request: Record<string, unknown>,
  ): Promise<TranslateResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin || this.process.killed) {
        reject(new Error("Translation service not running"));
        return;
      }

      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const line = JSON.stringify({ ...request, id }) + "\n";
      this.process.stdin.write(line);

      // Timeout per request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Translation request timeout"));
        }
      }, 30000);
    });
  }

  async translate(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<string> {
    if (!this.isReady) {
      await this.start();
    }

    try {
      const response = await this.sendRequest({
        action: "translate",
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      });

      if (!response.success) {
        throw new Error(response.error || "Translation failed");
      }

      // Reset restart counter on successful request
      this.restartAttempts = 0;
      return response.translation!;
    } catch (err) {
      // If process died mid-request, try once more
      if (
        !this.isReady &&
        this.restartAttempts < TranslateService.MAX_RESTART_ATTEMPTS
      ) {
        await this.start();
        const response = await this.sendRequest({
          action: "translate",
          text,
          source_lang: sourceLang,
          target_lang: targetLang,
        });
        if (!response.success) {
          throw new Error(response.error || "Translation failed");
        }
        this.restartAttempts = 0;
        return response.translation!;
      }
      throw err;
    }
  }

  async checkModelAvailability(
    sourceLang: string,
    targetLang: string,
  ): Promise<{ available: boolean; direct: boolean; pivot: boolean }> {
    if (!this.isReady) {
      await this.start();
    }

    const response = await this.sendRequest({
      action: "check_model",
      source_lang: sourceLang,
      target_lang: targetLang,
    });

    return {
      available: response.available ?? false,
      direct: response.direct ?? false,
      pivot: response.pivot ?? false,
    };
  }

  /**
   * Split text into translation-friendly chunks based on sentence boundaries.
   * Prefers splitting at sentence-ending punctuation, then clause-level punctuation,
   * then word boundaries, and only falls back to character splitting as last resort.
   */
  splitIntoSentences(text: string): string[] {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }

    // Split at sentence-ending punctuation first
    const sentenceParts = normalized.split(/(?<=[。！？.!?\n])\s*/);
    const chunks: string[] = [];

    const pushChunk = (value: string) => {
      const trimmed = value.trim();
      if (trimmed) {
        chunks.push(trimmed);
      }
    };

    const splitLongSegment = (segment: string) => {
      // Try splitting at clause-level punctuation
      const clauseParts = segment
        .split(/(?<=[，、；;：:,])\s*/)
        .map((part) => part.trim())
        .filter(Boolean);

      if (clauseParts.length > 1) {
        let current = "";
        for (const clause of clauseParts) {
          const next = current ? `${current}${clause}` : clause;
          if (next.length <= STREAMING_CHUNK_MAX_CHARS_LEGACY) {
            current = next;
            continue;
          }

          if (current) {
            pushChunk(current);
          }

          if (clause.length <= STREAMING_CHUNK_MAX_CHARS_LEGACY) {
            current = clause;
            continue;
          }

          // Split at word boundaries for Latin scripts
          splitAtWordBoundary(clause);
          current = "";
        }

        if (current) {
          pushChunk(current);
        }
        return;
      }

      splitAtWordBoundary(segment);
    };

    const splitAtWordBoundary = (segment: string) => {
      // For texts with spaces (Latin scripts), split at word boundaries
      if (/\s/.test(segment)) {
        const words = segment.split(/\s+/);
        let current = "";
        for (const word of words) {
          const next = current ? `${current} ${word}` : word;
          if (next.length <= STREAMING_CHUNK_MAX_CHARS_LEGACY) {
            current = next;
          } else {
            if (current) pushChunk(current);
            current = word;
          }
        }
        if (current) pushChunk(current);
        return;
      }

      // CJK text without punctuation: split at max chars
      for (
        let index = 0;
        index < segment.length;
        index += STREAMING_CHUNK_MAX_CHARS_LEGACY
      ) {
        pushChunk(
          segment.slice(index, index + STREAMING_CHUNK_MAX_CHARS_LEGACY),
        );
      }
    };

    for (const part of sentenceParts) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.length <= STREAMING_CHUNK_MAX_CHARS_LEGACY) {
        pushChunk(trimmed);
        continue;
      }

      splitLongSegment(trimmed);
    }

    return chunks;
  }

  /**
   * Translate text in chunks (sentence by sentence), calling onChunk for each result.
   */
  async translateStream(
    text: string,
    sourceLang: string,
    targetLang: string,
    onChunk: (chunk: {
      chunkIndex: number;
      totalChunks: number;
      originalChunk: string;
      translatedChunk: string;
      done: boolean;
    }) => void,
  ): Promise<string> {
    if (!this.isReady) {
      await this.start();
    }

    const sentences = this.splitIntoSentences(text);
    const translatedParts: string[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const translation = await this.translate(
        sentence,
        sourceLang,
        targetLang,
      );
      translatedParts.push(translation);

      onChunk({
        chunkIndex: i,
        totalChunks: sentences.length,
        originalChunk: sentence,
        translatedChunk: translation,
        done: i === sentences.length - 1,
      });
    }

    return translatedParts.join(targetLang === "zh" ? "" : " ");
  }

  async stop(): Promise<void> {
    this.restartAttempts = TranslateService.MAX_RESTART_ATTEMPTS; // Prevent auto-restart
    this.startupPromise = null;
    if (this.process && !this.process.killed) {
      this.process.stdin?.end();
      this.process.kill();
    }
    this.rl?.close();
    this.isReady = false;
    this.process = null;
    this.rl = null;
    this.restartAttempts = 0; // Reset for future starts
  }
}
