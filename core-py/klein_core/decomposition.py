"""Decomposition quality for the !Klein Python core.

Ports the TS dependency-coherence validator (``cline-decomposition-graph-quality.ts``) and best-of-N selection
(``cline-decomposition-selection.ts``) so the Python core can raise plan quality from weak local models via
self-consistency (sample N graphs, keep the best by an objective judge; arXiv:2203.11171). This is the #1
remaining quality gap (decomposition under-scoping) and lives in the Python core where constrained decoding +
knowledge acquisition will drive generation. Pure/stdlib + unit-tested.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_COMPLEXITY = 75
MAX_LIKELY_FILES = 3
_SPARSE_DENSITY = 0.5
_MIN_TASKS_FOR_DENSITY_WARNING = 5


@dataclass
class PlanTask:
    id: str
    title: str
    prompt: str = ""
    depends_on: list[str] = field(default_factory=list)
    complexity: float = 50.0
    files_likely_touched: list[str] = field(default_factory=list)
    acceptance_command: str | None = None


@dataclass
class GraphQuality:
    violations: list[str]
    warnings: list[str]
    task_count: int
    dependency_count: int
    dependency_density: float
    isolated_task_ids: list[str]


_TEST = [r"\btests?\b", r"\bspec(s)?\b", r"\bacceptance\b", r"\bverif(y|ication|ies)\b", r"\bcoverage\b"]
_DOCS = [r"\breadme\b", r"\bdocs?\b", r"\bdocumentation\b", r"\bchangelog\b"]
_UI = [r"\bui\b", r"\buser interface\b", r"\bfrontend\b", r"\bgui\b"]
_DOMAIN = [
    r"\bdomain\b",
    r"\bcore\b",
    r"\bengine\b",
    r"\bsynth(esis)?\b",
    r"\bdsp\b",
    r"\bapi\b",
    r"\bschema\b",
    r"\bcontrols?\b",
    r"\bmetadata\b",
    r"\bstate\b",
    r"\bmodel\b",
    r"\balgorithm\b",
    r"\brender(ing|er)?\b",
]


def _matches(text: str, patterns: list[str]) -> bool:
    return any(re.search(p, text) for p in patterns)


@dataclass
class _Classified:
    task: PlanTask
    is_test: bool
    is_docs: bool
    is_ui: bool
    is_domain: bool


def _classify(task: PlanTask) -> _Classified:
    text = f"{task.title}\n{task.prompt}\n{chr(10).join(task.files_likely_touched)}".lower()
    is_test = _matches(text, _TEST)
    is_docs = _matches(text, _DOCS)
    return _Classified(
        task=task,
        is_test=is_test,
        is_docs=is_docs,
        is_ui=(not is_test and not is_docs and _matches(text, _UI)),
        is_domain=(not is_test and not is_docs and _matches(text, _DOMAIN)),
    )


def assess_graph_quality(tasks: list[PlanTask]) -> GraphQuality:
    classified = [_classify(t) for t in tasks]
    by_id = {c.task.id: c for c in classified}
    dependency_count = sum(len(set(t.depends_on)) for t in tasks)
    density = dependency_count / len(tasks) if tasks else 0.0

    has_in: set[str] = set()
    has_out: set[str] = set()
    for task in tasks:
        for dep in set(task.depends_on):
            if dep in by_id:
                has_out.add(task.id)
                has_in.add(dep)
    isolated = [t.id for t in tasks if t.id not in has_in and t.id not in has_out]

    violations: list[str] = []
    warnings: list[str] = []
    non_test_exists = any(not c.is_test for c in classified)
    non_docs_exists = any(not c.is_docs for c in classified)
    domain_exists = any(c.is_domain for c in classified)

    for entry in classified:
        deps = [by_id[d] for d in set(entry.task.depends_on) if d in by_id]
        if entry.is_test and non_test_exists and not any(not d.is_test for d in deps):
            violations.append(
                f'Test card {entry.task.id} ("{entry.task.title}") does not depend on any implementation card.'
            )
        if entry.is_docs and non_docs_exists and not any(not d.is_docs for d in deps):
            violations.append(
                f'Documentation card {entry.task.id} ("{entry.task.title}") does not depend on any feature card.'
            )
        if entry.is_ui and domain_exists and not entry.is_domain and not any(d.is_domain for d in deps):
            warnings.append(
                f'UI card {entry.task.id} ("{entry.task.title}") does not depend on any domain/control card.'
            )
        reversed_edges = [d for d in deps if d.is_test]
        if not entry.is_test and reversed_edges:
            warnings.append(f"Card {entry.task.id} depends on test card(s); likely reversed edge.")

    if len(tasks) >= _MIN_TASKS_FOR_DENSITY_WARNING and density < _SPARSE_DENSITY:
        warnings.append(f"Graph is sparse: {dependency_count} edges across {len(tasks)} cards (density {density:.2f}).")
    if len(tasks) >= _MIN_TASKS_FOR_DENSITY_WARNING and isolated:
        warnings.append(f"Cards with no dependency edges: {', '.join(isolated)}.")

    return GraphQuality(
        violations=violations,
        warnings=warnings,
        task_count=len(tasks),
        dependency_count=dependency_count,
        dependency_density=density,
        isolated_task_ids=isolated,
    )


def _sizing_violations(tasks: list[PlanTask]) -> list[str]:
    out: list[str] = []
    ids = [t.id for t in tasks]
    id_set = set(ids)
    if len(ids) != len(id_set):
        out.append("duplicate task ids")
    for task in tasks:
        if task.complexity > MAX_COMPLEXITY:
            out.append(f"{task.id}: complexity {task.complexity} > {MAX_COMPLEXITY}")
        if len(task.files_likely_touched) > MAX_LIKELY_FILES:
            out.append(f"{task.id}: {len(task.files_likely_touched)} files > {MAX_LIKELY_FILES}")
        if not (task.acceptance_command or "").strip():
            out.append(f"{task.id}: missing acceptanceCommand")
        for dep in task.depends_on:
            if dep not in id_set:
                out.append(f"{task.id}: depends on unknown {dep}")
    return out


@dataclass
class CandidateScore:
    index: int
    parseable: bool
    violations: int
    warnings: int
    task_count: int
    dependency_density: float
    score: float
    error: str | None = None


@dataclass
class SelectionResult:
    best_index: int | None
    scores: list[CandidateScore]


def select_best_graph(candidates: list[list[PlanTask]]) -> SelectionResult:
    """Self-consistency: rank candidates by sizing validity, then coherence violations/warnings/density."""
    scores: list[CandidateScore] = []
    for index, tasks in enumerate(candidates):
        sizing = _sizing_violations(tasks)
        quality = assess_graph_quality(tasks)
        if sizing:
            scores.append(
                CandidateScore(
                    index=index,
                    parseable=False,
                    violations=len(quality.violations),
                    warnings=len(quality.warnings),
                    task_count=quality.task_count,
                    dependency_density=quality.dependency_density,
                    score=float("-inf"),
                    error="; ".join(sizing),
                )
            )
            continue
        score = (
            1000.0
            - len(quality.violations) * 100
            - len(quality.warnings) * 5
            + min(quality.dependency_density, 2.0) * 10
            + quality.task_count * 0.1
        )
        scores.append(
            CandidateScore(
                index=index,
                parseable=True,
                violations=len(quality.violations),
                warnings=len(quality.warnings),
                task_count=quality.task_count,
                dependency_density=quality.dependency_density,
                score=score,
            )
        )
    best_index = None
    best_score = float("-inf")
    for candidate_score in scores:
        if candidate_score.parseable and candidate_score.score > best_score:
            best_score = candidate_score.score
            best_index = candidate_score.index
    return SelectionResult(best_index=best_index, scores=scores)
