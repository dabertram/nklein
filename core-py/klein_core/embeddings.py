"""Embeddings for the !Klein Python core.

Default backend is a deterministic, dependency-free **lexical hashing embedding** (mirrors the TS
``local_lexical`` provider) so retrieval works on any hardware with no model download. Two real-dense
backends are available, both lazily imported so the package imports without heavy native deps:

* ``llama.cpp`` (``llama`` extra): a quantized GGUF embedding model loaded in-process via
  ``llama-cpp-python`` with ``embedding=True``. The host (TS side) downloads/caches the GGUF and passes its
  local path, so this is the zero-config "batteries-included" code-embedding path with no external model
  runtime (no LM Studio/Ollama). Capped threads keep it from competing with the main LLM; an idle ``unload``
  frees it. This never hard-fails: any load/embed error falls back to the lexical embedding.
* ``sentence-transformers`` (``ml`` extra): used when a ``model`` id is given.

Pure/stdlib for the default path so it is unit-testable without any model.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any

_TOKEN = re.compile(r"[A-Za-z0-9_]+")

# Cache of loaded GGUF embedding models keyed by absolute path, so repeated index batches reuse one load.
_GGUF_EMBED_CACHE: dict[str, Any] = {}


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text)]


def lexical_embedding(text: str, dim: int = 256) -> list[float]:
    """Hashing bag-of-words embedding, L2-normalized. Deterministic; no model required."""
    vector = [0.0] * dim
    for token in _tokenize(text):
        digest = hashlib.sha1(token.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[bucket] += sign
    norm = math.sqrt(sum(value * value for value in vector))
    if norm > 0:
        vector = [value / norm for value in vector]
    return vector


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError("embeddings must be the same dimension")
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    return max(-1.0, min(1.0, dot))


def gguf_embedding(
    texts: list[str],
    gguf_path: str,
    n_ctx: int = 8192,
    n_threads: int | None = None,
) -> list[list[float]]:
    """Embed texts with an in-process quantized GGUF model via ``llama-cpp-python`` (``embedding=True``).

    The model is cached by path so repeated index batches reuse a single load. ``n_threads`` caps CPU use so
    the embedder does not compete with the main LLM. Raises on load/embed failure; the caller falls back.
    """
    model = _GGUF_EMBED_CACHE.get(gguf_path)
    if model is None:
        from llama_cpp import Llama  # lazy heavy import (``llama`` extra)

        kwargs: dict[str, Any] = {
            "model_path": gguf_path,
            "n_ctx": n_ctx,
            "embedding": True,
            "verbose": False,
        }
        if n_threads is not None and n_threads > 0:
            kwargs["n_threads"] = n_threads
        model = Llama(**kwargs)
        _GGUF_EMBED_CACHE[gguf_path] = model
    payload = model.create_embedding(texts)
    return [list(map(float, row["embedding"])) for row in payload["data"]]


def unload_gguf_embedding(gguf_path: str | None = None) -> int:
    """Drop loaded GGUF embedding model(s) to free memory when idle. Returns how many were unloaded."""
    if gguf_path is None:
        count = len(_GGUF_EMBED_CACHE)
        _GGUF_EMBED_CACHE.clear()
        return count
    return 1 if _GGUF_EMBED_CACHE.pop(gguf_path, None) is not None else 0


def embed_texts(
    texts: list[str],
    dim: int = 256,
    model: str | None = None,
    gguf_path: str | None = None,
    n_threads: int | None = None,
) -> list[list[float]]:
    """Embed texts. Prefers an in-process GGUF model when ``gguf_path`` is set, then sentence-transformers
    when ``model`` is set, else the dependency-free lexical embedding. Real-dense backends never hard-fail:
    any error falls back to lexical so indexing always produces vectors."""
    if gguf_path:
        try:
            return gguf_embedding(texts, gguf_path, n_threads=n_threads)
        except Exception:
            # Never hard-fail indexing: a missing native dep / unreadable model degrades to lexical.
            return [lexical_embedding(text, dim) for text in texts]
    if model:
        try:
            from sentence_transformers import SentenceTransformer  # lazy, optional ``ml`` extra
        except ImportError:
            # Fall back to lexical so embedding never hard-fails on limited hardware.
            return [lexical_embedding(text, dim) for text in texts]
        encoder = SentenceTransformer(model)
        return [list(map(float, row)) for row in encoder.encode(texts, normalize_embeddings=True)]
    return [lexical_embedding(text, dim) for text in texts]
