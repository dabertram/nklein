from __future__ import annotations

from fastapi.testclient import TestClient

from klein_core.app import app
from klein_core.decomposition import PlanTask, assess_graph_quality, select_best_graph

client = TestClient(app)


def _task(id: str, title: str, depends_on: list[str] | None = None, complexity: float = 40) -> PlanTask:
    return PlanTask(
        id=id,
        title=title,
        prompt=title,
        depends_on=depends_on or [],
        complexity=complexity,
        acceptance_command="npm test",
    )


def test_quality_flags_test_card_without_impl_dependency() -> None:
    quality = assess_graph_quality([_task("impl", "Implement core"), _task("tests", "Add tests")])
    assert any("Test card tests" in v for v in quality.violations)


def test_quality_accepts_wired_test_card() -> None:
    quality = assess_graph_quality([_task("impl", "Implement core"), _task("tests", "Add tests", ["impl"])])
    assert quality.violations == []


def test_select_best_prefers_coherent_graph() -> None:
    incoherent = [_task("impl", "Implement core"), _task("tests", "Add tests")]
    coherent = [_task("impl", "Implement core"), _task("tests", "Add tests", ["impl"])]
    result = select_best_graph([incoherent, coherent])
    assert result.best_index == 1


def test_select_disqualifies_sizing_failure() -> None:
    too_big = [_task("huge", "Do everything", complexity=99)]
    ok = [_task("impl", "Implement core"), _task("tests", "Add tests", ["impl"])]
    result = select_best_graph([too_big, ok])
    assert result.scores[0].parseable is False
    assert result.best_index == 1


def test_decompose_select_endpoint() -> None:
    body = {
        "candidates": [
            [
                {"id": "impl", "title": "Implement core", "acceptance_command": "npm test"},
                {"id": "tests", "title": "Add tests", "acceptance_command": "npm test"},
            ],
            [
                {"id": "impl", "title": "Implement core", "acceptance_command": "npm test"},
                {"id": "tests", "title": "Add tests", "depends_on": ["impl"], "acceptance_command": "npm test"},
            ],
        ]
    }
    response = client.post("/v1/decompose/select", json=body)
    assert response.status_code == 200
    assert response.json()["best_index"] == 1
