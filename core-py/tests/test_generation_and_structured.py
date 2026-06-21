from __future__ import annotations

from typing import Any

import pytest

from klein_core.generation import (
    ChatMessage,
    GenerationResult,
    StructuredFormat,
    build_chat_completion_body,
    parse_openai_choice,
)
from klein_core.sampling import SamplingOptions
from klein_core.structured import StructuredGenerationError, generate_structured, try_parse_json


def test_build_body_includes_sampling_and_constrained_format() -> None:
    body = build_chat_completion_body(
        "qwen",
        [ChatMessage(role="user", content="hi")],
        SamplingOptions(temperature=0.1, min_p=0.05),
        StructuredFormat(json_schema={"name": "out", "schema": {"type": "object"}}),
    )
    assert body["model"] == "qwen"
    assert body["temperature"] == 0.1
    assert body["min_p"] == 0.05
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["name"] == "out"


def test_parse_openai_choice() -> None:
    payload = {"choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}]}
    assert parse_openai_choice(payload) == ("hello", "stop")
    assert parse_openai_choice({}) == ("", None)


def test_try_parse_json_recovers_fences_and_prose() -> None:
    assert try_parse_json('{"a": 1}') == (True, {"a": 1})
    assert try_parse_json('```json\n{"a": 1}\n```') == (True, {"a": 1})
    assert try_parse_json('sure: {"a": 1} done') == (True, {"a": 1})
    ok, _ = try_parse_json("not json at all")
    assert ok is False


class _ScriptedBackend:
    name = "scripted"

    def __init__(self, contents: list[str]) -> None:
        self._contents = contents
        self.calls = 0

    async def complete(self, model_id, messages, sampling, fmt=None) -> GenerationResult:  # type: ignore[no-untyped-def]
        content = self._contents[min(self.calls, len(self._contents) - 1)]
        self.calls += 1
        return GenerationResult(content=content, finish_reason="stop", backend=self.name, raw={})


@pytest.mark.asyncio
async def test_generate_structured_parses_first_success() -> None:
    backend = _ScriptedBackend(['{"value": 42}'])
    value = await generate_structured(
        backend, "qwen", [ChatMessage(role="user", content="x")], {"name": "out", "schema": {}}, SamplingOptions()
    )
    assert value == {"value": 42}
    assert backend.calls == 1


@pytest.mark.asyncio
async def test_generate_structured_retries_then_succeeds() -> None:
    backend = _ScriptedBackend(["nope", '{"value": 1}'])
    value: Any = await generate_structured(
        backend, "qwen", [ChatMessage(role="user", content="x")], {"name": "out", "schema": {}}, SamplingOptions()
    )
    assert value == {"value": 1}
    assert backend.calls == 2


@pytest.mark.asyncio
async def test_generate_structured_raises_after_failed_retry() -> None:
    backend = _ScriptedBackend(["nope", "still nope"])
    with pytest.raises(StructuredGenerationError):
        await generate_structured(
            backend, "qwen", [ChatMessage(role="user", content="x")], {"name": "out", "schema": {}}, SamplingOptions()
        )
