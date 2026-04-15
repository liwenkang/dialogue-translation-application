import { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import crypto from "crypto";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import {
  WHISPER_MODEL_URL,
  WHISPER_MODEL_FILENAME,
  WHISPER_MODEL_SHA256,
} from "../../shared/constants";

export class ModelManagerService {
  private modelsDir: string;

  constructor(modelsDir: string) {
    this.modelsDir = modelsDir;
  }

  private getWhisperDir(): string {
    return path.join(this.modelsDir, "whisper");
  }

  private getWhisperModelPath(): string {
    return path.join(this.getWhisperDir(), WHISPER_MODEL_FILENAME);
  }

  isWhisperModelDownloaded(): boolean {
    return fs.existsSync(this.getWhisperModelPath());
  }

  async downloadWhisperModel(mainWindow: BrowserWindow): Promise<void> {
    const targetDir = this.getWhisperDir();
    const targetPath = this.getWhisperModelPath();
    const tmpPath = targetPath + ".tmp";

    fs.mkdirSync(targetDir, { recursive: true });

    return new Promise<void>((resolve, reject) => {
      const download = (url: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          reject(new Error("Too many redirects"));
          return;
        }

        const protocol = url.startsWith("https") ? https : http;

        const req = protocol.get(
          url,
          { headers: { "User-Agent": "DialogueTranslation/1.0" } },
          (response) => {
            if (
              response.statusCode === 301 ||
              response.statusCode === 302 ||
              response.statusCode === 307
            ) {
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                response.resume();
                download(redirectUrl, redirectCount + 1);
                return;
              }
            }

            if (response.statusCode !== 200) {
              reject(
                new Error(`Download failed with status ${response.statusCode}`),
              );
              return;
            }

            const totalBytes = parseInt(
              response.headers["content-length"] || "0",
              10,
            );
            let downloadedBytes = 0;

            const file = fs.createWriteStream(tmpPath);

            response.on("data", (chunk: Buffer) => {
              downloadedBytes += chunk.length;
              if (totalBytes > 0) {
                mainWindow.webContents.send(
                  IPC_CHANNELS.MODEL.DOWNLOAD_PROGRESS,
                  {
                    modelId: "whisper-base",
                    percent: Math.round((downloadedBytes / totalBytes) * 100),
                    bytesDownloaded: downloadedBytes,
                    totalBytes,
                  },
                );
              }
            });

            response.pipe(file);

            file.on("finish", () => {
              file.close(() => {
                // Verify SHA256 checksum
                if (WHISPER_MODEL_SHA256) {
                  const hash = crypto.createHash("sha256");
                  const stream = fs.createReadStream(tmpPath);
                  stream.on("data", (chunk) => hash.update(chunk));
                  stream.on("end", () => {
                    const actual = hash.digest("hex");
                    if (actual !== WHISPER_MODEL_SHA256) {
                      try {
                        fs.unlinkSync(tmpPath);
                      } catch {
                        // ignore
                      }
                      reject(
                        new Error(
                          `Checksum mismatch: expected ${WHISPER_MODEL_SHA256}, got ${actual}`,
                        ),
                      );
                      return;
                    }
                    fs.renameSync(tmpPath, targetPath);
                    resolve();
                  });
                  stream.on("error", (err) => {
                    try {
                      fs.unlinkSync(tmpPath);
                    } catch {
                      // ignore
                    }
                    reject(err);
                  });
                } else {
                  fs.renameSync(tmpPath, targetPath);
                  resolve();
                }
              });
            });

            file.on("error", (err) => {
              try {
                fs.unlinkSync(tmpPath);
              } catch {
                // ignore
              }
              reject(err);
            });
          },
        );

        req.on("error", (err) => {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // ignore
          }
          reject(err);
        });
      };

      download(WHISPER_MODEL_URL);
    });
  }
}
