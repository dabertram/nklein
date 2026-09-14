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
| Scheduling | one model slot, instances sequential; **shared seat** — the same m5max model also served David's DeepSeek Harness (dsh) run on another machine (LM Link) and the runtime's own auxiliary calls | + 5-min cooldown between instances |
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
Suspended 2026-09-14 17:50 on David's instruction (the model was his DeepSeek Harness (dsh) run's seat); instance 6
(pytest-6202) had just started and was set aside. **Resumed 2026-09-14 21:30** on his go ("continue with the swebench
on m5max") — pytest-7521 in progress; pytest-6202 needs a second `run.sh all` pass.

### Legion arm — !Klein `83c39fe71`, `qwen3.6-35b-a3b@legion` (Q4_K_M, ctx 32k, in progress)

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 42 | blocked_by_review_cards (delivered) | `blueprints.py` fix; 1/1 F2P, 59 P2P held |

Running tally: **1 / 1 resolved**.

### m4 mini arm — !Klein `83c39fe71`, `dirk-qwen3.8-iq4xs@m4mini` (IQ4_XS, ctx 32k, in progress)

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 33 | blocked_by_review_cards (delivered) | `blueprints.py` fix; 1/1 F2P, 59 P2P held |

Running tally: **1 / 1 resolved**.

### Claude arms — !Klein `83c39fe71`, `claude-{sonnet-5,opus-5,fable-5-1,haiku-4-5}-hitl` (started 2026-09-14 22:14)

First launch (22:00) burned one instance per arm with `session did not start … does not report a context window`
(NOT counted — finding 5). Relaunched at 22:14 with the documented per-model context-window override (200k) in each
arm HOME's registry; the arms' pinned runtime (`83c39fe71`) predates the discovery fix, so the override is the lever
that keeps every pass-1 arm on the same !Klein commit.

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
   (DeepSeek Harness (dsh) on another machine, the runtime's own auxiliary calls) and under sustained load. → 120-min cap,
   `--cooldown-ms`, and the shared-seat note on every card (`1fe29d107`).
4. **Delivering with a still-failing visible test** — the held-out configuration requires nothing visible. → Arm B
   public acceptance (`7e13720e8`): repro test in a new file + graded files' existing tests as the acceptance command,
   visible test evidence, auto-review on.
5. **`openai-compatible` never asked its configured endpoint for models** — the provider's roster came from the SDK's
   static placeholder catalog (`gpt-4o`), so a model pinned to a custom endpoint but absent from that placeholder
   (the HITL seats, any proxy/self-hosted server) had no context window and the 32k admission floor refused every
   session start ("does not report a context window"). The 2026-09-06 HITL drive only worked because a 200k override
   had been set by hand. → Discovery probes the endpoint's own `/v1/models` (only that route) and lets its
   advertised window win; four tests (`b1519dfad`). The four Claude arms lost one instance each to it (excluded, not
   counted) before the per-model override was seeded.
6. **A graded instance's session lived on** — on the pinned pass-1 runtime `projects.remove` did not stop the
   session: arm A's requests-1921 was still answering turns an hour after its receipt, its review card queued for
   the one-slot host, competing with the live pytest-7521. → The runner writes the retirement ledger for the task
   and its review card before removing the project (`f941c80e9`). Operator note: while clearing interrupted
   first-launch leftovers (six half-materialized `requests-1921`/`2317` workspaces from the 22:00 launch) the LIVE
   requests-1921 attempts on the Legion and m4 mini arms were retired by mistake at 22:32 UTC; both arms were
   relaunched at 22:33 for a clean attempt (nothing from the retired attempt is counted).

## Arms launched 2026-09-14 evening (all at !Klein `83c39fe71`, pass 1)

| arm | seat | where the model runs | runtime | state |
|---|---|---|---|---|
| qwen38-8bit-m5max-20260914 | `qwen/qwen3.8-27b` MLX 8-bit, ctx 262k | m5max LM Studio | :3507 | resumed after David's go; 5 left |
| legion-qwen36-35b-a3b-q4 | `qwen3.6-35b-a3b@legion` GGUF Q4_K_M, ctx 32k | Legion 5 Pro (RTX 4070 8 GB + 32 GB RAM, experts in RAM) via LM Link | :3513 | running |
| m4mini-dirk-qwen38-iq4xs | `dirk-qwen3.8-iq4xs@m4mini` GGUF IQ4_XS, ctx 32k | m4 mini (24 GB) via LM Link — replaced the q2 quant, which needed 10–13 min per turn | :3514 | running |
| sonnet5 / opus5 / fable51 / haiku45 | `claude-<model>-hitl` — the HITL model server (:8096–8099) answered by `scripts/hitl-claude-responder.mjs` (`claude -p --model …`, tools disallowed, JSON-schema output, Claude Code 2.1.270) | Anthropic (David's Claude account via the CLI) | :3515–3518 | running since 22:14 (first launch 22:00 lost one instance per arm to finding 5) |

The Claude seats are the same harness with a different model behind the OpenAI-compatible endpoint; their
receipts carry `queue/seat.json` (CLI model id + Claude Code version) instead of `lms ps` facts.

## Plan

1. Finish arm A for `qwen/qwen3.8-27b`.
2. Same configuration (!Klein `83c39fe71`, arm A) for `qwen/qwen3.6-27b`, `qwen/qwen3.6-35b-a3b`,
   `muse-glimmer-30b`, then `qwen3.8-flash-next` (needs the m5max to itself: 90 GB).
3. Improve !Klein from the findings (this list grows as arms land).
4. Final pass: every model on the latest !Klein (arm B configuration), tabulated against pass 1.
