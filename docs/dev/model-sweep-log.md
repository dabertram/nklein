# Model sweep log — per-run scoreboard over time

> A **chronological** log of cross-model test-run sweeps (the §5.Z roster × the MCF challenge ladder). Each sweep is one
> small table — timestamp · challenge · per-model result + a short note — so you can **scroll top→bottom to watch each
> model evolve as difficulty grows**. Companion to [milestone-challenges.md](milestone-challenges.md) (the challenge
> catalog) and [cross-model-verification.md](cross-model-verification.md) (the aggregate per-flow matrix); this file is
> the **time series** behind them. Newest sweeps are **appended at the bottom**. Entry timestamps are **UTC** (`Z`),
> matching the harness's `SWEEP-ROW | <ISO ts> | …` line — paste that line's facts straight into a new entry.
>
> **Result legend:** ✅ pass · ◑ partial (ran, weak synthesis) · ⚠️ capability-floor (recorded, *provisional* — keep
> trying to lift it) · ❌ fail (no tool call / wrong) · 🎲 flaky (varies run-to-run) · ⏳ incomplete (timeout/horizon) ·
> `·` not run this sweep.
>
> **Note tags:** 🚀 very good · 🐢 slow · 🧩 weak synthesis · 🐞 bug found · 🔧 fix landed · 🧱 no mitigation yet (open) ·
> 🔁 transient (not a ceiling).
>
> **Roster discipline (per the 2026-06-28 directive):** keep EVERY model that has ever appeared, even if currently
> unloaded — models pop in and out; collect the full history. Mark loaded vs available-untested vs gone. **Watch the
> WEAKEST models closely** (the "weakest watch" below) — they're the early-warning signal for where a new difficulty
> rung first bites, and the place the §5.AA ladder earns its keep.

## Roster (every model seen — loaded + historical)

| model | size | status (2026-06-28) | role / notes |
|---|---|---|---|
| `qwen/qwen3-8b` | 4.62 GB | loaded | **north-star small** — the C0 done-bar |
| `qwen/qwen2.5-coder-14b` | 8.33 GB | loaded | coder; strongest small all-rounder |
| `qwen3.5-9b-mlx` | 5.98 GB | loaded | ⚠️ slow-finalize on C0 |
| `google/gemma-4-e2b` | 4.37 GB | loaded | **2B — capability floor**, watch first |
| `google/gemma-4-e4b` | 6.86 GB | available | |
| `microsoft/phi-4-mini-reasoning` | 2.18 GB | loaded | reasoning, 3.8B; flipped ❌→✅ on chat tools via §5.AA tool-set reduction |
| `microsoft/phi-4-reasoning-plus` | 8.26 GB | available | over-reasons; ❌ chat tools (won't emit a call) |
| `nvidia/nemotron-3-nano-4b` | 2.84 GB | loaded | |
| `deepseek-r1-0528-qwen3-8b-mlx` | 8.71 GB | available | ⚠️ crash-prone |
| `text-embedding-nomic-embed-text-v1.5@q8_0` | 146 MB | loaded | embedder (not a chat model) |
| _— newly appeared 2026-06-28, untested —_ | | | |
| `qwopus3.5-9b-coder-mlx` (`@8bit`/`@4bit`) | ~9B | available, **untested** | coder; scout when a sweep slot frees |
| `qwopus3.5-4b-coder-fable5-v1-mlx` | ~4B | **tested ✅ C0** | small coder; capable once warm, ⚠️ cold-start-prone (see 15:54Z) |
| `ornith-1.0-9b-mlx` | ~9B | **tested ✅ C0** | 🚀 clean first-try C0 pass |
| `ornith-1.0-35b-mlx` (`@8bit`/`@4bit`) | ~35B | `@8bit` **won't load** (insufficient resources, Low Power + many models resident) | **bigger local model** — Phase-A lever; retry `@4bit` after unloading idle models |
| `nvidia/nemotron-3-super` | — | available, **untested** | |
| `deepseek-v4-flash-dq` | — | available, **untested** | |

> _Up to ~120B at lower quantization fits the 128 GB / M5 Max (§5.0.3 Phase A) — `ornith-1.0-35b` is the first rung up._

## Weakest-models watch (check these FIRST each sweep — earliest to hit a wall)

- **`google/gemma-4-e2b` (2B)** — the smallest; the harness must carry it. C0/C1/C2 clean so far; the first to watch on C3+.
- **`microsoft/phi-4-reasoning-plus`** — over-reasons, won't emit a tool call even with 1 tool offered (🧱 open — needs the
  next §5.AA rungs: prompt simplification / reason-then-act / native `/api/v1/chat`).
- **`qwen3.5-9b-mlx`** — ⚠️ slow-finalize on C0 (the §5.AA finalization watchdog targets this).
- **`deepseek-r1-0528-qwen3-8b-mlx`** — ⚠️ crash-prone; re-confirm it still loads each sweep.

## Sweeps (oldest first — append new at the bottom)

### 2026-06-26 → 27 · **baseline C0–C2** across the loaded 9 · `verify-*` harnesses
| model | C0 single-card | C1 decompose | C2 promote+isolation | note |
|---|:-:|:-:|:-:|---|
| qwen3-8b | ✅ | ✅ | ✅ | 🚀 north-star clean; 🐢 reasoning-heavy |
| qwen2.5-coder-14b | ✅ | ✅ | ✅ | 🚀 |
| qwen3.5-9b | ⚠️ | ✅ | ✅ | 🐢 slow-finalize → §5.AA watchdog |
| gemma-4-e2b | ✅ | ✅ | ✅ | 🚀 2B passing the floor |
| gemma-4-e4b | ✅ | ✅ | ✅ | |
| phi-4-mini-reasoning | ✅ | ✅ | ⚠️ | 🔧 chat tools ❌→✅ via tool-set reduction |
| phi-4-reasoning-plus | ✅ | ✅ | ✅ | 🧱 ❌ on chat tools (over-reasons) |
| nemotron-3-nano-4b | ✅ | ✅ | ✅ | |
| deepseek-r1-qwen3-8b | ✅ | ✅ | ✅ | ⚠️ crash-prone |
> **8/9 on C0** (qwen3.5-9b ⚠️), **9/9 on C1**, ✅ C2 across the roster. 0 narration leaks anywhere (§5.O output hardening solid).

### 2026-06-26 · **chat tool-use sweep** across the 9 · `verify-chat-*` + `sweep-capture`
| model | run_command | create_card | browse_url | output-robust | note |
|---|:-:|:-:|:-:|:-:|---|
| qwen3-8b | ✅ | ✅ | ✅ | ✅ | 🚀 all chat tools clean (read/write/send/runtime ✅ too) |
| qwen2.5-coder-14b | ✅ | ✅ | ◑ | ✅ | strong; 🧩 browse reply synthesis weak |
| qwen3.5-9b | ◑ | ✅ | ◑ | ◑ | 🧩 weak synthesis on several (tool RAN, reply didn't echo) |
| gemma-4-e2b | ◑ | ✅ | ◑ | ✅ | 🧩 2B; create_card + output clean |
| gemma-4-e4b | ◑ | ✅ | · | ✅ | output clean |
| phi-4-mini-reasoning | ✅\* | ✅\* | · | ⚠️ | 🔧 ❌→✅ after §5.AA tool-set reduction (1 tool offered) |
| phi-4-reasoning-plus | ❌ | ❌ | · | · | 🧱 never emits a tool call — open |
| nemotron-3-nano-4b | ✅ | ✅ | ◑ | ✅ | solid |
| deepseek-r1-qwen3-8b | ◑ | ✅ | · | · | ⚠️ crash-prone |
> `run_command` ◑ = the command genuinely EXECUTED; only the reply echo (strict gate) was weak — the capability the user
> cares about works. **0 user-facing narration leaks anywhere** (§5.O). Remaining ❌/⚠️ are §5.AA *control* problems, not format.

### 2026-06-28 13:08Z · **C0 reliability sweep #1** · `verify-task-completion` · qwen3-8b ×5 (back-to-back)
| model | runs | result | note |
|---|:-:|:-:|---|
| qwen3-8b | 5 | ✅ 4/5 | 🔁 1 `interrupted` (transient, §5.AA class — not a wrong result) |

### 2026-06-28 13:12Z · **C0 reliability scout #2** · `verify-task-completion` ×3 each
| model | runs | result | note |
|---|:-:|:-:|---|
| qwen3-8b | 3 | ✅ 3/3 | 🚀 sweep-#1 transient did NOT reproduce → **7/8 (~88%) over both sweeps** |
| qwen2.5-coder-14b | 3 | ✅ 3/3 | 🚀 clean |

### 2026-06-28 13:17Z · **C3 unattended multi-card** · `verify-multi-card-pipeline` · `complex_dag` · qwen3-8b
| model | decompose | all-terminal | note |
|---|:-:|:-:|---|
| qwen3-8b | ✅ (13 cards) | ⏳ | 🐞 gate = wide-DAG **throughput + long-horizon transient survivability**, not a model ceiling; ~10 cards stuck in `planning` at 25 min |

### 2026-06-28 13:53Z · **C5 wide fan-out** · `verify-multi-card-pipeline` · `many_small` · qwen3-8b
| model | decompose | all-terminal | note |
|---|:-:|:-:|---|
| qwen3-8b | ✅ (21 indep. cards) | ⏳ | 🐞 only ≤3 ran concurrently — **single local endpoint serializes inference**; true fan-out needs multiple endpoints/models (not just a higher cap) |

### 2026-06-28 14:15Z · **C3 file-overlap diagnostic re-scout** · `complex_dag` · qwen3-8b
| model | result | note |
|---|:-:|---|
| qwen3-8b | ⏳ | 🔧 the auto-start skip fires on a **genuine** shared file (`src/habit-insights.ts`) → file-overlap heuristic **vindicated** (serializes real overlaps, not noise) |

### 2026-06-28 14:35Z · **runtime-wide throughput fix** (affects every sweep's per-card latency)
| area | result | note |
|---|:-:|---|
| token counting | 🔧 | 🐞🔧 `countKanbanTextTokens` hit BPE ~O(n²) on long single-char runs (120 KB `get_file_size` ~6 s, blocked the event loop) → chunked + capped; **6000 ms → 85 ms**. Behind every budget/size check, so it lifts all models' turn latency. |

### 2026-06-28 14:47Z · **C3 post-throughput-fix re-scout** · `complex_dag` · qwen3-8b · _(Low Power)_
| model | decompose | all-terminal | note |
|---|:-:|:-:|---|
| qwen3-8b | ✅ (13 cards) | ⏳ | 🔧 **power-aware timeout validated live** — auto-scaled 15→30 min (`power=low ×2`); INCOMPLETE but **inconclusive for the fix** (run was under Low Power ~50% throughput — confounded regime; single-endpoint serialization + low-power dominate). Re-run at high power to isolate the fix's effect. |

### 2026-06-28 15:42Z · **weakest-model watch** · C0 single-card · `verify-task-completion` · _(Low Power)_
| model | result | note |
|---|:-:|---|
| google/gemma-4-e2b (2B) | ✅ | 🚀 the floor holds — ran to `awaiting_review` + delivered correct `hello.txt` in ~40 s even at Low Power (`power=low ×2`) |

### 2026-06-28 15:54Z · **new-model scout** · C0 single-card · `verify-task-completion` · _(Low Power)_
| model | result | note |
|---|:-:|---|
| qwopus3.5-4b-coder (NEW, ~4B) | ✅ | **Capable** — passed C0 to `awaiting_review` once warm (16:35Z). But **cold-start-prone**: 1st run INCOMPLETE/interrupted (~9 min), 2nd run HUNG 26 min with no activity (the model's cold load stalled — looked like "no LLM activity"). 🔧 This drove a harness fix: **stall detection** (abort early with a `STALLED` verdict on no-progress) + **live activity printing**. Vindicates "don't judge prematurely" — a repeat after warm-up passed. |

### 2026-06-28 18:05Z · **C2 auto-promote — full loaded-roster sweep** · `verify-all-models verify-autopromote-recovery` · _(Low Power)_
| model | C2 auto-promote | note |
|---|:-:|---|
| qwen3-8b · coder-14b · gemma-4-e2b · qwen3.5-9b · nemotron-3-nano · qwopus-4b (NEW) · ornith-9b (NEW) | ✅ | 7/8 clean recovery-path promotes (9–38 s); both new models confirmed on C2 |
| microsoft/phi-4-mini-reasoning | ⚠️ | First run INCOMPLETE at 304 s (hit the unscaled 300 s budget) — which exposed + drove a harness fix (power-scale the isolation harnesses). **Re-validated with the 2× scaled budget (600 s): STILL fails** — `onCardPromoted: 0`, card never left `planning`. So it's a **genuine capability-floor, not a budget artifact** (re-validated per "don't judge prematurely"): phi-4 doesn't drive the multi-step recovery flow. Lift = §5.AA reason-then-act rung (already backlogged for phi-4). |
> **C2 = 7✅/1⚠️** (phi-4-mini ⚠️ re-validated as genuine). **phi-4-mini's ladder profile is now clear: single-turn OK
> (C1 ✅), multi-step tool-driving fails (C0 delivery ◑, C2 promote ⚠️)** — a §5.AA reason-then-act target, not a ceiling
> to hide. Ladder across the loaded roster: **C0** 6✅/1🧱/1◑ · **C1** 8/8 ✅ · **C2** 7✅/1⚠️.

### 2026-06-28 17:55Z · **C1 decompose — full loaded-roster sweep** · `verify-all-models verify-decompose-isolation` · _(Low Power)_
| model | C1 decompose | note |
|---|:-:|---|
| qwen3-8b | ✅ | 64s, 0 host-path leaks |
| qwen2.5-coder-14b | ✅ | 83s |
| gemma-4-e2b | ✅ | 27s (fastest) |
| qwen3.5-9b | ✅ | 47s — **passes C1 though it STALLED on C0**: decompose is one self-contained turn (no multi-turn finalization to stall on) |
| phi-4-mini-reasoning | ✅ | 303s (slow, reasoning) — **passes C1 though PARTIAL on C0**: single-turn, no deliverable-write step to skip |
| nvidia/nemotron-3-nano-4b | ✅ | 99s |
| qwopus3.5-4b-coder (NEW) | ✅ | 73s — new model confirmed on C1 |
| ornith-1.0-9b (NEW) | ✅ | 163s — new model confirmed on C1 |
> **C1 = 8/8 across the loaded roster** (loaded-only, no-load-guarded, 0 host-path leaks anywhere). Notably the two C0
> problem-children pass C1 — confirming their C0 issues are **multi-turn finalization/delivery** (§5.AA), not capability:
> a single decompose turn is clean for everyone.

### 2026-06-28 17:24Z · **loaded-roster C0 sweep wrap-up** · `verify-task-completion` · _(Low Power, delivery-gated + stall-detected)_
| model | result | note |
|---|:-:|---|
| microsoft/phi-4-mini-reasoning | ◑ | PARTIAL — reached `awaiting_review` but `delivered=NO` (declared done without writing hello.txt). Consistent with phi-4's reasoning-model tool-calling weakness — it was a **false ✅ under the old terminal-only criterion**; the deliverable-gate corrects it. Lift = §5.AA reason-then-act / tool-set-reduction rungs (already backlogged). |
> **Honest loaded-roster C0 — COMPLETE (Low Power, this session, delivery-gated; all 8 loaded chat models):**
> **6 ✅ real passes (`delivered=YES` confirmed):** qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b, nemotron-3-nano-4b,
> ornith-1.0-9b, qwopus3.5-4b (warm) · **🧱 STALLED:** qwen3.5-9b (finalization → §5.AA retry wiring) · **◑ PARTIAL:**
> phi-4-mini-reasoning (premature-done, no deliverable → §5.AA reason-then-act). The improved harness (deliverable gate +
> stall detector) surfaced the two issues the old terminal-only PASS hid — so this is the first *trustworthy* C0 baseline.

### 2026-06-28 17:18Z · **re-attack a standing ⚠️** · C0 · `verify-task-completion` · _(Low Power)_
| model | result | note |
|---|:-:|---|
| qwen3.5-9b-mlx | 🧱 STALLED | Re-tested the C0 ⚠️ slow-finalize (per "limitations are provisional"). Under Low Power it **stalls**: reached `running`→`interrupted` then **no activity for 360 s** → the new stall detector aborted it (validating itself — caught it fast instead of waiting out the 10-min timeout). Confirms the ⚠️ is a real **finalization** limitation; the §5.AA finalization watchdog is the owed lift. `delivered=NO`. |

### 2026-06-28 16:54Z · **weakest-model up the ladder** · C1 decompose + C2 promote · _(Low Power)_
| model | C1 decompose | C2 auto-promote | note |
|---|:-:|:-:|---|
| google/gemma-4-e2b (2B) | ✅ | ✅ | 🚀 **the floor holds across all met rungs** even at Low Power — C1: `decompose_project` → DAG, **0 host-path leaks** under isolation; C2: card auto-promoted Planning→In Progress via the recovery path. The harness carries the weakest 2B through C0/C1/C2. |

### 2026-06-28 16:38Z · **new-model + loaded-roster scout** · C0 single-card · `verify-task-completion` · _(Low Power, delivery-gated)_
| model | result | note |
|---|:-:|---|
| ornith-1.0-9b-mlx (NEW, ~9B) | ✅ | 🚀 clean first-try pass to `awaiting_review` in ~50 s (even Low Power) — a usable new 9B; ran with the new **live-activity** harness mode (visible real-time steps) |
| nvidia/nemotron-3-nano-4b | ✅ | clean C0 — terminal AND `delivered=YES` (the new deliverable-gated PASS) at 17:21Z |
| ornith-1.0-35b-mlx@8bit (NEW, ~35B, **Phase-A bigger-model lever**) | ◑→🧱 | **Root cause (live-activity dump): the model FAILED TO LOAD** — _"insufficient system resources… would overload your system and cause it to freeze."_ So it reached `awaiting_review` with nothing delivered (`delivered=NO`). **Two wins:** the live-activity mode surfaced the exact load error (old silent harness would've hidden it), and the deliverable-gate flagged it PARTIAL not PASS. **Operational finding:** @8bit (~35 GB) doesn't fit under Low Power with several scout models already resident — needs **`@4bit` (lower quant)** and/or unloading idle models first (ties the §5.AF resource-governance item: VRAM/RAM headroom check before a load). Not retried now — won't risk freezing an actively-used machine. |

### 2026-06-28 15:20Z · **infra fix** · LM Studio `/models` catalog no longer hammered
| area | result | note |
|---|:-:|---|
| roster discovery | 🔧 | 🐞🔧 the `/api/v0/models` catalog was hit ~every second → added a 30 s TTL cache (`nklein-provider-service.ts`); polled ≤ once/30 s now. Harness should also *monitor* the LM Studio dev log for recurrence (todo §5.Z). |
