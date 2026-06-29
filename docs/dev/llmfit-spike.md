# llmfit integration spike (2026-06-29)

Capability spike for the §5.AB `llmfit` integration (https://github.com/AlexsJones/llmfit, MIT). Goal: confirm it gives
us FIT + SPEED + ranking + hardware-simulation, and capture the exact JSON shapes the adapter will parse. **No binary
installed permanently** — run ephemerally via `uvx llmfit …` (downloads to the uv cache; ~5 MiB).

## What it is
`llmfit` detects the local hardware (RAM/CPU/GPU; Metal/CUDA/ROCm) and scores every model in its embedded DB for **fit,
speed, quality**. Global `--json` flag ("structured JSON on every subcommand, for tool/agent integration; exits 0 on
success, 1 on error") — perfect for a guarded CLI adapter. Subcommands: `system list fit search info diff plan recommend
download hf-search update`. The **`--memory` / `--ram` / `--cpu-cores` / `--max-context` overrides simulate other
machines** (so we plan the m4mini/legion pools without those boxes).

## Local-only (#1) classification of the subcommands
- **Local, no network:** `system`, `list`, `fit`, `search`, `info`, `diff`, `plan`, `recommend` (use the embedded DB +
  local HW detection). These are the ones we'd call on the hot path — safe local-only.
- **OUTBOUND (egress-gate / opt-in, default-off):** `update` (refreshes the DB from the HF API), `hf-search`,
  `download` (pulls GGUF weights). Gate these like the §5.AC online tools.

## JSON shapes (captured live on this machine)

`llmfit --json system` → the m5max, correctly:
```json
{ "system": { "available_ram_gb": 121.35, "total_ram_gb": 128.0, "gpu_vram_gb": 128.0,
  "gpu_name": "Apple M5 Max", "backend": "Metal", "cpu_cores": 18, "unified_memory": true } }
```

`llmfit --json recommend` → `{ "models": [ … ], "system": { … } }`; each model entry (the fields we'd consume **bolded**):
```json
{ "name": "google/gemma-4-E4B-it", "best_quant": "mlx-8bit", "category": "Multimodal",
  "capabilities": ["Vision","Tool Use"], "capability_ids": ["vision","tool_use"],
  "context_length": 131072, "effective_context_length": 8192,
  "fit_level": "Perfect",          // Perfect | Good | Marginal | Too Tight   ← decideModelLoad
  "memory_required_gb": 9.15, "memory_available_gb": 128.0, "moe_offloaded_gb": null, "is_moe": false,
  "estimated_tps": 42.2,           // ← §5.AB fitness speed + pool predictedWallTimeMs
  "disk_size_gb": 8.0, "installed": true,   // installed = detected in LM Studio/Ollama/llama.cpp/MLX
  "gguf_sources": [ { "provider": "unsloth", "repo": "unsloth/gemma-4-E4B-it-GGUF" } ],
  "license": "apache-2.0", "notes": ["Context capped at 8192 …"] }
```

DB row (`data/hf_models.json`, a JSON array): `name`, `provider`, `parameter_count`/`parameters_raw`,
`min_ram_gb`/`recommended_ram_gb`/`min_vram_gb`, `quantization`, `format`, `context_length`, `use_case`, `capabilities`,
`architecture`, `hf_downloads`/`hf_likes`, MoE fields (`is_moe`/`num_experts`/`active_experts`/`active_parameters`/
`moe_intermediate_size`), `license`.

## Hardware simulation works (the pools win)
`llmfit --json --memory 8G --ram 32G recommend` (simulate the legion 4070m): it reports `gpu_vram_gb: 8.0` and only
recommends fitting models — e.g. `gemma-4-E4B` req **5.55 GB** `fit=Perfect` `mlx-4bit` **84.5 tok/s**;
`Qwen3.5-9b` req 6.01 GB Perfect. ⇒ !Klein can ask "what fits + is fast on pool X" per machine from the m5 alone.

## Correction to the earlier note
llmfit DOES carry a coarse `capabilities`/`tool_use` tag (from HF metadata) — so it is NOT true that it has "no tool-use
notion". BUT that's a *claimed-support* flag, not the EMPIRICAL agentic-reliability verdict our §5.AL catalog provides
(TOOL_NATIVE/CAPABLE/WEAK/UNSUITABLE from real sweeps + the small-model-chaining traps). Still complementary: llmfit's
tag is a cheap pre-filter; §5.AL is the trustworthy verdict. Combine — llmfit narrows to fits+fast (+ claims tool use),
§5.AL confirms it *actually* drives tool chains at that size/quant.

## Recommended integration (next leaves of the §5.AB item)
1. `src/core/llmfit-adapter.ts` — a PURE parser for the `recommend`/`system` JSON above + a thin effectful runner
   (`uvx llmfit --json …` or a resolved binary), mirroring the guarded `lms` runner. Pin `--max-context` to the role's
   budget; pass `--memory`/`--ram` per **pool** so each machine is planned on its own envelope.
2. Feed `fit_level`/`memory_required_gb` → `decideModelLoad` (supersede the `approxSizeGb` guess); `estimated_tps` →
   the §5.AB fitness + the pool-routing `predictedWallTimeMs`/`capabilityTier`; `installed` → resident detection.
3. Cross-reference llmfit rows ↔ the §5.AL `MODEL_CAPABILITY_CATALOG` (fit/speed from llmfit, tool-use verdict from us).
4. Egress-gate `update`/`download`/`hf-search` (opt-in, default-off); offline `recommend`/`plan` need no network.
