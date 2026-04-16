// Cross-platform launcher for build:python
// Dispatches to the correct platform-specific script

import { execFileSync } from "child_process";
import process from "process";

const isWin = process.platform === "win32";

if (isWin) {
  execFileSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", "scripts/build-python.ps1"],
    { stdio: "inherit" },
  );
} else {
  // Unix: run the original inline commands via bash
  const cmd = [
    "rm -f dist/translate-server dist/convert-model",
    "source .pyinstaller-venv/bin/activate",
    "pip install 'numpy<2' 'torch==2.2.2' 'transformers==4.41.2' >/dev/null",
    [
      "pyinstaller --onedir",
      "--distpath dist/pyinstaller",
      "--workpath build/pyinstaller",
      "--name translate-server",
      "--hidden-import=ctranslate2",
      "--hidden-import=sentencepiece",
      "--collect-all ctranslate2",
      "--collect-all sentencepiece",
      "--noconfirm",
      "native/ctranslate2/translate_server.py",
    ].join(" "),
    [
      "pyinstaller --onedir",
      "--distpath dist/pyinstaller",
      "--workpath build/pyinstaller",
      "--name convert-model",
      "--hidden-import=ctranslate2",
      "--hidden-import=sentencepiece",
      "--hidden-import=transformers",
      "--hidden-import=huggingface_hub",
      "--hidden-import=torch",
      "--collect-all ctranslate2",
      "--collect-all sentencepiece",
      "--collect-all transformers",
      "--noconfirm",
      "native/ctranslate2/convert_model.py",
    ].join(" "),
  ].join(" && ");

  execFileSync("bash", ["-c", cmd], { stdio: "inherit" });
}
