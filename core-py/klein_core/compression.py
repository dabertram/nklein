"""Prompt compression for the !Klein Python core (LLMLingua-2-style; arXiv:2403.12968).

Compression is token classification: keep the highest-information tokens to hit a target ratio. The scorer is
pluggable:
  * ``heuristic_token_scores`` (default, dependency-free) — best for limited hardware; mirrors the TS
    ``nklein-prompt-compression`` heuristic so both runtimes behave consistently.
  * a real LLMLingua-2 scorer (XLM-RoBERTa) behind the ``ml`` extra, loaded lazily.

Pure/stdlib so it is unit-testable without the heavy ML dependency.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_WORD_OR_GAP = re.compile(r"\s+|\S+")
_STRUCTURAL = re.compile(r"^\s+$")
_CODE_SIGNAL = re.compile(r"[A-Z_.()\[\]{}/<>:;=]|\d")

STOP_WORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "that",
    "this",
    "these",
    "those",
    "it",
    "its",
    "at",
    "by",
    "from",
    "so",
    "if",
    "then",
    "than",
    "into",
    "about",
    "we",
    "you",
    "i",
    "they",
    "he",
    "she",
    "them",
    "our",
    "your",
}


@dataclass
class CompressToken:
    text: str
    index: int
    structural: bool


@dataclass
class CompressResult:
    compressed: str
    original_token_count: int
    kept_token_count: int
    kept_ratio: float


def tokenize(text: str) -> list[CompressToken]:
    tokens: list[CompressToken] = []
    for index, piece in enumerate(_WORD_OR_GAP.findall(text)):
        tokens.append(CompressToken(text=piece, index=index, structural=bool(_STRUCTURAL.match(piece))))
    return tokens


def heuristic_token_scores(tokens: list[CompressToken]) -> list[float]:
    """Rare words, identifiers/symbols, long tokens, and edges score higher; stop-words lowest."""
    frequency: dict[str, int] = {}
    for token in tokens:
        if token.structural:
            continue
        key = token.text.lower()
        frequency[key] = frequency.get(key, 0) + 1
    total = len(tokens)
    scores: list[float] = []
    for token in tokens:
        if token.structural:
            scores.append(float("inf"))  # never dropped
            continue
        lower = token.text.lower()
        if lower in STOP_WORDS:
            scores.append(0.1)
            continue
        score = 1.0 + 1.0 / frequency.get(lower, 1)
        if _CODE_SIGNAL.search(token.text):
            score += 1.0
        if len(token.text) >= 8:
            score += 0.5
        position_ratio = token.index / total if total else 0
        if position_ratio < 0.1 or position_ratio > 0.9:
            score += 0.5
        scores.append(score)
    return scores


def compress_by_token_importance(
    text: str,
    target_ratio: float,
    scores: list[float] | None = None,
) -> CompressResult:
    tokens = tokenize(text)
    droppable = [t for t in tokens if not t.structural]
    original = len(droppable)
    ratio = min(1.0, max(0.0, target_ratio))
    if original == 0 or ratio >= 1.0:
        return CompressResult(compressed=text, original_token_count=original, kept_token_count=original, kept_ratio=1.0)
    token_scores = scores if scores is not None else heuristic_token_scores(tokens)
    keep_count = max(1, round(original * ratio))
    ranked = sorted(((token_scores[t.index], t.index) for t in droppable), key=lambda pair: pair[0], reverse=True)
    kept_indices = {index for _, index in ranked[:keep_count]}

    pieces: list[str] = []
    previous_structural = True
    for token in tokens:
        if token.structural:
            pieces.append(token.text)
            previous_structural = True
        elif token.index in kept_indices:
            pieces.append(token.text)
            previous_structural = False
        elif not previous_structural:
            pieces.append(" ")
            previous_structural = True
    compressed = re.sub(r" *\n *", "\n", re.sub(r"[ \t]{2,}", " ", "".join(pieces)))
    return CompressResult(
        compressed=compressed,
        original_token_count=original,
        kept_token_count=len(kept_indices),
        kept_ratio=len(kept_indices) / original,
    )
