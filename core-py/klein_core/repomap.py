"""Repo map for the !Klein Python core (PageRank-ranked symbol map).

Default extraction is a dependency-free **lexical** pass (regex symbol definitions + references) ranked by
PageRank — an upgrade path for the TS documented-heuristic repo map. An optional tree-sitter backend (``ml``
extra) can replace extraction with precise AST symbols later. Pure/stdlib so it is unit-testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Definition signals across common languages (function/class/const/def/type).
_DEFINITION = re.compile(
    r"\b(?:function|class|interface|type|enum|struct|def|fn|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)"
)
_IDENTIFIER = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{2,})\b")


@dataclass
class RepoFile:
    path: str
    content: str


@dataclass
class RankedSymbol:
    name: str
    path: str
    rank: float


def _definitions(content: str) -> set[str]:
    return set(_DEFINITION.findall(content))


def rank_symbols(files: list[RepoFile], damping: float = 0.85, iterations: int = 24) -> list[RankedSymbol]:
    """PageRank over a symbol graph: a file 'votes' for symbols it references but does not define."""
    symbol_to_path: dict[str, str] = {}
    definitions_by_path: dict[str, set[str]] = {}
    for file in files:
        defs = _definitions(file.content)
        definitions_by_path[file.path] = defs
        for symbol in defs:
            symbol_to_path.setdefault(symbol, file.path)

    if not symbol_to_path:
        return []

    # Edges: referencing file -> defined symbol (cross-file references carry signal).
    out_edges: dict[str, list[str]] = {file.path: [] for file in files}
    for file in files:
        referenced = set(_IDENTIFIER.findall(file.content))
        for symbol in referenced:
            defined_path = symbol_to_path.get(symbol)
            if defined_path and defined_path != file.path:
                out_edges[file.path].append(symbol)

    symbols = list(symbol_to_path)
    rank = dict.fromkeys(symbols, 1.0 / len(symbols))
    for _ in range(iterations):
        incoming: dict[str, float] = dict.fromkeys(symbols, 0.0)
        for path, targets in out_edges.items():
            if not targets:
                continue
            share = rank_of_path(rank, definitions_by_path, path) / len(targets)
            for symbol in targets:
                incoming[symbol] += share
        base = (1.0 - damping) / len(symbols)
        rank = {symbol: base + damping * incoming[symbol] for symbol in symbols}

    ranked = [RankedSymbol(name=symbol, path=symbol_to_path[symbol], rank=rank[symbol]) for symbol in symbols]
    ranked.sort(key=lambda item: item.rank, reverse=True)
    return ranked


def rank_of_path(rank: dict[str, float], definitions_by_path: dict[str, set[str]], path: str) -> float:
    """A path's emitted rank is the sum of the ranks of the symbols it defines."""
    return sum(rank.get(symbol, 0.0) for symbol in definitions_by_path.get(path, set())) or 1e-9


def render_repo_map(files: list[RepoFile], max_symbols: int = 40) -> str:
    ranked = rank_symbols(files)[:max_symbols]
    lines = [f"- {symbol.path}: {symbol.name}" for symbol in ranked]
    return "\n".join(lines)
