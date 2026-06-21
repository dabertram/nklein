"""Structured (constrained) generation helper for the !Klein Python core.

Constrained decoding via ``response_format``/grammar makes small models emit schema-valid JSON; this adds the
post-hoc guarantee (parse + recover prose/code-fence wrapped JSON) and a single corrective retry, mirroring the
TS ``LocalLlmClient.generateStructured`` and ``cline-tool-argument-repair``. The recovery is pure/stdlib.
"""

from __future__ import annotations

import json
from typing import Any

from .generation import ChatMessage, GenerationBackend, StructuredFormat
from .sampling import SamplingOptions


def try_parse_json(content: str) -> tuple[bool, Any]:
    """Recover a JSON value from model output (handles ```json fences and surrounding prose)."""
    text = content.strip()
    if text.startswith("```"):
        # Strip a leading ```json / ``` fence and the trailing ```.
        newline = text.find("\n")
        if newline != -1:
            text = text[newline + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()
    try:
        return True, json.loads(text)
    except json.JSONDecodeError:
        pass
    start = next((i for i, ch in enumerate(text) if ch in "[{"), -1)
    end = max(text.rfind("}"), text.rfind("]"))
    if start >= 0 and end > start:
        try:
            return True, json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return False, None
    return False, None


class StructuredGenerationError(RuntimeError):
    pass


async def generate_structured(
    backend: GenerationBackend,
    model_id: str,
    messages: list[ChatMessage],
    json_schema: dict[str, Any],
    sampling: SamplingOptions,
    grammar: str | None = None,
) -> Any:
    """Generate a JSON value constrained to ``json_schema``; recover + retry once on parse failure."""
    fmt = StructuredFormat(json_schema=json_schema, grammar=grammar)
    # Reasoning models spend tokens thinking before emitting JSON; give them room if the caller didn't set one.
    if sampling.max_tokens is None:
        sampling.max_tokens = 2048
    first = await backend.complete(model_id, messages, sampling, fmt)
    ok, value = try_parse_json(first.content)
    if ok:
        return value
    retry_messages = [
        *messages,
        ChatMessage(role="assistant", content=first.content),
        ChatMessage(
            role="user",
            content=(
                "Your previous reply was not valid JSON for the required schema. "
                "Reply again with ONLY the JSON object that matches the schema — no prose, no code fences."
            ),
        ),
    ]
    second = await backend.complete(model_id, retry_messages, sampling, fmt)
    ok, value = try_parse_json(second.content)
    if not ok:
        name = json_schema.get("name", "output")
        raise StructuredGenerationError(f'Model did not return valid JSON for schema "{name}" after a retry.')
    return value
