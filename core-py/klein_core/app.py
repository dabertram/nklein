"""FastAPI application for the !Klein Python core sidecar.

Bound to 127.0.0.1, local-only. Phase 1 implements constrained generation (`/v1/generate`,
`/v1/generate_structured`); later phases add `/v1/compress`, `/v1/embed`, `/v1/repomap`, `/v1/decompose`,
`/v1/agent/run`. The TS runtime calls this sidecar when `NKLEIN_CORE_PY` is enabled, falling back to its own
path otherwise.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .contract import (
    GenerateRequest,
    GenerateResponse,
    GenerateStructuredRequest,
    GenerateStructuredResponse,
    HealthResponse,
)
from .generation import ChatMessage, GenerationBackend, ProxyBackend, StructuredFormat
from .local_only import CloudProviderDisabledError
from .sampling import SamplingOptions, resolve_sampling
from .structured import StructuredGenerationError, generate_structured

app = FastAPI(title="!Klein core", version="0.0.1")


def _resolve_backend(target) -> GenerationBackend:  # type: ignore[no-untyped-def]
    if target.base_url:
        return ProxyBackend(base_url=target.base_url, api_key=target.api_key)
    if target.gguf_path:
        from .llama_backend import LlamaCppBackend  # lazy: heavy optional dependency

        return LlamaCppBackend(model_id=target.model_id, gguf_path=target.gguf_path)
    raise HTTPException(status_code=400, detail="target requires base_url (proxy) or gguf_path (llama.cpp).")


def _sampling_from(request: GenerateRequest) -> SamplingOptions:
    override = None
    if request.sampling is not None:
        override = SamplingOptions(
            temperature=request.sampling.temperature,
            top_p=request.sampling.top_p,
            top_k=request.sampling.top_k,
            min_p=request.sampling.min_p,
            repetition_penalty=request.sampling.repetition_penalty,
            max_tokens=request.sampling.max_tokens,
            stop=tuple(request.sampling.stop) if request.sampling.stop else None,
        )
    return resolve_sampling(role=request.role, model_id=request.target.model_id, override=override)


def _messages_from(request: GenerateRequest) -> list[ChatMessage]:
    return [ChatMessage(role=m.role, content=m.content) for m in request.messages]


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/v1/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest) -> GenerateResponse:
    try:
        backend = _resolve_backend(request.target)
        result = await backend.complete(
            request.target.model_id,
            _messages_from(request),
            _sampling_from(request),
            StructuredFormat(grammar=request.grammar) if request.grammar else None,
        )
    except CloudProviderDisabledError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    return GenerateResponse(content=result.content, finish_reason=result.finish_reason, backend=result.backend)


@app.post("/v1/generate_structured", response_model=GenerateStructuredResponse)
async def generate_structured_endpoint(request: GenerateStructuredRequest) -> GenerateStructuredResponse:
    try:
        backend = _resolve_backend(request.target)
        value = await generate_structured(
            backend,
            request.target.model_id,
            _messages_from(request),
            {
                "name": request.json_schema.name,
                "schema": request.json_schema.schema_,
                "strict": request.json_schema.strict,
            },
            _sampling_from(request),
            grammar=request.grammar,
        )
    except CloudProviderDisabledError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except StructuredGenerationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return GenerateStructuredResponse(value=value, backend=backend.name)
