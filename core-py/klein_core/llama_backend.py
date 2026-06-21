"""Direct llama.cpp generation backend (loads a GGUF via ``llama-cpp-python``).

This gives !Klein full control of grammar (GBNF / JSON-schema) and all sampling (``min_p``, ``top_k``,
``repeat_penalty``) for the small/quantized-model regime. ``llama_cpp`` is imported lazily so the package
imports without the heavy native dependency; install it via the ``llama`` extra (``uv sync --extra llama``).
"""

from __future__ import annotations

import json
from typing import Any

from .generation import ChatMessage, GenerationResult, StructuredFormat
from .sampling import SamplingOptions

_MODEL_CACHE: dict[str, Any] = {}


class LlamaCppBackend:
    name = "llama_cpp"

    def __init__(self, model_id: str, gguf_path: str, n_ctx: int = 32_768) -> None:
        self._model_id = model_id
        self._gguf_path = gguf_path
        self._n_ctx = n_ctx

    def _load(self) -> Any:
        cached = _MODEL_CACHE.get(self._gguf_path)
        if cached is not None:
            return cached
        from llama_cpp import Llama  # lazy heavy import

        model = Llama(model_path=self._gguf_path, n_ctx=self._n_ctx, verbose=False)
        _MODEL_CACHE[self._gguf_path] = model
        return model

    async def complete(
        self,
        model_id: str,
        messages: list[ChatMessage],
        sampling: SamplingOptions,
        fmt: StructuredFormat | None = None,
    ) -> GenerationResult:
        model = self._load()
        kwargs: dict[str, Any] = {
            "messages": [{"role": m.role, "content": m.content} for m in messages],
        }
        if sampling.temperature is not None:
            kwargs["temperature"] = sampling.temperature
        if sampling.top_p is not None:
            kwargs["top_p"] = sampling.top_p
        if sampling.top_k is not None:
            kwargs["top_k"] = sampling.top_k
        if sampling.min_p is not None:
            kwargs["min_p"] = sampling.min_p
        if sampling.repetition_penalty is not None:
            kwargs["repeat_penalty"] = sampling.repetition_penalty
        if sampling.max_tokens is not None:
            kwargs["max_tokens"] = sampling.max_tokens
        if sampling.stop:
            kwargs["stop"] = list(sampling.stop)
        if fmt and fmt.grammar:
            from llama_cpp.llama_grammar import LlamaGrammar

            kwargs["grammar"] = LlamaGrammar.from_string(fmt.grammar)
        elif fmt and fmt.json_schema:
            kwargs["response_format"] = {
                "type": "json_object",
                "schema": fmt.json_schema.get("schema", {}),
            }
        payload = model.create_chat_completion(**kwargs)
        choice = payload["choices"][0]
        message = choice.get("message", {})
        content = message.get("content") or message.get("reasoning_content") or message.get("reasoning") or ""
        return GenerationResult(
            content=content,
            finish_reason=choice.get("finish_reason"),
            backend=self.name,
            raw=json.loads(json.dumps(payload, default=str)),
        )
