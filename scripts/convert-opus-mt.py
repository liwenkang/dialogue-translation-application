#!/usr/bin/env python3
"""
Opus-MT 模型转换脚本
将 HuggingFace 格式的 Opus-MT 模型转换为 CTranslate2 格式

用法:
    python convert-opus-mt.py --model Helsinki-NLP/opus-mt-en-zh --output ./models/opus-mt/opus-mt-en-zh

依赖:
    pip install ctranslate2 sentencepiece transformers torch
"""

import argparse
import os
import shutil
import sys
import tempfile

def convert_model(model_name: str, output_dir: str, quantization: str = "int8"):
    """
    Download and convert an Opus-MT model to CTranslate2 format.
    
    Args:
        model_name: HuggingFace model ID (e.g., 'Helsinki-NLP/opus-mt-en-zh')
        output_dir: Directory to save the converted model
        quantization: Quantization type ('int8', 'int16', 'float16', 'float32')
    """
    try:
        import ctranslate2
    except ImportError:
        print("Error: ctranslate2 not installed. Run: pip install ctranslate2")
        sys.exit(1)
    
    try:
        from transformers import MarianMTModel, MarianTokenizer
    except ImportError:
        print("Error: transformers not installed. Run: pip install transformers torch")
        sys.exit(1)

    print(f"Downloading model: {model_name}")
    
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Download HuggingFace model
        hf_model_dir = os.path.join(tmp_dir, "hf_model")
        model = MarianMTModel.from_pretrained(model_name, cache_dir=hf_model_dir)
        tokenizer = MarianTokenizer.from_pretrained(model_name, cache_dir=hf_model_dir)
        
        # Save to temp directory for conversion
        save_dir = os.path.join(tmp_dir, "saved_model")
        model.save_pretrained(save_dir)
        tokenizer.save_pretrained(save_dir)
        
        print(f"Converting to CTranslate2 format ({quantization})...")
        
        # Convert to CTranslate2
        os.makedirs(output_dir, exist_ok=True)
        converter = ctranslate2.converters.OpusMTConverter(save_dir)
        converter.convert(output_dir, quantization=quantization)
        
        # Copy SentencePiece models
        for spm_file in ["source.spm", "target.spm"]:
            src_path = os.path.join(save_dir, spm_file)
            dst_path = os.path.join(output_dir, spm_file)
            if os.path.exists(src_path):
                shutil.copy2(src_path, dst_path)
                print(f"  Copied {spm_file}")
            else:
                print(f"  Warning: {spm_file} not found in model directory")
    
    print(f"Model converted successfully: {output_dir}")
    
    # Show model size
    total_size = 0
    for f in os.listdir(output_dir):
        fp = os.path.join(output_dir, f)
        if os.path.isfile(fp):
            total_size += os.path.getsize(fp)
    print(f"Total size: {total_size / 1024 / 1024:.1f} MB")


def main():
    parser = argparse.ArgumentParser(
        description="Convert Opus-MT models to CTranslate2 format"
    )
    parser.add_argument(
        "--model",
        required=True,
        help="HuggingFace model ID (e.g., Helsinki-NLP/opus-mt-en-zh)",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output directory for converted model",
    )
    parser.add_argument(
        "--quantization",
        default="int8",
        choices=["int8", "int16", "float16", "float32"],
        help="Quantization type (default: int8)",
    )
    
    args = parser.parse_args()
    convert_model(args.model, args.output, args.quantization)


if __name__ == "__main__":
    main()
