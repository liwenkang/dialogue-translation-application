import { ChildProcess, execFile, spawn } from "child_process";
import { promisify } from "util";
import http from "http";
import path from "path";
import fs from "fs";
import { app } from "electron";
import { WHISPER_MODEL_FILENAME } from "../../shared/constants";
import { cleanWhisperOutput } from "../../shared/whisper-utils";
import * as OpenCC from "opencc-js";

const execFileAsync = promisify(execFile);

const WHISPER_SERVER_PORT = 18080;
const WHISPER_SERVER_HOST = "127.0.0.1";

// Traditional Chinese → Simplified Chinese converter
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });

export class WhisperService {
  private modelsDir: string;
  private cliBinaryPath: string | null = null;
  private serverBinaryPath: string | null = null;
  private serverProcess: ChildProcess | null = null;
  private serverReady = false;
  private startingServer = false;
  // Mutex to serialize CLI invocations (concurrent runs thrash CPU and may fail)
  private cliQueue: Promise<{ text: string; language: string }> =
    Promise.resolve({ text: "", language: "" });
  // Health check for persistent server
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 30000;
  private restartAttempts = 0;
  private static readonly MAX_RESTART_ATTEMPTS = 3;

  constructor() {
    this.modelsDir = path.join(app.getPath("userData"), "models", "whisper");
  }

  getModelPath(): string {
    return path.join(this.modelsDir, WHISPER_MODEL_FILENAME);
  }

  private async findBinaryByNames(names: string[]): Promise<string | null> {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    for (const name of names) {
      try {
        const { stdout } = await execFileAsync(whichCmd, [name]);
        const found = stdout.trim().split("\n")[0];
        if (found) return found;
      } catch {
        // Not found, try next
      }
    }
    return null;
  }

  // Look for a bundled binary in extraResources/whisper-cpp/
  private findBundledBinary(name: string): string | null {
    const bundled = path.join(process.resourcesPath, "whisper-cpp", name);
    if (fs.existsSync(bundled)) return bundled;
    return null;
  }

  async findServerBinary(): Promise<string | null> {
    if (this.serverBinaryPath) return this.serverBinaryPath;
    const isWin = process.platform === "win32";
    const binaryName = isWin ? "whisper-server.exe" : "whisper-server";
    // Prefer bundled binary
    const bundled = this.findBundledBinary(binaryName);
    if (bundled) {
      this.serverBinaryPath = bundled;
      return bundled;
    }
    // Fallback to system PATH
    const found = await this.findBinaryByNames([binaryName]);
    if (found) this.serverBinaryPath = found;
    return found;
  }

  async findCliBinary(): Promise<string | null> {
    if (this.cliBinaryPath) return this.cliBinaryPath;
    const isWin = process.platform === "win32";
    const primaryName = isWin ? "whisper-cli.exe" : "whisper-cli";
    // Prefer bundled binary
    const bundled = this.findBundledBinary(primaryName);
    if (bundled) {
      this.cliBinaryPath = bundled;
      return bundled;
    }
    // Fallback to system PATH
    const names = isWin
      ? ["whisper-cli.exe", "whisper-cpp.exe", "whisper.exe", "main.exe"]
      : ["whisper-cli", "whisper-cpp", "whisper", "main"];
    const found = await this.findBinaryByNames(names);
    if (found) this.cliBinaryPath = found;
    return found;
  }

  isModelAvailable(): boolean {
    return fs.existsSync(this.getModelPath());
  }

  async isBinaryAvailable(): Promise<boolean> {
    return (
      (await this.findServerBinary()) !== null ||
      (await this.findCliBinary()) !== null
    );
  }

  async checkAvailability(): Promise<{
    binaryAvailable: boolean;
    modelAvailable: boolean;
  }> {
    return {
      binaryAvailable: await this.isBinaryAvailable(),
      modelAvailable: this.isModelAvailable(),
    };
  }

  /**
   * Start the whisper-server process and keep the model loaded in memory.
   */
  private async ensureServerRunning(): Promise<void> {
    if (this.serverReady) return;
    if (this.startingServer) {
      // Wait for the in-flight startup to finish
      while (this.startingServer) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.serverReady) return;
      throw new Error("Whisper server failed to start");
    }

    const binary = await this.findServerBinary();
    if (!binary) throw new Error("whisper-server not found");

    this.startingServer = true;
    try {
      const args = [
        "-m",
        this.getModelPath(),
        "-l",
        "auto",
        "--host",
        WHISPER_SERVER_HOST,
        "--port",
        String(WHISPER_SERVER_PORT),
        "-nt",
      ];

      const proc = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.serverProcess = proc;

      proc.on("exit", (code) => {
        console.log(`whisper-server exited with code ${code}`);
        this.serverReady = false;
        this.serverProcess = null;
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes("error") || msg.includes("Error")) {
          console.error("[whisper-server stderr]", msg.trim());
        }
      });

      // Wait until the server is accepting connections
      await this.waitForServer(15000);
      this.serverReady = true;
    } finally {
      this.startingServer = false;
    }
  }

  private async waitForServer(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.httpGet("/");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error("whisper-server did not become ready in time");
  }

  private httpGet(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: WHISPER_SERVER_HOST,
          port: WHISPER_SERVER_PORT,
          path,
          timeout: 2000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => resolve(data));
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
  }

  /**
   * Send audio to the running whisper-server via HTTP multipart/form-data.
   */
  private async inferViaServer(
    audioBuffer: Buffer,
  ): Promise<{ text: string; language: string }> {
    await this.ensureServerRunning();

    const boundary = `----WhisperBoundary${Date.now()}`;

    // Build multipart body
    const fields: Array<{ name: string; value: string }> = [
      { name: "temperature", value: "0.0" },
      { name: "temperature_inc", value: "0.2" },
      { name: "response_format", value: "verbose_json" },
    ];

    const parts: Buffer[] = [];
    for (const field of fields) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`,
        ),
      );
    }
    // File field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
    );
    parts.push(audioBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: WHISPER_SERVER_HOST,
          port: WHISPER_SERVER_PORT,
          path: "/inference",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length,
          },
          timeout: 30000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              // Extract language code from language_probabilities (keys are codes like "en", "zh")
              let language = "unknown";
              if (
                json.language_probabilities &&
                typeof json.language_probabilities === "object"
              ) {
                let maxProb = -1;
                for (const [code, prob] of Object.entries(
                  json.language_probabilities,
                )) {
                  if (typeof prob === "number" && prob > maxProb) {
                    maxProb = prob;
                    language = code;
                  }
                }
              }
              const text = (json.text || "").trim();
              resolve({ text, language });
            } catch {
              reject(
                new Error(`Failed to parse whisper-server response: ${data}`),
              );
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Whisper inference timeout"));
      });
      req.write(body);
      req.end();
    });
  }

  async transcribe(
    audioBuffer: Buffer,
  ): Promise<{ text: string; language: string }> {
    if (!this.isModelAvailable()) {
      throw new Error(
        "Whisper model not found. Please download the model first.",
      );
    }

    // Prefer whisper-server (persistent process, model stays in memory)
    const serverBinary = await this.findServerBinary();
    let result: { text: string; language: string };
    if (serverBinary) {
      result = await this.inferViaServer(audioBuffer);
    } else {
      // Fallback to CLI (spawns a new process each time, serialized)
      result = await this.transcribeViaCliQueued(audioBuffer);
    }

    // Clean up Whisper artifacts
    result.text = cleanWhisperOutput(result.text);

    // Convert Traditional Chinese to Simplified Chinese
    if (result.language === "zh" && result.text) {
      result.text = t2s(result.text);
    }

    return result;
  }

  private transcribeViaCliQueued(
    audioBuffer: Buffer,
  ): Promise<{ text: string; language: string }> {
    const result = this.cliQueue.then(
      () => this.transcribeViaCli(audioBuffer),
      () => this.transcribeViaCli(audioBuffer),
    );
    this.cliQueue = result;
    return result;
  }

  private async transcribeViaCli(
    audioBuffer: Buffer,
  ): Promise<{ text: string; language: string }> {
    const binary = await this.findCliBinary();
    if (!binary) {
      throw new Error(
        "Whisper binary not found. Install via: brew install whisper-cpp",
      );
    }

    const os = require("os");
    const tmpFile = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`);
    fs.writeFileSync(tmpFile, audioBuffer);

    try {
      const { stdout, stderr } = await execFileAsync(
        binary,
        ["-m", this.getModelPath(), "-f", tmpFile, "-l", "auto", "-nt"],
        {
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const langMatch = stderr.match(/auto-detected language:\s*(\w+)/);
      const language = langMatch ? langMatch[1] : "unknown";
      const text = stdout
        .trim()
        .replace(/^\s*\[.*?\]\s*/gm, "")
        .trim();

      return { text, language };
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Pre-warm the whisper-server: start it proactively so the model is loaded
   * before the first transcription request. Safe to call multiple times.
   */
  async preWarm(): Promise<void> {
    const serverBinary = await this.findServerBinary();
    if (!serverBinary || !this.isModelAvailable()) return;

    try {
      await this.ensureServerRunning();
      this.startHealthCheck();
      console.log("[whisper] Server pre-warmed and health check started");
    } catch (err) {
      console.warn("[whisper] Pre-warm failed, will start on first use:", err);
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      if (!this.serverReady || !this.serverProcess) return;

      try {
        await this.httpGet("/");
        this.restartAttempts = 0;
      } catch {
        console.warn("[whisper] Health check failed, server may be down");
        this.serverReady = false;

        if (this.restartAttempts < WhisperService.MAX_RESTART_ATTEMPTS) {
          this.restartAttempts++;
          console.log(
            `[whisper] Auto-restart attempt ${this.restartAttempts}/${WhisperService.MAX_RESTART_ATTEMPTS}`,
          );
          try {
            this.serverProcess?.kill();
            this.serverProcess = null;
            await this.ensureServerRunning();
            console.log("[whisper] Server restarted successfully");
          } catch (restartErr) {
            console.error("[whisper] Auto-restart failed:", restartErr);
          }
        } else {
          console.error(
            "[whisper] Max restart attempts reached, stopping health check",
          );
          this.stopHealthCheck();
        }
      }
    }, WhisperService.HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Stop the whisper-server process.
   */
  stop(): void {
    this.stopHealthCheck();
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.serverReady = false;
    }
    this.restartAttempts = 0;
  }
}
