#!/usr/bin/env bash
set -euo pipefail

# Build whisper.cpp from source and place binaries into dist/whisper-cpp/

WHISPER_CPP_VERSION="v1.7.4"
BUILD_DIR="/tmp/whisper-cpp-build"
OUTPUT_DIR="dist/whisper-cpp"

echo "[build:whisper] Building whisper.cpp ${WHISPER_CPP_VERSION}..."

# Skip if already built
if [[ -f "${OUTPUT_DIR}/whisper-server" && -f "${OUTPUT_DIR}/whisper-cli" ]]; then
  echo "[build:whisper] Binaries already exist in ${OUTPUT_DIR}, skipping build."
  exit 0
fi

# Check for cmake
if ! command -v cmake &>/dev/null; then
  echo "[build:whisper] ERROR: cmake is required. Install via: brew install cmake"
  exit 1
fi

# Clone source
rm -rf "${BUILD_DIR}"
git clone --depth 1 --branch "${WHISPER_CPP_VERSION}" https://github.com/ggerganov/whisper.cpp.git "${BUILD_DIR}"

cd "${BUILD_DIR}"

# Build with Metal acceleration on macOS
CMAKE_ARGS="-DCMAKE_BUILD_TYPE=Release"
if [[ "$(uname)" == "Darwin" ]]; then
  CMAKE_ARGS="${CMAKE_ARGS} -DGGML_METAL=ON"
  echo "[build:whisper] Enabling Metal acceleration for macOS"
fi

cmake -B build ${CMAKE_ARGS}
cmake --build build --config Release -j "$(sysctl -n hw.logicalcpu 2>/dev/null || nproc)"

# Copy binaries
cd - >/dev/null
mkdir -p "${OUTPUT_DIR}"

# whisper.cpp build outputs
for bin in whisper-server whisper-cli; do
  for candidate in "${BUILD_DIR}/build/bin/${bin}" "${BUILD_DIR}/build/${bin}"; do
    if [[ -f "${candidate}" ]]; then
      cp "${candidate}" "${OUTPUT_DIR}/${bin}"
      echo "[build:whisper] Copied ${bin}"
      break
    fi
  done
done

# Copy required dynamic libraries (use find to cover all subdirectories)
# First copy real files (not symlinks)
while IFS= read -r lib; do
  libname="$(basename "${lib}")"
  if [[ ! -f "${OUTPUT_DIR}/${libname}" ]]; then
    cp "${lib}" "${OUTPUT_DIR}/${libname}"
    echo "[build:whisper] Copied ${libname}"
  fi
done < <(find "${BUILD_DIR}/build" -name "lib*.dylib" -not -type l)

# Then copy symlinks as actual copies of their targets
while IFS= read -r lib; do
  libname="$(basename "${lib}")"
  if [[ ! -f "${OUTPUT_DIR}/${libname}" ]]; then
    cp -L "${lib}" "${OUTPUT_DIR}/${libname}"
    echo "[build:whisper] Copied ${libname} (from symlink)"
  fi
done < <(find "${BUILD_DIR}/build" -name "lib*.dylib" -type l)

# Copy Metal shader support file if present (needed for Metal acceleration on macOS)
METAL_LIB="${BUILD_DIR}/build/bin/ggml-metal.metal"
if [[ -f "${METAL_LIB}" ]]; then
  cp "${METAL_LIB}" "${OUTPUT_DIR}/"
  echo "[build:whisper] Copied ggml-metal.metal"
fi

# Also check for the compiled metallib
METALLIB="${BUILD_DIR}/build/bin/default.metallib"
if [[ -f "${METALLIB}" ]]; then
  cp "${METALLIB}" "${OUTPUT_DIR}/"
  echo "[build:whisper] Copied default.metallib"
fi

# Fix rpath: make binaries look for dylibs in the same directory
echo "[build:whisper] Fixing rpath for bundled binaries..."
for bin in "${OUTPUT_DIR}"/whisper-server "${OUTPUT_DIR}"/whisper-cli; do
  if [[ -f "${bin}" ]]; then
    # Remove existing rpaths
    for rp in $(otool -l "${bin}" | grep -A2 'LC_RPATH' | grep 'path ' | awk '{print $2}'); do
      install_name_tool -delete_rpath "${rp}" "${bin}" 2>/dev/null || true
    done
    # Add @executable_path as rpath so it finds dylibs next to the binary
    install_name_tool -add_rpath @executable_path "${bin}"
  fi
done

# Fix dylib self-references and inter-references to use @rpath
for lib in "${OUTPUT_DIR}"/lib*.dylib; do
  if [[ -f "${lib}" ]]; then
    libname="$(basename "${lib}")"
    # Update the dylib's own install name
    install_name_tool -id "@rpath/${libname}" "${lib}"
    # Remove existing rpaths and add @loader_path
    for rp in $(otool -l "${lib}" | grep -A2 'LC_RPATH' | grep 'path ' | awk '{print $2}'); do
      install_name_tool -delete_rpath "${rp}" "${lib}" 2>/dev/null || true
    done
    install_name_tool -add_rpath @loader_path "${lib}" 2>/dev/null || true
  fi
done

# Verify
if [[ ! -f "${OUTPUT_DIR}/whisper-server" ]]; then
  echo "[build:whisper] ERROR: whisper-server not found after build"
  exit 1
fi

# Cleanup
rm -rf "${BUILD_DIR}"

echo "[build:whisper] Done. Binaries in ${OUTPUT_DIR}/"
ls -lh "${OUTPUT_DIR}/"
