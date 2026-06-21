"""!Klein native agent core loop (Python) — ReAct tool-calling on the local model.

Mirrors the TS ``src/agent-core/agent-loop.ts`` (ReAct; arXiv:2210.03629): each turn the model emits a
constrained-JSON action (a tool call or ``final``); the loop runs the tool, feeds back the observation, and
guards against loops (repeated identical action), unknown tools, and a max-turn budget. The action is produced
via :func:`klein_core.structured.generate_structured` so small/quantized models reliably emit a valid choice.

The decider is injectable so the loop is unit-testable without a live model.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from .agent_tools import AgentTool
from .generation import ChatMessage, GenerationBackend
from .sampling import resolve_sampling
from .structured import generate_structured


@dataclass
class AgentTranscriptEntry:
    turn: int
    action: dict[str, Any]
    observation: str | None = None
    error: str | None = None


@dataclass
class AgentRunResult:
    status: str  # completed | max_turns | stalled | error
    final_message: str | None
    transcript: list[AgentTranscriptEntry] = field(default_factory=list)
    turns: int = 0


DecideAction = Callable[[str, list[AgentTool], list[AgentTranscriptEntry]], Awaitable[dict[str, Any]]]

_MAX_OBSERVATION_CHARS = 4000


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value)
        except (TypeError, ValueError):
            text = str(value)
    return text if len(text) <= _MAX_OBSERVATION_CHARS else f"{text[:_MAX_OBSERVATION_CHARS]}\n[truncated]"


def _fingerprint(action: dict[str, Any]) -> str:
    if action.get("action") == "final":
        return "final"
    try:
        return f"{action.get('action')}:{json.dumps(action.get('input'), sort_keys=True)}"
    except (TypeError, ValueError):
        return f"{action.get('action')}:{action.get('input')}"


async def run_agent_loop(
    task: str,
    tools: list[AgentTool],
    decide_action: DecideAction,
    max_turns: int = 20,
    repeated_action_limit: int = 3,
) -> AgentRunResult:
    tools_by_name = {tool.name: tool for tool in tools}
    transcript: list[AgentTranscriptEntry] = []
    last_fingerprint: str | None = None
    repeat_count = 0

    for turn in range(1, max_turns + 1):
        try:
            action = await decide_action(task, tools, transcript)
        except Exception as error:  # noqa: BLE001 - surface decider failure as a terminal status
            transcript.append(AgentTranscriptEntry(turn=turn, action={"action": "final"}, error=str(error)))
            return AgentRunResult(status="error", final_message=None, transcript=transcript, turns=turn)

        if action.get("action") == "final":
            transcript.append(AgentTranscriptEntry(turn=turn, action=action))
            return AgentRunResult(
                status="completed", final_message=str(action.get("message", "")), transcript=transcript, turns=turn
            )

        fingerprint = _fingerprint(action)
        repeat_count = repeat_count + 1 if fingerprint == last_fingerprint else 1
        last_fingerprint = fingerprint
        if repeat_count >= repeated_action_limit:
            transcript.append(
                AgentTranscriptEntry(
                    turn=turn, action=action, error=f"Repeated {action.get('action')} {repeat_count}x; parking."
                )
            )
            return AgentRunResult(status="stalled", final_message=None, transcript=transcript, turns=turn)

        tool = tools_by_name.get(str(action.get("action")))
        entry = AgentTranscriptEntry(turn=turn, action=action)
        if tool is None:
            entry.observation = f"Error: unknown tool {action.get('action')!r}. Tools: {', '.join(tools_by_name)}."
            transcript.append(entry)
            continue
        try:
            result = tool.run(action.get("input") or {})
            if inspect.isawaitable(result):
                result = await result
            entry.observation = _stringify(result)
        except Exception as error:  # noqa: BLE001 - tool errors are observations, not crashes
            entry.observation = f"Error: {error}"
        transcript.append(entry)

    return AgentRunResult(status="max_turns", final_message=None, transcript=transcript, turns=max_turns)


def _action_schema(tools: list[AgentTool]) -> dict[str, Any]:
    return {
        "name": "agent_action",
        "schema": {
            "type": "object",
            "properties": {
                "thought": {"type": "string"},
                "action": {"type": "string", "enum": [*[t.name for t in tools], "final"]},
                "input": {"type": "object"},
                "message": {"type": "string"},
            },
            "required": ["action"],
            "additionalProperties": True,
        },
    }


_SYSTEM_PROMPT = (
    "You are !Klein's local coding agent. Work in small, verifiable steps. Each turn choose exactly one "
    "action: a tool, or 'final'. Reply ONLY with JSON: "
    '{"thought": str, "action": <tool|"final">, "input": object, "message": str}. '
    "Prefer edit_file for changes to existing files."
)


def make_model_decider(backend: GenerationBackend, model_id: str) -> DecideAction:
    """Builds a decider that selects the next action via constrained structured generation."""

    async def decide(task: str, tools: list[AgentTool], transcript: list[AgentTranscriptEntry]) -> dict[str, Any]:
        catalog = "\n".join(f"- {tool.name}: {tool.description}" for tool in tools)
        progress = (
            "\n".join(
                f"Step {e.turn}: {e.action.get('action')} {json.dumps(e.action.get('input'))}"
                + (f" -> {e.observation}" if e.observation else "")
                for e in transcript
            )
            or "(no steps yet)"
        )
        messages = [
            ChatMessage(role="system", content=_SYSTEM_PROMPT),
            ChatMessage(
                role="user",
                content=f"Task:\n{task}\n\nTools:\n{catalog}\n\nProgress:\n{progress}\n\nChoose the next action.",
            ),
        ]
        value = await generate_structured(
            backend,
            model_id,
            messages,
            _action_schema(tools),
            resolve_sampling(role="structured", model_id=model_id),
        )
        return value if isinstance(value, dict) else {"action": "final", "message": str(value)}

    return decide
