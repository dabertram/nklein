# Model sweep log — per-run scoreboard over time

> A **chronological** log of cross-model test-run sweeps (the §5.Z roster × the MCF challenge ladder). Each sweep is one
> small table — timestamp · challenge · per-model result + a short note. Entries are ordered **oldest-first** (ascending
> by time), so you can **scroll top→bottom to watch each model evolve as difficulty grows**; the latest sweep is at the
> bottom. Companion to [milestone-challenges.md](milestone-challenges.md) (the challenge catalog) and
> [cross-model-verification.md](cross-model-verification.md) (the aggregate per-flow matrix); this file is the **time
> series** behind them. **Append new sweeps at the bottom of the Sweeps section.** Entry timestamps are **UTC** (`Z`),
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

### 2026-06-28 15:20Z · **infra fix** · LM Studio `/models` catalog no longer hammered
| area | result | note |
|---|:-:|---|
| roster discovery | 🔧 | 🐞🔧 the `/api/v0/models` catalog was hit ~every second → added a 30 s TTL cache (`nklein-provider-service.ts`); polled ≤ once/30 s now. Harness should also *monitor* the LM Studio dev log for recurrence (todo §5.Z). |

### 2026-06-28 15:42Z · **weakest-model watch** · C0 single-card · `verify-task-completion` · _(Low Power)_
| model | result | note |
|---|:-:|---|
| google/gemma-4-e2b (2B) | ✅ | 🚀 the floor holds — ran to `awaiting_review` + delivered correct `hello.txt` in ~40 s even at Low Power (`power=low ×2`) |

### 2026-06-28 15:54Z · **new-model scout** · C0 single-card · `verify-task-completion` · _(Low Power)_
| model | result | note |
|---|:-:|---|
| qwopus3.5-4b-coder (NEW, ~4B) | ✅ | **Capable** — passed C0 to `awaiting_review` once warm (16:35Z). But **cold-start-prone**: 1st run INCOMPLETE/interrupted (~9 min), 2nd run HUNG 26 min with no activity (the model's cold load stalled — looked like "no LLM activity"). 🔧 This drove a harness fix: **stall detection** (abort early with a `STALLED` verdict on no-progress) + **live activity printing**. Vindicates "don't judge prematurely" — a repeat after warm-up passed. |

### 2026-06-28 16:38Z · **new-model + loaded-roster scout** · C0 single-card · `verify-task-completion` · _(Low Power, delivery-gated)_
| model | result | note |
|---|:-:|---|
| ornith-1.0-9b-mlx (NEW, ~9B) | ✅ | 🚀 clean first-try pass to `awaiting_review` in ~50 s (even Low Power) — a usable new 9B; ran with the new **live-activity** harness mode (visible real-time steps) |
| nvidia/nemotron-3-nano-4b | ✅ | clean C0 — terminal AND `delivered=YES` (the new deliverable-gated PASS) at 17:21Z |
| ornith-1.0-35b-mlx@8bit (NEW, ~35B, **Phase-A bigger-model lever**) | ◑→🧱 | **Root cause (live-activity dump): the model FAILED TO LOAD** — _"insufficient system resources… would overload your system and cause it to freeze."_ So it reached `awaiting_review` with nothing delivered (`delivered=NO`). **Two wins:** the live-activity mode surfaced the exact load error (old silent harness would've hidden it), and the deliverable-gate flagged it PARTIAL not PASS. **Operational finding:** @8bit (~35 GB) doesn't fit under Low Power with several scout models already resident — needs **`@4bit` (lower quant)** and/or unloading idle models first (ties the §5.AF resource-governance item: VRAM/RAM headroom check before a load). Not retried now — won't risk freezing an actively-used machine. |

### 2026-06-28 16:54Z · **weakest-model up the ladder** · C1 decompose + C2 promote · _(Low Power)_
| model | C1 decompose | C2 auto-promote | note |
|---|:-:|:-:|---|
| google/gemma-4-e2b (2B) | ✅ | ✅ | 🚀 **the floor holds across all met rungs** even at Low Power — C1: `decompose_project` → DAG, **0 host-path leaks** under isolation; C2: card auto-promoted Planning→In Progress via the recovery path. The harness carries the weakest 2B through C0/C1/C2. |

### 2026-06-28 17:18Z · **re-attack a standing ⚠️** · C0 · `verify-task-completion` · _(Low Power)_
| model | result | note |
|---|:-:|---|
| qwen3.5-9b-mlx | 🧱 STALLED | Re-tested the C0 ⚠️ slow-finalize (per "limitations are provisional"). Under Low Power it **stalls**: reached `running`→`interrupted` then **no activity for 360 s** → the new stall detector aborted it (validating itself — caught it fast instead of waiting out the 10-min timeout). Confirms the ⚠️ is a real **finalization** limitation; the §5.AA finalization watchdog is the owed lift. `delivered=NO`. |

### 2026-06-28 17:24Z · **loaded-roster C0 sweep wrap-up** · `verify-task-completion` · _(Low Power, delivery-gated + stall-detected)_
| model | result | note |
|---|:-:|---|
| microsoft/phi-4-mini-reasoning | ◑ | PARTIAL — reached `awaiting_review` but `delivered=NO` (declared done without writing hello.txt). Consistent with phi-4's reasoning-model tool-calling weakness — it was a **false ✅ under the old terminal-only criterion**; the deliverable-gate corrects it. Lift = §5.AA reason-then-act / tool-set-reduction rungs (already backlogged). |
> **Honest loaded-roster C0 — COMPLETE (Low Power, this session, delivery-gated; all 8 loaded chat models):**
> **6 ✅ real passes (`delivered=YES` confirmed):** qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b, nemotron-3-nano-4b,
> ornith-1.0-9b, qwopus3.5-4b (warm) · **🧱 STALLED:** qwen3.5-9b (finalization → §5.AA retry wiring) · **◑ PARTIAL:**
> phi-4-mini-reasoning (premature-done, no deliverable → §5.AA reason-then-act). The improved harness (deliverable gate +
> stall detector) surfaced the two issues the old terminal-only PASS hid — so this is the first *trustworthy* C0 baseline.

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

### 2026-06-28 18:05Z · **C2 auto-promote — full loaded-roster sweep** · `verify-all-models verify-autopromote-recovery` · _(Low Power)_
| model | C2 auto-promote | note |
|---|:-:|---|
| qwen3-8b · coder-14b · gemma-4-e2b · qwen3.5-9b · nemotron-3-nano · qwopus-4b (NEW) · ornith-9b (NEW) | ✅ | 7/8 clean recovery-path promotes (9–38 s); both new models confirmed on C2 |
| microsoft/phi-4-mini-reasoning | ⚠️ | First run INCOMPLETE at 304 s (hit the unscaled 300 s budget) — which exposed + drove a harness fix (power-scale the isolation harnesses). **Re-validated with the 2× scaled budget (600 s): STILL fails** — `onCardPromoted: 0`, card never left `planning`. So it's a **genuine capability-floor, not a budget artifact** (re-validated per "don't judge prematurely"): phi-4 doesn't drive the multi-step recovery flow. Lift = §5.AA reason-then-act rung (already backlogged for phi-4). |
> **C2 = 7✅/1⚠️** (phi-4-mini ⚠️ re-validated as genuine). **phi-4-mini's ladder profile is now clear: single-turn OK
> (C1 ✅), multi-step tool-driving fails (C0 delivery ◑, C2 promote ⚠️)** — a §5.AA reason-then-act target, not a ceiling
> to hide. Ladder across the loaded roster: **C0** 6✅/1🧱/1◑ · **C1** 8/8 ✅ · **C2** 7✅/1⚠️.

### 2026-06-28 18:18Z · **chat create_card — full loaded-roster sweep** · `verify-all-models verify-chat-create-card` · _(Low Power)_
| model | create_card | note |
|---|:-:|---|
| all 8 loaded (qwen3-8b · coder-14b · gemma-4-e2b · qwen3.5-9b · phi-4-mini · nemotron · qwopus-4b NEW · ornith-9b NEW) | ✅ | **8/8** created a real board card at runtime (9–42 s). phi-4-mini ✅ here (chat tool-set-reduction path works, unlike the agent multi-step flow). **Both new models clean.** |
> **The 2 new models (qwopus3.5-4b, ornith-1.0-9b) are now fully characterized: C0 ✅ · C1 ✅ · C2 ✅ · chat create_card ✅** — usable additions to the roster.

### 2026-06-28 18:30Z · **chat run_command — full loaded-roster sweep** · `verify-all-models verify-chat-command-exec` · _(Low Power)_
| model | run_command | note |
|---|:-:|---|
| qwen3-8b · coder-14b · phi-4-mini · nemotron · qwopus-4b (NEW) | ✅ | clean — command executed + marker echoed (7–52 s) |
| gemma-4-e2b · qwen3.5-9b · ornith-1.0-9b (NEW) | ◑ | the model **called `run_command`** but the reply didn't echo the marker (weak synthesis) → strict gate marks INCOMPLETE, but the tool-call capability works (the `‡` matrix footnote semantics; matches baseline for gemma-e2b/qwen3.5-9b). Not a !Klein bug — a model reply-quality trait. |
> **run_command = 5✅ + 3◑** (all 8 emitted the tool call; 3 weak-echoed). New-model chat profile now complete:
> **qwopus3.5-4b strong** (create_card ✅, run_command ✅) · **ornith-1.0-9b good** (create_card ✅, run_command ◑ weak-echo).

### 2026-06-28 18:42Z · **chat write-tool — full loaded-roster sweep** · `verify-all-models verify-chat-agent-write` · _(Low Power)_
| model | write tool | note |
|---|:-:|---|
| qwen3-8b · coder-14b · gemma-4-e2b · qwen3.5-9b · nemotron · qwopus-4b (NEW) · ornith-9b (NEW) | ✅ | 7/8 drove a write through the confirm gate (ran only after approval + audited; 6–29 s). Both new models ✅. |
| microsoft/phi-4-mini-reasoning | ❌ | INCOMPLETE (30 s) — didn't drive the confirm-gated write. **Reconfirms phi-4-mini's consistent multi-step tool-driving weakness** (C0 delivery ◑ · C2 promote ⚠️ · write ❌) vs its single-tool successes (create_card ✅ · run_command ✅ · C1 decompose ✅). Clear §5.AA reason-then-act target. |
> New-model verdict holding strong: **qwopus3.5-4b and ornith-1.0-9b pass C0/C1/C2 + create_card + run_command(◑ for ornith) + write-tool** — solid roster additions.

### 2026-06-28 18:54Z · **chat read-tools — full loaded-roster sweep** · `verify-all-models verify-chat-agent-tools` · _(Low Power)_
| model | read tools | note |
|---|:-:|---|
| qwen3-8b · coder-14b · qwen3.5-9b · qwopus-4b (NEW) · ornith-9b (NEW) | ✅ | called `read_file` + answered from the file (7–29 s); both new models clean |
| gemma-4-e2b · phi-4-mini · nemotron-3-nano | ◑ | **all CALLED `read_file`** but the final answer didn't echo the file's secret (weak synthesis) → strict gate marks INCOMPLETE; the tool-use capability works (same ◑ semantics as run_command; matches baseline for gemma-e2b/nemotron) |
> read-tools = **5✅ + 3◑** (all 8 called the tool; 3 weak-answered). qwopus-4b + ornith-9b ✅ — new models now clean across 4 chat tools (create_card · run_command[ornith ◑] · write · read).

### 2026-06-28 19:14Z · **chat send + runtime — full loaded-roster sweep** · `verify-chat-send` / `verify-chat-runtime` · _(Low Power)_
| flow | result | note |
|---|:-:|---|
| send (`chat.sendMessage` runs a real turn + persists) | **8/8 ✅** | 1–5 s across the roster |
| runtime (turn composes memory + goal, calls model, persists) | **8/8 ✅** | 2–20 s; qwen3-8b cold-start 20 s, rest fast |
> Both basic single-turn chat flows are universally green on the loaded roster — these exercise the call+persist seam, not tool-driving, so even the weak models (gemma-e2b, phi-4-mini, nemotron) pass cleanly. Chat-flow matrix now covers: create_card · run_command · write · read · send · runtime.

### 2026-06-28 19:36Z · **chat e2e capstone (multi-tool chain) — full loaded-roster sweep** · `verify-chat-agent-e2e` · _(Low Power)_
> One instruction exercising the WHOLE stack in one session: read FACT.txt → run `cat FACT.txt` (see output) → create a board card → maintain a focus chain; PASS requires all the durable side effects (marker echoed + card persisted + each tool used).

| model | e2e | what happened |
|---|:-:|---|
| **ALL 8** | ❌ | **0/8 — a hard multi-tool-chain wall.** Even qwen3-8b (north-star) + coder-14b fail. |

**Root cause (consistent across the roster): chain-fatigue NARRATION.** Models do the FIRST tool calls for real (read_file + run_command → the marker echoes back), then **narrate the LATER steps in prose instead of calling them** — `create_card` + `update_focus_chain` are described ("3. Created card E2E-CARD-7777…"), never executed, so the board stays empty. Two narration dialects observed:
- **qwen3-8b / coder / others** → pure-prose narration ("Created card X with prompt Y") — **not recoverable** (too ambiguous to parse safely).
- **gemma-4-e2b** → Python `tool_code = create_card(title="E2E-CARD-7777", prompt="from e2e")` (incl. a list-valued `update_focus_chain(steps_completed=[…])`) — **NOW RECOVERABLE**: 🔧 added `parseGemmaToolCodeCalls` (§5.AA) so these execute. **gemma e2e is a re-verify lift candidate.**
> Timings: qwen3-8b 48 s · coder 23 s · gemma 25 s · qwen3.5-9b 20 s · phi-4-mini 109 s 🐢 · nemotron 13 s · qwopus-4b 26 s · ornith-9b 18 s. **Takeaway:** the e2e capstone is a genuine difficulty rung ABOVE the single-tool flows (all 8 pass create_card/run_command/write/read individually) — the wall is *chaining* tools across turns without the model lapsing into narration. The real fix is the §5.AA retry-engine wiring (narrated-recovery + constrained-decoding rung firing mid-chain) — wired + re-swept next (20:05Z below).

### 2026-06-28 20:05Z · **chat e2e capstone — RE-SWEEP after wiring the §5.AA constrained-decoding rung** · `verify-chat-agent-e2e` · _(Low Power)_
> Same capstone, now with the constrained-decoding rung LIVE on the chat path (`createChatAgentModel` forces a parseable `{tool,arguments}` call when a turn names a tool but emits none). **Strict harness gate still 0/8**, but the *tool-execution* picture changed materially for the strongest models:

| model | tools driven this run | card persisted | vs pre-wiring | note |
|---|:-:|:-:|:-:|---|
| qwen2.5-coder-14b | read · run_command · **create_card** · **update_focus_chain** (4/4) | ✅ | ❌→**◑** | 🚀🔧 **full chain executed** — only the strict marker-echo (reply quality) misses ✅ |
| microsoft/phi-4-mini-reasoning | read · run_command · **create_card** (3/4) | ✅ | ❌→**◑** | 🔧 the narration-wall model now **drives + persists the card** (234 s, reasoning-heavy); only update_focus_chain + echo miss |
| qwen3-8b · gemma-4-e2b · qwen3.5-9b · nemotron · qwopus-4b · ornith-9b | read only (1/4) | ❌ | ❌→❌ | declare "done" with a prose summary after read_file → the loop ends before the rung can force later steps (a controller/turn-budget gap, not a rung gap) |
> **The constrained-decoding rung WORKS** where the loop keeps turning: coder-14b + phi-4-mini went from *narrate-everything, persist-nothing* to **driving the control-plane mutation + persisting the card** (◑ — tool side effects real, only the reply-echo quality gate unmet). The remaining 6 stop after read_file with a final prose answer, so the rung never gets a later no-call turn to fire on — the next lift is a **finite-state controller** that keeps the run going until all required steps are done (todo §5.AA controller item), not more recovery. **0/8 strict, but 2 genuine ❌→◑ lifts** — the wall is cracking.
> **20:05Z follow-ups:** (1) a **used-tool steering** refinement (the rung drops already-executed tools from the forced schema, steering a stalled chain to the next undone step) — a fresh sweep held the 2 lifts (coder-14b + phi-4-mini persist) but the other 6 still narrate "done" after read_file and don't yield a parseable forced call (model-dependent constrained-decoding adherence). (2) A reliability recheck showed the lift is **stochastic** (drives on longer runs, narrates+stops on short ones). ⇒ Built the **§5.AA finite-state-controller pure core** ([run-state-machine.ts](../../src/core/run-state-machine.ts)) — evidence-based phase transitions (completion needs acceptance evidence, not a model "done") — as the durable fix; wiring it to drive the loop is the next step.

### 2026-06-28 20:38Z · **C0 reliability repeat (never-idle)** · `verify-all-models verify-task-completion qwen3-8b` ×3 · _(Low Power)_
| model | runs | result | note |
|---|:-:|:-:|---|
| qwen/qwen3-8b | 3 | ✅ 2/3 · 🧱 1 STALL | runs 1–2 PASS fast (37 s, 18 s) to `awaiting_review` + `delivered=YES`; **run 3 STALLED** — the model went silent for 480 s (hung/unresponsive call) → the stall detector aborted at 498 s, `delivered=NO` |
> Ran as the never-idle background LLM work while building the §5.AA controller substrate. **Honest result: ~2/3 under sustained Low-Power load** — the 3rd back-to-back run hit a model **stall** (no activity 480 s), the same transient/under-load class seen at 13:08Z (the `interrupted`/`aborted` outcome) and 17:18Z (qwen3.5-9b stall), NOT a wrong answer. 🔁 transient (recoverable — the §5.AA `aborted`→re-run rung is its mitigation), but a real reminder that sustained back-to-back load under Low Power provokes endpoint stalls. The stall detector did its job (aborted at 498 s instead of waiting out the full budget).

### 2026-06-29 · **q4-vs-q8 A/B — gemma-4-e2b on the e2e capstone** · `verify-chat-agent-e2e` (spaced ×3 each) · _(Low Power; user loaded the q8)_
> The controlled quant experiment: same 2B model, same hardest challenge, q4 (`-m5max`) vs q8 (`-q8`) — how much of the chaining failure is quant-induced?

| variant | e2e (×3) | note |
|---|:-:|---|
| gemma-4-e2b **q4** | 0/3 persist · ❌❌❌ | narration/early-stop (12–14 s), `Tool call: …` prose dialect |
| gemma-4-e2b **q8** | 0/3 persist · ❌❌❌ | narration/early-stop (15–16 s), `tool_code print(…)` dialect |
> **Finding: q8 does NOT lift the 2B floor model on the e2e chain — identical 0/3 to q4.** The multi-tool-chaining failure is a **control/orchestration limit (or inherent 2B-size limit), not quant precision** — bumping the SAME small model to q8 buys nothing here. Strongly reinforces the [[model-quant-strategy-q4-first]] call: the lever for these failures is the §5.AA controller (evidence-gated, force-the-call), not higher quant. (A q8 of a LARGER model is a separate question — this only tests the 2B floor, which is the one the user loaded.) Interesting aside: the two quants even narrate in DIFFERENT dialects (q4 prose, q8 `tool_code`), underscoring that narration form is model/quant-idiosyncratic — recovery must cover many, which is why the durable fix is the controller, not chasing dialects.

### 2026-06-29 · **e2e capstone — full roster, GRADED + SPACED** · `NKLEIN_SWEEP_SPACING_MS=30000 verify-all-models verify-chat-agent-e2e` · _(Low Power)_
> The same graded sweep but with 30 s spacing between models (the new flag) to remove consecutive-load degradation — the TRUE current-state of the capstone.

| result | models | note |
|---|---|---|
| ✅ PASS | **qwen3-8b (29 s)** | 🚀 FULL pass — chain executed + card persisted + **marker echoed**. Spacing recovered it from ❌ (back-to-back) → ✅. |
| ◑ PARTIAL | **coder-14b (17 s), phi-4-mini (64 s)** | full chain + card persisted; reply didn't echo the marker |
| ❌ FAIL | gemma-4-e2b, qwen3.5-9b, nemotron, qwopus-4b, ornith-9b | fast narration-stop (7–13 s) **even when spaced** — these need the controller/reason-then-act, not just spacing |
> **Spaced = 1 ✅ + 2 ◑ + 5 ❌ (vs back-to-back 0 ✅ + 2 ◑ + 6 ❌).** Two clear wins: **(1) spacing works** — it recovered qwen3-8b to a FULL ✅ (the consecutive-load degradation was real + the `NKLEIN_SWEEP_SPACING_MS` mitigation is validated). **(2) The north-star fully clears the hardest challenge** when not load-degraded — a milestone vs the pre-§5.AA 0/8 wall. The 5 that fast-fail *even spaced* (7–13 s) are the genuine remaining target: they declare done / narrate before the constrained rung can drive the chain — the §5.AA finite-state controller (evidence-gated, per-step) is the lift, not more recovery or spacing.

### 2026-06-28 21:50Z · **e2e capstone — full roster, GRADED gate (✅/◑/❌)** · `verify-all-models verify-chat-agent-e2e` · _(Low Power, back-to-back)_
> First sweep with the new graded gate: ◑ = full 4-tool chain executed + card persisted, only the reply-echo missing (real capability, weak synthesis); ❌ = chain didn't run / card didn't persist.

| result | models | note |
|---|---|---|
| ◑ PARTIAL | **qwen2.5-coder-14b (16 s), phi-4-mini-reasoning (131 s)** | drove the full chain + persisted the card; only the marker-echo gate unmet |
| ❌ FAIL | qwen3-8b, gemma-4-e2b, qwen3.5-9b, nemotron, qwopus-4b, ornith-9b | narration-stop fast (6–23 s) under **consecutive load** |
> **2/8 ◑, 6/8 ❌ — but this is a LOWER BOUND (back-to-back).** The ❌ models all failed *fast* (6–23 s = consecutive-load narration-stop), and several reach ◑ **standalone**: coder-14b ✅ standalone (this same sweep had it ◑), qwopus-4b 4/4 + phi-4-mini 4/4 in the *paced* characterization below. So the back-to-back sweep **understates** the true ◑ rate — exactly the consecutive-load degradation §4A warns about (now mitigated by the new `NKLEIN_SWEEP_SPACING_MS` flag; re-run spaced for the true rate). **Net vs the pre-§5.AA 0/8 wall (nothing executed anywhere): the chain now executes + persists for the robust models, and the graded gate makes that visible instead of a flat ❌.**

### 2026-06-28 21:1xZ · **constrained-rung e2e lift — reliability characterization (paced ×4)** · `verify-chat-agent-e2e` · _(Low Power)_
> Quantifying the §5.AA constrained-decoding lift on the e2e capstone — does the rung reliably make a model drive the full tool chain + **persist the card**? Paced one run at a time (per the stall finding above). The `coder` filter also matched qwopus-4b, so 3 models × 4 runs.

| model | card persisted | note |
|---|:-:|---|
| **microsoft/phi-4-mini-reasoning** | **4/4 ✅** | 🚀🔧 the constrained rung makes the *weakest single-card model* (C0 ◑, C2 ⚠️) RELIABLY drive the full e2e chain + persist — 98–124 s runs (it does the work). A real, repeatable capability lift on the hardest challenge. |
| **qwopus3.5-4b-coder (NEW)** | **4/4 ✅** | 🚀 reliably persists via the rung too |
| **qwen/qwen2.5-coder-14b** | **0/4 in the batch · ✅ standalone** | 0/4 (narration-stop ~15 s) in the back-to-back batch, **but a fresh STANDALONE run immediately drove all 4 tools + persisted** (◑, only the marker-echo missing). So coder is **stochastic, not consistently-failing** — and consecutive runs appear to degrade it (the same load effect as the stalls). |
> **Findings (answers "are models inherently flaky / is the work worth it"):** (1) the lift is **real** — phi-4-mini + qwopus-4b at 4/4; coder-14b drives it standalone. **Persist correlates with run time** (slow = did the work; fast ~15 s = narrated/quit). (2) It is genuinely **stochastic + run-dependent**, and **back-to-back runs degrade weaker models** (coder 0/4 consecutive but ✅ standalone; cf. the qwen3-8b stall on its 3rd consecutive C0). ⇒ **pace AND space live runs** — even non-stalling consecutive runs can suppress the lift. (3) **Most striking + the headline: the constrained rung lifts phi-4-mini — the WEAKEST single-card model (◑ C0, ⚠️ C2) — to RELIABLE (4/4) multi-tool-chain execution.** That validates the §5.AA robustness thesis on q4 weak models — the work is worth it. (4) The remaining gap is the **strict marker-echo reply-quality gate** (all these are really ◑ — tools executed, card persisted, the reply just didn't quote the file marker), not tool execution.

### 2026-06-29 · **e2e capstone — FIRST AUTONOMOUS model-lab sweep (fresh-load per model)** · `model-lab sweep verify-chat-agent-e2e` · _(Low Power; !Klein now controls load/unload)_
> 🎉 The model-loading handover is live — !Klein loaded each model itself (guarded: one resident at a time, unload-before-load, ctx 40000, headroom-checked), ran the graded e2e, unloaded, next. Each model is **freshly loaded + sole-resident**, so this is the cleanest snapshot yet — **no consecutive-load degradation** confounder.

| model | size | e2e | note |
|---|---|:-:|---|
| qwen/qwen3-8b | 8B | ✅ PASS | full chain executed + card persisted + marker echoed |
| microsoft/phi-4-mini-reasoning | 3.8B | ◑ PARTIAL | drove the full chain + persisted the card (only marker-echo missing) — fresh-load reproduces its 4/4 paced result |
| qwen/qwen2.5-coder-14b | 14B | ◑ PARTIAL | full chain + persisted |
| google/gemma-4-e2b | 2B | ❌ FAIL | fast narration-stop (~13 s) |
| nvidia/nemotron-3-nano-4b | 4B | ❌ FAIL | fast narration-stop (~9 s) |
| qwopus3.5-4b-coder | 4B | ❌ FAIL | fast narration-stop (~10 s) |
> **1 ✅ + 2 ◑ + 3 ❌ (fresh loads).** Two clean takeaways: **(1) the handover machinery works perfectly** — 6 guarded load→test→unload cycles, no pile-up, no freeze, embedder kept throughout. **(2) The multi-tool-chain floor is real at ≤4B** — gemma-2B, nemotron-4B, qwopus-4B fast-narration-stop even when freshly loaded (not a degradation artifact), while 3.8B-phi (◑), 8B (✅), 14B (◑) drive + persist the chain. So the chaining capability emerges around ~the phi-4-mini/qwen3-8b class; below it, narration dominates and the constrained rung can't force a schema the tiny model won't honor. The ≤4B tier is where the §5.AA controller (or a GGUF format that tool-calls better — the recommended A/B) must earn its keep, or these stay a recorded floor.

### 2026-06-29 · **≤4B chaining floor — confirmed after the full §5.AA robustness layer** · `model-lab` (autonomous) · _(Low Power)_
> After wiring the complete robustness layer — constrained-decoding rung, all three narration-dialect recoveries (`<tool_call>`/Phi/DeepSeek markers · gemma `tool_code` · plain-prose `Tool call:` · tool-validated markerless `{"tool","parameters"}`), and the controller **evidence-gate** (don't accept a premature "done" while an instruction-named tool is uncalled) — the ≤4B models STILL fail the e2e multi-tool chain.

| model | e2e | why the layers don't lift it |
|---|:-:|---|
| nvidia/nemotron-3-nano-4b (4B) | ❌ | **stochastic across dialects within one model** — run A: well-formed `{"tool",…}` JSON (recoverable); run B: bare `"tool":"X"` fragments with no `{}` (not an object → unrecoverable); run C: pure prose "I've completed all steps". The evidence-gate fires (1 nudge) but nemotron re-narrates/repeats → the loop's dedup-force-final ends it. It can't drive the chain even when told it isn't done. |
| google/gemma-4-e2b (2B) · qwopus3.5-4b (4B) | ❌ | same class — narration-stop / can't sustain the chain |
> **Conclusion (honest, recorded):** the §5.AA robustness layer reliably lifts models that CAN follow a nudge/constraint — **qwen3-8b ✅, phi-4-mini + coder-14b ◑** drive the full chain + persist. But **≤4B multi-tool chaining is a genuine capability floor**: no recovery (the narration format is itself unstable run-to-run) and no evidence-gate nudge (the model won't act on it) forces a 2-4B model to drive a 4-step tool chain. This is the recorded `⚠️` floor, consistent with the tier roadmap (harden the small models on SINGLE-tool flows — where they pass ◑/✅ — and let the chain capability emerge at the ~8B class). Two minor follow-ups noted: the loop's all-repeats dedup-force-final path bypasses the evidence-gate (apply the gate there too); and a bare-`"tool":"X"`-fragment recovery is possible but low-value given the stochasticity. The lift work pays off from ~phi-4-mini/8B up — exactly where the next tier sweeps will focus.

### 2026-06-29 · **§5.AL capability gate live-verified + nemotron-3-nano reconfirmed (HIGH power)** · `model-lab` + chat-agent e2e
> Verified the new §5.AL model-capability gate end-to-end against live models, and folded a fresh empirical result into the catalog.
- **Gate refusal (live):** `model-lab load microsoft/phi-4-mini-reasoning` → REFUSED ("Refused by the model-capability gate: … TOOL_UNSUITABLE"), and the resident `nemotron-3-nano-4b` stayed loaded — the gate refuses BEFORE any unload, so a bad model never costs the resident good one.
- **Gate warn (live):** the `nklein chat` path printed `⚠️ Model capability warn: …` for the (then-uncatalogued) `nemotron-3-nano-4b` and proceeded — warn/unknown never wedges a run.
- **nemotron-3-nano-4b e2e (HIGH power, correcting any prior Low-Power assumption):** used `read_file` then DROPPED the chain — no `run_command`/`create_card`/`update_focus_chain`, card NOT persisted → single-tool only, multi-tool chain fails (the ≤4B floor again). **Folded into the catalog**: broadened the Nemotron-Nano matcher to `/nemotron(-\d+)?-nano/` (covers the `nemotron-3-nano` generation) with the live note, verdict TOOL_WEAK (basis: both).
> Takeaway: the catalog/gate now actively protect the load path + the chat use-path + task-start, and the "living artifact" loop works — a surfaced UNKNOWN model got a live capability check and a catalog entry in the same session.
