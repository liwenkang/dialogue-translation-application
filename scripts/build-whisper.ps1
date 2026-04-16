# Build whisper.cpp from source on Windows and place binaries into dist/whisper-cpp/
# Requires: cmake, git, Visual Studio Build Tools (or full VS with C++ workload)

$ErrorActionPreference = "Stop"

$WHISPER_CPP_VERSION = "v1.7.4"
$BUILD_DIR = "$env:TEMP\whisper-cpp-build"
$OUTPUT_DIR = "dist\whisper-cpp"

Write-Host "[build:whisper] Building whisper.cpp $WHISPER_CPP_VERSION on Windows..."

# Skip if already built
if ((Test-Path "$OUTPUT_DIR\whisper-server.exe") -and (Test-Path "$OUTPUT_DIR\whisper-cli.exe")) {
    Write-Host "[build:whisper] Binaries already exist in $OUTPUT_DIR, skipping build."
    exit 0
}

# Check for cmake
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Write-Host "[build:whisper] ERROR: cmake is required. Install via: winget install Kitware.CMake"
    exit 1
}

# Check for git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[build:whisper] ERROR: git is required."
    exit 1
}

# Clone source
if (Test-Path $BUILD_DIR) { Remove-Item -Recurse -Force $BUILD_DIR }
git clone --depth 1 --branch $WHISPER_CPP_VERSION https://github.com/ggerganov/whisper.cpp.git $BUILD_DIR

Push-Location $BUILD_DIR

# Build (CPU-only on Windows; CUDA support can be added with -DGGML_CUDA=ON if CUDA toolkit is installed)
$CMAKE_ARGS = @(
    "-DCMAKE_BUILD_TYPE=Release"
    "-DBUILD_SHARED_LIBS=ON"
)

# Detect CUDA
if (Get-Command nvcc -ErrorAction SilentlyContinue) {
    Write-Host "[build:whisper] CUDA detected, enabling GPU acceleration"
    $CMAKE_ARGS += "-DGGML_CUDA=ON"
} else {
    Write-Host "[build:whisper] No CUDA found, building CPU-only"
}

cmake -B build @CMAKE_ARGS
$CPU_COUNT = (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors
cmake --build build --config Release -j $CPU_COUNT

Pop-Location

# Copy binaries
New-Item -ItemType Directory -Force -Path $OUTPUT_DIR | Out-Null

# Copy executables
foreach ($bin in @("whisper-server", "whisper-cli")) {
    $candidates = @(
        "$BUILD_DIR\build\bin\Release\$bin.exe",
        "$BUILD_DIR\build\bin\$bin.exe",
        "$BUILD_DIR\build\Release\$bin.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            Copy-Item $candidate "$OUTPUT_DIR\$bin.exe"
            Write-Host "[build:whisper] Copied $bin.exe"
            break
        }
    }
}

# Copy required DLLs
$dllPatterns = @("ggml*.dll", "whisper*.dll")
foreach ($pattern in $dllPatterns) {
    Get-ChildItem -Path "$BUILD_DIR\build" -Recurse -Filter $pattern | ForEach-Object {
        $destPath = "$OUTPUT_DIR\$($_.Name)"
        if (-not (Test-Path $destPath)) {
            Copy-Item $_.FullName $destPath
            Write-Host "[build:whisper] Copied $($_.Name)"
        }
    }
}

# Verify
if (-not (Test-Path "$OUTPUT_DIR\whisper-server.exe")) {
    Write-Host "[build:whisper] ERROR: whisper-server.exe not found after build"
    exit 1
}

# Cleanup
Remove-Item -Recurse -Force $BUILD_DIR

Write-Host "[build:whisper] Done. Binaries in $OUTPUT_DIR\"
Get-ChildItem $OUTPUT_DIR | Format-Table Name, Length
