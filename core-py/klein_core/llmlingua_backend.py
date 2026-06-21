"""Real LLMLingua-2 compression backend (opt-in ``ml`` extra).

``llmlingua`` is imported lazily so the package works without it; the ``/v1/compress`` endpoint falls back to
the dependency-free heuristic when this backend is unavailable or errors. Install with ``uv sync --extra ml``.
"""

from __future__ import annotations

from typing import Any

from .compression import CompressResult, tokenize

_COMPRESSOR_CACHE: dict[str, Any] = {}


def _load_compressor(model: str) -> Any:
    cached = _COMPRESSOR_CACHE.get(model)
    if cached is not None:
        return cached
    from llmlingua import PromptCompressor  # lazy heavy import

    compressor = PromptCompressor(model_name=model, use_llmlingua2=True)
    _COMPRESSOR_CACHE[model] = compressor
    return compressor


def llmlingua_compress(text: str, target_ratio: float, model: str) -> CompressResult:
    """Compress with LLMLingua-2 to approximately ``target_ratio`` of the original tokens."""
    compressor = _load_compressor(model)
    rate = min(1.0, max(0.05, target_ratio))
    result = compressor.compress_prompt(text, rate=rate)
    compressed = result["compressed_prompt"] if isinstance(result, dict) else str(result)
    original = len([t for t in tokenize(text) if not t.structural])
    kept = len([t for t in tokenize(compressed) if not t.structural])
    return CompressResult(
        compressed=compressed,
        original_token_count=original,
        kept_token_count=kept,
        kept_ratio=(kept / original) if original else 1.0,
    )
