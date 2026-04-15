#!/usr/bin/env python3
"""
Safe Opus-MT model conversion script.
Splits conversion into two separate subprocess steps to avoid
the OpenMP (libiomp5) conflict between PyTorch and CTranslate2.

Step 1 (subprocess): Downloads HF model, saves to temp dir (uses torch only)
Step 2 (subprocess): Converts saved model to CT2 format (uses ctranslate2 only)
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile


STEP1_SCRIPT = '''
import sys, json, os
model_name = sys.argv[1]
save_dir = sys.argv[2]
os.environ["OMP_NUM_THREADS"] = "1"
from transformers import MarianMTModel, MarianTokenizer
print(f"Downloading model: {model_name}", file=sys.stderr)
model = MarianMTModel.from_pretrained(model_name)
tokenizer = MarianTokenizer.from_pretrained(model_name)
model.save_pretrained(save_dir)
tokenizer.save_pretrained(save_dir)
files = os.listdir(save_dir)
print(json.dumps({"success": True, "files": files}))
'''

STEP2_SCRIPT = '''
import sys, json, os, shutil
save_dir = sys.argv[1]
output_dir = sys.argv[2]
quantization = sys.argv[3]
os.environ["OMP_NUM_THREADS"] = "1"
import ctranslate2
print(f"Converting to CTranslate2 format ({quantization})...", file=sys.stderr)
os.makedirs(output_dir, exist_ok=True)
converter = ctranslate2.converters.TransformersConverter(save_dir)
# Patch load_model to remove unsupported dtype kwarg
_orig = converter.load_model
def _patched(model_class, path, **kw):
    kw.pop("dtype", None)
    return _orig(model_class, path, **kw)
converter.load_model = _patched
converter.convert(output_dir, quantization=quantization, force=True)
# Copy SPM files
for spm_file in ["source.spm", "target.spm"]:
    src = os.path.join(save_dir, spm_file)
    dst = os.path.join(output_dir, spm_file)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"  Copied {spm_file}", file=sys.stderr)
total_size = sum(os.path.getsize(os.path.join(output_dir, f))
                 for f in os.listdir(output_dir)
                 if os.path.isfile(os.path.join(output_dir, f)))
print(json.dumps({"success": True, "size_mb": round(total_size / 1024 / 1024, 1),
                   "files": os.listdir(output_dir)}))
'''


def run_step(python_path, script, args, step_name):
    env = os.environ.copy()
    env["OMP_NUM_THREADS"] = "1"
    env["MKL_NUM_THREADS"] = "1"
    
    result = subprocess.run(
        [python_path, "-c", script] + args,
        capture_output=True, text=True, env=env
    )
    
    if result.returncode != 0:
        print(f"[{step_name}] STDERR:\n{result.stderr}", file=sys.stderr)
        print(f"[{step_name}] STDOUT:\n{result.stdout}", file=sys.stderr)
        print(f"Error: {step_name} failed with exit code {result.returncode}")
        sys.exit(1)
    
    # Print stderr (progress info)
    if result.stderr:
        for line in result.stderr.strip().split('\n'):
            print(f"  [{step_name}] {line}")
    
    # Parse JSON result from last line of stdout
    stdout_lines = result.stdout.strip().split('\n')
    try:
        return json.loads(stdout_lines[-1])
    except (json.JSONDecodeError, IndexError):
        print(f"Error: Could not parse output from {step_name}")
        print(f"STDOUT: {result.stdout}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Safely convert Opus-MT models to CTranslate2 format"
    )
    parser.add_argument("--model", required=True,
                        help="HuggingFace model ID (e.g., Helsinki-NLP/opus-mt-en-zh)")
    parser.add_argument("--output", required=True,
                        help="Output directory for converted model")
    parser.add_argument("--quantization", default="int8",
                        choices=["int8", "int16", "float16", "float32"])
    parser.add_argument("--python", default=sys.executable,
                        help="Python executable to use")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp_dir:
        save_dir = os.path.join(tmp_dir, "saved_model")
        os.makedirs(save_dir)

        # Step 1: Download and save model (torch only, no ctranslate2)
        print(f"Step 1: Downloading {args.model}...")
        result1 = run_step(args.python, STEP1_SCRIPT,
                           [args.model, save_dir], "Download")
        print(f"  Downloaded: {result1.get('files', [])}")

        # Step 2: Convert to CTranslate2 (ctranslate2 only, no torch)
        print(f"Step 2: Converting to CTranslate2...")
        result2 = run_step(args.python, STEP2_SCRIPT,
                           [save_dir, args.output, args.quantization], "Convert")
        print(f"  Output: {result2.get('files', [])}")
        print(f"  Size: {result2.get('size_mb', '?')} MB")

    print(f"\nModel converted successfully: {args.output}")


if __name__ == "__main__":
    main()
