#!/usr/bin/env python3
"""
Model conversion script with JSON progress output.
Downloads a HuggingFace Opus-MT model and converts to CTranslate2 format.

Runs in a single process (no subprocesses) so it can be frozen with PyInstaller.

Usage:
  python convert_model.py --hf-model Helsinki-NLP/opus-mt-en-zh --output /path/to/opus-mt-en-zh

Output (JSON lines on stdout):
  {"status": "downloading", "progress": 0}
  {"status": "downloading", "progress": 100}
  {"status": "converting", "progress": 0}
  {"status": "converting", "progress": 100}
  {"status": "done", "size_mb": 78.7}
  OR
  {"status": "error", "message": "..."}
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time

# Prevent OpenMP duplicate library crash
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import warnings
warnings.filterwarnings("ignore")
import logging
logging.disable(logging.WARNING)


def emit(status, **kwargs):
    msg = {"status": status, **kwargs}
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def step_download(model_name, save_dir):
    """Download model from HuggingFace."""
    from huggingface_hub import snapshot_download

    allow_patterns = [
        "*.bin",
        "*.safetensors",
        "*.json",
        "*.model",
        "*.spm",
        "source.spm",
        "target.spm",
    ]

    emit("downloading", progress=10)

    max_attempts = 4
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            snapshot_download(
                repo_id=model_name,
                local_dir=save_dir,
                local_dir_use_symlinks=False,
                allow_patterns=allow_patterns,
                max_workers=1,
                etag_timeout=30,
            )
            emit("downloading", progress=100)
            return
        except Exception as exc:
            last_error = exc
            if attempt >= max_attempts:
                break

            emit(
                "downloading",
                progress=10,
                message=f"下载连接不稳定，正在重试 ({attempt}/{max_attempts - 1})...",
            )
            time.sleep(min(2 ** attempt, 8))

    raise RuntimeError(
        f"Model download failed after {max_attempts} attempts: {last_error}"
    )


def step_convert(save_dir, output_dir, quantization):
    """Convert downloaded model to CTranslate2 format."""
    try:
        import ctranslate2
    except Exception as exc:
        raise RuntimeError(f"Failed to import ctranslate2 stack: {exc}") from exc

    emit("converting", progress=30)

    os.makedirs(output_dir, exist_ok=True)
    converter = ctranslate2.converters.TransformersConverter(save_dir)

    # Patch to remove unsupported dtype kwarg
    _orig = converter.load_model
    def _patched(model_class, path, **kw):
        kw.pop("dtype", None)
        return _orig(model_class, path, **kw)
    converter.load_model = _patched

    try:
        converter.convert(output_dir, quantization=quantization, force=True)
    except Exception as exc:
        raise RuntimeError(f"Model conversion failed: {exc}") from exc

    # Copy SPM files
    for spm_file in ["source.spm", "target.spm"]:
        src = os.path.join(save_dir, spm_file)
        dst = os.path.join(output_dir, spm_file)
        if os.path.exists(src):
            shutil.copy2(src, dst)

    # Generate SHA256 manifest for integrity verification
    manifest = {}
    for f in sorted(os.listdir(output_dir)):
        fpath = os.path.join(output_dir, f)
        if os.path.isfile(fpath) and f != "manifest.json":
            h = hashlib.sha256()
            with open(fpath, "rb") as fh:
                for chunk in iter(lambda: fh.read(8192), b""):
                    h.update(chunk)
            manifest[f] = h.hexdigest()

    with open(os.path.join(output_dir, "manifest.json"), "w") as mf:
        json.dump(manifest, mf, indent=2)

    total_size = sum(
        os.path.getsize(os.path.join(output_dir, f))
        for f in os.listdir(output_dir)
        if os.path.isfile(os.path.join(output_dir, f))
    )

    emit("converting", progress=100)
    emit("done", size_mb=round(total_size / 1024 / 1024, 1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hf-model", required=True, help="HuggingFace model ID")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--quantization", default="int8")
    args = parser.parse_args()

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            save_dir = os.path.join(tmp_dir, "saved_model")
            os.makedirs(save_dir)

            emit("downloading", progress=0)
            step_download(args.hf_model, save_dir)

            emit("converting", progress=0)
            step_convert(save_dir, args.output, args.quantization)

    except Exception as e:
        emit("error", message=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
