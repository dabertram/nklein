# !Klein Python core (`klein-core`)

Local-only Python sidecar that owns !Klein's ML + native-agent capabilities, called by the TypeScript runtime
over a small versioned HTTP/JSON contract. See the migration plan and `THIRD_PARTY_NOTICES.md`.

**Why this exists:** the NKlein SDK's LLM layer can only forward `temperature`/`max_tokens`/`stop`. The Python
core can send full sampling + **grammar / JSON-schema constrained decoding** (the biggest small/quantized-model
reliability win), and unlocks the Python ML ecosystem (LLMLingua-2, sentence-transformers, tree-sitter,
llama-cpp-python) and direct reuse of Apache/MIT Python agents (aider, OpenHands).

## Status
- Phase 0 (scaffold) + Phase 1 (constrained generation) endpoints: `/health`, `/v1/generate`,
  `/v1/generate_structured`. Later phases add `/v1/compress`, `/v1/embed`, `/v1/repomap`, `/v1/decompose`,
  `/v1/agent/run`.

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
