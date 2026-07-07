"""FastAPI application for the !Klein Python core sidecar.

Bound to 127.0.0.1, local-only. Phase 1 implements constrained generation (`/v1/generate`,
`/v1/generate_structured`); later phases add `/v1/compress`, `/v1/embed`, `/v1/repomap`, `/v1/decompose`,
`/v1/agent/run`. The TS runtime calls this sidecar when `NKLEIN_CORE_PY` is enabled, falling back to its own
path otherwise.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .compression import compress_by_token_importance
from .contract import (
    AgentRunRequest,
    AgentRunResponse,
    AgentTranscriptEntryPayload,
    CandidateScorePayload,
    CompressRequest,
    CompressResponse,
    EmbedRequest,
    EmbedResponse,
    EmbedUnloadRequest,
    EmbedUnloadResponse,
    GenerateRequest,
    GenerateResponse,
    GenerateStructuredRequest,
    GenerateStructuredResponse,
    HealthResponse,
    RankedSymbolPayload,
    RepoMapRequest,
    RepoMapResponse,
    SelectGraphRequest,
    SelectGraphResponse,
)
from .decomposition import PlanTask, select_best_graph
from .embeddings import embed_texts, loaded_embedding_models, unload_gguf_embedding
from .generation import ChatMessage, GenerationBackend, ProxyBackend, StructuredFormat
from .local_only import CloudProviderDisabledError
from .repomap import RepoFile, rank_symbols, render_repo_map
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
    return HealthResponse(status="ok", loaded_models=loaded_embedding_models())


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


@app.post("/v1/compress", response_model=CompressResponse)
async def compress(request: CompressRequest) -> CompressResponse:
    if request.model:
        try:
            from .llmlingua_backend import llmlingua_compress  # lazy ``ml`` extra

            result = llmlingua_compress(request.text, request.target_ratio, request.model)
            return CompressResponse(
                compressed=result.compressed,
                original_token_count=result.original_token_count,
                kept_token_count=result.kept_token_count,
                kept_ratio=result.kept_ratio,
                backend=f"llmlingua:{request.model}",
            )
        except Exception:  # noqa: BLE001 - never fail compression; fall back to the heuristic below
            pass
    result = compress_by_token_importance(request.text, request.target_ratio)
    return CompressResponse(
        compressed=result.compressed,
        original_token_count=result.original_token_count,
        kept_token_count=result.kept_token_count,
        kept_ratio=result.kept_ratio,
        backend="heuristic",
    )


@app.post("/v1/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    embeddings = embed_texts(
        request.texts,
        dim=request.dim,
        model=request.model,
        gguf_path=request.gguf_path,
        n_threads=request.n_threads,
    )
    backend = "llama_cpp" if request.gguf_path else (request.model or "lexical")
    return EmbedResponse(embeddings=embeddings, backend=backend)


@app.post("/v1/embed/unload", response_model=EmbedUnloadResponse)
async def embed_unload(request: EmbedUnloadRequest) -> EmbedUnloadResponse:
    return EmbedUnloadResponse(unloaded=unload_gguf_embedding(request.gguf_path))


@app.post("/v1/repomap", response_model=RepoMapResponse)
async def repomap(request: RepoMapRequest) -> RepoMapResponse:
    files = [RepoFile(path=f.path, content=f.content) for f in request.files]
    ranked = rank_symbols(files)[: request.max_symbols]
    return RepoMapResponse(
        symbols=[RankedSymbolPayload(name=s.name, path=s.path, rank=s.rank) for s in ranked],
        rendered=render_repo_map(files, max_symbols=request.max_symbols),
    )


@app.post("/v1/agent/run", response_model=AgentRunResponse)
async def agent_run(request: AgentRunRequest) -> AgentRunResponse:
    from .agent_loop import make_model_decider, run_agent_loop
    from .agent_tools import WorkspaceTools

    try:
        backend = _resolve_backend(request.target)
    except CloudProviderDisabledError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    tools = WorkspaceTools(request.workspace_root, allow_commands=request.allow_commands).build()
    decider = make_model_decider(backend, request.target.model_id)
    result = await run_agent_loop(request.task, tools, decider, max_turns=request.max_turns)
    return AgentRunResponse(
        status=result.status,
        final_message=result.final_message,
        turns=result.turns,
        transcript=[
            AgentTranscriptEntryPayload(turn=e.turn, action=e.action, observation=e.observation, error=e.error)
            for e in result.transcript
        ],
    )


@app.post("/v1/decompose/select", response_model=SelectGraphResponse)
async def decompose_select(request: SelectGraphRequest) -> SelectGraphResponse:
    candidates = [
        [
            PlanTask(
                id=t.id,
                title=t.title,
                prompt=t.prompt,
                depends_on=t.depends_on,
                complexity=t.complexity,
                files_likely_touched=t.files_likely_touched,
                acceptance_command=t.acceptance_command,
            )
            for t in graph
        ]
        for graph in request.candidates
    ]
    result = select_best_graph(candidates)
    return SelectGraphResponse(
        best_index=result.best_index,
        scores=[
            CandidateScorePayload(
                index=s.index,
                parseable=s.parseable,
                violations=s.violations,
                warnings=s.warnings,
                task_count=s.task_count,
                dependency_density=s.dependency_density,
                score=s.score,
                error=s.error,
            )
            for s in result.scores
        ],
    )
