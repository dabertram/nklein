"""Versioned TS<->Python wire contract for the !Klein core sidecar.

This is intentionally small (NOT the 88-procedure tRPC surface): just the capabilities the Python core owns.
The JSON Schema exported from these models (see ``scripts/export_schema.py``) is the source of truth that the
TS ``KleinCoreClient`` validates against; a CI parity check fails on drift.

Requires pydantic (installed via ``uv sync``); kept out of the pure helper modules so those stay importable
without it.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

CONTRACT_VERSION = 1


class SamplingPayload(BaseModel):
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    min_p: Optional[float] = None
    repetition_penalty: Optional[float] = None
    max_tokens: Optional[int] = None
    stop: Optional[list[str]] = None


class ChatMessagePayload(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ModelTarget(BaseModel):
    """Which model/backend to use. When ``base_url`` is set the proxy backend is used; otherwise llama.cpp."""

    model_id: str
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    gguf_path: Optional[str] = None


class JsonSchemaPayload(BaseModel):
    name: str = "output"
    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")
    strict: bool = True

    model_config = {"populate_by_name": True}


class GenerateRequest(BaseModel):
    contract_version: int = CONTRACT_VERSION
    target: ModelTarget
    messages: list[ChatMessagePayload]
    sampling: Optional[SamplingPayload] = None
    role: str = "unknown"
    grammar: Optional[str] = None


class GenerateResponse(BaseModel):
    contract_version: int = CONTRACT_VERSION
    content: str
    finish_reason: Optional[str] = None
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
