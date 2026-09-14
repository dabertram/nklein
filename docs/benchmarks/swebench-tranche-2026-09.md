# SWE-bench tranche campaign — !Klein × local models (September 2026)

David 2026-09-14: *"can we get a swe bench score for qwen3.8 27b q8 m5max? … for that model + nklein … I also want
swebench scores for nklein using qwen3.6 27b and the 3.6 moe with a3b, and also flash-next … and meta muse glimmer
… make sure we properly measure, collect results and document in the repository … do improve nklein based on the
swebench results right away autonomously … and then make sure to have the scores for the latest nklein version with
all applied fixes and improvements at the end."*

This document is the durable record. Receipts (one immutable JSON per instance, superseded receipts kept beside
their corrections) and the per-arm `summary.json`/`summary.md` are copied into `docs/benchmarks/swebench-tranche-2026-09/`.

## What is measured

- **Benchmark:** the N8 tranche — 10 SWE-bench Lite/Verified instances (3 pytest, 3 requests, 3 pylint, 1 flask),
  sha256-pinned in `.nklein-bench/swebench/` (fetched 2026-08-05; no egress since). Selection bar and per-instance
  facts: `src/core/swebench-tranche.ts`.
- **System under test:** !Klein at an exact commit driving ONE model pinned on every role, ACT mode (no plan
  decomposition), held-out oracle (`testEvidencePolicy: externally_held_out`), auto-review OFF — the worker alone.
  Arm B (see below) turns the visible evidence into requirements.
- **Score:** SWE-bench's rule verbatim per instance — every fail-to-pass id passes AND every pass-to-pass id still
  passes, judged by the sealed grader (`python:3.9-slim`, network namespace off, wheels from the prepared cache,
  silence-is-failure parsing). Reported as resolved / attempted; an instance whose attempts ran on a different model
  is EXCLUDED and named (the runner audits every `attempt_started` in the runtime HOME's telemetry).
- **Runner:** `scripts/swebench-tranche-run.mts` (materialize → pinned session → stop → pin the delivered
  `nklein/tasks` result branch → retire → sealed grade → receipt). Arms are created by
  `scripts/swebench-arm-setup.sh <arm> <model> <port> <commit>` (own HOME, own port, worktree snapshot).

## Harness card (ETCSOVG, P20.8)

| Dimension | Arm A (as shipped) | Arm B (fixed + public acceptance) |
|---|---|---|
| Execution | ACT mode, one card per instance, 120-min wall (first four instances of arm A: 45 min), 4-min no-progress settle | same |
| Tool | agent sandbox `nklein/agent-sandbox:0.0.1` (python 3.11, uv, no pytest, no era interpreter) | `0.0.1-python` pack (CPython 3.8–3.12 offline, pytest/coverage wheelhouse) |
| Context | issue text IS the prompt + two ground rules; repo at base commit; no test patch anywhere | + repro test in a NEW file required; `Acceptance command:` = existing tests of the graded files |
| Scheduling | one model slot, instances sequential; **shared seat** — the same m5max model also served David's dschinn run on another machine (LM Link) and the runtime's own auxiliary calls | + 5-min cooldown between instances |
| Observability | runtime HOME telemetry + request logs per arm; receipts carry model facts from `lms ps`/`lms ls` at run time | same |
| Verification | sealed grader outside the agent workspace; N8.1 tampering check on graded files | + delivery gate runs the acceptance command; auto-review by the same model |
| Governance | capability tier `fully_open` (product default): sandbox has full egress | same (packs make it unnecessary at stricter tiers) |

## Models (all on the m5max, M5 Max 128 GB, LM Studio 0.4.23, MLX engine nax 1.11.0 / llama.cpp 2.33.0)

| Arm | Model key | Quant / format | Size | Max context | Loaded context |
|---|---|---|---|---|---|
| qwen38-8bit | `qwen/qwen3.8-27b` | 8-bit MLX safetensors | 29.5 GB | 262,144 | 262,144 |
| qwen36-27b-8bit | `qwen/qwen3.6-27b` | 8-bit MLX safetensors | 29.5 GB | 262,144 | (set at load) |
| qwen36-35b-a3b-8bit | `qwen/qwen3.6-35b-a3b` | 8-bit MLX safetensors (MoE, 3B active) | 37.7 GB | 262,144 | (set at load) |
| muse-glimmer-30b-q8 | `muse-glimmer-30b` | Q8_0 GGUF (muse-glimmer arch) | 29.6 GB | 131,072 | (set at load) |
| flash-next-q3kxl | `qwen3.8-flash-next` | Q3_K_XL GGUF (512×56B, qwen4exp) | 90.0 GB | 262,144 | (set at load) — cannot coexist with qwen3.8 |

## Results

### Arm A — !Klein `83c39fe71`, `qwen/qwen3.8-27b` (in progress)

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 10 | blocked_by_review_cards (delivered) | 2-line `blueprints.py` fix; 1/1 F2P, 59 P2P held |
| psf__requests-1921 | yes | 45 (cap) | stagnant | 1-line `sessions.py` fix delivered at stop; 6/6 F2P, 105 P2P |
| psf__requests-2317 | no | 31 | blocked_by_review_cards (delivered) | right files (`models.py`, `sessions.py`), 1 F2P still failing |
| psf__requests-5414 | no | 45 (cap) | stagnant | no delivery — 18 turns, ~96 s median turn latency (shared seat) |
| pytest-dev__pytest-5227 | no | 75 | blocked_by_review_cards (delivered) | 578-byte patch delivered; 3 F2P still failing (log-cli level defaults) |

Running tally: **2 / 5 resolved**. Remaining: pytest-6202, pytest-7521, pylint-4970, pylint-6903, pylint-7993.
**SUSPENDED 2026-09-14 17:50** on David's instruction ("suspend our use of qwen3.8 27b on m5max until i give a go
again") — the model is his dschinn run's seat. Runner, runtime and the campaign orchestrator stopped; instance 6
(pytest-6202) had just started and was discarded. Resumes on his go (the runner skips graded instances).

## Findings → improvements (treated as found)

1. **Runner graded the base tree** — the delivered `nklein/tasks` result branch was deleted by project retirement
   before capture (flask), and a capped run delivers at session STOP, after a pre-stop pin (requests-1921); the ref
   lookup also lacked a trailing glob. Fixed in `b80f85180`, `8afeb4f91`, `7944435e7`; affected instances re-graded
   from their recovered deliveries (superseded receipts kept).
2. **No Python toolchain for setup.py repos** — every worker fetched a Python 3.8 by hand (2,791–5,275 junk files per
   delivery, ~10 min per card), possible only because the `fully_open` tier grants full egress. → P1.SANDBOXPACKS:
   python pack overlay, ecosystem egress packs, uv toolchain with setup.py detection, `.python-version` sealed into
   the root commit (`23db8f219`, `e3e9aa9de`).
3. **Turn latency climbed 13 s → 21 s → 39 s → 96 s median** across consecutive instances — the seat was shared
   (dschinn on another machine, the runtime's own auxiliary calls) and under sustained load. → 120-min cap,
   `--cooldown-ms`, and the shared-seat note on every card (`1fe29d107`).
4. **Delivering with a still-failing visible test** — the held-out configuration requires nothing visible. → Arm B
   public acceptance (`7e13720e8`): repro test in a new file + graded files' existing tests as the acceptance command,
   visible test evidence, auto-review on.

## Plan

1. Finish arm A for `qwen/qwen3.8-27b`.
2. Same configuration (!Klein `83c39fe71`, arm A) for `qwen/qwen3.6-27b`, `qwen/qwen3.6-35b-a3b`,
   `muse-glimmer-30b`, then `qwen3.8-flash-next` (needs the m5max to itself: 90 GB).
3. Improve !Klein from the findings (this list grows as arms land).
4. Final pass: every model on the latest !Klein (arm B configuration), tabulated against pass 1.
