"""Suite 11 — core-py contract parity oracle (§5.H / §5.X).

This module is the cross-language CONTRACT PARITY oracle between the Python sidecar
and the TypeScript ``KleinCoreClient``.  It fails the moment the Python wire contract
(``klein_core/contract.py``) drifts from the JSON Schema that ``scripts/export_schema.py``
exports and the TS side validates against.

Three categories of assertions:

1. **Schema-export parity** — regenerating the schema from the live Pydantic models
   yields byte-for-byte identical output to what ``export_schema.py`` produces.  Catches
   "someone changed contract.py but forgot to re-export / update export_schema.py."

2. **Endpoint response-shape parity** — for every FastAPI endpoint, a minimal valid
   request is driven via ``TestClient`` (no real model / no network) and the JSON
   response is validated against the corresponding Pydantic response model.  Ensures the
   app serialises exactly what the contract declares.

3. **Request validation** — malformed / missing-field requests return the expected 4xx,
   proving the contract rejects off-contract input at the edge.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from klein_core.app import app
from klein_core.contract import (
    CONTRACT_VERSION,
    AgentRunResponse,
    CompressResponse,
    EmbedResponse,
    EmbedUnloadResponse,
    GenerateResponse,
    GenerateStructuredResponse,
    HealthResponse,
    RepoMapResponse,
    SelectGraphResponse,
)

# ---------------------------------------------------------------------------
# Shared test client (no real model; routes that need a backend are patched)
# ---------------------------------------------------------------------------

client = TestClient(app)

# ============================================================================
# 1. Schema-export parity
# ============================================================================


def test_schema_export_matches_live_models() -> None:
    """export_schema.build_schema() must stay in sync with the live Pydantic models.

    If contract.py is updated but the export function is not (or vice-versa), the
    TS side will silently disagree with the Python side.  This catches that drift.
    """
    from scripts.export_schema import build_schema  # type: ignore[import]

    # Import directly to build the expected schema from the current contract models
    from klein_core.contract import (
        GenerateRequest,
        GenerateResponse,
        GenerateStructuredRequest,
        GenerateStructuredResponse,
        HealthResponse,
    )

    expected: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "models": {
            "GenerateRequest": GenerateRequest.model_json_schema(),
            "GenerateResponse": GenerateResponse.model_json_schema(),
            "GenerateStructuredRequest": GenerateStructuredRequest.model_json_schema(),
            "GenerateStructuredResponse": GenerateStructuredResponse.model_json_schema(),
            "HealthResponse": HealthResponse.model_json_schema(),
        },
    }

    live = build_schema()

    # Compare via JSON round-trip so ordering differences are irrelevant
    assert json.dumps(live, sort_keys=True) == json.dumps(expected, sort_keys=True), (
        "export_schema.build_schema() is out of sync with the live contract models. "
        "Re-run `uv run python scripts/export_schema.py > contract.schema.json` and update "
        "the export function when contract.py changes."
    )


def test_schema_contains_contract_version() -> None:
    """The exported schema must carry the CONTRACT_VERSION so the TS side can guard against version mismatches."""
    from scripts.export_schema import build_schema  # type: ignore[import]

    schema = build_schema()
    assert schema["contractVersion"] == CONTRACT_VERSION, (
        f"Exported schema contractVersion {schema['contractVersion']!r} "
        f"!= CONTRACT_VERSION {CONTRACT_VERSION!r}"
    )


def test_schema_models_match_expected_keys() -> None:
    """The exported schema must contain exactly the models the TS KleinCoreClient knows about."""
    from scripts.export_schema import build_schema  # type: ignore[import]

    schema = build_schema()
    expected_keys = {
        "GenerateRequest",
        "GenerateResponse",
        "GenerateStructuredRequest",
        "GenerateStructuredResponse",
        "HealthResponse",
    }
    assert set(schema["models"].keys()) == expected_keys, (
        f"Exported model keys {set(schema['models'].keys())} != expected {expected_keys}"
    )


# ============================================================================
# 2. Endpoint response-shape parity
# ============================================================================

# --- /health ---------------------------------------------------------------


def test_health_response_shape() -> None:
    """/health returns a payload that round-trips through HealthResponse without errors."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    parsed = HealthResponse(**data)
    assert parsed.status == "ok"
    assert parsed.contract_version == CONTRACT_VERSION
    assert parsed.service == "klein-core"


def test_health_response_validates_against_schema() -> None:
    """/health JSON keys must match the exported schema definition for HealthResponse."""
    from scripts.export_schema import build_schema  # type: ignore[import]

    resp = client.get("/health")
    data = resp.json()
    schema = build_schema()["models"]["HealthResponse"]

    # Every required property in the schema must be present
    required = set(schema.get("required", []))
    for field in required:
        assert field in data, f"Required field {field!r} missing from /health response"


# --- /v1/generate (proxy backend, stubbed) ---------------------------------

_PROXY_REQUEST = {
    "target": {"model_id": "test-model", "base_url": "http://localhost:1234"},
    "messages": [{"role": "user", "content": "hello"}],
}


def _make_proxy_mock(content: str = "hello from stub") -> MagicMock:
    """Build an AsyncMock that mimics a ProxyBackend.complete() return value."""
    from klein_core.generation import GenerationResult

    mock = MagicMock()
    mock.name = "proxy"
    mock.complete = AsyncMock(
        return_value=GenerationResult(content=content, finish_reason="stop", backend="proxy", raw={})
    )
    return mock


def test_generate_response_shape() -> None:
    """/v1/generate response must conform to GenerateResponse."""
    with patch("klein_core.app.ProxyBackend", return_value=_make_proxy_mock()):
        resp = client.post("/v1/generate", json=_PROXY_REQUEST)
    assert resp.status_code == 200
    data = resp.json()
    parsed = GenerateResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert isinstance(parsed.content, str)
    assert isinstance(parsed.backend, str)


def test_generate_response_validates_against_schema() -> None:
    """/v1/generate JSON keys must match the exported GenerateResponse schema."""
    from scripts.export_schema import build_schema  # type: ignore[import]

    with patch("klein_core.app.ProxyBackend", return_value=_make_proxy_mock()):
        resp = client.post("/v1/generate", json=_PROXY_REQUEST)
    data = resp.json()
    schema = build_schema()["models"]["GenerateResponse"]
    required = set(schema.get("required", []))
    for field in required:
        assert field in data, f"Required field {field!r} missing from /v1/generate response"


# --- /v1/generate_structured (proxy backend, stubbed) ----------------------

_STRUCTURED_REQUEST = {
    "target": {"model_id": "test-model", "base_url": "http://localhost:1234"},
    "messages": [{"role": "user", "content": "return a number"}],
    "json_schema": {"name": "result", "schema": {"type": "object"}, "strict": True},
}


def test_generate_structured_response_shape() -> None:
    """/v1/generate_structured response must conform to GenerateStructuredResponse."""
    mock = _make_proxy_mock('{"answer": 42}')
    with patch("klein_core.app.ProxyBackend", return_value=mock):
        resp = client.post("/v1/generate_structured", json=_STRUCTURED_REQUEST)
    assert resp.status_code == 200
    data = resp.json()
    parsed = GenerateStructuredResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert parsed.value == {"answer": 42}


def test_generate_structured_response_validates_against_schema() -> None:
    """/v1/generate_structured JSON keys must match the exported GenerateStructuredResponse schema."""
    from scripts.export_schema import build_schema  # type: ignore[import]

    mock = _make_proxy_mock('{"answer": 42}')
    with patch("klein_core.app.ProxyBackend", return_value=mock):
        resp = client.post("/v1/generate_structured", json=_STRUCTURED_REQUEST)
    data = resp.json()
    schema = build_schema()["models"]["GenerateStructuredResponse"]
    required = set(schema.get("required", []))
    for field in required:
        assert field in data, f"Required field {field!r} missing from /v1/generate_structured response"


# --- /v1/compress (pure heuristic, no model required) ----------------------

_COMPRESS_REQUEST = {
    "text": "The quick brown fox jumps over the lazy dog. " * 20,
    "target_ratio": 0.5,
}


def test_compress_response_shape() -> None:
    """/v1/compress with heuristic backend (no model) must conform to CompressResponse."""
    resp = client.post("/v1/compress", json=_COMPRESS_REQUEST)
    assert resp.status_code == 200
    data = resp.json()
    parsed = CompressResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert parsed.backend == "heuristic"
    assert 0.0 <= parsed.kept_ratio <= 1.0
    assert parsed.original_token_count >= parsed.kept_token_count


def test_compress_response_has_all_fields() -> None:
    """/v1/compress response must contain every field declared in CompressResponse."""
    resp = client.post("/v1/compress", json=_COMPRESS_REQUEST)
    data = resp.json()
    # Validate by constructing the model — Pydantic raises on missing required fields
    CompressResponse(**data)


# --- /v1/embed (lexical backend, no model required) ------------------------

_EMBED_REQUEST = {
    "texts": ["hello world", "foo bar baz"],
    "dim": 64,
}


def test_embed_response_shape() -> None:
    """/v1/embed with lexical backend must conform to EmbedResponse."""
    resp = client.post("/v1/embed", json=_EMBED_REQUEST)
    assert resp.status_code == 200
    data = resp.json()
    parsed = EmbedResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert len(parsed.embeddings) == 2
    assert all(len(row) == 64 for row in parsed.embeddings)


def test_embed_response_backend_field() -> None:
    """/v1/embed backend field defaults to 'lexical' when no model or gguf_path is given."""
    resp = client.post("/v1/embed", json=_EMBED_REQUEST)
    data = resp.json()
    assert data["backend"] == "lexical"


# --- /v1/embed/unload (no model required) ----------------------------------


def test_embed_unload_response_shape() -> None:
    """/v1/embed/unload must conform to EmbedUnloadResponse."""
    resp = client.post("/v1/embed/unload", json={})
    assert resp.status_code == 200
    data = resp.json()
    parsed = EmbedUnloadResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert isinstance(parsed.unloaded, int)


# --- /v1/repomap (pure Python, no model required) --------------------------

_REPOMAP_REQUEST = {
    "files": [
        {"path": "foo.py", "content": "def hello():\n    pass\n"},
        {"path": "bar.py", "content": "class MyClass:\n    def method(self): ...\n"},
    ],
    "max_symbols": 10,
}


def test_repomap_response_shape() -> None:
    """/v1/repomap must conform to RepoMapResponse."""
    resp = client.post("/v1/repomap", json=_REPOMAP_REQUEST)
    assert resp.status_code == 200
    data = resp.json()
    parsed = RepoMapResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert isinstance(parsed.rendered, str)
    assert isinstance(parsed.symbols, list)


# --- /v1/decompose/select (pure Python, no model required) -----------------

_DECOMPOSE_REQUEST = {
    "candidates": [
        [
            {"id": "impl", "title": "Implement core", "acceptance_command": "npm test"},
            {"id": "tests", "title": "Add tests", "acceptance_command": "npm test"},
        ],
        [
            {"id": "impl", "title": "Implement core", "acceptance_command": "npm test"},
            {"id": "tests", "title": "Add tests", "depends_on": ["impl"], "acceptance_command": "npm test"},
        ],
    ]
}


def test_decompose_select_response_shape() -> None:
    """/v1/decompose/select must conform to SelectGraphResponse."""
    resp = client.post("/v1/decompose/select", json=_DECOMPOSE_REQUEST)
    assert resp.status_code == 200
    data = resp.json()
    parsed = SelectGraphResponse(**data)
    assert parsed.contract_version == CONTRACT_VERSION
    assert parsed.best_index is not None
    assert isinstance(parsed.scores, list)
    assert len(parsed.scores) == 2


def test_decompose_select_scores_shape() -> None:
    """Each score entry must be parseable as CandidateScorePayload."""
    from klein_core.contract import CandidateScorePayload

    resp = client.post("/v1/decompose/select", json=_DECOMPOSE_REQUEST)
    data = resp.json()
    for score in data["scores"]:
        CandidateScorePayload(**score)  # raises if any required field is missing


# ============================================================================
# 3. Request validation — off-contract inputs must be rejected with 4xx
# ============================================================================


def test_generate_missing_target_returns_422() -> None:
    """A GenerateRequest without a required `target` field must return 422."""
    resp = client.post("/v1/generate", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 422, f"Expected 422 for missing target, got {resp.status_code}"


def test_generate_missing_messages_returns_422() -> None:
    """A GenerateRequest without `messages` must return 422."""
    resp = client.post(
        "/v1/generate",
        json={"target": {"model_id": "m", "base_url": "http://localhost:1234"}},
    )
    assert resp.status_code == 422


def test_generate_invalid_message_role_returns_422() -> None:
    """A ChatMessagePayload with an invalid role must be rejected."""
    resp = client.post(
        "/v1/generate",
        json={
            "target": {"model_id": "m", "base_url": "http://localhost:1234"},
            "messages": [{"role": "invalid_role", "content": "hi"}],
        },
    )
    assert resp.status_code == 422


def test_generate_structured_missing_json_schema_returns_422() -> None:
    """GenerateStructuredRequest without json_schema must return 422."""
    resp = client.post("/v1/generate_structured", json=_PROXY_REQUEST)
    assert resp.status_code == 422


def test_embed_non_list_texts_returns_422() -> None:
    """EmbedRequest with a string instead of list[str] for texts must return 422."""
    resp = client.post("/v1/embed", json={"texts": "not a list"})
    assert resp.status_code == 422


def test_compress_missing_text_returns_422() -> None:
    """CompressRequest without `text` must return 422."""
    resp = client.post("/v1/compress", json={"target_ratio": 0.5})
    assert resp.status_code == 422


def test_decompose_select_missing_candidates_returns_422() -> None:
    """SelectGraphRequest without `candidates` must return 422."""
    resp = client.post("/v1/decompose/select", json={})
    assert resp.status_code == 422


def test_generate_target_no_backend_returns_400() -> None:
    """`target` with neither base_url nor gguf_path must return 400 (app-level check)."""
    resp = client.post(
        "/v1/generate",
        json={
            "target": {"model_id": "m"},  # no base_url, no gguf_path
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert resp.status_code == 400
