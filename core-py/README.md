# !Klein Python core (`klein-core`)

Optional local-only Python sidecar for ML/native-agent experiments, called by the TypeScript runtime over a small
versioned HTTP/JSON contract. !Klein's final product architecture remains TypeScript; this is not a migration target.

**Why this exists:** the NKlein SDK's LLM layer can only forward `temperature`/`max_tokens`/`stop`. The Python
core can send full sampling + **grammar / JSON-schema constrained decoding** (the biggest small/quantized-model
reliability win), and unlocks the Python ML ecosystem (LLMLingua-2, sentence-transformers, tree-sitter,
llama-cpp-python) and direct reuse of Apache/MIT Python agents (aider, OpenHands).

## Status
- Implemented/tested endpoints: `/health`, `/v1/generate`, `/v1/generate_structured`, `/v1/compress`, `/v1/embed`,
  `/v1/repomap`, `/v1/decompose/select`, and `/v1/agent/run`.
- The TypeScript runtime remains authoritative and falls back safely when the opt-in sidecar is unavailable.

## Generation backends (decision: "both")
- **Proxy** an existing local OpenAI-compatible server (LM Studio / Ollama / llama.cpp) — set `base_url`.
- **Own** the model via `llama-cpp-python` (full grammar + sampling control) — set `gguf_path`
  (`uv sync --extra llama`).

## Invariant
Local-only: every backend funnels through `assert_local_base_url`; the service refuses non-`127.0.0.1` binds.

## Dev
```bash
cd core-py
uv sync --extra dev          # base + dev tools
uv run python -m klein_core --port 3585
uv run pytest                # tests
uv run ruff check . && uv run mypy klein_core
uv run python scripts/export_schema.py > contract.schema.json   # contract source of truth
```

The pure helpers (`local_only`, `sampling`, `generation` body builder, `structured` recovery) import without
FastAPI/pydantic/httpx, so they can be unit-tested standalone.
