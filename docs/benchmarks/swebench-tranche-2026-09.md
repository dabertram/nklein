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

## Pass-1 scoreboard (all arms, !Klein `83c39fe71`, sealed offline grading, updated 2026-09-15 22:50)

| seat | resolved | graded | mean min/instance | state |
|---|---|---|---|---|
| Opus 5 (Claude CLI seat) | **10** | 10 | 8.6 | final |
| Sonnet 5 (Claude CLI seat) | **9** | 10 | 23.4 | final |
| qwen3.6-27b MLX 8-bit, m5max | **8** | 10 | 16.3 | final |
| qwen3.6-35b-a3b MLX 8-bit, m5max | **8** | 10 | 14.5 | final |
| qwen3.8-27b MLX 8-bit, m5max (shared seat) | **7** | 10 | 54.9 | final |
| Fable 5.1 (Claude CLI seat) | **7** | 8 | 14.2 | paused by David at 02:08, 2 instances left |
| Haiku 4.5 (Claude CLI seat) | **6** | 10 | 15.2 | final |
| qwen3.6-35b-a3b Q4_K_M, Legion via LM Link | **5** | 10 | 81.7 | final |
| qwen3.8-27b IQ4_XS, m4 mini via LM Link | **4** | 8 | 82.9 | stopped, seat unstable |
| muse-glimmer-30b 8-bit, m5max | **1** | 10 | 46.6 | final |

Per-instance grids are in each arm's section below. Excluded attempts (seat outages, mis-seated runs, never-started
sessions) are not in these numbers; every counted receipt is seat-verified. Caveats from the audit still apply: the
instances are public SWE-bench items (contamination), ten is a small sample, the pass-1 toolchain never primed, arm A
shared its seat, and the local arms ran in low power mode from 09:10.


### Arm A — !Klein `83c39fe71`, `qwen/qwen3.8-27b` MLX 8-bit on the m5max (COMPLETE 2026-09-15 05:20)

Seat shared all afternoon with David's DeepSeek Harness (dsh) run; suspended 17:50–21:30 on 2026-09-14; 120-minute cap.
Receipts: `swebench-tranche-2026-09/qwen38-8bit-m5max-20260914/` (superseded runner-bug and sealed-F2P receipts kept).

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 10 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held (re-graded); `src/flask/blueprints.py` |
| psf__requests-1921 | yes | 45 | stagnant | resolved: 6/6 fail-to-pass now green, 105 pass-to-pass held (re-graded); `requests/sessions.py`, `tmp_repro_none_headers.py` |
| psf__requests-2317 | yes | 31 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held (re-graded); `requests/models.py`, `requests/sessions.py` |
| psf__requests-5414 | no | 45 | stagnant | unresolved: 1 fail-to-pass still failing; `` |
| pytest-dev__pytest-5227 | no | 75 | blocked_by_review_cards | unresolved: 3 fail-to-pass still failing; `` |
| pytest-dev__pytest-6202 | yes | 36 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | yes | 120 | blocked_by_review_cards | resolved: 2/2 fail-to-pass now green, 122 pass-to-pass held; `src/_pytest/capture.py` |
| pylint-dev__pylint-4970 | no | 120 | stagnant | unresolved: 1 fail-to-pass still failing; `_simtest_dup.py`, `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | yes | 15 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 8 pass-to-pass held; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | yes | 52 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 10 pass-to-pass held; `.tmp/cli/target.py`, `.tmp/repro.py`, `pylint/reporters/text.py` |

**Score: 7 / 10 resolved.** Mean 54.9 min per instance; three instances ran to the cap. Failures:
requests-5414 and pylint-4970 (no library change delivered — the pass-1 toolchain gap and the shared seat ate the
card), pytest-5227 (patch delivered, three fail-to-pass still red).

### qwen3.6-27b arm — !Klein `83c39fe71`, `qwen/qwen3.6-27b` MLX 8-bit on the m5max (COMPLETE 2026-09-15 08:03)

Loaded by the campaign beside David's qwen3.8 (27.5 GiB, LM Studio reported context 262144); the seat was NOT shared
with dsh. Receipts: `swebench-tranche-2026-09/qwen36-27b-8bit/`.

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 8 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | yes | 13 | blocked_by_review_cards | resolved: 6/6 fail-to-pass now green, 105 pass-to-pass held; `requests/models.py` |
| psf__requests-2317 | yes | 10 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held; `requests/sessions.py` |
| psf__requests-5414 | yes | 25 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 124 pass-to-pass held; `requests/models.py` |
| pytest-dev__pytest-5227 | yes | 10 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py` |
| pytest-dev__pytest-6202 | yes | 24 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | yes | 28 | blocked_by_review_cards | resolved: 2/2 fail-to-pass now green, 122 pass-to-pass held; `src/_pytest/capture.py` |
| pylint-dev__pylint-4970 | no | 19 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | yes | 9 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 8 pass-to-pass held; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | no | 17 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing, 2 pass-to-pass REGRESSED; `pylint/reporters/text.py` |

**Score: 8 / 10 resolved.** Mean 16.3 min per instance — a third of qwen3.8's, and the best local seat of the
campaign. Failures: pylint-4970 (one fail-to-pass red) and pylint-7993 (one red plus two regressions).

### Legion arm — !Klein `83c39fe71`, `qwen3.6-35b-a3b@legion` GGUF Q4_K_M via LM Link (COMPLETE 2026-09-15 12:33)

Legion 5 Pro (RTX 4070 8 GB + 32 GB RAM, experts in RAM), context 32k, one request at a time; low power mode from
09:10. Receipts: `swebench-tranche-2026-09/legion-qwen36-35b-a3b-q4/` (the seat-outage and mis-retired attempts kept
as superseded). Two attempts restarted from scratch (operator, 22:32 and 09:10).

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 42 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | yes | 120 | stagnant | resolved: 6/6 fail-to-pass now green, 105 pass-to-pass held; `requests/models.py` |
| psf__requests-2317 | yes | 102 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held (re-graded, finding 7); `requests/sessions.py` |
| psf__requests-5414 | no | 120 | stagnant | unresolved: 0 fail-to-pass still failing, 8 pass-to-pass REGRESSED; `requests/models.py` |
| pytest-dev__pytest-5227 | yes | 56 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py` |
| pytest-dev__pytest-6202 | no | 53 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `` |
| pytest-dev__pytest-7521 | no | 41 | needs_attention | unresolved: 2 fail-to-pass still failing; `` |
| pylint-dev__pylint-4970 | no | 52 | needs_attention | unresolved: 1 fail-to-pass still failing; `pylint/checkers/similar.py`, `test_duplicate.py` |
| pylint-dev__pylint-6903 | yes | 109 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 8 pass-to-pass held; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | no | 121 | stagnant | unresolved: 0 fail-to-pass still failing, 2 pass-to-pass REGRESSED; `pylint/reporters/text.py`, `test_msg_template_fix.py`, `test_regex_fix.py` |

**Score: 5 / 10 resolved.** Mean 81.7 min per instance; four instances ran to the 120-minute cap. Failures: requests-5414 and
pylint-7993 (fail-to-pass fixed but pass-to-pass regressed), pytest-6202 (nothing delivered), pytest-7521 and
pylint-4970 (loop-guard parks — finding 10).

### m4 mini arm — !Klein `83c39fe71`, `dirk-qwen3.8-iq4xs@m4mini` GGUF IQ4_XS via LM Link (STOPPED 2026-09-15 14:55, 8 of 10 graded)

Mac mini M4 24 GB, context 32k, one request at a time. **The seat is not stable at this size:** the model unloaded
itself four times (07:16, ~10:00, 11:34, 12:44 UTC), each time around a long-context turn — twice mid-attempt with
two empty model turns and a model-side error before the unload; the last drop came eight minutes after a reload with
a 24-hour TTL, so idle unloading is not the cause (memory pressure on the 24 GB mini is the likely one). The two
crashed attempts (pylint-4970 first try, pylint-6903) are voided as seat outages; pylint-6903 and pylint-7993 were not
graded. Receipts: `swebench-tranche-2026-09/m4mini-dirk-qwen38-iq4xs/`.

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 33 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | no | 121 | stagnant | unresolved: 1 fail-to-pass still failing; `` |
| psf__requests-2317 | yes | 55 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held (re-graded, finding 7); `requests/models.py`, `requests/sessions.py` |
| psf__requests-5414 | no | 121 | stagnant | unresolved: 1 fail-to-pass still failing; `` |
| pytest-dev__pytest-5227 | yes | 107 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py` |
| pytest-dev__pytest-6202 | yes | 43 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | no | 121 | stagnant | unresolved: 2 fail-to-pass still failing; `` |
| pylint-dev__pylint-4970 | no | 63 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | not run | – | – | seat unstable — see note |
| pylint-dev__pylint-7993 | not run | – | – | seat unstable — see note |

**Score: 4 / 8 graded (of 10).** Mean 82.9 min per graded instance; three ran to the cap. A smaller
model on the mini (the 9B class) would be the honest next configuration for this host.

### muse-glimmer-30b arm — !Klein `83c39fe71`, `muse-glimmer-30b` 8-bit on the m5max (COMPLETE 2026-09-15 16:31)

Loaded by the campaign beside David's qwen3.8 (context 65536); low power mode from 09:10; the requests-1921 attempt
restarted once (operator, 09:10). Receipts: `swebench-tranche-2026-09/muse-glimmer-30b-q8/`.

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 26 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `reproduce_blueprint_name.py`, `src/flask/blueprints.py` |
| psf__requests-1921 | no | 48 | needs_attention | unresolved: 1 fail-to-pass still failing; `` |
| psf__requests-2317 | no | 40 | needs_attention | unresolved: 1 fail-to-pass still failing; `` |
| psf__requests-5414 | no | 24 | needs_attention | unresolved: 1 fail-to-pass still failing; `` |
| pytest-dev__pytest-5227 | no | 15 | needs_attention | unresolved: 3 fail-to-pass still failing; `` |
| pytest-dev__pytest-6202 | no | 107 | needs_attention | unresolved: 1 fail-to-pass still failing; `` |
| pytest-dev__pytest-7521 | no | 14 | needs_attention | unresolved: 2 fail-to-pass still failing; `` |
| pylint-dev__pylint-4970 | no | 120 | stagnant | unresolved: 1 fail-to-pass still failing; `` |
| pylint-dev__pylint-6903 | no | 26 | needs_attention | unresolved: 1 fail-to-pass still failing; `` |
| pylint-dev__pylint-7993 | no | 47 | needs_attention | unresolved: 1 fail-to-pass still failing; `` |

**Score: 1 / 10 resolved.** Seven of the nine misses ended in a loop-guard park (three identical calls of the same
tool — `search_code`, `skills`, `read_files`) with nothing delivered, the pattern finding 10 addresses for pass 2;
the other two ran to the cap with scratch scripts but no library change.

### qwen3.6-35b-a3b arm — !Klein `83c39fe71`, `qwen/qwen3.6-35b-a3b` MLX 8-bit on the m5max (COMPLETE 2026-09-15 22:10)

Started 19:45 once the Legion's copy of the same model key was gone (finding 9); local seat, low power mode.
Receipts: `swebench-tranche-2026-09/qwen36-35b-a3b-8bit/` (three earlier mis-seated starts quarantined under
`results/mis-seated/`, none counted).

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 9 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | no | 11 | blocked_by_review_cards | unresolved: 0 fail-to-pass still failing, 1 pass-to-pass REGRESSED; `requests/structures.py` |
| psf__requests-2317 | yes | 8 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held; `requests/sessions.py` |
| psf__requests-5414 | yes | 12 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 124 pass-to-pass held; `requests/models.py` |
| pytest-dev__pytest-5227 | yes | 10 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py` |
| pytest-dev__pytest-6202 | yes | 20 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | yes | 26 | blocked_by_review_cards | resolved: 2/2 fail-to-pass now green, 122 pass-to-pass held; `src/_pytest/capture.py`, `test_capfd_cr.py`, `test_verify_fix.py` |
| pylint-dev__pylint-4970 | no | 10 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | yes | 6 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 8 pass-to-pass held; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | yes | 35 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 10 pass-to-pass held; `pylint/reporters/text.py`, `test_msg_template.py`, `test_msg_template_integration.py` |

**Score: 8 / 10 resolved.** Mean 14.5 min per instance — the fastest local seat of the campaign (the MoE's 3B
active parameters), one point behind the dense qwen3.6-27b. Failures: requests-1921, pylint-4970.

### Opus 5 arm — !Klein `83c39fe71`, `claude-opus-5-hitl` (COMPLETE 2026-09-15 01:41)

Seat: `claude -p --model claude-opus-5` through the HITL model server (Claude Code 2.1.270 (Claude Code), CLI default
effort, schema answer mode, responder concurrency 1 until 00:25 then 4). Receipts: `swebench-tranche-2026-09/opus5/`.

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 7 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | yes | 7 | blocked_by_review_cards | resolved: 6/6 fail-to-pass now green, 105 pass-to-pass held; `requests/sessions.py` |
| psf__requests-2317 | yes (re-graded, finding 7) | 7 | blocked_by_review_cards | resolved: 7/7 fail-to-pass green, 127 pass-to-pass held; 1 fail-to-pass excluded under the seal; `requests/sessions.py` |
| psf__requests-5414 | yes | 7 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 124 pass-to-pass held; `requests/models.py` |
| pytest-dev__pytest-5227 | yes | 16 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py` |
| pytest-dev__pytest-6202 | yes | 13 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | yes | 9 | blocked_by_review_cards | resolved: 2/2 fail-to-pass now green, 122 pass-to-pass held; `src/_pytest/capture.py` |
| pylint-dev__pylint-4970 | yes | 8 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 17 pass-to-pass held; `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | yes | 6 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 8 pass-to-pass held; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | yes | 7 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 10 pass-to-pass held; `pylint/reporters/text.py` |

**Score: 10 / 10 resolved** (9/10 before finding 7 was treated). Mean 8.6 min per instance. requests-2317 had been
\"unresolved\" on every seat for the same reason: its eighth fail-to-pass test hardcodes `https://httpbin.org`, which the
sealed grader can never reach; all seats passed the other seven.

### Sonnet 5 arm — !Klein `83c39fe71`, `claude-sonnet-5-hitl` (COMPLETE 2026-09-15 04:59)

Seat: `claude -p --model claude-sonnet-5` through the HITL model server (Claude Code 2.1.270 (Claude Code), CLI default
effort, schema answer mode, responder concurrency 4 from 00:25). Receipts: `swebench-tranche-2026-09/sonnet5/`. The
requests-1921 attempt of 03:54 was voided as a seat outage (finding 8) and re-run.

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 12 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | yes | 16 | blocked_by_review_cards | resolved: 6/6 fail-to-pass now green, 105 pass-to-pass held; `requests/sessions.py` |
| psf__requests-2317 | yes | 28 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held (re-graded, finding 7); `requests/sessions.py` |
| psf__requests-5414 | yes | 65 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 124 pass-to-pass held; `requests/adapters.py` |
| pytest-dev__pytest-5227 | yes | 13 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py` |
| pytest-dev__pytest-6202 | yes | 17 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | yes | 29 | blocked_by_review_cards | resolved: 2/2 fail-to-pass now green, 122 pass-to-pass held; `src/_pytest/capture.py` |
| pylint-dev__pylint-4970 | no | 25 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | yes | 17 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 8 pass-to-pass held; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | yes | 13 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 10 pass-to-pass held; `pylint/reporters/text.py` |

**Score: 9 / 10 resolved.** Mean 23.4 min per instance — about twice Opus's. The one failure, pylint-4970, is
the instance Haiku also failed (a `similar.py` change that leaves one fail-to-pass red).

### Haiku 4.5 arm — !Klein `83c39fe71`, `claude-haiku-4-5-20251001-hitl` (COMPLETE 2026-09-15 05:13)

Seat: `claude -p --model claude-haiku-4-5-20251001` through the HITL model server (Claude Code 2.1.270 (Claude Code), CLI
default effort, schema answer mode, responder concurrency 4 from 00:25). Receipts: `swebench-tranche-2026-09/haiku45/`.

| instance | resolved | minutes | outcome | note |
|---|---|---|---|---|
| pallets__flask-5014 | yes | 26 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 59 pass-to-pass held; `src/flask/blueprints.py` |
| psf__requests-1921 | yes | 8 | blocked_by_review_cards | resolved: 6/6 fail-to-pass now green, 105 pass-to-pass held; `requests/sessions.py` |
| psf__requests-2317 | yes | 10 | blocked_by_review_cards | resolved: 7/7 fail-to-pass now green, 127 pass-to-pass held; `requests/sessions.py` |
| psf__requests-5414 | no | 10 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `requests/models.py`, `test_fix.py` |
| pytest-dev__pytest-5227 | yes | 34 | blocked_by_review_cards | resolved: 3/3 fail-to-pass now green, 31 pass-to-pass held; `src/_pytest/logging.py`, `testing/logging/test_formatter.py` |
| pytest-dev__pytest-6202 | yes | 8 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 72 pass-to-pass held; `src/_pytest/python.py` |
| pytest-dev__pytest-7521 | no | 13 | blocked_by_review_cards | unresolved: 2 fail-to-pass still failing; `test_carriage_return.py` |
| pylint-dev__pylint-4970 | no | 17 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing; `pylint/checkers/similar.py` |
| pylint-dev__pylint-6903 | no | 9 | blocked_by_review_cards | unresolved: 1 fail-to-pass still failing, 4 pass-to-pass REGRESSED; `pylint/lint/run.py` |
| pylint-dev__pylint-7993 | yes | 16 | blocked_by_review_cards | resolved: 1/1 fail-to-pass now green, 10 pass-to-pass held; `pylint/reporters/text.py` |

**Score: 6 / 10 resolved.** Mean 15.2 min per instance. Failures: requests-5414 and pytest-7521 (a test
file written, no library fix), pylint-4970 (one fail-to-pass still red), pylint-6903 (four pass-to-pass regressed).

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
7. **An internet-bound fail-to-pass test made requests-2317 unresolvable offline** — `test_requests_history_is_saved`
   hardcodes `https://httpbin.org/redirect/5` (it ignores the loopback `HTTPBIN_URL` the grader provides), so under
   `--network none` it fails for any fix. Opus, Fable, Sonnet and qwen3.8 all passed the other seven fail-to-pass
   tests and "failed" exactly this one. → The tranche now declares `sealedFailToPassExclusions` (per id, with cause),
   the grader drops those ids and NAMES them on the receipt, and an instance whose gradable set would become empty
   stays "not resolvable". The four deliveries were re-graded with the same sealed grader (superseded receipts kept
   as `*.superseded-sealed-f2p.json`): all four resolved. Upstream SWE-bench grades with the network on; this is the
   local-only equivalent, recorded on every receipt it touches.
8. **A seat outage is not a model result** — David's Claude usage limit hit at 01:54 UTC on 2026-09-15: every
   `claude -p` call on the Sonnet arm exited 1 for the whole requests-1921 second-pass attempt (the responder answered
   "the model seat failed to answer this turn"), the session delivered a venv and nothing else in five minutes, and
   the receipt said "unresolved". Voided (`*.superseded-seat-outage.json`) and re-run after the limit reset; the
   same rule as the Legion seat outage (operator note under finding 6). A seat-failure marker on the receipt itself
   (responder FAILED count in the run window) is the next runner improvement so this never needs a human to spot.
   **The m4 mini's LM Link seat flaps:** it dropped at 07:16 (five instances excluded as "not loaded", seat reloaded
   08:25, arm relaunched) and again at ~10:00 UTC mid-attempt on pylint-4970 (two empty model turns, then "not
   loaded"; the attempt voided as a seat outage, the arm relaunched for its last three instances). Both were
   seat outages, not model results; the receipts say so.
9. **A local arm fanned out to another host** — the m5max qwen3.6-35b-a3b arm's first attempt ran on
   `qwen3.6-35b-a3b@legion` (the Legion arm's seat, same model key over LM Link): the worker pool uses every host
   that has the pinned model loaded unless `workerUseAllLoadedHosts` restricts it. The seat audit caught it (receipt
   excluded as a seat violation, quarantined under `results/mis-seated/`), the arm was reset and pinned to
   `["local"]`, and the campaign's "already loaded" check now ignores LM Link instances. Local arms are created with
   the pin from now on (`swebench-arm-setup.sh`). **Root cause, fixed in `a758c19a0`:** the runtime's alias→machine map
   was last-writer-wins, and `lms ps` lists the LM Link copy after the local one with the same model key — so the
   bare key mapped to the Legion (the pinned worker fanned out there), and with the `local` allowlist the LOCAL
   instance itself was excluded as "legion" and the runtime fell back to qwen3.8. Identifiers now claim aliases
   exclusively and contended secondary aliases prefer local. The pinned pass-1 runtime predates the fix, so the
   m5max qwen3.6-35b-a3b arm is queued to run after the Legion arm finishes (no shared key loaded twice).
   **Operator note 2026-09-15 19:45:** the queued arm started a third mis-seated attempt at 19:33 (a transient `lms ps`
   failure released the waiter; excluded by the seat audit, quarantined). While resetting it, `lms unload
   qwen/qwen3.6-35b-a3b` (meant for the LOCAL copy the campaign had loaded) unloaded the LEGION's copy instead — LM
   Link resolves a bare model key to the linked instance. That removed the collision, so the m5max arm now runs on the
   local copy; the Legion seat (David's dsh route) was unloaded by the operator and needs reloading after the arm.
   **Operator note 2026-09-15 09:10:** David switched the Legion and the m5max to low power mode ("things are just
   slower"). Expect longer turn latencies and more 120-minute-cap hits on every arm graded after this point; the
   operator (me) wrongly paused the Legion, m4 mini and muse arms for two minutes on that notice — their in-flight
   attempts (pytest-7521, pytest-6202, requests-1921) restarted from scratch at 09:10; nothing graded was affected.
10. **A loop-guard park is a lost card in a headless run** — muse (requests-1921) and the Legion (pytest-7521) both
   ended "needs attention": the model repeated the same read/search calls, the repeated-tool-call guard paused the
   card with "send a new instruction to continue", and a benchmark has nobody to send it; the card went to Review
   with nothing delivered. → `NKLEIN_LOOP_GUARD_AUTO_NUDGE` (opt-in, arms set it from now on): one bounded automatic
   re-drive per card — cancel the looping turn and re-prompt with the guard's own finding and the way out (results
   are already in context; edit the library files; deliver) — and only the SECOND loop parks. Pass-1 arms keep the
   old behavior (pinned runtime); the flag is on for every arm created from now on and for pass 2.

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
