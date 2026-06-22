"""Versioned TS<->Python wire contract for the !Klein core sidecar.

This is intentionally small (NOT the 88-procedure tRPC surface): just the capabilities the Python core owns.
The JSON Schema exported from these models (see ``scripts/export_schema.py``) is the source of truth that the
TS ``KleinCoreClient`` validates against; a CI parity check fails on drift.

Requires pydantic (installed via ``uv sync``); kept out of the pure helper modules so those stay importable
without it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

CONTRACT_VERSION = 1


class SamplingPayload(BaseModel):
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    min_p: float | None = None
    repetition_penalty: float | None = None
    max_tokens: int | None = None
    stop: list[str] | None = None


class ChatMessagePayload(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ModelTarget(BaseModel):
    """Which model/backend to use. When ``base_url`` is set the proxy backend is used; otherwise llama.cpp."""

    model_id: str
    base_url: str | None = None
    api_key: str | None = None
    gguf_path: str | None = None


class JsonSchemaPayload(BaseModel):
    name: str = "output"
    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")
    strict: bool = True

    model_config = {"populate_by_name": True}


class GenerateRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    target: ModelTarget
    messages: list[ChatMessagePayload]
    sampling: SamplingPayload | None = None
    role: str = "unknown"
    grammar: str | None = None


class GenerateResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    content: str
    finish_reason: str | None = None
    backend: str


class GenerateStructuredRequest(GenerateRequest):
    json_schema: JsonSchemaPayload


class GenerateStructuredResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    value: Any
    backend: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    contract_version: int = CONTRACT_VERSION
    service: str = "klein-core"


class CompressRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    text: str
    target_ratio: float = 0.5
    model: str | None = None  # opt-in LLMLingua-2 model id; None = heuristic


class CompressResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    compressed: str
    original_token_count: int
    kept_token_count: int
    kept_ratio: float
    backend: str


class EmbedRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    texts: list[str]
    dim: int = 256
    model: str | None = None  # opt-in sentence-transformers model id; None = lexical
    gguf_path: str | None = None  # local GGUF embedding model (host-downloaded); in-process llama.cpp
    n_threads: int | None = None  # cap CPU threads so the embedder does not compete with the main LLM


class EmbedResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    embeddings: list[list[float]]
    backend: str


class EmbedUnloadRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    gguf_path: str | None = None  # specific model to free; None = all loaded GGUF embedding models


class EmbedUnloadResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    unloaded: int


class RepoFilePayload(BaseModel):
    path: str
    content: str


class RepoMapRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    files: list[RepoFilePayload]
    max_symbols: int = 40


class RankedSymbolPayload(BaseModel):
    name: str
    path: str
    rank: float


class RepoMapResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    symbols: list[RankedSymbolPayload]
    rendered: str


class AgentRunRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    target: ModelTarget
    task: str
    workspace_root: str
    max_turns: int = 20
    allow_commands: bool = False


class AgentTranscriptEntryPayload(BaseModel):
    turn: int
    action: dict[str, Any]
    observation: str | None = None
    error: str | None = None


class AgentRunResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    status: str
    final_message: str | None = None
    turns: int
    transcript: list[AgentTranscriptEntryPayload]


class PlanTaskPayload(BaseModel):
    id: str
    title: str
    prompt: str = ""
    depends_on: list[str] = Field(default_factory=list)
    complexity: float = 50.0
    files_likely_touched: list[str] = Field(default_factory=list)
    acceptance_command: str | None = None


class SelectGraphRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    candidates: list[list[PlanTaskPayload]]


class CandidateScorePayload(BaseModel):
    index: int
    parseable: bool
    violations: int
    warnings: int
    task_count: int
    dependency_density: float
    score: float
    error: str | None = None


class SelectGraphResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    best_index: int | None
    scores: list[CandidateScorePayload]
