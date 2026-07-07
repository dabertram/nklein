# Cross-model verification matrix

> Every LLM-interactive !Klein flow, verified across **all loaded local models** (the [§5.Z](../todo.md) requirement).
> Rows = flows (each backed by a `scripts/verify-*.mts` / `sweep-capture.mts` harness); columns = the loaded roster.
> Cells: `✅` PASS · `◑` PARTIAL (the capability works but the harness's strict proof — e.g. echoing output in the
> reply — isn't met) · `❌` FAIL → harden · `⚠️` CANT (capability floor) · `🎲` flaky · `💥` DROPPED (crashed mid-run) ·
> `·` not yet run.
>
> **Time series:** this file is the *aggregate* matrix (latest result per flow×model). The chronological **per-run**
> history — one table per sweep, scroll top→bottom to watch each model evolve over time/difficulty — is in
> [model-sweep-log.md](model-sweep-log.md) (keep both in sync; the sweep log also tracks newly-appeared + unloaded models).
>
> **Crash caveat:** `deepseek` may vanish mid-run — record `💥` and move on, never block the sweep.
> **Restore:** every run restores the user's selected model afterward.
> **FAIL vs CANT:** a malformed-output / parse gap is `❌` (a !Klein hardening task, §5.O parse-and-recover); a model
> that simply isn't capable enough is `⚠️` (a recorded capability-floor data point, not a bug).

## Roster (2026-06-26)

| # | model | size | notes |
|---|---|---|---|
| 1 | `qwen/qwen3-8b` | 4.62 GB | north-star small |
| 2 | `qwen/qwen2.5-coder-14b` | 8.33 GB | coder |
| 3 | `qwen3.5-9b-mlx` | 5.98 GB | |
| 4 | `google/gemma-4-e2b` | 4.37 GB | 2B |
| 5 | `google/gemma-4-e4b` | 6.86 GB | |
| 6 | `microsoft/phi-4-mini-reasoning` | 2.18 GB | reasoning, 3.8B |
| 7 | `microsoft/phi-4-reasoning-plus` | 8.26 GB | reasoning |
| 8 | `nvidia/nemotron-3-nano-4b` | 2.84 GB | |
| 9 | `deepseek-r1-0528-qwen3-8b-mlx` | 8.71 GB | ⚠️ crash-prone |
| E | `text-embedding-nomic-embed-text-v1.5@q8_0` | 146 MB | embedder |

## Matrix

| flow / harness | qwen3-8b | coder-14b | qwen3.5-9b | gemma-e2b | gemma-e4b | phi4-mini | phi4-plus | nemotron | deepseek |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| decompose · `verify-decompose-isolation` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| single-card · `verify-task-completion` | ✅ | ✅ | ⚠️§§ | ✅ | ✅ | ◑§§ | ✅ | ✅ | ✅ |
| auto-promote · `verify-autopromote-recovery` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| strict-isolation · `verify-strict-isolation` | ✅ | ✅ | ✅ | ✅ | · | ✅ | · | ✅ | · |
| restart-resume · `verify-restart-resume-isolation` | ✅ | ✅ | ✅ | ✅ | · | ✅ | · | ✅ | · |
| chat run_command‡ · `verify-chat-command-exec` | ✅ | ✅ | ◑ | ◑ | ◑ | ✅* | ❌ | ✅ | ◑ |
| chat create_card · `verify-chat-create-card` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* | ❌ | ✅ | ✅ |
| chat browse_url · `verify-chat-browse` | ✅ | ◑ | ◑ | ◑ | · | · | · | ◑ | · |
| chat e2e capstone† · `verify-chat-agent-e2e` | ✅ | ◑ | ❌ | ❌ | · | ◑ | · | ❌ | · |
| chat read tools · `verify-chat-agent-tools` | ✅ | ✅ | ◑ | ◑ | · | ◑ | · | ◑ | · |
| chat write tool · `verify-chat-agent-write` | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | · |
| chat send · `verify-chat-send` | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | · |
| chat runtime · `verify-chat-runtime` | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | · |
| autonomous run · `verify-chat-autonomous-live` | ✅ | · | · | · | · | · | · | · | · |
| multi-card pipeline · `verify-multi-card-pipeline` | ✅ | · | · | · | · | · | · | · | · |
| output robustness · `sweep-capture` | ✅ | ✅ | ◑ | ✅ | ✅ | ⚠️ | · | ✅ | · |

> **†** The `verify-chat-agent-e2e` capstone asks for **4 specific tools in ONE turn** (read → run_command →
> create_card → update_focus_chain). **Full loaded-roster sweep 2026-06-28 = 0/8 — a hard multi-tool-CHAIN wall**
> (even qwen3-8b + coder-14b ❌). Root cause is consistent **chain-fatigue narration**: models do the FIRST calls for
> real (read + command → marker echoes back), then NARRATE the later steps (`create_card`, `update_focus_chain`) in
> prose/pseudo-code instead of calling them, so the board stays empty. Narration dialect varies run-to-run (qwen prose;
> gemma alternates `tool_code = create_card(…)` ↔ markerless `"tool_name":…` JSON), which is why earlier single runs
> looked flaky (`🎲`). **§5.AA constrained-decoding rung now WIRED (2026-06-28)** — `createChatAgentModel` forces a
> parseable `{tool,arguments}` call when a turn names a tool but emits none. Re-sweep result: **coder-14b ❌→◑ and
> phi-4-mini ❌→◑** — both drove the full/near-full tool chain AND **persisted the card** (only the strict marker-echo
> reply-quality gate keeps them from ✅). **The capstone is now a GRADED gate (2026-06-28): ✅ = chain executed + card
> persisted + marker echoed · ◑ = chain executed + card persisted, reply didn't echo (real capability, weak synthesis) ·
> ❌ = chain didn't run.** A paced ×4 characterization had **phi-4-mini + qwopus-4b persist 4/4** and coder-14b persist
> standalone — so the lift is real but **stochastic + run-dependent**, and **consecutive (back-to-back) runs degrade
> weaker models** (a full back-to-back sweep shows only the most-robust 2 as ◑; the rest fast-narration-stop). Mitigation:
> `NKLEIN_SWEEP_SPACING_MS` spaces runs so a sweep measures capability, not consecutive-load fatigue. The deeper lift for
> the models that still stop after `read_file` is the **§5.AA finite-state controller** (evidence-gated completion + the
> constrained rung firing per step) — its substrate is built; driving the full loop through it is the remaining wiring.
> It is **not a reliable per-model gate**; per-model chat capability is proven by the **individual** `run_command` /
> `create_card` / `browse_url` / `read`/`write`/`send`/`runtime` rows (deterministic single-tool checks, all ✅/◑).
>
> **‡** `run_command` — the **command genuinely EXECUTES at runtime for 7/9** (✅ + ◑). `◑` = the command ran (the
> agent called `run_command`, it executed) but the model's *reply* didn't echo the output (weak synthesis), so the
> harness's strict marker-echo gate isn't met — the runtime-execution capability the user cares about works; the reply
> quality is the model's weakness, not a !Klein bug. `❌` (phi-4-mini, phi-4-reasoning-plus) = the model never emitted a
> tool call. **(Footnote corrected 2026-06-28 — the earlier "chat path has no narrated-recovery" claim is now STALE):**
> the chat path (`completeWithTools`, [nklein-local-llm-client.ts:381](../src/nklein-agent/nklein-local-llm-client.ts#L381))
> **now mirrors the swarm's `recoverNarratedToolCalls`** — when a model offered tools returns no native `tool_calls`, it
> runs `parseNarratedToolCalls` over both `content` AND `reasoning_content` (todo §5.O, DONE 2026-06-26). So a model that
> *narrates* its call IS recovered on the chat path too. The remaining ❌ (phi-4-reasoning-plus) is a capability issue —
> it over-reasons and emits **no** tool call at all (nothing to recover), needing the next ladder rungs (prompt
> simplification / reason-then-act / native `/api/v1/chat`), not a missing-recovery gap.
>
> **`*`** **phi-4-mini FLIPPED `❌`→`✅`** on BOTH chat tools after the §5.AA tool-set-reduction wiring landed
> (`b4fc2522`): when the model returns no tool call with many tools offered, the chat adapter retries with only the
> tool the instruction references — grounded in the diag that phi emits a clean structured call with 1 tool but drowns
> with 6. run_command 34s + create_card 14s, both with the real side effect. **phi-4-reasoning-plus is still `❌`** —
> it over-reasons and won't act even with 1 tool, so it needs the next ladder rungs (prompt simplification / native
> `/api/v1/chat` endpoint iteration). The 7 already-passing models are unaffected (the retry only fires on a no-call).

> **§§ delivery-gated re-validation (2026-06-28, Low Power, LOADED models only):** the `single-card` harness now requires
> the card to reach a terminal lane **AND deliver the correct artifact** (was terminal-state only). Re-validated: the 6
> loaded strong/mid models genuinely deliver (✅); **`phi-4-mini` is ◑ not ✅** — it reaches `awaiting_review` but delivers
> nothing (declared done without writing the file; §5.AA reason-then-act); **`qwen3.5-9b` ⚠️ is a finalization STALL**
> (`running`→`interrupted`, no output; §5.AA transient-retry). The not-currently-loaded columns (gemma-e4b, phi4-plus,
> deepseek) keep their earlier terminal-only marks pending a delivery-gated re-run when loaded. Per-run detail +
> the full delivery-gated C0/C1/C2 ladder: [model-sweep-log.md](model-sweep-log.md).

## Run log

> Newest first. Each entry: date · flow · model · result · note.

- _(2026-06-28)_ **single-card RELIABILITY sweeps (idle-LLM repeats, §5.0.3 "never idle the LLMs"):**
  `verify-task-completion` repeated back-to-back — **qwen3-8b 7/8 (~88%)** across two sweeps (one run ended `interrupted`,
  a §5.AA transient, not a wrong result; it did not reproduce in 3 further runs), **qwen2.5-coder-14b 3/3**. Confirms the
  `single-card` ✅ cells are robust under repeat load; the lone transient is the §5.AA `aborted`/`interrupted`-class
  (finalization watchdog + transient-retry rung is the lift, not a model ceiling). Reliability tracked in the challenge
  catalog ([milestone-challenges.md](milestone-challenges.md) C0 row).
- _(2026-06-26)_ matrix scaffolded from prior single-model proofs; cross-model sweep starting per §5.Z.

### 2026-06-26 18:54:12 · verify-decompose-isolation
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 25s · PASS ✓ no host path leaked into the agent's output during a real decompose.
  - matrix row: qwen3-8b-m5max=✅

### 2026-06-26 19:08:55 · verify-decompose-isolation
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 24s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 47s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 18s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `google/gemma-4-e4b-m5max` · 43s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 27s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `deepseek-r1-0528-qwen3-8b-mlx-m5max` · 243s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 242s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 24s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `microsoft/phi-4-reasoning-plus-m5max` · 167s · PASS ✓ no host path leaked into the agent's output during a real decompose.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ gemma-4-e4b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ deepseek-r1-0528-qwen3-8b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ phi-4-reasoning-plus-m5max=✅

### 2026-06-26 19:27:14 · verify-task-completion
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 18s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 26s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 12s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
- ✅ **PASS** · `google/gemma-4-e4b-m5max` · 10s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 302s · INCOMPLETE — the card did not reach awaiting_review/completed within the timeout (see activities).
- ✅ **PASS** · `deepseek-r1-0528-qwen3-8b-mlx-m5max` · 82s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 10s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 302s · INCOMPLETE — the card did not reach awaiting_review/completed within the timeout (see activities).
- ✅ **PASS** · `microsoft/phi-4-reasoning-plus-m5max` · 226s · PASS ✓ a small local model ran the card to a terminal state (awaiting_review/completed) with its result captured.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ gemma-4-e4b-m5max=✅ qwen3.5-9b-mlx-m5max=❌ deepseek-r1-0528-qwen3-8b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=❌ phi-4-reasoning-plus-m5max=✅

### 2026-06-26 19:46:02 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 55s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 44s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 31s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e4b-m5max` · 32s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 11s · INCOMPLETE — see above.
- ❌ **FAIL** · `deepseek-r1-0528-qwen3-8b-mlx-m5max` · 54s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 9s · INCOMPLETE — see above.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 7s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-reasoning-plus-m5max` · 23s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=❌ qwen2.5-coder-14b-m5max=❌ gemma-4-e2b-m5max=❌ gemma-4-e4b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ deepseek-r1-0528-qwen3-8b-mlx-m5max=❌ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=❌ phi-4-reasoning-plus-m5max=❌

### 2026-06-26 19:54:29 · verify-chat-command-exec
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 13s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 6s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 7s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e4b-m5max` · 6s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 7s · INCOMPLETE — see above.
- ❌ **FAIL** · `deepseek-r1-0528-qwen3-8b-mlx-m5max` · 25s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 8s · INCOMPLETE — see above.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 5s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `microsoft/phi-4-reasoning-plus-m5max` · 20s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=❌ gemma-4-e4b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ deepseek-r1-0528-qwen3-8b-mlx-m5max=❌ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=✅ phi-4-reasoning-plus-m5max=❌

### 2026-06-26 20:02:26 · verify-chat-create-card
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 11s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 5s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 7s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `google/gemma-4-e4b-m5max` · 7s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 8s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `deepseek-r1-0528-qwen3-8b-mlx-m5max` · 16s · PASS ✓ the chat agent created a real board card at runtime.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 8s · INCOMPLETE — see above.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 6s · PASS ✓ the chat agent created a real board card at runtime.
- ❌ **FAIL** · `microsoft/phi-4-reasoning-plus-m5max` · 20s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ gemma-4-e4b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ deepseek-r1-0528-qwen3-8b-mlx-m5max=✅ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=✅ phi-4-reasoning-plus-m5max=❌

### 2026-06-26 20:14:26 · verify-autopromote-recovery
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 16s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 17s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 6s · PASS ✓ the lane advanced to In Progress (via begin_implementation; recovery seam wired + idempotent).
- ✅ **PASS** · `google/gemma-4-e4b-m5max` · 8s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 12s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `deepseek-r1-0528-qwen3-8b-mlx-m5max` · 19s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 304s · INCOMPLETE — see above.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 11s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `microsoft/phi-4-reasoning-plus-m5max` · 190s · PASS ✓ the lane advanced to In Progress (via begin_implementation; recovery seam wired + idempotent).
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ gemma-4-e4b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ deepseek-r1-0528-qwen3-8b-mlx-m5max=✅ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=✅ phi-4-reasoning-plus-m5max=✅

### 2026-06-26 20:18:50 · verify-chat-create-card
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 8s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-reasoning-plus-m5max` · 20s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌ phi-4-reasoning-plus-m5max=❌

### 2026-06-26 20:51:53 · verify-chat-create-card
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 14s · PASS ✓ the chat agent created a real board card at runtime.
- ❌ **FAIL** · `microsoft/phi-4-reasoning-plus-m5max` · 56s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=✅ phi-4-reasoning-plus-m5max=❌

### 2026-06-26 20:53:48 · verify-chat-command-exec
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 34s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `microsoft/phi-4-reasoning-plus-m5max` · 55s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=✅ phi-4-reasoning-plus-m5max=❌

### 2026-06-28 01:56:38 · verify-full-system
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 87s · PASS ✓ the real stack ran a small model to a terminal state AND the generated result is VALID (cap bug fixed).
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 63s · PASS ✓ the real stack ran a small model to a terminal state AND the generated result is VALID (cap bug fixed).
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 93s · PASS ✓ the real stack ran a small model to a terminal state AND the generated result is VALID (cap bug fixed).
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 109s · PASS ✓ the real stack ran a small model to a terminal state AND the generated result is VALID (cap bug fixed).
- ⏱ **TIMEOUT** · `microsoft/phi-4-mini-reasoning` · 626s · INCOMPLETE — the card did not reach a terminal state within the timeout.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 88s · PASS ✓ the real stack ran a small model to a terminal state AND the generated result is VALID (cap bug fixed).
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 241s · PARTIAL — reached a terminal state but the generated result is INVALID (see oracle).
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 306s · INCOMPLETE — the card did not reach a terminal state within the timeout.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=⏱ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 03:16:06 · verify-decompose-isolation
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 27s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 56s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 16s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 21s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 843s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 22s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 843s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 312s · Docker sandbox available ✓
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=❌

### 2026-06-28 03:24:08 · verify-chat-command-exec
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 16s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 6s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 5s · INCOMPLETE — see above.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 6s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 33s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 5s · INCOMPLETE — see above.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 7s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 6s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=❌

### 2026-06-28 · verify-strict-isolation (manual sweep, current HEAD)
Strict Docker isolation invariant (#2) on a real task — sandbox container appears, NO host worktree, containers cleaned up — swept across the loaded roster. **8/8 PASS.** Note: every model ended the task in `interrupted` (the harness asserts isolation, not completion, and uses a short task; this also confirms the `interrupted`/no-output-abort terminal state is common — see §5.AA `aborted` classification).
- ✅ **PASS** · `qwen/qwen3-8b-m5max` (re-confirmed on HEAD)
- ✅ **PASS** · `google/gemma-4-e2b-m5max`
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max`
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max`
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max`
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` (not in the 9-col matrix)
- ✅ **PASS** · `ornith-1.0-9b-mlx` (not in the 9-col matrix)
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning`
  - matrix coverage: 6 of the 9 roster columns now ✅ (qwen3-8b, coder-14b, qwen3.5-9b, gemma-e2b, phi4-mini, nemotron). Remaining 3 (gemma-e4b, phi4-plus, deepseek) are NOT currently loaded in LM Studio — run when loaded. The `restart-resume` half of the §5.Z line is still qwen3-8b-only.

### 2026-06-28 · verify-restart-resume-isolation (manual sweep, current HEAD)
Restart/resume isolation — a task resumed after a simulated runtime restart re-preps its Docker sandbox with NO host leak. **6/6 PASS** across the loaded roster.
- ✅ **PASS** · `qwen/qwen3-8b-m5max` (re-confirmed on HEAD)
- ✅ **PASS** · `google/gemma-4-e2b-m5max`
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max`
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max`
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max`
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning`
  - matrix coverage: 6 of the 9 roster columns now ✅ (same set as strict-isolation). Remaining 3 (gemma-e4b, phi4-plus, deepseek) not currently loaded.

### 2026-06-28 · verify-task-completion (two newer models, not in the 9-col matrix)
Single-card delivery → awaiting_review + captured result branch, for two models loaded outside the original roster.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · reached awaiting_review, result branch `nklein/tasks/verify-completion-…` captured, hello.txt content matches. A 4B coder model delivers a single card cleanly.
- ⚠️ **INCOMPLETE** · `ornith-1.0-9b-mlx` · did NOT reach awaiting_review within 240s (last state: `interrupted`) — provisionally slow/non-terminal in window (cf. qwen3.5-9b ⚠️; nemotron delivered only at 540s, so a longer budget may flip it). Not a conclusive capability floor on one run.

### 2026-06-28 · sweep-capture --preset mid_task (output robustness, against a booted isolated-HOME runtime)
- ✅ **CLEAN** · `qwen/qwen2.5-coder-14b-m5max` · reached `awaiting_review`; tool sequence list_files→get_file_size→read_files→update_focus_chain→begin_implementation (10 calls); **0 narration leaks, 0 hot repeated tool calls, 0 reasoning-channel narration**. 954 WS frames. Matrix → ✅.
- ◑ **PARTIAL** · `qwen3.5-9b-mlx-m5max` · **output FORMAT clean (0 narration leaks)** but did NOT reach a terminal state within 300s; 78 tool calls (read_files×54 — heavy re-reading), run_commands×12, write_file×4, search_codebase×6; 1 hot repeated tool call; reasoning channel 1092. So its issue is **control behavior** (non-termination / finalization-stall, the §5.AA `aborted`/final-answer-watchdog territory + the retry-ladder loop rung), NOT output-format robustness. Matrix → ◑ (clean format, capability/control gap). Consistent with its single-card ⚠️.
- ✅ **CLEAN** · `nvidia/nemotron-3-nano-4b-m5max` · reached `awaiting_review`; 32 tool calls (read_files×20, list_files×4, write_file×4, run_commands×2, update_focus_chain×2); **0 narration leaks, 0 hot repeated tool calls** (heavy reasoning channel 1754, but clean output). Matrix → ✅.
- ⚠️ **CANT (clean format)** · `microsoft/phi-4-mini-reasoning` · reached `awaiting_review` but with **0 tool calls** — it ruminated in the reasoning channel (1414 reasoning msgs) and never acted (no reads/writes/commands). **0 narration leaks** (output FORMAT is clean), so this is the confirmed reasoning-no-action capability gap (§5.O/§5.AB — the canonical reason-then-act / constrained-decoding rung target), NOT an output-format/parse failure. Matrix → ⚠️.

> **Output-robustness mid_task sweep (2026-06-28) — KEY TAKEAWAY:** across every loaded model swept (qwen3-8b, coder-14b, qwen3.5-9b, gemma-e2b/e4b, nemotron, phi-4-mini), narration-leak count is **0** and hot-repeated-tool-call count is **0–1**. The §5.O parse-and-recover output-format hardening is solid; the remaining failures are §5.AA/§5.AB **control** problems (qwen3.5-9b non-termination, phi-4-mini reasons-without-acting), not output-format problems.

### 2026-06-28 · verify-chat-agent-tools (chat read tools) — fixed a stale harness assertion, then swept
**Harness bug fixed:** the "Executor audited an executed read" gate checked `record.detail === "read_file"`, but the audit record's `detail` is the path arg (`buildAuditDetail`, e.g. "NOTES.md") and the tool is identified by `record.action` (read_file's actionKind = `sandbox_read`). The stale check failed for EVERY model (the read genuinely executed + audited; only the assertion was wrong). Fixed to `record.action === "sandbox_read" && record.executed`. Then swept the loaded roster:
- ✅ **PASS** · `qwen/qwen3-8b-m5max` — read_file called, audited, secret in reply.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` — read_file called, audited, secret in reply (re-confirmed after the fix).
- ◑ **PARTIAL** · `qwen3.5-9b-mlx-m5max`, `google/gemma-4-e2b-m5max`, `nvidia/nemotron-3-nano-4b-m5max` — read_file **executed + audited correctly** (the gated-executor path works), but the model's reply didn't echo the secret (weak synthesis, same ◑ pattern as run_command). Matrix → ◑.

### 2026-06-28 · verify-chat-agent-write (chat write tool) — fixed a missing-workspace harness bug, then swept
**Harness bug fixed:** the harness never created the temp `workspace` dir before running, so the write tool's `assertRealPathWithinWorkspace` realpath threw ENOENT (FATAL) for every model (the read harness creates it; this one omitted it). The product is correct — the workspace root (always the real project dir) must exist. Added `mkdir(workspace, {recursive:true})`. Then swept the loaded roster — **4/4 PASS**: `qwen3-8b`, `qwen2.5-coder-14b` (re-confirmed), `qwen3.5-9b`, `gemma-4-e2b`, `nemotron-3-nano` each drove a write through the **confirm gate** (ran only after approval) and the audit recorded a confirmed+executed `sandbox_write`. Matrix → ✅ for all swept.

### 2026-06-28 · verify-chat-send + verify-chat-runtime — swept the loaded roster (all PASS)
Both the basic chat-turn-and-persist (`verify-chat-send`) and the memory+goal-composed runtime turn (`verify-chat-runtime`) **PASS for every loaded model**: qwen3-8b (already), qwen2.5-coder-14b, qwen3.5-9b, gemma-4-e2b, nemotron-3-nano. These are plumbing checks (a real model turn runs, composes context, and persists) — no per-model weakness. Matrix → ✅ across the swept models.

### 2026-06-28 · browse_url "blocker" RESOLVED — it was a command bug, not the harness; + autonomous-run finding
**The earlier browse_url sweep failures were MY command bug**, not a harness/product issue: I passed `PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright` on the same command line as `HOME=<isolated>`, so the shell expanded `~` to the **isolated** HOME → an empty browser cache → `chromium.launch` failed, which the browse tool reports as the generic "page could not be loaded / navigation timed out". With an **absolute** `PLAYWRIGHT_BROWSERS_PATH=/Users/david/Library/Caches/ms-playwright`, browse_url **works**: Chromium rendered the local page and the text flowed back — qwen3-8b/coder-14b each correctly reported the page's heading. The strict gate greps for the body MARKER; when the model answers with the heading instead it's ◑ (stochastic synthesis, same as run_command ◑) — the browse CAPABILITY is proven. coder-14b → ◑; qwen3-8b's prior ✅ stands. (NB two Playwright versions in the tree want different Chromium revisions — autonomous-live wanted headless_shell-1208, browse wanted 1228; both now in the real cache.)
- ⚙️ **autonomous run** (`verify-chat-autonomous-live`, qwen3-8b, on a fresh isolated-HOME dev:full): the §5.0.1 loop **core works** — it started ("Working autonomously…") and drove to a stop reason (`stopped: true`). But it consistently (2 runs) reached "⏸ Needs your input · 1 turn" with **0 transcript messages**. **Root-caused: NOT a bug — my test env was incomplete.** chat-autonomous-wiring.ts:99-102 early-pauses (sets `userQuestion="…no active workspace or loaded local model…"`, returns without running a turn) when `assembleTurnDeps` is null; my fresh isolated-HOME dev:full had **no project/workspace** (empty board), so the run correctly paused before calling the model. The §5.0.1 loop core is fine; prior ✅ stands. To re-verify live, the harness must CREATE a project + active workspace in the session scope first (pinning a model alone isn't enough). (Matrix qwen3-8b ✅ left as-is.)

### 2026-06-28 · browse_url swept the remaining loaded roster (absolute PLAYWRIGHT_BROWSERS_PATH)
With the command fixed, browse_url renders for every model: gemma-4-e2b, nemotron-3-nano, qwen3.5-9b each **USED browse_url + Chromium rendered the local page** (replies contain the page heading `NKLEIN-BROWSE-TITLE-4242`), but answered with the heading rather than the body MARKER → ◑ (weak synthesis, same as run_command/read-tools). The browse CAPABILITY (Chromium launch + render + text-back) is proven across the loaded roster; matrix → ◑ for coder-14b/qwen3.5-9b/gemma-e2b/nemotron, qwen3-8b ✅.

### 2026-06-28 · e2e capstone on coder-14b — full 4-tool composition, reliably
`verify-chat-agent-e2e` on qwen2.5-coder-14b used **ALL 4 tools** in the multi-step turn (read_file + run_command + create_card + update_focus_chain) and the card **E2E-CARD-7777 persisted** (durable control-plane mutation). Only the marker-echo gate failed (weak synthesis, the ◑ pattern). So the stronger coder handles the 4-tool composition **reliably** → ◑, vs qwen3-8b's 🎲 (1/4–3/4 tools run to run). Confirms the capstone flakiness is a small-model composition-capacity limit, not a !Klein bug; the agent loop drives the full tool sequence + durable side effects when the model can keep up.

### 2026-06-28 · autonomous-run RE-CONFIRMED end-to-end on HEAD (with a project + workspace)
After creating a dev-test project (→ current project + active workspace) and pinning the model, `verify-chat-autonomous-live` for qwen3-8b **PASSES**: "✓ Goal complete · 1 turn · 1/1 steps", transcript = 2 messages, stopped=true. This confirms the §5.0.1 autonomous loop works end-to-end on HEAD, and that the earlier "needs input · 0 transcript" was purely the no-workspace early-pause (chat-autonomous-wiring.ts:99) — NOT a bug. The matrix qwen3-8b ✅ is re-confirmed on current HEAD. (Setup note: the harness needs a project/workspace in scope, not just a pinned model.)

### 2026-06-28 18:11:33 · verify-decompose-isolation
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 64s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 83s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 27s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 47s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 303s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 99s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 73s · PASS ✓ no host path leaked into the agent's output during a real decompose.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 163s · PASS ✓ no host path leaked into the agent's output during a real decompose.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 18:22:16 · verify-autopromote-recovery
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 32s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 38s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 9s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 23s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 304s · INCOMPLETE — see above.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 21s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 27s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 36s · PASS ✓ the card auto-promoted Planning→In Progress via the RECOVERY path (begin_implementation never called).
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 18:43:01 · verify-chat-create-card
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 25s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 9s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 11s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 19s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 42s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 12s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 15s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 20s · PASS ✓ the chat agent created a real board card at runtime.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 18:47:45 · verify-chat-command-exec
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 31s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 7s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 9s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 16s · INCOMPLETE — see above.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 52s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 10s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 11s · PASS ✓ the chat agent ran a real shell command and saw its output at runtime.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 12s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=❌

### 2026-06-28 18:57:20 · verify-chat-agent-write
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 29s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 8s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 6s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 9s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 30s · INCOMPLETE — see above.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 6s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 13s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 11s · PASS ✓ a real model drove a write through the confirm gate; it ran only after approval and was audited.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 19:06:06 · verify-chat-agent-tools
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 29s · PASS ✓ a real model called a workspace tool through the gated executor and answered from the file.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 7s · PASS ✓ a real model called a workspace tool through the gated executor and answered from the file.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 5s · INCOMPLETE — see above.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 9s · PASS ✓ a real model called a workspace tool through the gated executor and answered from the file.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 15s · INCOMPLETE — see above.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 5s · INCOMPLETE — see above.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 9s · PASS ✓ a real model called a workspace tool through the gated executor and answered from the file.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 8s · PASS ✓ a real model called a workspace tool through the gated executor and answered from the file.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 19:12:43 · verify-chat-send
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 5s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 1s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 1s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 5s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 2s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 1s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 2s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 2s · PASS ✓ chat.sendMessage ran a real turn and persisted it.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 19:13:58 · verify-chat-runtime
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 20s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 2s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 4s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 11s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 10s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 3s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 4s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 8s · PASS ✓ a real chat turn composed memory + goal, called the model, and persisted.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 19:35:05 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 48s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 23s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 25s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 20s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 109s · INCOMPLETE — see above.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 13s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 26s · INCOMPLETE — see above.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 18s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=❌ qwen2.5-coder-14b-m5max=❌ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 19:44:44 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 26s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌

### 2026-06-28 19:51:39 · verify-chat-create-card
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 27s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwen/qwen2.5-coder-14b-m5max` · 8s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `google/gemma-4-e2b-m5max` · 12s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwen3.5-9b-mlx-m5max` · 18s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `microsoft/phi-4-mini-reasoning` · 41s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `nvidia/nemotron-3-nano-4b-m5max` · 10s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 14s · PASS ✓ the chat agent created a real board card at runtime.
- ✅ **PASS** · `ornith-1.0-9b-mlx` · 17s · PASS ✓ the chat agent created a real board card at runtime.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=✅ gemma-4-e2b-m5max=✅ qwen3.5-9b-mlx-m5max=✅ phi-4-mini-reasoning=✅ nemotron-3-nano-4b-m5max=✅ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=✅ ornith-1.0-9b-mlx=✅

### 2026-06-28 20:05:41 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 55s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 25s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 26s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 18s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 170s · INCOMPLETE — see above.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 20s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 29s · INCOMPLETE — see above.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 28s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=❌ qwen2.5-coder-14b-m5max=❌ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 20:13:10 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 62s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 39s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 27s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 18s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 234s · INCOMPLETE — see above.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 10s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 20s · INCOMPLETE — see above.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 13s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=❌ qwen2.5-coder-14b-m5max=❌ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 20:18:49 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 35s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 20s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌

### 2026-06-28 20:20:44 · verify-chat-agent-e2e
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 114s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌

### 2026-06-28 20:21:34 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 32s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 18s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌

### 2026-06-28 20:23:54 · verify-chat-agent-e2e
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 139s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌

### 2026-06-28 20:31:34 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 53s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 36s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 23s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 17s · INCOMPLETE — see above.
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 202s · INCOMPLETE — see above.
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 23s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 21s · INCOMPLETE — see above.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 14s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=❌ qwen2.5-coder-14b-m5max=❌ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=❌ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 20:38:05 · verify-task-completion
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 37s · PASS ✓ a small local model ran the card to a terminal state AND delivered the correct result (hello.txt).
  - matrix row: qwen3-8b-m5max=✅

### 2026-06-28 20:38:24 · verify-task-completion
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 18s · PASS ✓ a small local model ran the card to a terminal state AND delivered the correct result (hello.txt).
  - matrix row: qwen3-8b-m5max=✅

### 2026-06-28 20:46:42 · verify-task-completion
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 498s · SWEEP-ROW | 2026-06-28T20:46:42.962Z | C0 single-card | model=qwen/qwen3-8b-m5max | result=STALLED 🧱 | terminal=interrupted | delivered=NO | power=low×2
  - matrix row: qwen3-8b-m5max=❌

### 2026-06-28 21:29:06 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 15s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 11s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌

### 2026-06-28 21:30:44 · verify-chat-agent-e2e
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 98s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌

### 2026-06-28 21:31:11 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 15s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 11s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌

### 2026-06-28 21:33:05 · verify-chat-agent-e2e
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 114s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌

### 2026-06-28 21:33:29 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 15s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 8s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌

### 2026-06-28 21:35:33 · verify-chat-agent-e2e
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 124s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌

### 2026-06-28 21:35:55 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 14s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 8s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌

### 2026-06-28 21:37:58 · verify-chat-agent-e2e
- ❌ **FAIL** · `microsoft/phi-4-mini-reasoning` · 123s · INCOMPLETE — see above.
  - matrix row: phi-4-mini-reasoning=❌

### 2026-06-28 21:42:35 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen2.5-coder-14b-m5max` · 16s · INCOMPLETE — see above.
  - matrix row: qwen2.5-coder-14b-m5max=❌

### 2026-06-28 21:47:46 · verify-chat-agent-e2e
- ◑ **PARTIAL** · `qwen/qwen2.5-coder-14b-m5max` · 15s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
  - matrix row: qwen2.5-coder-14b-m5max=◑

### 2026-06-28 21:52:53 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen/qwen3-8b-m5max` · 23s · INCOMPLETE — see above.
- ◑ **PARTIAL** · `qwen/qwen2.5-coder-14b-m5max` · 16s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 12s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 12s · INCOMPLETE — see above.
- ◑ **PARTIAL** · `microsoft/phi-4-mini-reasoning` · 131s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 6s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 11s · INCOMPLETE — see above.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 8s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=❌ qwen2.5-coder-14b-m5max=◑ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=◑ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 22:00:57 · verify-chat-agent-e2e
- ✅ **PASS** · `qwen/qwen3-8b-m5max` · 29s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
- ◑ **PARTIAL** · `qwen/qwen2.5-coder-14b-m5max` · 17s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 13s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwen3.5-9b-mlx-m5max` · 8s · INCOMPLETE — see above.
- ◑ **PARTIAL** · `microsoft/phi-4-mini-reasoning` · 64s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b-m5max` · 8s · INCOMPLETE — see above.
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx-m5max` · 9s · INCOMPLETE — see above.
- ❌ **FAIL** · `ornith-1.0-9b-mlx` · 7s · INCOMPLETE — see above.
  - matrix row: qwen3-8b-m5max=✅ qwen2.5-coder-14b-m5max=◑ gemma-4-e2b-m5max=❌ qwen3.5-9b-mlx-m5max=❌ phi-4-mini-reasoning=◑ nemotron-3-nano-4b-m5max=❌ qwopus3.5-4b-coder-fable5-v1-mlx-m5max=❌ ornith-1.0-9b-mlx=❌

### 2026-06-28 22:04:01 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 14s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-q8` · 16s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌ gemma-4-e2b-q8=❌

### 2026-06-28 22:07:45 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 12s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌

### 2026-06-28 22:10:34 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 14s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-q8` · 15s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌ gemma-4-e2b-q8=❌

### 2026-06-28 22:11:22 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 12s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-q8` · 16s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌ gemma-4-e2b-q8=❌

### 2026-06-28 22:12:11 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 13s · INCOMPLETE — see above.
- ❌ **FAIL** · `google/gemma-4-e2b-q8` · 16s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌ gemma-4-e2b-q8=❌

### 2026-06-28 22:54:44 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 14s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌

### 2026-06-28 22:54:57 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 13s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌

### 2026-06-28 22:55:12 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b-m5max` · 14s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b-m5max=❌

### 2026-06-28 23:07:30 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b` · 13s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b=❌

### 2026-06-28 23:07:47 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 9s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-28 23:08:01 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwopus3.5-4b-coder-fable5-v1-mlx` · 10s · INCOMPLETE — see above.
  - matrix row: qwopus3.5-4b-coder-fable5-v1-mlx=❌

### 2026-06-28 23:10:16 · verify-chat-agent-e2e
- ◑ **PARTIAL** · `microsoft/phi-4-mini-reasoning` · 131s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
  - matrix row: phi-4-mini-reasoning=◑

### 2026-06-28 23:10:46 · verify-chat-agent-e2e
- ✅ **PASS** · `qwen/qwen3-8b` · 27s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
  - matrix row: qwen3-8b=✅

### 2026-06-28 23:11:11 · verify-chat-agent-e2e
- ◑ **PARTIAL** · `qwen/qwen2.5-coder-14b` · 21s · PARTIAL ◑ the full tool chain executed + the card persisted, but the reply didn't echo the marker (weak synthesis).
  - matrix row: qwen2.5-coder-14b=◑

### 2026-06-28 23:23:11 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 8s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-28 23:23:30 · verify-chat-agent-e2e
- ❌ **FAIL** · `google/gemma-4-e2b` · 13s · INCOMPLETE — see above.
  - matrix row: gemma-4-e2b=❌

### 2026-06-28 23:31:12 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 9s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-28 23:31:21 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 9s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-28 23:31:31 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 9s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-28 23:36:58 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 10s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-28 23:37:07 · verify-chat-agent-e2e
- ❌ **FAIL** · `nvidia/nemotron-3-nano-4b` · 8s · INCOMPLETE — see above.
  - matrix row: nemotron-3-nano-4b=❌

### 2026-06-29 15:36:11 · verify-task-completion (capable-model-first driver, idle-LLM background run)
- ✅ **PASS** · `qwopus3.6-27b-v2-mlx` · ~159s · SWEEP-ROW | C0 single-card | result=PASS ✓ | terminal=awaiting_review | delivered=YES (hello.txt content matches) | result branch `nklein/tasks/verify-completion-1-…` | power=low×2.
  - Clean: one `write_file` tool call → terminal → captured result patch; 0 narration leaks. Confirms single-card C0 delivery for the driver (multi-tool CHAINING still owed before TOOL_NATIVE per the catalog note).
  - **Reliability: C0 = 2/2 PASS** (repeat 15:59:35 also PASS, awaiting_review + hello.txt delivered, ~159s). Stable on the simple single-tool card — contrast the reliable C1 decompose-call gap below (the driver handles a simple emit but stalls on the complex decompose emit).
  - matrix row: qwopus3.6-27b-v2-mlx=✅ (C0, 2/2)

### 2026-06-29 · verify-decompose-isolation (C1 scout, capable-model-first driver, idle-LLM background run)
- ✅ **ISOLATION PASS** · `qwopus3.6-27b-v2-mlx` · sandbox container observed, **no host-path leak**, no host worktree, no containers remaining after dispose. The security invariant (the harness's PASS criterion) holds.
- ⚠️ **BEHAVIORAL LIMITATION (control, NOT isolation/format): `decompose_project` was NEVER called.** The driver read `specification.md` + `storage.ts`/`app.ts` + `list_files`, then **re-read `specification.md` → hit the redundant-read block** ("this exact file content was already read successfully") → **retried the same blocked read** → session ended `interrupted` without ever emitting the decompose call (12 activities, no decompose).
  - **Root cause (structured, per MCF):** on the architect/decompose path the model EXPLORES with read tools but doesn't transition to the decompose ACTION; when the loop-guard blocks a redundant re-read, the agent retries the *same* read instead of advancing to `decompose_project`. This is the §5.AA control/finalization gap (a no-progress read loop), distinct from the §5.O output-format robustness (format was clean) and from C0 (a single write_file it handled fine).
  - **Limitation → next chapter (challenge: C1):** the redundant-read block should STEER the next turn toward the owed action (decompose), not let the agent retry the blocked read — a `beforeModel` nudge ("context gathered; now call `decompose_project`") is the §5.AA proactive rung this argues for (ties the reason-then-act / finite-state-controller work). Re-attack on the driver once that rung lands; a stronger/again-run may also clear it (don't judge a ceiling on one run).
  - matrix row: qwopus3.6-27b-v2-mlx C1 = ⚠️ (isolation ✅, decompose-call control gap)
- **REPEAT (reliability, 2nd run):** ⚠️ AGAIN — `decompose_project` NOT called (98 activities). Different shape, SAME outcome: this time it read all 3 files in ONE call (no redundant-read block), called `list_files`, then **narrated "Good — I have a clear picture… Let me decompose this into dependency-ordered cards." and the session ENDED (`interrupted`) right there** — a no-tool-call (prose-intent) turn, never emitting the structured decompose call.
  - ~~CONCLUSION: reliable C3-blocker, build a proactive force-decompose rung.~~ **RETRACTED + CORRECTED (2026-06-29, same day, harness conflation):** this scout is **NOT a fair decompose-completion test** — `verify-decompose-isolation.mts` starts the task WITHOUT `startInPlanMode`, and the production decompose stall-recovery (`DecompositionStallNudger`) only arms for a task registered as explicit-decomposition, which requires `startInPlanMode === true` ([nklein-task-session-service.ts:1680](src/nklein-agent/nklein-task-session-service.ts#L1680)). So in BOTH scouts the **stall-nudger was INACTIVE** — the model narrated freely with no 25s chat-nudge / turn-end recovery and simply ran to the harness deadline. The "no decompose" is therefore largely a **harness artifact**, not a proven model limitation, and a brand-new rung is likely REDUNDANT (the nudger already targets exactly the narrate-instead-of-emit shape). **What IS still valid:** the isolation result (no host leak, clean teardown) ✓, and a real *tendency* of the driver to narrate decompose intent before emitting. **Correct next step:** run a decompose-COMPLETION test WITH `startInPlanMode: true` (engaging the nudger) before concluding anything about the driver's decompose reliability or building new recovery — see the §5.AA item.
- **PLAN-MODE re-runs (2026-06-29, nudger ARMED via `NKLEIN_VERIFY_PLAN_MODE=1`) — 3 more, ALL different shapes, NONE reached `decompose_project`:** (run A, ~6min) read files then narrated "Let me decompose this into cards" to the deadline — its phrasing did NOT match the chat-nudge pattern (deterministically verified), so the nudge never fired → **fixed the pattern** (broadened `DECOMPOSITION_CHAT_REPORT_PATTERN`, +2 tests). (run B) only got through *reading* before the deadline (plan-mode adds a 2nd spec copy; slow under Low Power). (run C, 20-min window) read + redundant re-read + a malformed `run_commands` + retry, then died on **`Agent error: Body Timeout Error`** (an undici transient — the §5.AF scout-signal-3 case) with no file changes.
  - **HONEST CONCLUSION (don’t over-claim either way):** `verify-decompose-isolation` is **not a reliable decompose-COMPLETION oracle** for this driver under Low Power — the 4 runs failed for *varied incidental reasons* (read loop · narration the nudge missed · slow reads hitting the deadline · a network transient), NOT a clean capability ceiling. The nudge-pattern fix is **landed + unit-correct but NOT validated end-to-end** (no run reached the nudge-fire→cancel→reprompt→emit cycle cleanly). **To measure decompose reliably:** a dedicated **decompose-COMPLETION harness** that (a) waits on `decompose_project` not an isolation deadline, (b) **retries transient body/headers timeouts** (ties §5.AF durable scheduler), (c) gives the full nudge cycle time under Low Power. Scouting stopped here — diminishing returns + noisy infra transients.
  - matrix row: qwopus3.6-27b-v2-mlx C1 decompose-COMPLETION = **unmeasured** (isolation ✅; completion needs the dedicated harness above).

### 2026-07-01 14:57:37 · verify-chat-agent-e2e
- ❌ **FAIL** · `gpt-oss-20b-mlx` · 46s · INCOMPLETE — see above.
  - matrix row: gpt-oss-20b-mlx=❌

### 2026-07-01 14:58:08 · verify-chat-agent-e2e
- ✅ **PASS** · `qwen/qwen3-coder-next` · 25s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
  - matrix row: qwen3-coder-next=✅

### 2026-07-01 14:58:48 · verify-chat-agent-e2e
- ✅ **PASS** · `openai/gpt-oss-120b` · 22s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
  - matrix row: gpt-oss-120b=✅

### 2026-07-01 15:29:44 · verify-chat-agent-e2e
- ✅ **PASS** · `qwen3.5-9b-mlx` · 172s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
  - matrix row: qwen3.5-9b-mlx=✅

### 2026-07-01 15:31:39 · verify-chat-agent-e2e
- ✅ **PASS** · `qwen2.5-coder-7b-instruct` · 18s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
  - matrix row: qwen2.5-coder-7b-instruct=✅

### 2026-07-01 15:32:06 · verify-chat-agent-e2e
- ✅ **PASS** · `gemma-4-12b-it-qat` · 21s · PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime.
  - matrix row: gemma-4-12b-it-qat=✅

### 2026-07-01 15:34:18 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen3-14b` · 122s · INCOMPLETE — see above.
  - matrix row: qwen3-14b=❌

### 2026-07-01 15:48:56 · verify-chat-agent-e2e
- ❌ **FAIL** · `qwen3.6-27b` · 840s · INCOMPLETE — see above.
  - matrix row: qwen3.6-27b=❌

### 2026-07-01 15:51:25 · verify-chat-agent-e2e
- ❌ **FAIL** · `gpt-oss-20b-mlx` · 59s · INCOMPLETE — see above.
  - matrix row: gpt-oss-20b-mlx=❌

### 2026-07-01 15:52:04 · verify-chat-agent-e2e
- ❌ **FAIL** · `gpt-oss-20b-mlx` · 39s · INCOMPLETE — see above.
  - matrix row: gpt-oss-20b-mlx=❌

### 2026-07-06 (Opus polishing) · §5.Z §5.A decompose host-path isolation on qwen3.6-27b@q4 — isolation ✓ / capability inconclusive
`verify-decompose-isolation.mts` (real sandboxed NKlein task-session → read a spec + decompose; asserts NOTHING the
agent emits contains the host mount path). On `qwen3.6-27b@q4_k_m` (ctx 40000, 240s budget): **ISOLATION INVARIANT
HELD ✓** — sandbox container observed, no host worktree created, **zero host-path leaks** across 10 captured agent
activities, containers cleaned up on dispose. **But the decompose CAPABILITY was inconclusive:** the model did NOT emit
`decompose_project` and the session ended `interrupted` (ran out its budget / stalled mid-plan before the tool call).
The isolation prime-directive (#2) is the assertion here and it's robust; whether the 27B@q4 can complete a decompose
within a 240s budget is a separate capability/latency question (the heavier resident models are slower than the prior
sweeps' lighter roster — not re-run across the roster since each is a slow Docker multi-turn with an inconclusive
capability signal). Recorded as: isolation ✓ on the 27B; decompose-under-budget = open capability data point.

### 2026-07-06 (Opus polishing) · §5.Z §5.M chat-agent-tools on the heavy resident roster — 6/6 + W3.1 regression check
`verify-chat-agent-tools.mts` (real model → `runChatAgentTurn` with the read-only workspace tools + gated/audited
executor on a tiny on-disk workspace; asks a question answerable only by reading a file, asserts the model CALLED
read_file, the executor audited it, the tool ran in the workspace, and the answer reflects the file secret). Swept the
CURRENTLY-resident roster (state=loaded). **6/6 PASS:** qwen3.5-122b-a10b · qwen3.6-27b@q4_k_m · qwen3-8b ·
mistralai/devstral-small-2-2512 · qwen2.5-coder-14b · coder-gpu — each called the tool through the gate, was audited,
and answered from the file. **Doubles as a LIVE regression check of the Fable W3.1 change** (`chat-agent-turn.ts` now
persists the user message BEFORE the tool loop so per-tool transcript rows interleave user→tool…→assistant): every run
reported `User + assistant persisted: YES ✓` with the correct ordering + a clean `Tool steps: 1`. The chat tool-loop
composes end-to-end on the full 8B→122B resident range after the W3.1 renderer/transcript rework.
  - matrix rows (chat-agent-tools): qwen3.5-122b-a10b=✅ · qwen3.6-27b=✅ · qwen3-8b=✅ · devstral-small=✅ ·
    qwen2.5-coder-14b=✅ · coder-gpu=✅

### 2026-07-06 · §5.Z EGRESS verification (egress LIVE at 127.0.0.1:18888) — infra + cross-model e2e
**Infrastructure — `verify-egress-live.mts` ✅ ALL PASS:** real SearXNG search returns 8 real internet results
(`"Claude Opus \ Anthropic" — anthropic.com/claude/opus`); the fail-closed gate blocks with `blocked_by_egress`
when egress is OFF (no request fired); a null backend yields `no_backend`; SearXNG payload fields map onto the
contract. The egress feature is live-validated end-to-end.

**Cross-model e2e — `verify-egress-model-e2e.mts` (model → web_search tool-call → live SearXNG → grounded answer),
8 models, 7/8 PASS:**
- ✅ **PASS (7):** `qwen/qwen3-8b` (north-star), `qwen/qwen2.5-coder-14b`, `google/gemma-4-e2b` (2B weak!),
  `microsoft/phi-4-mini-reasoning`, `mistralai/mistral-small-3.2`, `openai/gpt-oss-120b` (120B MoE),
  `nvidia/nemotron-3-nano-4b` — each emitted the web_search tool call (`finish=tool_calls`), executed the query
  against live SearXNG (8 real results), and used them to answer with the correct `anthropic.com/claude/opus` URL.
  Egress works across the full capability range 2B → 120B, including a reasoning model (phi-4-mini-reasoning).
- ⚠️ **CANT (1): `microsoft/phi-4-reasoning-plus`** — REASONING RUNAWAY. It never emits the tool call: at
  max_tokens 2048 AND at 6144 it truncates (`finish=length`) having spent the ENTIRE budget on `reasoning_content`
  (25,972 chars / 6143 completion tokens of deliberation about *whether/how* to call web_search) with empty
  `content` and NO `tool_calls`. This is a **model-quality trait** (the exact reasoning-runaway pattern the §5.AA
  adaptive-retry / `recovery-ladder-model` + `NKLEIN_ADAPTIVE_RETRY` target), **not an egress bug** — the egress
  path itself is proven by the 7 passes + the infra validation. Recorded as a capability-floor data point for the
  tool-call-under-reasoning axis; a model that reasons 26K chars without acting is a §5.AB fitness signal.
  - matrix rows (egress-e2e): qwen3-8b=✅ · qwen2.5-coder-14b=✅ · gemma-4-e2b=✅ · phi-4-mini-reasoning=✅ ·
    mistral-small-3.2=✅ · gpt-oss-120b=✅ · nemotron-3-nano-4b=✅ · phi-4-reasoning-plus=⚠️(reasoning-runaway)
- **Sweep bound (not a bug):** attempting 4 more (deepseek-r1, ornith-1.0-9b-mlx, qwopus3.5-9b-coder, qwq-32b) all
  returned `HTTP 400: Model loading was stopped due to insufficient system resources` — LM Studio is at its memory
  ceiling with big models resident (gpt-oss-120b, qwen3.5-122b). `/v1/models` lists *registered* models but JIT-load
  fails under memory pressure. An LM Studio resource/JIT-load constraint, NOT a !Klein/egress issue; the egress sweep
  is complete for the currently-loadable set. (Didn't force-unload resident models — that's the operator's LM Studio
  session.)

**RE-VERIFICATION on the updated resident roster (2026-07-06 later, Opus polishing session):** egress re-confirmed
GREEN end-to-end on the CURRENTLY-loaded set (`/api/v0/models` `state=loaded` — the 6 truly-resident models, NOT the
downloaded `/v1/models` list). `verify-egress-live.mts` ✅ (8 real results, fail-closed gate, no_backend, payload
mapping). `verify-egress-model-e2e.mts` **6/6 PASS across the resident roster**, extending the matrix with NEW heavier
data points (the 122B MoE + a 27B + devstral were not in the prior sweep):
  - matrix rows (egress-e2e): **qwen3.5-122b-a10b=✅ (NEW — 122B-A10B MoE)** · **qwen3.6-27b@q4_k_m=✅ (NEW)** ·
    **mistralai/devstral-small-2-2512=✅ (NEW, coder)** · **coder-gpu=✅ (NEW)** · qwen3-8b=✅ (re-confirmed) ·
    qwen2.5-coder-14b=✅ (re-confirmed) — each emitted the web_search tool call, executed against live SearXNG (8 real
    results), and grounded its answer on `anthropic.com/claude/opus`. Egress now proven across 8B → 122B on this roster.
  - Same `/v1/models`-vs-loaded caveat re-observed: `openai/gpt-oss-120b` (registered but NOT resident) returned
    `HTTP 400: Model loading was stopped due to insufficient system resources` when its id was passed — an LM Studio
    JIT-load ceiling, not an egress issue. Only `state=loaded` ids were swept thereafter (never force a giant to load).

### 2026-07-07 · §5.Z egress REGRESSION re-check (Opus polishing) — still GREEN after the week's commits
Bounded no-sweep regression pass confirming the live egress (127.0.0.1:18888) still holds after all the intervening
`feat/nklein-upcoming` commits. **Infra `verify-egress-live.mts` ✅ ALL PASS** (8 real SearXNG results —
`"Claude Opus \ Anthropic" — anthropic.com/claude/opus`; fail-closed `blocked_by_egress` gate; `no_backend`; payload
field mapping). **SMOKE-tier model e2e `verify-egress-model-e2e.mts` ✅ — the full SMOKE pair (north-star + one weak model) each 3/3:**
`qwen/qwen3-8b` and `google/gemma-4-e2b` (2B) both emitted the `web_search` tool call (`finish=tool_calls`) → executed
against live SearXNG (8 real results each) → grounded their answer on `anthropic.com/claude/opus`. No regression; the
full model→tool-call→egress→real-results→answer path is intact at both the capable and the weak end. (SMOKE tier per
the §5.Z done-bar tiering — the FULL resident-roster sweep remains the periodic-cadence obligation.)

**NEW matrix data point (same run, zero extra load — already resident): `qwopus3.5-9b-coder-mtp` ✅ 3/3.** A 9B
coder model with **multi-token prediction (MTP)** — not previously in the egress matrix. It emitted the `web_search`
tool call (`finish=tool_calls`), executed against live SearXNG (8 real results), and grounded its answer on the real
Anthropic URL. Confirms MTP decoding doesn't disrupt the tool-call → egress → grounded-answer path. Resident egress
coverage this pass: qwen3-8b ✅ · gemma-4-e2b ✅ · qwopus3.5-9b-coder-mtp ✅ (NEW) — the three non-giant resident models
(qwen2.5-coder-14b + the 122B MoE already ✅ in the 2026-07-06 rows; not force-reloaded).

### 2026-07-06 · §5.Z §5.AC temporal-awareness ("knows today") — HARNESS BUG FIXED + cross-model sweep
**Harness bug found + fixed:** `verify-temporal-awareness-live.mts` was failing its own assertions on EVERY model —
root cause: the §5.AC "knows today" block is OFF BY DEFAULT (`knowsTodayEnabled ?? isTruthyEnv(NKLEIN_KNOWS_TODAY)`),
and the harness passed neither the dep nor the env flag, so it drove `runChatTurn` with the feature DISABLED (no
`<current_date>` block ⇒ the model answered "the current year is 2023" from its training prior ⇒ the temporal-block
assertions correctly reported NO). The feature is fine; the harness wasn't enabling what it verifies. Fixed by passing
`knowsTodayEnabled: true` in the harness's runChatTurn deps (verifying the feature ENABLED is the script's whole
purpose). Confirmed the feature works: with it enabled, qwen3-8b overrode its prior → "current year is 2026, and
2026-03-01 is in the past relative to today's date of 2026-07-06."
**Cross-model sweep (fixed harness), 7/7 PASS across 2B→120B:** qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b (2B!),
mistral-small-3.2, gpt-oss-120b (120B), nemotron-3-nano-4b, phi-4-mini-reasoning — every model injected the leading
`<current_date>` block carrying today's ISO date AND correctly placed a current-year past month in the PAST (the
strong override signal: training-prior overridden by the injected clock). The §5.AC temporal lighthouse holds across
the capability range.
  - matrix rows (temporal): qwen3-8b=✅ · qwen2.5-coder-14b=✅ · gemma-4-e2b=✅ · mistral-small-3.2=✅ · gpt-oss-120b=✅ ·
    nemotron-3-nano-4b=✅ · phi-4-mini-reasoning=✅

### 2026-07-06 · §5.Z §5.M chat-agent-tools (read_file loop) — current-roster sweep
`verify-chat-agent-tools.mts` (real model → read_file tool → gated+audited executor → answer from file content), 6
models. The loop is healthy — every non-PASS is a MODEL-QUALITY trait, not a !Klein bug (the tool + executor work):
- ✅ **PASS (3):** qwen3-8b, qwen2.5-coder-14b, gpt-oss-120b — called read_file, executor audited it, final answer
  echoed the file's secret (`hunter2-fjord-lantern`).
- ◑ **weak-synthesis (2):** gemma-4-e2b (2B), nemotron-3-nano-4b — CALLED read_file + executed it, but didn't echo the
  secret in the final answer. The known weak-synthesis ◑ trait (execute the tool + side effects, don't echo the
  marker) — model quality, not a bug.
- ⚠️ **tool-selection (1): mistral-small-3.2** — consistently (2/2 runs) picks `list_dir` and replies "Done" instead of
  calling read_file, so it never reads the content. A model tool-selection/premature-stop trait (it calls tools fine
  for egress web_search + temporal, just mis-selects here) — not a !Klein bug; read_file works for the other 5.
  - matrix rows (chat read_file): qwen3-8b=✅ · qwen2.5-coder-14b=✅ · gpt-oss-120b=✅ · gemma-4-e2b=◑ ·
    nemotron-3-nano-4b=◑ · mistral-small-3.2=⚠️(picks list_dir)

### 2026-07-06 · §5.Z §5.M-G2 chat-command-exec (run_command at runtime) — current-roster sweep
`verify-chat-command-exec.mts` (real `nklein chat --allow-commands` CLI agent → run_command → the shell output must
flow back into the model's context and appear in the reply), 4 models. Runtime command execution is healthy:
- ✅ **PASS (3):** qwen3-8b, qwen2.5-coder-14b, gpt-oss-120b — used run_command and echoed the marker (proving the
  command genuinely executed and its output flowed back into context).
- ◑ **weak-synthesis (1): gemma-4-e2b (2B)** — USED run_command (the command executed) but didn't echo the marker in
  its reply. The same weak-synthesis ◑ trait seen on read_file — model quality, not a bug (the execution path works).
  - matrix rows (chat run_command): qwen3-8b=✅ · qwen2.5-coder-14b=✅ · gpt-oss-120b=✅ · gemma-4-e2b=◑

### 2026-07-06 · §5.Z §5.M chat-agent-write (CONFIRM gate + audit for a mutating tool) — current-roster sweep
`verify-chat-agent-write.mts` (real model → write_file → the `isolated_readonly` confirm gate must invoke the approval
callback, the file must actually land in the workspace, and the audit must record a confirmed+executed sandbox_write),
6 models. **6/6 PASS across 2B→120B:** qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b (2B!), gpt-oss-120b, mistral-small-3.2,
nemotron-3-nano-4b — every model called write_file, the confirm gate fired, the content landed, and the write was
audited. **Notable: this flow passes UNIVERSALLY** — including the 2B/mistral/nemotron models that showed ◑/⚠️ on
read_file/run_command — because it asserts on the DURABLE SIDE EFFECT + audit (file written, confirmed sandbox_write),
NOT on the model echoing a marker in its reply. So the weak-synthesis ◑ trait (don't-echo-the-marker) can't fail it,
and the security-relevant confirm-gate + audit path is robust across the entire capability range. (Also: mistral
called write_file fine here — its read_file `list_dir` mis-selection was scenario-specific, not a general tool-calling
defect.)
  - matrix rows (chat write_file): qwen3-8b=✅ · qwen2.5-coder-14b=✅ · gemma-4-e2b=✅ · gpt-oss-120b=✅ ·
    mistral-small-3.2=✅ · nemotron-3-nano-4b=✅

### 2026-07-06 · §5.Z §5.M chat-browse (browse_url → headless Chromium render) — current-roster sweep
`verify-chat-browse.mts` (real `nklein chat --browser` CLI agent → browse_url a tiny local page → the page text must
flow back; instruction: *"reply with the exact text of the page's main heading"* — the `<h1>` marker
`BROWSE-MARKER-4242-XYZ`; the page `<title>` is a DIFFERENT string `NKLEIN-BROWSE-TITLE-4242`), 4 models. **The
browse_url tool is verified working** (all 4 USED it; Playwright/Chromium rendered the page; qwen3-8b returned the h1
marker, proving the body text flows back into context):
- ✅ **PASS (1):** qwen3-8b — returned the `<h1>` marker exactly.
- ⚠️ **comprehension/ambiguity (3): qwen2.5-coder-14b, gpt-oss-120b, gemma-4-e2b** — each USED browse_url and rendered
  the page, but replied with the page `<title>` (`NKLEIN-BROWSE-TITLE-4242`) instead of the `<h1>` "main heading". A
  model-comprehension trait — "the page's main heading" read as the page title, not the body `<h1>` — hitting even the
  capable gpt-oss-120b. **NOT a browse_url bug** (the tool surfaces the body text, per qwen3-8b) and NOT a harness bug
  (the instruction is defensible: h1 IS the main heading; kept the strict body-marker assertion — did not weaken it to
  accept the title). Note for a future harness: the "main heading" phrasing is genuinely ambiguous vs `<title>`; an
  unambiguous instruction ("the text inside the page's large body marker") would isolate browse-comprehension from the
  title/h1 naming trap. Recorded as a cross-model data point, not actioned.
  - matrix rows (chat browse_url): qwen3-8b=✅ · qwen2.5-coder-14b=⚠️(title-vs-h1) · gpt-oss-120b=⚠️(title-vs-h1) ·
    gemma-4-e2b=⚠️(title-vs-h1)

## 2026-07-06 (Opus) — live egress re-verify on the current resident roster
Resident (state=loaded, no force-load): `qwen3.5-122b-a10b`, `qwen/qwen2.5-coder-14b`, `coder-gpu`. Egress LIVE at 18888.
- **`verify-egress-live.mts` ✓** — real search (8 results); fail-closed gate blocks when egress off (`blocked_by_egress`,
  no fetch); null backend → `no_backend`; SearXNG payload → contract title+url mapping. Security posture holds live.
- **`verify-egress-model-e2e.mts` [qwen/qwen2.5-coder-14b] ✓** — emitted `web_search` tool call → 8 real SearXNG results →
  used them → answered the correct URL (anthropic.com/claude/opus). Full model→tool→egress→results→answer chain.
- matrix rows (egress e2e): qwen2.5-coder-14b=✅ (repeat-confirmed on the current roster). 122B skipped (already proven
  8B→122B in the prior sweep; slow re-run not worth the wall-time).

## 2026-07-06 (Opus) — chat-agent tool loop (§5.M) re-verify on the current roster
Resident (state=loaded, no force-load): `qwen3.5-122b-a10b`, `qwen/qwen2.5-coder-14b`.
- **`verify-chat-agent-tools.mts` [qwen/qwen2.5-coder-14b] ✓** — model CALLED `read_file` → policy-gated executor AUDITED
  the executed read → tool ran in-workspace → final answer contained the file secret (1 tool step, no iteration limit).
  `User + assistant persisted: YES` (live regression check of the W3.1 persist-user-before-loop change). Full §5.M
  tool-using chat loop composes end-to-end through the gated/audited executor on a real model.
- matrix row (chat-agent-tools): qwen2.5-coder-14b=✅ (repeat-confirmed post recent chat/prompt refactors).
