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

### 2026-06-29 · **qwen3-8b stochastic chaining — live positive+negative (HIGH power, fresh-loaded)** · chat-agent e2e
> Loaded `qwen/qwen3-8b` via the guarded runner (gate ALLOWED TOOL_NATIVE, auto-unloaded nemotron, ctx 40000, 111.9 GiB free). Two back-to-back e2e runs:
- **run 1: ❌ INCOMPLETE** — used `read_file` then NARRATED steps 2-4 as prose ("create_card(…) Output: Card created successfully") while only read_file actually executed; card did NOT persist. The §5.AA evidence-gate correctly refused the false "All steps completed" → INCOMPLETE (not a fake pass), but the layer couldn't force qwen to emit the real calls.
- **run 2: ✅ PASS** — drove read_file + run_command + create_card + update_focus_chain; card persisted.
> Conclusion: qwen3-8b multi-tool chaining is **stochastic even fresh-loaded** — the prior "✅ when fresh-loaded/spaced" note was too absolute; softened the catalog note accordingly. Key positive: the robustness layer's evidence-gate did its job (no false success on the narrated run). n=2, so judge qwen by a distribution of runs, not one.

### 2026-06-29 · **gemma-4 E4B + E2B verified — vendor "agentic/more-reliable" claim REFUTED at ≤4B (HIGH power)** · chat-agent e2e
> Verified the two `verified:false` catalog rows against live sweeps (each fresh-loaded via the guarded runner; gate allowed/​warned correctly).
- **google/gemma-4-e4b (4B): ❌ 3/3** — used read_file then dropped the chain every run (no run_command/create_card/focus-chain), card never persisted. The vendor docs' "native structured tool use / more reliable than E2B / agentic workflows" does NOT hold at 4B in our harness. **Catalog corrected: TOOL_CAPABLE → TOOL_WEAK (research→both, verified).**
- **google/gemma-4-e2b (2B): ❌ 2/2** — same single-tool-then-stop. Confirms TOOL_WEAK. **Marked verified.**
> Takeaway: the ≤4B multi-tool chaining floor holds across the gemma-4 edge line too — vendor tool-use marketing ≠ multi-step reliability at 2–4B. Both `verified:false` rows are now empirically settled. This is the living-artifact loop doing its job: a research-sourced optimistic verdict got corrected by a live sweep.

### 2026-06-29 · **qwopus3.6-27b-v2-mlx loaded as the capable-model-first driver** · single-tool probe
> Per the capable-model-first pivot (user 2026-06-29 — drive the backlog with a strong model), guarded-loaded
> `qwopus3.6-27b-v2-mlx` (8bit MLX, qwen3.6×opus merge) via `model-lab load … 40000`: auto-unloaded qwen3-8b, kept the
> embedder, **111.9 GiB free after load** (≥25% reserve). Catalog verdict was UNKNOWN→warn (proceeded).
- **Single-tool probe (`/v1/chat/completions`, one `create_card` tool): ✅** — `finish_reason=tool_calls`, correct
  name + args (`{"title":"Smoke test"}`), reasoning-capable (~186 reasoning tokens on a trivial call). **Folded into the
  catalog**: new `qwopus-merge` entry (`/qwopus/`, matched before the generic qwen rows), TOOL_CAPABLE, basis empirical.
- **Owed:** a full multi-tool CHAIN e2e (read_file→run_command→create_card→focus-chain) to promote TOOL_CAPABLE→TOOL_NATIVE.
> Takeaway: the driver tool-calls cleanly out of the gate; chaining strength (where the ≤4B floor lives) is the next check.

### 2026-06-29 · **qwopus3.6-27b-v2-mlx mid_task e2e — chains + completes real cards (first backlog-driver run)** · dev test-project
> First real agentic run on the capable-model-first driver (`dev test-project --preset mid_task --model-id
> qwopus3.6-27b-v2-mlx`, live runtime on :3484, ctx 40000).
- **Result:** `started:true` → decomposed the `habit-insights` project → **4 cards COMPLETED** (full tool chains:
  planning→…→completed), then **stagnant** (finalCounts: completed 4, planning 5, backlog 1, inProgress 0). Classified
  `success:false / stagnant` because the run idled with cards still in planning.
- **Telemetry:** NO `model_stalled`/`tool_argument_error` events for the driver this run (the only errors in the log are
  stale `qwen/qwen3-8b` reads from the prior session). So the stagnation is an **orchestration/scheduler idle** (planning
  cards not picked up within the window), **not a model stall** — the 27B drove + completed real multi-tool chains.
- **Verdict:** the driver is a working backlog driver (multi-tool chaining CONFIRMED via 4 real completions). Catalog stays
  TOOL_CAPABLE; promote→TOOL_NATIVE once a full decomposition reaches all-cards-terminal cleanly. **Open thread (separate
  from the model):** why mid_task goes stagnant with cards left in planning — a swarm-promotion/scheduler question to chase
  while punching the backlog, not a driver limitation.
> Cross-check plan (user 2026-06-29): free to pull OTHER catalog models for second opinions on issues/solutions — curious
> about the **35B MoE ornith** evals (`ornith-1.0-35b-mlx@8bit` / `qwen3.6-35b-a3b`) when a slot fits; focus stays on backlog.

### 2026-07-01 · **big-tier e2e sweep — 11 models, guarded loads on the m5** · `model-lab` + `verify-chat-agent-e2e` · _(HIGH power)_
> User-authorized full-ish sweep across the mid/large tier (4B → 122B), each **freshly loaded + sole-resident** via the
> `model-lab` guard (`load <key> 40000`: exclusive, unload-before-load, ctx 40000, ≥25% RAM reserve — every load reported
> **111.9 GiB free after load**, the guard never neared the floor). Same e2e capstone (read_file → run_command → create_card →
> update_focus_chain in one session). Driver at rest `qwopus3.6-27b-v2-mlx` restored at the end; the m4mini/legion pair untouched.
> **Headline: with the §5.AB force-advance wiring live, MOST models now drive the FULL 4-tool chain + PERSIST the card — SYNTHESIS
> (marker echo) is the differentiator.** ✅ = full synth (exit 0) · ◑ = chain+persist but weak synth (exit 3) · ❌/skip as noted.

| model | size | e2e | tools+persist | synth | wall | note |
|---|---|:-:|:-:|:-:|---:|---|
| nvidia/nemotron-3-nano-4b | 4B | ◑→⚠️ | **read only** | full-ish* | 54s | 🧱 the ONLY chain-dropper — single-tool, then FALSELY claims all 4 done. TOOL_WEAK/single_only reconfirmed |
| phi-4-mini-instruct@4bit | ~2B | ◑ | 4/4 ✅ | 🧩 weak | 5s | 🚀 fastest; a ~2B clearing the full chain (native, ⚠️ known-fragile — re-run to confirm) |
| google/gemma-4-e4b | 4B | ◑ | 4/4 ✅ | 🧩 weak | 37s | ⚠️ **CONTRADICTS** its TOOL_WEAK "fails chaining 3/3" — chained fully here (owed ×3 re-run) |
| qwopus3.5-9b-coder-mlx@8bit | 9B | ◑ | 4/4 ✅ | 🧩 weak | 67s | 9B-coder = weak synth (the 4B-coder got FULL) — size/variant nuance folded into the qwopus3.5-coder row |
| qwen/qwen2.5-coder-14b | 14B | ◑ | 4/4 ✅ | 🧩 weak | 45s | ✅ multi-tool chain confirmed (chaining caveat lifted); synth weak |
| mistralai/mistral-small-3.2 | 24B | ◑ | 4/4 ✅ | 🧩 weak | 21s | fastest 24B; native chain, weak synth |
| **mistralai/magistral-small-2509** | 24B | ✅ | 4/4 ✅ | 🚀 **full** | 54s | ⚠️ **CONTRADICTS** its TOOL_WEAK "empty tool_calls" — CLEAN PASS here (owed ×3 re-run) |
| **mistralai/devstral-small-2-2512** | 24B | ✅ | 4/4 ✅ | 🚀 **full** | 42s | ✅ confirms TOOL_NATIVE agentic-coder; clean pass + full synth |
| google/gemma-4-26b-a4b-qat | 26B MoE | ◑ | 4/4 ✅ | 🧩 weak | 34s | **NEW catalog entry** (TOOL_CAPABLE) — far stronger chaining than its e4b sibling |
| mlx-qwopus3.5-27b-v3 | 27B | ◑ | 4/4 ✅ | 🧩 weak | 301s | 🐢 MLX 27B latency outlier (vs the 26B-qat at 34s); chain ✓, synth weak |
| **qwen3.5-122b-a10b@4bit** | 122B MoE | ✅ | 4/4 ✅ | 🚀 **full** | 77s | 🚀 **strongest all-round** — native chain + full synth, healthy 77s (A10B active). **NEW high-tier entry** (was 9B-calibrated) |
| qwen3-14b | 14B | ⏳ | — | — | — | **queued** — resident on `davidlegion5pro`; loadable *there* via a device-targeted load (2026-07-01 correction: not "can't load", just not onto m5). Swept in the legion run below |
| ornith-1.0-35b-mlx@4bit | 35B | ❌ | — | — | — | 🐞 **LOAD-FAILED 3/3** (`lms load` exit 1 at ~2%, no diagnostic). NOT headroom (111.9 GiB free) — a broken/incompatible MLX checkpoint (@8bit sibling too). Guard behaved correctly; not forced |
> `*` nemotron echoed the marker but never ran steps 2-4 — narration, not execution (so not a real synthesis win).
>
> **Result: 11/11 loaded models fired the full 4-tool chain + persisted — EXCEPT nemotron-4B (single-tool).** That is a far
> stronger chaining picture than the older sweeps' "single-tool only" pattern: the **§5.AB force-advance controller carries most
> models through the chain in this harness**, so PASS-vs-◑ is decided almost entirely by the **final-synthesis (marker-echo)**
> criterion. **3 CLEAN PASSES (full synth): magistral-small-2509, devstral-small-2-2512, qwen3.5-122b-a10b** (a 24B reasoner,
> a 24B agentic-coder, and a 122B MoE reasoner — synthesis does NOT track size or reasoning-vs-code cleanly). **2 CONTRADICTIONS
> vs the catalog:** magistral (TOOL_WEAK→clean PASS) and gemma-4-e4b (TOOL_WEAK "fails chaining"→chained fully) — recorded as
> dated contradiction notes on their entries, **verdict held pending a ×3 re-run** (one run under a changed harness ≠ a lift).
> **1 load-fail:** ornith-1.0-35b MLX (broken artifact — now a reject-with-note so a future run won't retry blind). All loads
> **headroom-safe** (111.9 GiB free throughout) and the **driver was restored** at the end. Catalog folded (§5.AL): new rows
> qwen3.5-122b + gemma-4-26b + ornith-1.0-35b; fine-grained fields added to phi-4-mini/qwen2.5-coder/mistral-small/devstral/
> nemotron-nano; the qwopus3.5-coder row widened with the 9B/27B = weak-synth size nuance.

### 2026-07-01 · **FLEET sweep — m5max + m4mini + legion5pro, per-machine guarded loads** · `model-lab sweep verify-chat-agent-e2e` · _(HIGH power)_
> The first sweep across ALL THREE linked machines (user greenlit loading/unloading/sweeping everywhere, within safe limits).
> Enabled by the device-aware guard (commit 4d321820): `loadModelExclusive` now DEVICE-SCOPES the unload (an m5 load never
> evicts a legion/m4mini model) + takes a `--gpu` offload ratio. Device targeting is deterministic: device-unique keys
> auto-resolve to their machine; shared keys via `lms link set-preferred-device <id>` (m5max `579028ee…`, legion `040891f3…`,
> m4mini `2d30f46d…`). Baseline (driver `qwopus3.6-27b-v2-mlx` on m5 + nomic embedder on m4mini) restored at the end.
> GPU-offload + MoE-expert-CPU-offload research folded into [gpu-offload-and-moe.md](gpu-offload-and-moe.md).

| machine | model | size | e2e | wall | note |
|---|---|---|:-:|---:|---|
| **m5max** (128 GB UMA) | qwen/qwen3-coder-next | 80B MoE | ✅ PASS | 25s | full chain + persist + synth — top-tier driver candidate |
| m5max | openai/gpt-oss-120b | 120B MoE (5.1B act) | ✅ PASS | 22s | full synth, FAST — high-tier winner |
| m5max | gpt-oss-20b-mlx | 20B MoE (3.6B act) | ❌ 0/3 | 39–59s | chain-drop (read+cmd, no persist) — active-param floor |
| **m4mini** (24 GB) | qwen3.5-9b-mlx | 9B | ✅ PASS | 172s | @40k, device-targeted → m4mini; 24 GB hosts a 9B fine |
| m4mini | qwopus3.5-9b-coder-oq4-mtp | 9B | ⚠️ load-fail | — | MLX runtime rejects 29 `mtp.*` tensors (checkpoint/runtime incompat, NOT capacity) |
| **legion5pro** (8 GB VRAM + 32 GB RAM) | qwen2.5-coder-7b-instruct | 7B | ✅ PASS | 18s | fits 8 GB VRAM, fast |
| legion5pro | gemma-4-12b-it-qat | 12B | ✅ PASS | 21s | full synth, fast even on the 8 GB GPU |
| legion5pro | qwen3-14b | 14B | ❌ | 122s | chain-drop (n=1, provisional) |
| legion5pro | qwen3.6-27b | 27B | ❌ | 840s | SPEED-confounded (14 min, RAM-bound) — timeout artifact, not a ceiling |

> **Headline findings:**
> - **gpt-oss chaining tracks ACTIVE params, not total size:** the 120b (~5.1B active) drives the full 4-tool chain + full
>   synth; the 20b (~3.6B active) drops the chain 0/3 — the same ≤~4B-active floor seen in the small-model tier.
> - **≤12B runs GREAT on the Legion's 8 GB GPU** (coder-7b 18s, gemma-12b 21s, both full PASS); **14B/27B fail** — the 27B
>   purely SPEED-confounded (840s mostly-RAM-bound → INCOMPLETE, the known "too slow for a multi-turn chain in-window"
>   pattern), qwen3-14b a provisional n=1 chain-drop (verified:false, ×3 owed).
> - **m4mini (24 GB) hosts a 9B@40k cleanly** (qwen3.5-9b-mlx ✅ FULL PASS 172s incl. marker echo ⇒ qwen3.5 synthesis is
>   STOCHASTIC, full IS achievable). CORRECTED an earlier wrong "RAM-limited / embedder-only" read — the `-mtp` variant's
>   fail was an MLX-runtime tensor mismatch, NOT capacity (the ornith "load-fail ≠ incapable" lesson, again).
> - **Per-machine mechanics validated:** device-unique keys auto-resolve; the device-scoped unload keeps concurrency correct
>   across boxes; `--estimate-only` estimates against LOCAL m5 (not the target) ⇒ unreliable remote gate — LM Studio's
>   on-device guardrail is the real one (refused the m4mini mtp load safely, never froze).
> - **Apple Silicon = always `--gpu max`** (unified memory); the Legion is where `--gpu <ratio>` / MoE expert-offload matter.
>   Catalog folded (§5.AL): 6 new rows + qwen2.5-coder/qwen3.5 note updates (commit d8803b56).
SWEEP-ROW | 2026-07-02T07:01:25.060Z | fleet mid_task | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=PASS ✓ | power=high×1 — THE FIRST FULL FLEET PASS (run17; runs 9-17 converged 1→2→3→4→PASS via ten live-found fixes; see todo.md §5.0.5)
SWEEP-ROW | 2026-07-02T10:01:36Z | fleet mid_task run20 | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=PARTIAL (t1 COMPLETED live through fail-closed gate w/ mount fix; t2 escalate→park ladder exercised, root-caused: disposed-workspace re-drive; t3 starved by parked churn; run stopped early after harvest) | power=high×1
SWEEP-ROW | 2026-07-02T11:48:12Z | fleet mid_task run22 | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=PARTIAL (2 completed incl. FULL score-clamp delivery; bounce+escalation exercised; stalled on escalated 120B turn; phantom-running seed root-caused → #23 hard-abort) | power=high×1
SWEEP-ROW | 2026-07-02T12:45:06Z | fleet mid_task run23 | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=BEST-YET (3 completed, 4/4 work cards delivered result branches, #23 seed-idle verified; 'STALLED' verdict was a harness dead-stall FALSE POSITIVE — awaiting_review host-side capture killed mid-exec; ALIVE set fixed) | power=high×1
SWEEP-ROW | 2026-07-02T14:22:09Z | fleet mid_task run24 | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=PARKED-HONEST (score-clamp exhausted bounce→escalate→park with ZERO post-park churn — #16 verified live; dependents blocked on it; DEAD-STALL closed the run in 90s with no false positive — awaiting_review fix held; pre-shells prefix-reuse baseline confirmed 8%) | power=high×1
SWEEP-ROW | 2026-07-02T14:49:04Z | fleet mid_task run25 | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=SHELLS-VALIDATED (reuse 8%→57% cross-kind→74% same-kind→99.7% worker; ≥70% bar MET; 3 completed incl. fastest cycle ~2.5min; honest dead-stall on the REAL remaining strand: interrupted card with NO result branch has no rescue — fix next) | power=high×1
SWEEP-ROW | 2026-07-02T16:11:34Z | fleet mid_task run26 | architect=gptoss120-m5 worker=coder-gpu | decompose=YES | result=6/7 COMPLETED (best ever, 2× prior record; timeout not stall — last card grinding on v3-cpu; score-clamp CRACKED via the ladder; warmth+shells sustained 99.6-99.7% reuse on BOTH rails all run incl. reviews via kind-batching; 74% warm tier on interleave; plan gate armed but 7th card never landed) | power=high×1
SWEEP-ROW | 2026-07-02T17:49:09Z | fleet mid_task run27 | architect=gptoss120-m5 worker=coder-gpu maxConcurrent=1 | decompose=YES | result=DEAD-STALL 90s (HONEST — found #25: concurrency-deferred root never retried when no sibling completes; rail-mode measurement blocked on it, fixed, rerun as run28) | power=high×1
SWEEP-ROW | 2026-07-02T18:14:23Z | fleet mid_task run28 | architect=gptoss120-m5 worker=coder-gpu maxConcurrent=1 | decompose=YES | result=5/6 in ~21min RAIL MODE (vs run26 4-in-24min @2-parallel: rails FASTER on warm fast models, slow-model card serializes — the fan-out trade-off measured; final card stranded by #26: event-only deferral rescue has no post-last-completion retry → timer sweep added) | power=high×1
SWEEP-ROW | 2026-07-02T18:53:44Z | fleet mid_task run29 | architect=gptoss120-m5 worker=coder-gpu maxConcurrent=1 | decompose=YES | result=STALLED-900s (2 completed; 🎉 RE-DECOMPOSE RUNG FIRED LIVE — backlog redecompose card spawned; NEW stall variant: a post-park(?) session stuck awaiting_review w/ captured patch 15min, review never concluded — awaiting_review counts alive so dead-stall correctly deferred to the general window; home preserved for autopsy: /var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/T/nklein-fleet-home-WOdGqc) | power=high×1
SWEEP-ROW | 2026-07-10T17:59:00Z | eval-harness qwen/qwen3.6-27b (m5max, 4 repeats/cell, persisted) | result=PASS mean 0.854/32 cells — tool_use 12/12 🚀 (incl. irrelevance, settled); decompose easy+medium settled 1.0, HARD ×4 NO-ANSWER at the 300s cap 🐢 (low-power timeout, unscored — re-run on high power); reviewer recall settled-weak 🐞 (medium 0.5, hard 0.33, spread 0 — deterministic misses of subtle defects; avoid for reviewer role or pair with lenses). Fitness persisted; catalog row flipped verified:true | power=low×2
SWEEP-ROW | 2026-07-11T09:42:21Z | chat-agent-tools single-read probe (m5max, §11 sweep increment, low-power) | qwen2.5-coder-7b-instruct (~4.7GB, non-MLX) | result=PARTIAL — CALLED read_file (audited ✓) but answered "Done." = WEAK synth (contradicts the 2026-07-01 MLX-laptop full-synth clean-pass; catalog note updated, synthesis:full HELD at n=1) | power=low×1
SWEEP-ROW | 2026-07-11T09:42:21Z | chat-agent-tools single-read probe (m5max, §11 sweep increment, low-power) | nvidia/nemotron-3-nano-4b (~2.8GB) | result=PASS — called read_file + FULLY answered from it (single-tool synth ✓; consistent w/ catalog TOOL_WEAK/single_only — its weakness is MULTI-tool chaining, not single-tool synth) | power=low×1
SWEEP-ROW | 2026-07-11T09:42:21Z | chat-agent-tools single-read probe (m5max, §11 sweep increment, low-power) | google/gemma-4-e2b (~4.4GB) | result=PARTIAL — CALLED read_file (audited ✓) but answered "Done." = WEAK synth (CONFIRMS catalog TOOL_WEAK/verified:true; the ≤4B 'Done.' abbreviation) | power=low×1
SWEEP-ROW | 2026-07-11T09:47:09Z | chat-agent-tools single-read probe (m5max, §11 sweep increment, low-power) | phi-4-mini-instruct@4bit (~2.4GB) | result=PASS — called read_file + fully answered (CONFIRMS catalog TOOL_CAPABLE; contrast w/ its verified-negative phi-4-mini-REASONING sibling) | power=low×1
SWEEP-ROW | 2026-07-11T09:47:09Z | chat-agent-tools single-read probe (m5max, §11 sweep increment, low-power) | qwen3-0.6b-mlx (~0.4GB, was UNCATALOGUED) | result=PASS — the 0.6B FLOOR cleanly called read_file + FULL synth (echoed the secret). Single-tool synth is family/tuning-gated, not size-gated. New catalog entry added (TOOL_WEAK/single_only; multi-tool untested/expected-fail at 0.6B) | power=low×1
SWEEP-ROW | 2026-07-11T09:52:56Z | eval-harness qwen/qwen3-8b (m5max, native_tool_call, 12 cells, low-power) | result=PASS mean 0.931/12 — architect/decompose 1.000 (all 3 tiers, ~10.7s) 🚀 + worker/tool-use+context 1.000 (2k/8k/24k) 🚀; reviewer quality 0.722/reliability 0.667 🐞 (medium 0.5, hard 0.667 — misses subtle null/race defects, same small-model reviewer ceiling as coder-14b/qwopus-9b). TOP decompose+worker, WEAK reviewer. Catalog note updated. | power=low×1
SWEEP-ROW | 2026-07-11T09:56:32Z | eval-harness qwen2.5-coder-7b-instruct (m5max, native_tool_call, 12 cells, low-power) | result=PARTIAL-GRADED mean 0.764/12 — architect/decompose 1.000 (all 3 tiers, ~4.5s, MATCHES coder-14b 🚀) but worker/tool-use 0.667 (tooluse-simple-weather + multi-select BOTH 0.000 🐞, irrelevance+context-probes 1.0) + reviewer 0.722. CORROBORATES the single-tool 'Done.' finding: TOP decomposer, UNRELIABLE tool-worker. synthesis:full now optimistic on 2 low-power signals. | power=low×1
SWEEP-BATCH | 2026-07-11T10:13:11Z | chat-agent-tools single-read probe (m5max, HIGH power, §11 uncatalogued sweep, unload-by-resolved-id one-at-a-time) | PASS(call+synth)=ornith-1.0-9b(@q4_k_m), qwable-9b-claude-fable-5-mlx 🌟(fable-tuned), qwen/qwen3.6-35b-a3b(MoE), qwen/qwq-32b(reasoning — passes single-tool on high power), ravenx-...-35b-a3b-pentester-mlx(69GB), nvidia/nemotron-3-super(86GB) · PARTIAL(call,no-synth)=qwable-3.6-27b · FAIL/no-call=zai-org/glm-4.7-flash(32GB — did NOT emit a tool call; likely a GLM tool-dialect/template mismatch, needs a dialect probe before routing work). Skipped: deepseek-v4-flash-dq(96.5GB breaks 25% headroom), ornith/qwen3.6-35b-a3b quant dups. GOTCHA: a key resolving to a quant (@q4_k_m) has instance_id≠key — target+unload by the RESOLVED id (ornith first read FAIL as a targeting artifact, is actually PASS). | power=high×1
SWEEP-ROW | 2026-07-11T10:31:50Z | eval-harness qwen/qwen3.6-35b-a3b (m5max HIGH power, native_tool_call, 12 cells) | result=PASS mean 0.955/11 — worker/tool-use 1.0, decompose 1.0 med+hard (easy NO-ANSWER = reasoning over-think), REVIEWER 0.833 🌟 (caught the hard race/leak/injection trio — a real upgrade over qwen3.6-27b base 0.333 and the ~0.72 small-model ceiling; the STRONGEST reviewer swept). Slow (~40s decompose, ~25s review). New catalog entry added. | power=high×1
SWEEP-ROW | 2026-07-11T10:31:50Z | eval-harness qwable-9b-claude-fable-5-mlx (m5max HIGH power) | result=INCONCLUSIVE — single-tool chat-tools PASS (call+synth) but the full 12-cell eval-harness exceeded 10min wall (reasoning-heavy for a 9B); needs a reduced-cell or longer-budget re-run to score. | power=high×1
SWEEP-ROW | 2026-07-11T10:57:35Z | eval-harness qwen/qwq-32b (m5max HIGH power, native_tool_call, 12 cells, bg) | result=PASS mean 0.955/11 — reviewer 0.833 🌟 (caught the hard trio, ties qwen3.6-35b-a3b), decompose 1.0 easy+hard (medium NO-ANSWER over-think), worker 1.0 — BUT PROHIBITIVELY SLOW 🐢🐢: 191-272s/decompose cell, ~22min total eval even on HIGH power. Same quality as qwen3.6-35b-a3b at 4-6x latency → PREFER the 35b-a3b for reviewer. New catalog entry. | power=high×1
SWEEP-ROW | 2026-07-11T11:19:56Z | eval-harness qwable-9b-claude-fable-5-mlx (m5max HIGH power, native_tool_call, 12 cells, bg) | result=PASS mean 0.931/12 — David's fable merge: DECOMPOSE 1.0 all 3 tiers 🚀 + worker/tool-use 1.0, reviewer 0.722 (the ceiling). RELIABILITY STANDOUT: scored ALL 12 cells, ZERO no-answers (vs qwq-32b/35b-a3b over-thinking timeouts). Solid reliable decompose+worker all-rounder at 9B, weak reviewer. New catalog entry. | power=high×1
SWEEP-ROW | 2026-07-11T11:26:10Z | eval-harness ornith-1.0-9b@q4_k_m (m5max HIGH power, native_tool_call, 12 cells, bg) | result=PASS mean 0.931/12 — decompose 1.0 all 3 tiers + worker 1.0, reviewer 0.722 (ceiling). FASTEST 0.931-tier: ~8-13s/decompose cell, WHOLE eval ~3min (vs qwable ~19min, qwq ~22min), zero no-answers. Fast reliable decompose+worker all-rounder (the 9B ornith LOADS fine, unlike the load-failing 35B). New catalog entry. | power=high×1
SWEEP-ROW | 2026-07-11T11:31:46Z | eval-harness nvidia/nemotron-3-nano-4b (m5max HIGH power, native_tool_call, 12 cells, bg) | result=PASS mean 0.875/12 — ⭐ decompose 1.0 all tiers + REVIEWER 0.833 (CAUGHT the hard race/leak/injection trio — matches 35b-a3b/qwq, BEATS every 7-9B qwen-family @0.667). KEY: reviewer ceiling is TRAINING-gated not size-gated. FASTEST eval ~90s (~10s/review cell). Blemish: worker context-8k 0.000 (non-monotonic glitch). A viable FAST single-call reviewer; never route multi-tool chains to it. Catalog note updated. | power=high×1
SWEEP-ROW | 2026-07-11T11:47:22Z | eval-harness qwen/qwen3.6-27b (m5max HIGH power, native_tool_call, 12 cells, bg) — CAVEAT RESOLVER | result=mean 0.894/11 — RESOLVES the low-power hard-decompose "timeout": at HIGH power the hard cell finished in 121s (under cap) yet still NO ANSWER 🐞 = a GENUINE 27b-base ceiling, not latency. Reviewer 0.611/0.333 CONFIRMED real (hard trio 0.333). Intra-family split: 27b base reviews 0.333 vs 35b-a3b MoE 0.833 → route qwen3.6 review to the MoE, not the base. Catalog caveat closed. | power=high×1
SWEEP-ROW | 2026-07-11T11:58:22Z | eval-harness nvidia/nemotron-3-super (86GB, m5max HIGH power, native_tool_call, 12 cells, bg) | result=PASS mean 0.958/12 = HIGHEST of the sweep 🚀 — decompose 1.0 all tiers, worker 1.0, REVIEWER 0.833 (hard trio caught). CONFIRMS the nemotron-reviews-well pattern AT SCALE (nano-4b + super both 0.833 → training-gated family trait, robust 4B→super). Efficient (~6min eval). But 86GB = impractical routine reviewer vs the 2.8GB nano at the same 0.833. New catalog entry. | power=high×1
SWEEP-ROW | 2026-07-11T12:07:31Z | eval-harness ravenx-…-pentester-bughunter (69GB qwen3.6-35b-a3b merge, m5max HIGH power, bg) | result=mean 0.833/9 — HYPOTHESIS REFUTED + finding: STRICTLY WORSE than its base. DECOMPOSE BROKEN (all 3 tiers NO ANSWER 🐞 — the heavy merge disrupted the structured decompose call; base=1.0), reviewer 0.833 = IDENTICAL to base (pentester tuning added nothing), worker 0.833 (weather 0.000). Lesson: heavy capability merges DEGRADE structured-output without helping the target skill — prefer the clean base. New catalog entry (placed BEFORE the base row to avoid shadowing — the ravenx id contains "qwen3.6-35b-a3b"). | power=high×1
SWEEP-ROW | 2026-07-11T12:21:20Z | eval-harness qwen/qwen2.5-coder-14b HIGH-POWER REFRESH (m5max, json_schema, 12 cells, bg) | result=mean 0.879/11 — CONFIRMS the low-power verdict on high power: decompose 1.0 all tiers + worker tool-use 1.0, reviewer 0.556 REAL not power-masked (medium 0.000, hard 0.667). NEW: 24k-context worker probe NO-ANSWER at the 301s cap even high power (slow on long context). Top decomposer, weak reviewer stands. | power=high×1
SWEEP-ROW | 2026-07-11T12:29:00Z | eval-harness qwopus3.5-9b-coder-mlx@4bit HIGH-POWER (m5max, native_tool_call, bg) | result=mean 0.917/10 but QUANT-SENSITIVE 🐞: the @4bit UNDERPERFORMED the @8bit settled data — reviewer 0.722 (hard 0.667, did NOT catch the trio = plain ceiling, not the @8bit's 0.833), decompose medium+hard NO ANSWER (only easy landed), worker 1.0. Likely a 4bit-quality drop (n=1). PREFER @8bit for this model's reviewer/decompose roles. Catalog + synthesis softened. | power=high×1
SWEEP-ROW | 2026-07-11T12:33:07Z | eval-harness phi-4-mini-instruct@8bit HIGH-POWER REFRESH (m5max, json_schema, 12 cells, bg) | result=PASS mean 0.958/12 = TIES nemotron-super for HIGHEST, at 3.8B + ~1min TOTAL (2s/decompose, sub-second tool-use = FASTEST high-quality) 🚀🚀. decompose 1.0, worker 1.0, REVIEWER 0.833 (hard trio CAUGHT). KEY: a PLAIN INSTRUCT 3.8B out-reviews every 7-14B qwen instruct/coder → review recall is MODEL-SPECIFIC, not reasoning-depth/size-gated. Arguably the BEST all-round small pick. Catalog + synthesis updated. | power=high×1
SWEEP-ROW | 2026-07-11T12:38:44Z | eval-harness openai/gpt-oss-120b (63GB MoE, m5max HIGH power, first fitness scores, bg) | result=PASS mean 0.875/12 — decompose 1.0 all tiers (fast ~5s/cell, ~5B active MoE) + REVIEWER 0.833 (hard trio caught) = another NON-qwen model breaking the reviewer ceiling (confirms model-specific review recall). Worker context-8k 0.000 = SAME glitch as nemotron-nano (2k+24k pass) → likely a harness artifact at 8k. Good reviewer but 63GB (impractical vs phi-4-mini @3.8GB same 0.833). | power=high×1
HARNESS-FIX | 2026-07-11T12:46:10Z | 🔧 scoreContextProbeAnswer separator-canonicalization (src/core/eval-prompt-corpus.ts) | ROOT-CAUSED a real mis-score found mid-sweep: nemotron-nano + gpt-oss-120b scored 0.000 on context-probe-8k while 2k+24k passed. Live-captured nemotron-nano's raw answer = "amber‑falcon‑92" with NON-BREAKING hyphens (U+2011) — a CORRECT retrieval the exact-substring scorer rejected. Fix canonicalizes whitespace/underscore/regular-hyphen/Unicode-dashes to "-" before matching (plain tokens unaffected, no false positives; 8/8 cases + new unit test). CONSEQUENCE: both models' worker fitness is actually 1.0 (not 0.833) → true mean ~0.958, so nemotron-nano-4b is TOP-TIER. | power=n/a
SWEEP-ROW | 2026-07-11T12:51:10Z | eval-harness gpt-oss-20b-mlx (22GB MoE, m5max HIGH power, 12 cells, bg) | result=PASS mean 0.958/12 — CORRECTS the TOOL_WEAK verdict's scope: decompose 1.0 + worker 1.0 (context-8k now passes = harness fix confirmed) + REVIEWER 0.833 (hard trio caught). Same shape as nemotron-nano: chain-weak (multi-tool e2e 0/3) but single-call-STRONG. Viable fast decompose/review/single-tool-worker; never a multi-tool chainer. | power=high×1
