// Cross-platform launcher for build:whisper
// Dispatches to the correct platform-specific script

import { execFileSync } from "child_process";
import process from "process";

const isWin = process.platform === "win32";

if (isWin) {
  execFileSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", "scripts/build-whisper.ps1"],
    { stdio: "inherit" },
  );
} else {
  execFileSync("bash", ["scripts/build-whisper.sh"], { stdio: "inherit" });
}
