# Build PyInstaller binaries for translate-server and convert-model on Windows
# Requires: Python 3.x with pip, .pyinstaller-venv virtual environment

$ErrorActionPreference = "Stop"

Write-Host "[build:python] Building Python binaries on Windows..."

# Activate venv
$venvActivate = ".pyinstaller-venv\Scripts\Activate.ps1"
if (-not (Test-Path $venvActivate)) {
    Write-Host "[build:python] ERROR: Virtual environment not found at .pyinstaller-venv\"
    Write-Host "[build:python] Create it with: python -m venv .pyinstaller-venv"
    exit 1
}

& $venvActivate

# Install dependencies
pip install "numpy<2" "torch==2.2.2" "transformers==4.41.2" | Out-Null

# Build translate-server
Write-Host "[build:python] Building translate-server..."
pyinstaller --onedir `
    --distpath dist/pyinstaller `
    --workpath build/pyinstaller `
    --name translate-server `
    --hidden-import=ctranslate2 `
    --hidden-import=sentencepiece `
    --collect-all ctranslate2 `
    --collect-all sentencepiece `
    --noconfirm `
    native/ctranslate2/translate_server.py

# Build convert-model
Write-Host "[build:python] Building convert-model..."
pyinstaller --onedir `
    --distpath dist/pyinstaller `
    --workpath build/pyinstaller `
    --name convert-model `
    --hidden-import=ctranslate2 `
    --hidden-import=sentencepiece `
    --hidden-import=transformers `
    --hidden-import=huggingface_hub `
    --hidden-import=torch `
    --collect-all ctranslate2 `
    --collect-all sentencepiece `
    --collect-all transformers `
    --noconfirm `
    native/ctranslate2/convert_model.py

# Verify
if (-not (Test-Path "dist\pyinstaller\translate-server\translate-server.exe")) {
    Write-Host "[build:python] ERROR: translate-server.exe not found"
    exit 1
}
if (-not (Test-Path "dist\pyinstaller\convert-model\convert-model.exe")) {
    Write-Host "[build:python] ERROR: convert-model.exe not found"
    exit 1
}

Write-Host "[build:python] Done. Binaries in dist\pyinstaller\"
