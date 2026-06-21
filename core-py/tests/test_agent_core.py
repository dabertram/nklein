from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from klein_core.agent_loop import AgentTranscriptEntry, run_agent_loop
from klein_core.agent_tools import WorkspaceTools
from klein_core.fuzzy_edit import apply_search_replace


def test_fuzzy_edit_ladder() -> None:
    file = "function add(a, b) {\n\treturn a + b;\n}\n"
    assert apply_search_replace(file, "\treturn a + b;\n", "\treturn a - b;\n").strategy == "exact"
    # 2-space indent vs the file's tab -> whitespace-flexible, re-indented to a tab.
    ws = apply_search_replace(file, "  return a + b;\n", "  return b + a;\n")
    assert ws.strategy == "whitespace" and ws.content is not None and "\treturn b + a;" in ws.content
    # internal typo -> fuzzy.
    fz = apply_search_replace(file, "\treturn a+ b;\n", "\treturn a * b;\n")
    assert fz.strategy == "fuzzy" and fz.similarity is not None and fz.similarity >= 0.8
    # nonsense -> failure with a corrective reason.
    miss = apply_search_replace(file, "completely different\n", "x\n")
    assert miss.ok is False and miss.reason


def test_dotdotdots_elision() -> None:
    file = "const a = 1;\nconst b = 2;\nconst c = 3;\n"
    result = apply_search_replace(file, "const a = 1;\n...\nconst c = 3;\n", "const a = 10;\n...\nconst c = 30;\n")
    assert result.ok and result.content is not None
    assert "const a = 10;" in result.content and "const c = 30;" in result.content and "const b = 2;" in result.content


def test_workspace_tools_roundtrip_and_containment(tmp_path: Path) -> None:
    tools = WorkspaceTools(str(tmp_path))
    by_name = {t.name: t for t in tools.build()}
    assert by_name["write_file"].run({"path": "src/a.ts", "content": "let x = 1;\n"})["written"] is True
    assert by_name["read_file"].run({"path": "src/a.ts"})["content"] == "let x = 1;\n"
    edited = by_name["edit_file"].run(
        {"path": "src/a.ts", "edits": [{"search": "let x = 1;\n", "replace": "let x = 2;\n"}]}
    )
    assert edited["changed"] is True
    assert "let x = 2;" in (tmp_path / "src" / "a.ts").read_text()
    listed = by_name["list_files"].run({})
    assert "src/a.ts" in listed["files"]
    with pytest.raises(ValueError):
        by_name["read_file"].run({"path": "../../etc/passwd"})


@pytest.mark.asyncio
async def test_agent_loop_runs_tool_then_finishes() -> None:
    calls: list[Any] = []

    def echo(args: dict[str, Any]) -> Any:
        calls.append(args)
        return {"ok": True}

    from klein_core.agent_tools import AgentTool

    tools = [AgentTool("write_file", "w", echo)]
    actions = [
        {"action": "write_file", "input": {"path": "a"}},
        {"action": "final", "message": "done"},
    ]
    index = {"i": 0}

    async def decide(task: str, _tools: list[AgentTool], _t: list[AgentTranscriptEntry]) -> dict[str, Any]:
        action = actions[index["i"]]
        index["i"] += 1
        return action

    result = await run_agent_loop("do it", tools, decide)
    assert result.status == "completed"
    assert result.final_message == "done"
    assert calls == [{"path": "a"}]


@pytest.mark.asyncio
async def test_agent_loop_parks_on_repeated_action() -> None:
    from klein_core.agent_tools import AgentTool

    tools = [AgentTool("read_file", "r", lambda _a: "same")]

    async def decide(task: str, _tools: list[AgentTool], _t: list[AgentTranscriptEntry]) -> dict[str, Any]:
        return {"action": "read_file", "input": {"path": "x"}}

    result = await run_agent_loop("t", tools, decide, repeated_action_limit=3)
    assert result.status == "stalled"
    assert result.turns == 3
