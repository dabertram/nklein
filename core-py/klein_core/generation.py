"""Generation request building + backend abstraction for the !Klein Python core.

Two backends satisfy the same contract (decision: "both"):
  * ``ProxyBackend`` — forwards to an existing local OpenAI-compatible server (LM Studio / Ollama / llama.cpp),
    adding the full sampling + grammar/JSON-schema fields the Cline SDK could not send.
  * ``LlamaCppBackend`` — loads a GGUF directly via ``llama-cpp-python`` for full control of grammar + all
    sampling. Imported lazily inside the backend so the package imports without the heavy dependency.

``build_chat_completion_body`` is pure and stdlib-only so it is unit-testable without FastAPI/httpx/llama_cpp.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .local_only import assert_local_base_url
from .sampling import SamplingOptions, sampling_to_body


@dataclass
class ChatMessage:
    role: str
    content: str


@dataclass
class StructuredFormat:
    """OpenAI ``response_format`` (json_schema) and/or a raw llama.cpp GBNF grammar."""

    json_schema: dict[str, Any] | None = None  # { "name": str, "schema": {...}, "strict": bool }
    grammar: str | None = None


@dataclass
class GenerationResult:
    content: str
    finish_reason: str | None
    backend: str
    raw: Any


def build_chat_completion_body(
    model_id: str,
    messages: list[ChatMessage],
    sampling: SamplingOptions,
    fmt: StructuredFormat | None = None,
) -> dict[str, Any]:
    """Build an OpenAI-compatible /chat/completions body including constrained-decoding fields."""
    body: dict[str, Any] = {
        "model": model_id,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "stream": False,
    }
    body.update(sampling_to_body(sampling))
    if fmt and fmt.json_schema:
        schema = fmt.json_schema
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": schema.get("name", "output"),
                "schema": schema.get("schema", {}),
                "strict": schema.get("strict", True),
            },
        }
    if fmt and fmt.grammar:
        body["grammar"] = fmt.grammar
    return body


class GenerationBackend(Protocol):
    name: str

    async def complete(
        self,
        model_id: str,
        messages: list[ChatMessage],
        sampling: SamplingOptions,
        fmt: StructuredFormat | None = None,
    ) -> GenerationResult: ...


def parse_openai_choice(payload: Any) -> tuple[str, str | None]:
    """Extract (content, finish_reason) from an OpenAI-compatible chat completion payload.

    Reasoning models served by LM Studio / llama.cpp frequently put their entire output — including a
    constrained-JSON answer — in ``message.reasoning_content`` and leave ``content`` empty. When content is
    empty we fall back to ``reasoning_content`` so structured generation still works with reasoning models
    (verified against qwen3.5 in LM Studio).
    """
    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not choices:
        return "", None
    choice = choices[0]
    message = choice.get("message") if isinstance(choice, dict) else None
    finish = choice.get("finish_reason") if isinstance(choice, dict) else None
    if not isinstance(message, dict):
        return "", finish
    content = message.get("content")
    if not content:
        content = message.get("reasoning_content") or message.get("reasoning")
    return (content or ""), finish


class ProxyBackend:
    """Forwards generation to an existing local OpenAI-compatible server."""

    name = "proxy"

    def __init__(self, base_url: str, api_key: str | None = None, timeout_s: float = 120.0) -> None:
        assert_local_base_url(base_url)
        self._base_url = base_url.rstrip("/")
        if not self._base_url.endswith(("/v1", "/v2", "/v3")):
            self._base_url = f"{self._base_url}/v1"
        self._api_key = api_key
        self._timeout_s = timeout_s

    async def complete(
        self,
        model_id: str,
        messages: list[ChatMessage],
        sampling: SamplingOptions,
        fmt: StructuredFormat | None = None,
    ) -> GenerationResult:
        import httpx  # lazy: only needed when the proxy backend is actually used

        body = build_chat_completion_body(model_id, messages, sampling, fmt)
        headers = {"content-type": "application/json"}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            response = await client.post(f"{self._base_url}/chat/completions", json=body, headers=headers)
            response.raise_for_status()
            payload = response.json()
        content, finish = parse_openai_choice(payload)
        return GenerationResult(content=content, finish_reason=finish, backend=self.name, raw=payload)
