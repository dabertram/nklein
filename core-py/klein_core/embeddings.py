"""Embeddings for the !Klein Python core.

Default backend is a deterministic, dependency-free **lexical hashing embedding** (mirrors the TS
``local_lexical`` provider) so retrieval works on any hardware with no model download. An optional
``sentence-transformers`` backend (``ml`` extra, lazy import) provides real dense embeddings when the user
opts in. Pure/stdlib for the default path so it is unit-testable.
"""

from __future__ import annotations

import hashlib
import math
import re

_TOKEN = re.compile(r"[A-Za-z0-9_]+")


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


def embed_texts(texts: list[str], dim: int = 256, model: str | None = None) -> list[list[float]]:
    """Embed texts. Uses sentence-transformers when ``model`` is given and the extra is installed."""
    if model:
        try:
            from sentence_transformers import SentenceTransformer  # lazy, optional ``ml`` extra
        except ImportError:
            # Fall back to lexical so embedding never hard-fails on limited hardware.
            return [lexical_embedding(text, dim) for text in texts]
        encoder = SentenceTransformer(model)
        return [list(map(float, row)) for row in encoder.encode(texts, normalize_embeddings=True)]
    return [lexical_embedding(text, dim) for text in texts]
