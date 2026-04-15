import { ChildProcess, spawn } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import readline from "readline";
import { app, BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { OPUS_MT_MODELS } from "../../shared/constants";

export interface ModelInstallProgress {
  pair: string;
  status: "downloading" | "converting" | "done" | "error";
  progress: number;
  message?: string;
}

export class TranslateModelService {
  private modelsDir: string;
  private installingPairs: Set<string> = new Set();

  constructor() {
    this.modelsDir = path.join(app.getPath("userData"), "models", "opus-mt");
    fs.mkdirSync(this.modelsDir, { recursive: true });
  }

  private getModelDir(sourceLang: string, targetLang: string): string {
    return path.join(this.modelsDir, `opus-mt-${sourceLang}-${targetLang}`);
  }

  isModelInstalled(sourceLang: string, targetLang: string): boolean {
    const dir = this.getModelDir(sourceLang, targetLang);
    return (
      fs.existsSync(path.join(dir, "model.bin")) &&
      fs.existsSync(path.join(dir, "source.spm")) &&
      fs.existsSync(path.join(dir, "target.spm"))
    );
  }

  /**
   * Verify model file integrity against SHA256 manifest.
   * Returns true if manifest exists and all hashes match, or if no manifest (legacy install).
   */
  verifyModelIntegrity(sourceLang: string, targetLang: string): boolean {
    const dir = this.getModelDir(sourceLang, targetLang);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      // Legacy model without manifest — skip verification
      return true;
    }

    try {
      const manifest: Record<string, string> = JSON.parse(
        fs.readFileSync(manifestPath, "utf-8"),
      );

      for (const [filename, expectedHash] of Object.entries(manifest)) {
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) return false;

        const hash = crypto.createHash("sha256");
        const data = fs.readFileSync(filePath);
        hash.update(data);
        const actual = hash.digest("hex");
        if (actual !== expectedHash) {
          console.error(
            `Model integrity check failed: ${filePath} expected ${expectedHash}, got ${actual}`,
          );
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error("Failed to verify model integrity:", err);
      return false;
    }
  }

  /**
   * Get all model pairs needed for translating between sourceLang and targetLang.
   * All translation pivots through English.
   */
  getRequiredPairs(
    sourceLang: string,
    targetLang: string,
  ): { source: string; target: string }[] {
    if (sourceLang === targetLang) return [];

    // Direct pair (both are en or direct)
    if (sourceLang === "en" || targetLang === "en") {
      return [{ source: sourceLang, target: targetLang }];
    }

    // Pivot through English: source→en + en→target
    return [
      { source: sourceLang, target: "en" },
      { source: "en", target: targetLang },
    ];
  }

  /**
   * Check which models are missing for a language pair.
   */
  getMissingModels(
    sourceLang: string,
    targetLang: string,
  ): { source: string; target: string }[] {
    const required = this.getRequiredPairs(sourceLang, targetLang);
    return required.filter((p) => !this.isModelInstalled(p.source, p.target));
  }

  /**
   * Install a single model pair by downloading and converting it.
   */
  async installModel(
    sourceLang: string,
    targetLang: string,
    mainWindow: BrowserWindow,
  ): Promise<void> {
    const pair = `${sourceLang}-${targetLang}`;

    if (this.installingPairs.has(pair)) {
      return; // Already installing
    }

    const hfModel = OPUS_MT_MODELS[pair];
    if (!hfModel) {
      throw new Error(`No HuggingFace model mapping for pair: ${pair}`);
    }

    if (this.isModelInstalled(sourceLang, targetLang)) {
      this.sendProgress(mainWindow, pair, "done", 100);
      return;
    }

    this.installingPairs.add(pair);

    try {
      await this.runConversion(pair, hfModel, mainWindow);
      // Verify integrity after installation
      if (!this.verifyModelIntegrity(sourceLang, targetLang)) {
        this.deleteModel(sourceLang, targetLang);
        throw new Error(`Model integrity verification failed for ${pair}`);
      }
    } finally {
      this.installingPairs.delete(pair);
    }
  }

  /**
   * Install all missing models needed for sourceLang↔targetLang translation.
   * This includes both directions for bidirectional support.
   */
  async installModelsForLanguage(
    targetLang: string,
    mainWindow: BrowserWindow,
  ): Promise<void> {
    // We need models for all supported source languages to this target.
    // At minimum, we need en↔targetLang for pivot translation.
    const pairsToInstall: { source: string; target: string }[] = [];

    if (targetLang !== "en") {
      if (!this.isModelInstalled(targetLang, "en")) {
        pairsToInstall.push({ source: targetLang, target: "en" });
      }
      if (!this.isModelInstalled("en", targetLang)) {
        pairsToInstall.push({ source: "en", target: targetLang });
      }
    }

    if (pairsToInstall.length === 0) {
      return;
    }

    for (const p of pairsToInstall) {
      await this.installModel(p.source, p.target, mainWindow);
    }
  }

  /**
   * Delete an installed model pair.
   */
  deleteModel(sourceLang: string, targetLang: string): void {
    const dir = this.getModelDir(sourceLang, targetLang);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private isDev(): boolean {
    return fs.existsSync(
      path.join(app.getAppPath(), "native", "ctranslate2", "convert_model.py"),
    );
  }

  private getDevPython(): string {
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

  private getConvertBinary(): string {
    // In development, use the Python script directly
    const devScript = path.join(
      app.getAppPath(),
      "native",
      "ctranslate2",
      "convert_model.py",
    );
    if (fs.existsSync(devScript)) {
      return devScript;
    }

    // In production, use the frozen binary from extraResources
    const binaryName =
      process.platform === "win32" ? "convert-model.exe" : "convert-model";
    return path.join(process.resourcesPath, "convert-model", binaryName);
  }

  private async runConversion(
    pair: string,
    hfModel: string,
    mainWindow: BrowserWindow,
  ): Promise<void> {
    const binary = this.getConvertBinary();
    const outputDir = path.join(this.modelsDir, `opus-mt-${pair}`);

    // In dev mode, launch via venv python; in production, run the frozen binary directly
    const spawnCmd = this.isDev() ? this.getDevPython() : binary;
    const spawnArgs = this.isDev()
      ? [
          binary,
          "--hf-model",
          hfModel,
          "--output",
          outputDir,
          "--quantization",
          "int8",
        ]
      : [
          "--hf-model",
          hfModel,
          "--output",
          outputDir,
          "--quantization",
          "int8",
        ];

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(spawnCmd, spawnArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          KMP_DUPLICATE_LIB_OK: "TRUE",
          OMP_NUM_THREADS: "1",
        },
      });

      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      rl.on("line", (line: string) => {
        try {
          const data = JSON.parse(line);
          this.sendProgress(
            mainWindow,
            pair,
            data.status,
            data.progress ?? 0,
            data.message,
          );

          if (data.status === "error") {
            reject(new Error(data.message || "Conversion failed"));
          }
        } catch {
          // ignore non-JSON lines
        }
      });

      let stderrOutput = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
      });

      proc.on("error", (err) => {
        reject(err);
      });

      proc.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Model conversion failed (exit ${code}): ${stderrOutput.slice(0, 500)}`,
            ),
          );
        }
      });
    });
  }

  private sendProgress(
    mainWindow: BrowserWindow,
    pair: string,
    status: string,
    progress: number,
    message?: string,
  ) {
    mainWindow.webContents.send(IPC_CHANNELS.TRANSLATE.INSTALL_PROGRESS, {
      pair,
      status,
      progress,
      message,
    });
  }
}
