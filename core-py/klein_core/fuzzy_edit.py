"""Lenient fuzzy search/replace editing (aider ``editblock`` ladder; Apache-2.0 — see THIRD_PARTY_NOTICES.md).

Re-implements the same fallback ladder used by the TS ``nklein-fuzzy-edit`` so both runtimes behave
identically: exact -> whitespace-flexible (dedent/re-indent) -> leading-blank tolerance -> ``...`` elision ->
closest fuzzy match (>=0.8 similarity within +/-10% length). This is the single biggest reliability win for
small/quantized models making edits. Pure/stdlib + unit-tested.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

_DOTDOTDOTS = re.compile(r"^\s*\.\.\.\s*$")
_FUZZY_THRESHOLD = 0.8


@dataclass
class EditResult:
    ok: bool
    content: str | None = None
    strategy: str | None = None
    similarity: float | None = None
    reason: str | None = None
    best_similarity: float | None = None


def _split(text: str) -> list[str]:
    return text.splitlines(keepends=True) if text else []


def _leading_ws(line: str) -> str:
    return line[: len(line) - len(line.lstrip(" \t"))]


def _perfect(whole: list[str], part: list[str], replace: list[str]) -> list[str] | None:
    if not part:
        return None
    for i in range(0, len(whole) - len(part) + 1):
        if whole[i : i + len(part)] == part:
            return whole[:i] + replace + whole[i + len(part) :]
    return None


def _whitespace_flexible(whole: list[str], part: list[str], replace: list[str]) -> list[str] | None:
    if not part:
        return None
    first_non_blank = next((i for i, line in enumerate(part) if line.strip()), -1)
    for i in range(0, len(whole) - len(part) + 1):
        window = whole[i : i + len(part)]
        if any(window[j].strip() != part[j].strip() for j in range(len(part))):
            continue
        reindented = replace
        if first_non_blank >= 0:
            file_indent = _leading_ws(window[first_non_blank])
            part_indent = _leading_ws(part[first_non_blank])
            if file_indent != part_indent:
                reindented = []
                for line in replace:
                    if not line.strip():
                        reindented.append(line)
                        continue
                    current = _leading_ws(line)
                    without = current[len(part_indent) :] if current.startswith(part_indent) else current
                    reindented.append(f"{file_indent}{without}{line[len(current) :]}")
        return whole[:i] + reindented + whole[i + len(part) :]
    return None


def _strip_leading_blanks(lines: list[str]) -> list[str]:
    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    return lines[start:]


def _dotdotdots(content: str, search: str, replace: str) -> str | None:
    search_lines = _split(search)
    if not any(_DOTDOTDOTS.match(line) for line in search_lines):
        return None

    def segments(lines: list[str]) -> list[list[str]]:
        out: list[list[str]] = [[]]
        for line in lines:
            if _DOTDOTDOTS.match(line):
                out.append([])
            else:
                out[-1].append(line)
        return out

    search_segments = segments(search_lines)
    replace_segments = segments(_split(replace))
    if len(search_segments) != len(replace_segments):
        return None
    current = content
    for seg_search, seg_replace in zip(search_segments, replace_segments, strict=True):
        needle = "".join(seg_search)
        if not needle.strip():
            continue
        if current.count(needle) != 1:
            return None
        current = current.replace(needle, "".join(seg_replace), 1)
    return current


def _fuzzy(whole: list[str], part: list[str], replace: list[str]) -> tuple[list[str] | None, float]:
    if not part:
        return None, 0.0
    part_text = "".join(part)
    min_len = max(1, int(len(part) * 0.9))
    max_len = max(min_len, round(len(part) * 1.1))
    best_sim = 0.0
    best_start = -1
    best_len = len(part)
    for window_len in range(min_len, max_len + 1):
        for i in range(0, len(whole) - window_len + 1):
            window_text = "".join(whole[i : i + window_len])
            ratio = difflib.SequenceMatcher(None, window_text, part_text).ratio()
            if ratio > best_sim:
                best_sim, best_start, best_len = ratio, i, window_len
    if best_start >= 0 and best_sim >= _FUZZY_THRESHOLD:
        return whole[:best_start] + replace + whole[best_start + best_len :], best_sim
    return None, best_sim


def apply_search_replace(content: str, search: str, replace: str) -> EditResult:
    if search == "":
        return EditResult(ok=True, content=replace if content == "" else f"{content}{replace}", strategy="exact")
    whole, part, repl = _split(content), _split(search), _split(replace)

    exact = _perfect(whole, part, repl)
    if exact is not None:
        return EditResult(ok=True, content="".join(exact), strategy="exact")
    ws = _whitespace_flexible(whole, part, repl)
    if ws is not None:
        return EditResult(ok=True, content="".join(ws), strategy="whitespace")
    trimmed = _strip_leading_blanks(part)
    if trimmed and len(trimmed) != len(part):
        for fn, strat in ((_perfect, "leading_blank"), (_whitespace_flexible, "leading_blank")):
            result = fn(whole, trimmed, repl)
            if result is not None:
                return EditResult(ok=True, content="".join(result), strategy=strat)
    dots = _dotdotdots(content, search, replace)
    if dots is not None:
        return EditResult(ok=True, content=dots, strategy="dotdotdots")
    fuzzy, best = _fuzzy(whole, part, repl)
    if fuzzy is not None:
        return EditResult(ok=True, content="".join(fuzzy), strategy="fuzzy", similarity=best)
    return EditResult(
        ok=False,
        reason=(
            "Search block did not match the file. Re-read the exact current text (including indentation) and "
            "copy it verbatim, or include more surrounding context to make it unique."
        ),
        best_similarity=best,
    )


def apply_blocks(content: str, blocks: list[tuple[str, str]]) -> EditResult:
    current = content
    strategies: list[str] = []
    for index, (search, replace) in enumerate(blocks):
        result = apply_search_replace(current, search, replace)
        if not result.ok or result.content is None:
            return EditResult(
                ok=False,
                content=content,
                reason=f"edit block {index + 1}: {result.reason}",
                best_similarity=result.best_similarity,
            )
        current = result.content
        if result.strategy:
            strategies.append(result.strategy)
    return EditResult(ok=True, content=current, strategy=",".join(strategies))
