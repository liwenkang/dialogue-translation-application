"""
嵌入式翻译微服务
由 Electron Main Process 启动和管理
通过 stdin/stdout JSON Line 协议通信

协议格式：
请求: {"id": 1, "action": "translate", "text": "Hello", "source_lang": "en", "target_lang": "zh"}
响应: {"id": 1, "success": true, "translation": "你好"}

请求: {"id": 2, "action": "ping"}
响应: {"id": 2, "success": true, "message": "pong"}

请求: {"id": 3, "action": "check_model", "source_lang": "en", "target_lang": "zh"}
响应: {"id": 3, "success": true, "available": true}
"""

import sys
import json
import os
from pathlib import Path


class TranslateEngine:
    def __init__(self, models_dir: str):
        self.models_dir = Path(models_dir)
        self.loaded_models: dict = {}
        self._ct2 = None
        self._spm = None

    def _ensure_imports(self):
        """Lazy import ctranslate2 and sentencepiece"""
        if self._ct2 is None:
            import ctranslate2
            import sentencepiece
            self._ct2 = ctranslate2
            self._spm = sentencepiece

    def get_model_dir(self, source_lang: str, target_lang: str) -> Path:
        """Get the directory path for a language pair model"""
        return self.models_dir / f"opus-mt-{source_lang}-{target_lang}"

    def is_model_available(self, source_lang: str, target_lang: str) -> bool:
        """Check if a model is downloaded and converted"""
        model_dir = self.get_model_dir(source_lang, target_lang)
        # CTranslate2 model needs model.bin and source/target SPM models
        return (
            (model_dir / "model.bin").exists()
            and (model_dir / "source.spm").exists()
            and (model_dir / "target.spm").exists()
        )

    def get_model(self, source_lang: str, target_lang: str):
        """Lazily load model for a language pair"""
        self._ensure_imports()

        key = f"{source_lang}-{target_lang}"
        if key in self.loaded_models:
            return self.loaded_models[key]

        model_dir = self.get_model_dir(source_lang, target_lang)
        if not self.is_model_available(source_lang, target_lang):
            raise FileNotFoundError(
                f"Model not found: opus-mt-{source_lang}-{target_lang}. "
                f"Expected at: {model_dir}"
            )

        translator = self._ct2.Translator(
            str(model_dir),
            device="cpu",
            compute_type="auto",
        )
        sp_source = self._spm.SentencePieceProcessor(
            str(model_dir / "source.spm")
        )
        sp_target = self._spm.SentencePieceProcessor(
            str(model_dir / "target.spm")
        )

        self.loaded_models[key] = (translator, sp_source, sp_target)
        return self.loaded_models[key]

    def _postprocess(self, text: str, target_lang: str) -> str:
        """Clean up translation output."""
        import re
        text = text.strip()
        # Remove leading dash/bullet artifacts
        text = re.sub(r'^[-–—]\s*', '', text)

        if target_lang == "zh":
            # Remove runs of 4+ identical characters: 哈哈哈哈哈 → 哈哈
            text = re.sub(r'(.)\1{3,}', r'\1\1', text)
            # Remove repeated 2-4 char patterns appearing 3+ times: 天气天气天气 → 天气
            text = re.sub(r'(.{2,4})\1{2,}', r'\1', text)
            # Remove comma-separated duplicate clauses: "你好,你好" → "你好"
            text = re.sub(r'(.{2,})[,，](\s*\1)+', r'\1', text)
        else:
            # Remove repeated words: "world world" → "world"
            text = re.sub(r'\b(\w+)\s+\1\b', r'\1', text, flags=re.IGNORECASE)
            # Remove repeated phrases (2-5 word patterns appearing 2+ times)
            text = re.sub(r'\b(\w+(?:\s+\w+){1,4}),?\s+\1\b', r'\1', text, flags=re.IGNORECASE)

        return text.strip().rstrip(',;，；、')

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text from source_lang to target_lang"""
        translator, sp_source, sp_target = self.get_model(
            source_lang, target_lang
        )

        # Tokenize (must append EOS token for Marian/OPUS-MT models)
        tokens = sp_source.encode(text, out_type=str) + ["</s>"]
        input_len = len(tokens)

        # Allow generous length: zh→en needs more tokens, en→zh fewer
        max_len = min(max(input_len * 4 + 20, 30), 512)
        results = translator.translate_batch(
            [tokens],
            beam_size=5,
            num_hypotheses=3,
            max_input_length=512,
            max_decoding_length=max_len,
            repetition_penalty=1.2,
            no_repeat_ngram_size=3,
            return_scores=True,
        )

        # Pick the best hypothesis that isn't degenerate
        best_text = None
        for hyp in results[0].hypotheses:
            candidate = sp_target.decode(hyp)
            # Skip degenerate outputs (excessive repetition)
            unique_chars = len(set(candidate))
            if len(candidate) > 3 and unique_chars / len(candidate) < 0.15:
                continue
            best_text = candidate
            break

        if best_text is None:
            best_text = sp_target.decode(results[0].hypotheses[0])

        return self._postprocess(best_text, target_lang)

    def translate_with_pivot(
        self, text: str, source_lang: str, target_lang: str
    ) -> str:
        """
        Translate with English as pivot language.
        If direct pair exists, use it. Otherwise: source->en->target.
        """
        # Try direct translation first
        if self.is_model_available(source_lang, target_lang):
            return self.translate(text, source_lang, target_lang)

        # Pivot through English
        if source_lang != "en" and target_lang != "en":
            if not self.is_model_available(source_lang, "en"):
                raise FileNotFoundError(
                    f"Pivot model not found: opus-mt-{source_lang}-en"
                )
            if not self.is_model_available("en", target_lang):
                raise FileNotFoundError(
                    f"Pivot model not found: opus-mt-en-{target_lang}"
                )

            english_text = self.translate(text, source_lang, "en")
            return self.translate(english_text, "en", target_lang)

        raise FileNotFoundError(
            f"No translation path from {source_lang} to {target_lang}"
        )


def main():
    models_dir = sys.argv[1] if len(sys.argv) > 1 else "./models/opus-mt"
    engine = TranslateEngine(models_dir)

    # Signal readiness
    sys.stdout.write(
        json.dumps({"id": 0, "success": True, "message": "ready"}) + "\n"
    )
    sys.stdout.flush()

    # JSON Line protocol: read requests line by line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            req_id = request.get("id", -1)
            action = request.get("action", "")

            if action == "ping":
                response = {"id": req_id, "success": True, "message": "pong"}

            elif action == "check_model":
                source_lang = request.get("source_lang", "")
                target_lang = request.get("target_lang", "")
                available = engine.is_model_available(source_lang, target_lang)
                # Also check pivot availability
                pivot_available = False
                if not available and source_lang != "en" and target_lang != "en":
                    pivot_available = (
                        engine.is_model_available(source_lang, "en")
                        and engine.is_model_available("en", target_lang)
                    )
                response = {
                    "id": req_id,
                    "success": True,
                    "available": available or pivot_available,
                    "direct": available,
                    "pivot": pivot_available,
                }

            elif action == "translate":
                text = request.get("text", "")
                source_lang = request.get("source_lang", "")
                target_lang = request.get("target_lang", "")

                if not text or not source_lang or not target_lang:
                    response = {
                        "id": req_id,
                        "success": False,
                        "error": "Missing required fields: text, source_lang, target_lang",
                    }
                else:
                    translation = engine.translate_with_pivot(
                        text, source_lang, target_lang
                    )
                    response = {
                        "id": req_id,
                        "success": True,
                        "translation": translation,
                    }

            else:
                response = {
                    "id": req_id,
                    "success": False,
                    "error": f"Unknown action: {action}",
                }

        except FileNotFoundError as e:
            response = {
                "id": req_id,
                "success": False,
                "error": str(e),
                "error_type": "model_not_found",
            }
        except Exception as e:
            response = {
                "id": req_id,
                "success": False,
                "error": str(e),
            }

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
