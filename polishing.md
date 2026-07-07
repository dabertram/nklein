# !Klein — polishing.md (the post-implementation hardening/verification backlog)

> **The fourth backlog file, split from [todo.md](todo.md) on 2026-07-05 (user directive).** The phase model is
> temporal: **`todo.md` = build the features + stitch the pieces together** (net-new capability + the wiring that makes
> built-but-dark cores live); **this file = everything that happens AFTER feature-complete** — verify · harden ·
> refactor · measure. It is worked **only once the implementation backlog in `todo.md` is drained** (or when a specific
> polish task is genuinely blocking an implementation task).
>
> **What lives here:** adversarial bug-hunt sweeps · dev-test-project runs · cross-model verification (every LLM flow ×
> every model) · model-attribute A/B hardening excursions · the Fable-session double-check pass · comprehensive
> test-coverage-for-completeness · the deep architecture/code-quality refactor · the continuous dev-test eval rail · the
> UI visual overhaul · post-maturity work (MoE eval, public-release prep).
>
> **What does NOT live here (stays in `todo.md`):** feature implementation, the wiring/integration that makes a built
> core live, and any test coverage that is a **hard gate for a specific feature** (that coverage ships with its
> feature — otherwise a feature reads "done" while its gate lives elsewhere).
>
> **Conventions (same as `todo.md`):** section ids are STABLE (a migrated `§5.x` keeps its id, so cross-references from
> `todo.md`/`done.md` still resolve — they just resolve here). `[x]` done · `[~]` partial · `[ ]` ready · `[-]`
> deferred. The ready-work grep on `todo.md` measures *implementation left*; this file is not counted in that burndown.
>
> **Migration status (2026-07-05):** seeded with the unambiguous post-implementation sections (§5.Z, §5.AO, §5.BF,
> §5.AX, §5.AY, §5.AZ). The larger review/coverage sections (§5.U architecture refactor, §5.V comprehensive coverage,
> §5.AI dev-test eval rail) also belong here and are being migrated incrementally as the implementation backlog clears.

---

### 5.Z — Cross-model verification: every LLM-interactive flow on every loaded model *(2026-06-26, user)*
> **MATRIX STATUS (2026-06-28 sweep, loaded roster):** broadly covered — decompose ✅9/9; single-card 8/9; auto-promote
> 8/9; **strict-isolation 8/8 + restart-resume 6/6** (swept this pass); **output-robustness** 6 models (key finding: 0
> narration leaks anywhere — format hardening solid; remaining fails are §5.AA *control* problems); **chat read/write/send/
> runtime/browse + e2e capstone** swept across the loaded set (write/send/runtime ✅ all; read/browse/run_command/capstone
> ◑ for weak-synthesis models — they execute the tool + durable side effects, just don't echo the gate's marker; that's a
> model-quality trait, not a !Klein bug). **3 harness bugs fixed** by the sweep (chat-agent-tools stale audit assertion;
> chat-agent-write missing-workspace mkdir; the browse_url "blocker" was my own `~`-expansion command bug — browse works).
> Full per-cell grid + run log: [docs/dev/cross-model-verification.md](docs/dev/cross-model-verification.md). **Remaining:**
> the 3 not-currently-loaded roster models (gemma-e4b, phi4-plus, deepseek), the ~25-min multi-card sweep, and autonomous-run
> across the roster (needs a project + active workspace in the session scope, not just a pinned model — root-caused above).
>
> **★ EGRESS §5.Z DONE (2026-07-06, egress LIVE at 127.0.0.1:18888):** the newly-live egress verified end-to-end. Infra
> (`verify-egress-live.mts`) ✅ all pass (real SearXNG results + fail-closed gate + no_backend + field mapping). Cross-model e2e
> (`verify-egress-model-e2e.mts`, model → web_search tool-call → live search → grounded answer): **7/8 PASS** across 2B→120B
> (qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b, phi-4-mini-reasoning, mistral-small-3.2, gpt-oss-120b, nemotron-3-nano-4b).
> **1 ⚠️ CANT: phi-4-reasoning-plus** — reasoning runaway (spends the whole token budget on reasoning_content, truncates
> `finish=length` at ≥6144 tokens, never emits the tool call). Model-quality trait → the §5.AA adaptive-retry/recovery-ladder
> target, NOT an egress bug. Full detail in the matrix run log.
> **Standing requirement (do NOT re-litigate):** every task involving *real LLM interactivity* — the agent driving a
> live local model through a tool loop / decompose / chat / autonomous run / review — must be **verified across ALL
> loaded local models**, not just the north-star model it was first proven on. This is a **retro-verification**
> obligation for `[x]` done tasks (user, 2026-06-26: *"do run those verifications for the already marked as done tasks
> at the next best opportunity"*) AND part of the **done-bar** for open LLM-interactive tasks. Cross-linked from the §5
> cross-model convention note above. **Interpretation taken (recorded so it can be corrected):** the requirement is
> applied as this one standing section + the matrix, NOT by editing every individual task line — each task keeps its
> single-model proof text and inherits the all-models obligation here.
>
> **Loaded roster (live `lms ps` / `/v1/models`, 2026-06-26 — 9 chat/reasoning models + 1 embedder):**
> 1. `qwen/qwen3-8b` (north-star small) · 2. `qwen/qwen2.5-coder-14b` · 3. `qwen3.5-9b-mlx` · 4. `google/gemma-4-e2b`
> (2B) · 5. `google/gemma-4-e4b` · 6. `microsoft/phi-4-mini-reasoning` (3.8B reasoning) · 7. `microsoft/phi-4-reasoning-plus`
> · 8. `nvidia/nemotron-3-nano-4b` · 9. `deepseek-r1-0528-qwen3-8b-mlx` (⚠️ crash-prone). Embedder (for embedding /
> code-intel flows): `text-embedding-nomic-embed-text-v1.5@q8_0` (currently the only one loaded). *(Newer models also
> seen loaded this session: `qwopus3.5-4b-coder`, `ornith-1.0-9b/35b` — recorded in the matrix run log.)*
>
> **The roster GROWS with the challenge ladder (2026-06-28, user — MCF Phase A):** this is NOT a fixed 9. As challenges
> get harder, **load bigger/better models** so the difficulty wall is met by capability, not declared impossible — the
> machine (128 GB RAM + M5 Max) runs **up to ~120B at lower quantization**, push toward that. A model that can't pass a
> difficulty tier is a **`⚠️` capability-floor data point** (recorded only after repeat-runs + the full §5.AA ladder —
> don't judge prematurely), valuable for the §5.AB fitness store + user advice. Add new models as matrix columns / run-log
> entries as they're loaded. (Frontier *cloud* models are MCF Phase B — future, gated behind #1; see §5.0.3.)
>
> **Crash-resilience caveat (user, settled):** **deepseek** has been seen **crashing/unloading** mid-run. If a model
> disappears from `/v1/models` during a sweep, **record it DROPPED and continue with the remaining models** — never
> block the sweep on one model. (We *want* deepseek covered; its crash-resilience is a separate task.)
>
> **Methodology:** reuse the existing `scripts/verify-*.mts` / `scripts/sweep-capture.mts` harnesses, pinning each
> model (most take a `--model` / model env, or the swarm reads it from the pinned provider settings). For each flow:
> iterate the roster → pin → run → record per model in the matrix [cross-model-verification.md](docs/dev/cross-model-verification.md):
> **✅ PASS · ❌ FAIL → harden** (a malformed-output / parse gap is a !Klein hardening task per the §5.O parse-and-recover
> principle, NOT just a model failing) **· ⚠️ CANT** (the model genuinely isn't capable enough — a recorded capability-floor
> data point, not a bug) **· 💥 DROPPED** (crashed mid-run) — then restore the user's selected model. **Priority:** fast
> high-value flows first (decompose, single-card, chat tools); the long multi-card pipeline is sampled, not full-swept.
>
> **DONE-BAR TIERING (2026-06-26, from the spec audit — so "every flow × every model" doesn't dominate runtime):** the
> requirement is **tiered**, not "full sweep every time". **SMOKE tier** = 1–2 representative models (the north-star
> `qwen3-8b` + one weak model, e.g. `gemma-4-e2b` or `phi-4-mini`) — the routine done-bar a new/changed LLM-interactive
> feature must pass before commit. **FULL tier** = all 9 models — run on a **cadence / at a milestone** (a §5.AF durable
> scheduler job once it lands), not per-change. A task's done-bar is the SMOKE tier; the FULL matrix is a periodic
> obligation tracked by the per-flow checkboxes here. The matrix itself should become a **§5.AF ledger projection** (a
> query over recorded attempts) rather than a hand-maintained table.
>
> **PHASE-2 SWEEP FINDINGS — project #1 `small-model-smoke` (fix-the-uncapped-score), 2026-06-28, 8 loaded models.**
> First pass (5min budget): 5 PASS (qwen3-8b, qwen2.5-coder-14b, gemma-4-e2b, qwen3.5-9b, nemotron-3-nano-4b), 3 fail
> (phi-4-mini-reasoning ⏱, qwopus3.5-4b-coder PARTIAL, ornith-1.0-9b interrupted). **Re-run with the generous 12-min
> budget flipped 2 of the 3 → so 7/8 PASS:**
> - **ornith-1.0-9b** was just **SLOW** — at the 5-min budget the runtime marked the session `interrupted` (heartbeat
>   lost) before it finished; with 12 min it reached `awaiting_review` and the oracle passed. **Hardening finding (below):
>   the heartbeat-loss → `interrupted` abort fires too aggressively for slow-but-progressing local models.**
> - **qwopus3.5-4b-coder** was **FLAKY** — first run left the original uncapped code (PARTIAL), next 2 runs PASS. Repeat-
>   runs are essential (a single run misleads); reliability/variance is itself a fitness signal (§5.AB).
> - **phi-4-mini-reasoning** still fails: reaches `awaiting_review` but with **"Sandbox finished with no file changes"**
>   (`reviewReason=exit heartbeat=lost`) → it reasons but **emits no edit** → no result branch captured. Pending
>   classification (capability-floor vs the reasoning-channel-no-tool-call robustness gap, §5.AB reasoning-capture note) —
>   a diagnostic run with LM Studio logs is in flight.
> - **The hermetic oracle is working correctly** — it cleanly PASSes valid fixes and flags genuinely-invalid ones (the
>   qwopus PARTIAL was a real wrong result, not a false-fail).
>
> **PHASE-2 SWEEP FINDINGS — use-case #2 `verify-decompose-isolation` (decompose / architect role), 2026-06-28, 8 models.**
> **7/8 PASS** (no host path leaked into the agent's output during a real decompose). Highlights:
> - **phi-4-mini-reasoning PASSED decompose** (843s, slow) — so the reasoning model that *can't* do agentic code-edit
>   (use-case #1) **can** do the decompose/planning role. **Validates the §5.AB routing thesis:** don't blanket-blacklist
>   a model — route it to the roles it clears (a reasoning model is fine for plan/decompose/reason, weak at tool-edits).
> - **ornith-1.0-9b FAILED → surfaced a REAL product robustness bug (FIXED 2026-06-28).** The failure wasn't a leak; the
>   session couldn't even start: **"Could not clone project into sandbox workspace: destination path '/workspaces/
>   verify-decompose-1' already exists and is not an empty directory."** Root cause: `prepareWorkspace`
>   ([nklein-agent-sandbox.ts](src/nklein-agent/nklein-agent-sandbox.ts)) `git clone`s into `/workspaces/<taskId>` (a
>   **host-level shared volume keyed by taskId**); a prior run that didn't dispose cleanly (an interrupted/aborted
>   session — the §5.AA transient-abort class above — or a reused taskId across the sweep's separate processes) leaves a
>   non-empty workdir, and git refuses to clone into it. **Fix: clear any stale workdir (`rm -rf`) before the clone** —
>   every caller (start / review-at-result / acceptance-at-result) wants a fresh clone and the clone overwrites anyway, so
>   this only turns a hard start-failure into a clean fresh clone. **This also hardens real resume-after-crash** (a task
>   whose sandbox workspace was left dirty can now restart). Verified the normal decompose path still passes after the fix.
>
> **PHASE-2 SWEEP FINDINGS — use-case #3 `verify-chat-command-exec` (CHAT-agent tool-use), 2026-06-28, 8 models.**
> Strict result 5/8; after per-model re-run triage: **effectively 6/8 PASS + 2 ◑ PARTIAL, NO !Klein bug.**
> - **PASS (echoed the command output):** qwen3-8b, qwen2.5-coder-14b, qwen3.5-9b, qwopus3.5-4b, **phi-4-mini-reasoning**
>   (33s). **phi-4 PASSES chat tool-use too** — so it fails ONLY agentic code-edit (use-case #1), and clears decompose
>   AND chat. **Decisive confirmation of the §5.AB role-routing thesis:** a model is below-bar for *a role*, not globally.
> - **nemotron-3-nano-4b = FLAKY** — INCOMPLETE in the sweep, **PASS on re-run** (echoed). Third flake observed across the
>   sweeps (qwopus #1, nemotron #3) → repeat-run reliability is a first-class fitness signal (§5.AB), not optional.
> - **gemma-4-e2b (2B) + ornith-1.0-9b = ◑ PARTIAL, not a bug.** Both **ran `run_command` successfully** and the tool
>   output **did** flow back (the stronger models echoed it fine, so delivery works) — but their final reply didn't
>   *echo the marker* (gemma stayed terse; ornith re-narrated intent "I'll run `cat MARKER.txt`" instead of reporting the
>   result). The strict oracle requires the echo as proof, so it scores INCOMPLETE — but the **capability works**; this is
>   a weak-model reply-*synthesis* gap, not a !Klein tool-delivery bug. For an autonomous agent what matters is that it
>   *uses* the output (it did), not that it echoes it. Matrix legend = ◑ (capability works, strict proof unmet), NOT ❌.
>   *(Optional future nudge, low-ROI: a §5.O post-tool "report the result to the user" prompt for weak models.)*
>
> **PHASE-2 OVERALL (3 use-cases × 8 loaded models, 2026-06-28).** Strong models (qwen3-8b, qwen2.5-coder-14b, qwen3.5-9b,
> qwopus-4b) clear all three roles. Reasoning model phi-4-mini clears decompose + chat, fails only code-edit (route it).
> Tiny models (gemma-2B, nemotron-4B) clear code-edit + are ◑/flaky on chat-echo. **Real product bug found + fixed:** the
> sandbox stale-workspace clone failure (above). **Cross-cutting findings → fitness signals (§5.AB):** generous timeouts
> matter (slow ≠ broken), **flakiness is real** (repeat-runs required), and **capability is per-role** (auto-assign, don't
> blacklist). Hardening shipped this phase: sandbox clone resilience · generous-but-bounded sweep budgets · LM Studio
> dev-log capture · loaded-model-only targeting · richer non-PASS diagnostics. Remaining model-lift work (the §5.AA ladder
> wiring + reason-then-act for phi-4 on code-edit) is queued for Phase 3.
- [x] **Harness MONITORS the LM Studio dev log for anomalies, not just captures it (2026-06-28, user) — DONE.** Pure
      detector [src/core/lmstudio-log-anomalies.ts](src/core/lmstudio-log-anomalies.ts) — `detectLmStudioLogAnomalies(lines)`
      flags all four classes: (a) **catalog hammering** (`/api/v0/models`|`/v1/models` hits over a threshold — the
      30s-TTL-cache regression alarm), (b) request errors / non-2xx, (c) model **load / unload / out-of-resources / crash**
      events (the 35B `@8bit` "insufficient resources" refusal + a deepseek mid-run drop), (d) **slow-prefill / low-throughput**
      warnings — and `summarizeLmStudioLogAnomalies` renders a one-line per-run summary (capped). Pure, 7 tests; tsc+biome
      green. **Wired:** the full-system harness exposes `lmStudioLogAnomalies()` over its captured `lms log stream`, and
      `verify-full-system` prints the summary in its triage block. (Folding into the per-model sweep-log note column for the
      lighter `verify-all-models` runs is a thin follow-up — those use a different capture path.) General rule (§4A): keep
      an eye on the LM Studio dev log during ANY live LLM work — it catches what the board trace doesn't.
- [~] **HARDENING (Phase-2 finding 2026-06-28, root-caused): a transient SDK `aborted` end parks a slow model as
      `interrupted` instead of retrying.** **CLASSIFICATION HALF DONE (2026-06-28):** added a distinct `aborted`
      `ModelOutcomeKind` (kept in lock-step across `model-behavior-profile.ts`, the `agent-attempt-ledger.ts` zod enum +
      its drift-guard, and all `Record<ModelOutcomeKind,…>` literals); `mapTerminalStateToOutcome` now maps an
      `interrupted` end with **no !Klein timeout** → `aborted` (a timed-out interrupt still → `timeout`), so a transient
      abort no longer pollutes the model's hard-failure profile and is recorded distinctly on the §5.AF ledger / §5.AG
      "what was tried" panel; `retry-policy.ts` gives `aborted` a ladder that **re-runs first** (`same_model_retry` →
      `alternate_endpoint` → `context_shrink` → `cross_model_carry`); and `agent-stuckness.ts` lists `aborted` in
      `TRANSIENT_OUTCOME_KINDS` so repeated transient aborts never escalate to `hard_stuck` on their own. Pure + tested
      (retry-policy, ledger-attempt, stuckness, profile/projection suites green). **STILL OWED (the WIRING):** firing the
      chosen retry strategy at the shared model-call seam is the broader §5.AA "wire the retry engine into the task path"
      item (line ~3633) — until that lands, the decision core picks `same_model_retry` for an `aborted` outcome but nothing
      fires it live; the generous sweep budget remains the mitigation. (When wired, gate so a *user-initiated* stop isn't
      auto-retried — `mapTerminalStateToOutcome` can't yet distinguish a user cancel from an SDK abort.) ROOT CAUSE
      (traced, not guessed): `interrupted` is set when the vendored agent
      loop emits an `aborted` done/error event **with no final text** and it isn't a reviewable aborted tool completion
      ([nklein-event-adapter.ts:483,534](src/nklein-agent/nklein-event-adapter.ts)); the `heartbeat:"lost"` stamp on that
      terminal summary is **cosmetic**, NOT a !Klein heartbeat-timeout firing. Evidence: `ornith-1.0-9b` got an aborted
      end (→ interrupted) on the 5-min sweep but **completed cleanly on the 12-min retest** — i.e. the abort was a
      **transient** (a slow model's request likely hit an SDK/endpoint-level timeout or iteration boundary), not a real
      dead end. **Durable fix = the §5.AA retry-policy ladder treating a no-output `aborted` as a RETRYABLE transient**
      (re-run the turn within the learned budget) rather than parking as `interrupted` — this is exactly the §5.AA "wire
      the chosen retry strategy at the shared model-call seam" item (`timeout`/`aborted` → retry rung). So fold this here:
      add `aborted-no-output` to the retryable-outcome table and re-run before parking. **Mitigation already in place:**
      the generous sweep budget (the slow model just needs time). Confirm via the LM Studio dev logs (now captured) that
      an abort coincides with a long/stalled request, then make the retry rung fire. (Not a heartbeat-timeout knob — that
      framing was wrong; corrected here.) **MORE LIVE EVIDENCE (2026-06-28, Low Power):** `qwen3.5-9b` on C0 went
      `running`→`interrupted` then produced NO further activity — a hard repro of the park-instead-of-retry: the session
      gave up at the transient abort and never finalized (the harness's new stall detector aborted it at 360 s,
      `delivered=NO`). Under Low Power (~50% throughput) the transient-abort window is hit more often, so this `[~]`
      wiring is the concrete lift for the qwen3.5-9b ⚠️ (and the general slow-finalize class) — until it fires, slow
      models park as `interrupted`/STALLED rather than retrying through.
- [ ] **Per-model classification + "failing-LLM list" (Phase-2, 2026-06-28) — provisional, until the §5.AB fitness store
      lands.** small-model-smoke (code-fix role): **7/8 deliver** with a generous budget; **phi-4-mini-reasoning** is the
      lone non-deliverer (reasons, no edit) — provisionally a **capability-floor for the code-edit role** (a 3.8B *reasoning*
      model, not a coder) UNLESS the diagnostic shows it's the reasoning-no-tool-call gap (then it's a §5.O/§5.AB hardening
      fix, not a floor). qwopus3.5-4b-coder = **capable-but-flaky** (needs repeat-run tolerance). Record these in the
      §5.AB fitness store (per role × difficulty × context-size) when built; the "failing-LLM list" is the projection of
      below-bar (model,role) cells, not a hand-list.
  - [ ] **phi-4-mini-reasoning CONFIRMED non-deliverer for agentic code-edit (2026-06-28, LM Studio logs).** Across 3
        runs it consistently ends "Sandbox finished with no file changes" / never reaches a captured result. The LM
        Studio dev logs (now captured) show it **ruminating in its reasoning channel** ("Wait not sure", "Alternatively…",
        speculating about the formula) and emitting **no tool-call / no edit** at all. So this 3.8B *reasoning* model is a
        poor fit for **agentic tool-driven coding** (it's tuned for chain-of-thought answers, not tool loops). **Provisional
        verdict: below-bar for code-edit on the CURRENT (thin) ladder — but NOT a confirmed capability-floor yet,**
        because it has not been through the full §5.AA ladder. Before the floor verdict is final, try the **reason-then-act
        rung** (§5.AA, user idea 2026-06-28: let it reason which tool call applies, then constrained-decoding forces the
        emit) + **constrained-decoding fallback** + **endpoint-iteration** (native reasoning channel) — phi-4-mini-reasoning
        is the canonical test case for those rungs. If they still don't get an edit out of it → confirmed floor → failing-
        LLM list for code-edit, and let §5.AB auto-assign route it to non-agentic roles (reasoning/review) where its
        chain-of-thought is an asset. (Reasoning-channel capture tracked in §5.AB; the ladder rungs in §5.AA.)
- [x] **Sweep driver + results matrix (DONE 2026-06-26)** — `scripts/verify-all-models.mts` iterates the loaded roster,
      pins each model via `NKLEIN_VERIFY_MODEL` (per run a fresh isolated HOME; user settings untouched), runs a named
      harness, applies the deepseek-drop caveat (gone from `/v1/models` → DROPPED + continue), and appends a per-model
      result block + matrix row to `cross-model-verification.md`. Validated end-to-end on the decompose sweep.
- [x] **Decompose & planning (`verify-decompose-isolation.mts`) — ✅ ALL 9 PASS (2026-06-26).** Clean sweep across the
      whole roster, **zero host-path leaks on every model** incl. deepseek (243s, did NOT crash this run) and both phi
      reasoning models. Fast: gemma-e2b 18s / nemotron 24s / qwen3-8b 24s; slow reasoning: deepseek + phi-4-mini ~243s,
      phi-4-reasoning-plus 167s. !Klein decompose+isolation is robust regardless of model.
- [x] **Single-card implementation → awaiting_review + result branch (`verify-task-completion.mts`) — 8/9 deliver
      (2026-06-26).** ✅ qwen3-8b 18s · coder-14b 26s · gemma-e2b 12s · gemma-e4b 10s · phi-4-mini 10s · deepseek 82s
      (no crash) · phi-4-reasoning-plus 226s — each wrote `hello.txt`, captured a result branch, reached awaiting_review.
      **nemotron-3-nano: ✅ but SLOW** — INCOMPLETE at the 300s cap, delivered cleanly at 540s (work done early, then a
      long token-by-token final message pushed termination past 5 min). **qwen3.5-9b: ⚠️ CANT** — wrote + read the file
      correctly (activities #2-6) then **looped re-emitting its "Done!" final message and never reached a terminal state
      even at 540s**, so the result branch was never captured (correct work stuck in the sandbox). Tools were recognized
      (NOT a parse gap); the wall-time/no-diff guardrail parks it in a real run, just slowly → hardening candidate below.
- [x] **Planning→In-Progress promotion / auto-promote recovery (`verify-autopromote-recovery.mts`) — 8/9 advance
      (2026-06-26).** ✅ qwen3-8b, coder-14b, qwen3.5-9b, gemma-e2b/e4b, phi-4-reasoning-plus (190s, via
      begin_implementation), nemotron, deepseek (19s, no crash) — the card reaches In Progress via the recovery path or
      begin_implementation. ⚠️ phi-4-mini timed out at 304s (stuck refining in Planning, never wrote/promoted — a
      capability/speed floor for the 3.8B reasoning model; it passed single-card in 10s, so the §5.B refinement-lane
      preamble is the harder ask). **KEY ASYMMETRY:** phi-4-reasoning-plus PASSES here (the SWARM path, which has the
      narrated recovery) yet FAILED both chat tools (the CHAT path, which lacks it) — near-conclusive evidence for the
      chat-path narrated-recovery fix below.
- [~] **Strict Docker isolation on a real task** (`verify-strict-isolation.mts`) + **restart/resume isolation**
      (`verify-restart-resume-isolation.mts`). **strict-isolation SWEPT (2026-06-28): 8/8 PASS** across the loaded roster —
      qwen3-8b (re-confirmed on HEAD), gemma-4-e2b, qwen2.5-coder-14b, nemotron-3-nano, qwen3.5-9b, phi-4-mini-reasoning +
      2 newer models (qwopus3.5-4b-coder, ornith-1.0-9b). Each: sandbox container appeared, **no host worktree**,
      containers cleaned up. Matrix: 6 of the 9 roster columns now ✅ (rows in [cross-model-verification.md](docs/dev/cross-model-verification.md));
      the remaining 3 (gemma-e4b, phi4-plus, deepseek) are **not currently loaded** — run when loaded. **Observation:** every
      model ended `interrupted` (the harness asserts isolation, not completion, on a short task) — confirms the no-output
      `interrupted` terminal state is common (validates the §5.AA `aborted` classification). **restart-resume SWEPT
      (2026-06-28): 6/6 PASS** — a task resumed after a simulated runtime restart re-preps its Docker sandbox with no host
      leak: qwen3-8b (re-confirmed), gemma-4-e2b, coder-14b, nemotron, qwen3.5-9b, phi-4-mini-reasoning (same 6 of 9 matrix
      columns). **Both isolation flows remaining:** the 3 roster models not currently loaded (gemma-e4b, phi4-plus,
      deepseek) — run when loaded.
- [~] **Chat agent tool loop (`verify-chat-*` family) — sweeping per-capability (2026-06-26).** The **deterministic
      single-tool** harnesses are the meaningful per-model proofs (sweeping below). **The 4-tools-in-one-turn
      `verify-chat-agent-e2e` capstone is FLAKY even on qwen3-8b** (run 1: 1/4 tools, stopped after read_file; run 2:
      3/4 tools — read+run_command+create_card with durable side effects holding [marker echoed + card persisted] —
      but skipped update_focus_chain, which it only claimed in text). The agent loop is **unchanged since the capstone
      was first proven** (`9b15e3e3`, after the §5.O loop edits), so this is stochastic composition, NOT a regression
      → **§5.M G7's "PASSES reliably" was optimistic** (corrected). Per-model chat capability is proven by the
      individual sweeps, not the capstone. Sub-sweeps:
  - [x] `run_command` (`verify-chat-command-exec`) ACROSS ROSTER (2026-06-26) — **the command EXECUTES at runtime for
        7/9**: ✅ call+echo (qwen3-8b, coder-14b, nemotron); ◑ EXECUTED-but-weak-reply (gemma-e2b/e4b, qwen3.5-9b,
        deepseek — `run_command` ran, but the model's reply didn't echo the output: weak synthesis, not a !Klein bug);
        ❌ never emitted a tool call (phi-4-mini, phi-4-reasoning-plus). The user's "things execute at runtime" works
        broadly; the 2 non-callers feed the chat-path narrated-recovery candidate below.
  - [x] `create_card` (`verify-chat-create-card`) ACROSS ROSTER (2026-06-26) — **7/9 ✅** (clean durable gate: the card
        must persist on the board). The 4 run_command-◑ models (gemma-e2b/e4b, qwen3.5-9b, deepseek) **ALL ✅** here →
        confirming their run_command issue was reply-synthesis, NOT tool-calling. ❌ only phi-4-mini + phi-4-reasoning-plus
        — the SAME 2 models that failed run_command → they don't emit chat tool calls at all (strong evidence for the
        narrated-recovery candidate below; the other 7 models call chat tools fine).
  - [~] `browse_url` (`verify-chat-browse`) across the roster — headless browser (self-serves a page + chromium).
        **RESOLVED 2026-06-28 — the earlier "blocker" was a COMMAND bug in my sweep, not the harness or !Klein:** I passed
        `PLAYWRIGHT_BROWSERS_PATH=~/...` on the same command line as `HOME=<isolated>`, so the shell expanded `~` to the
        **isolated** HOME → empty browser cache → `chromium.launch` failed, which the browse tool surfaces as the generic
        "page could not be loaded / navigation timed out". With an **absolute** `PLAYWRIGHT_BROWSERS_PATH` (and Playwright's
        chromium installed — two tree versions want headless_shell-1208 and -1228, both now cached), **browse_url works**:
        Chromium rendered the local page and text flowed back — qwen3-8b + coder-14b each reported the page heading.
        coder-14b → ◑ (the strict gate greps the body MARKER; the model answered with the heading — stochastic synthesis,
        same ◑ as run_command); qwen3-8b's ✅ stands. Remaining roster models can be swept the same way (absolute path).
  - [x] **chat read tools / write tool / send / runtime — SWEPT 2026-06-28 (+ 2 harness bugs fixed).** Across the loaded
        roster: **write/send/runtime PASS for all** (qwen3-8b, coder-14b, qwen3.5-9b, gemma-e2b, nemotron — the gated
        write confirm-gate + audit, the basic turn+persist, and the memory+goal-composed turn all work); **read-tools** is
        ✅ for qwen3-8b/coder-14b and ◑ for qwen3.5-9b/gemma-e2b/nemotron (read executes + audits correctly, but those
        models don't echo the secret in the reply — weak synthesis, same ◑ as run_command). **Fixed 2 stale harness bugs
        found by the sweep:** `verify-chat-agent-tools` checked `record.detail === "read_file"` but `detail` is the path
        arg (tool id is `record.action === "sandbox_read"`) → falsely failed every model; `verify-chat-agent-write` never
        `mkdir`'d its temp workspace → `realpath` ENOENT FATAL for every model. Both fixed; matrix rows updated.
- [x] **HEAD regression gate — core LLM-interactive flows re-confirmed across the small tier (2026-06-30).** After this
      session's changes (SB#3 boot-replay fold, B1 credit-limit alignment, raw-NUL hygiene, §5.AC date-only temporal),
      re-ran the live verifications across **three sizes/architectures** to prove no regression: **qwen3-8b** (Qwen3)
      PASSES all four — temporal, chat-send, chat-runtime, `create_card` tool-use (clean, exit 0); **gemma-4-e4b** (Gemma4,
      4B, distinct arch) PASSES temporal + `create_card`; **qwopus3.6-27b-v2-mlx** (Qwen3.5 MLX — first check on this
      model) PASSES temporal/chat-send/chat-runtime, and `create_card` genuinely persisted the card but the run **timed
      out** (Low Power Mode + a 27B is too slow for a multi-turn tool task — a HARDWARE limit, not a !Klein issue; the
      8B/4B do the identical task cleanly in-window). Done via a guarded load/unload cycle (1-resident-at-a-time, ctx
      40000, headroom-safe by swapping big→small so net RAM drops); the user's 27B was **restored exactly** (28.60 GB, ctx
      40000) and the m4mini embedding never touched. **No robustness gaps surfaced 4B→27B** — the core flows are solid
      across the practical small-model range. (Also fixed the desync where the date-only win had broken
      `verify-temporal-awareness-live`'s `<current_datetime>` assertion — committed separately.)
- [x] **Autonomous chat run** (`verify-chat-autonomous-live.mts`) — **RE-CONFIRMED end-to-end on HEAD (2026-06-28).**
      After creating a dev-test project (→ current project + active workspace) and pinning the model on a fresh dev:full,
      qwen3-8b **PASSES**: "✓ Goal complete · 1 turn · 1/1 steps", transcript = 2 messages, `stopped: true` — the §5.0.1
      autonomous loop drives a real local model to goal-complete with persisted turns. (The earlier "needs input · 0
      transcript" on the *empty-board* run was the no-workspace early-pause at chat-autonomous-wiring.ts:99, NOT a bug —
      the harness needs a project/workspace in scope, not just a pinned model.) Remaining roster models pending (each needs
      the same project+workspace setup). **ROOT-CAUSED 2026-06-28 — NOT a bug; my test env was incomplete:** traced to
      [chat-autonomous-wiring.ts:99-102](src/chat/chat-autonomous-wiring.ts#L99) — when `assembleTurnDeps` returns null
      (**no active workspace OR loaded model**), the run sets `userQuestion = "Autonomous work paused: no active workspace
      or loaded local model. Open a project / load a model, then resume."` and returns `{finalText:"", steps:[]}` WITHOUT
      running a turn → exactly "needs input · 1 turn · 0 messages". My fresh isolated-HOME dev:full had **no project /
      workspace** (empty board), so the run correctly early-paused before calling the model. So the §5.0.1 loop core is fine
      and the prior ✅ stands; my earlier "tool-only turn doesn't persist" hypothesis was WRONG (`runChatAgentTurn` always
      appends user+assistant, [chat-agent-turn.ts:124](src/chat/chat-agent-turn.ts#L124)). **To re-verify autonomous-run
      live:** the harness needs a project CREATED + a workspace active in the session scope (not just a model pinned) before
      starting the run. Boot
      recipe confirmed: `npm run dev:full` skips `npm ci` when deps are installed; **use an ABSOLUTE `PLAYWRIGHT_BROWSERS_PATH`**
      (a `~` after `HOME=<isolated>` expands to the isolated HOME → no chromium). Remaining roster models pending.
- [ ] **Multi-card pipeline e2e**, decomposed:
  - [ ] Build `verify-multi-card-pipeline.mts` test harness with multi-card chaining on qwen3-8b
  - [ ] Sample 2-3 representative mid-tier models (not full 9-model sweep)
  - [ ] Record per-model results matrix row in cross-model-verification.md
  - [ ] Verify no host-path leaks + correct card chain execution
- [~] **Small-model output robustness** (`sweep-capture.mts`) — proven clean: gemma-4-e2b (mid+complex), gemma-4-e4b
      (complex), qwen3-8b (mid+complex, slow/non-terminal in window). **mid_task sweep extended 2026-06-28** (against a
      booted isolated-HOME runtime on :3484): **qwen2.5-coder-14b ✅ CLEAN** (awaiting_review, 0 leaks/0 repeats);
      **nemotron-3-nano ✅ CLEAN** (awaiting_review, 0 leaks/0 repeats); **qwen3.5-9b ◑** — output FORMAT clean (0 narration
      leaks) but did NOT terminate in 300s (78 tool calls incl. read_files×54 heavy re-reading + 1 hot repeated tool call):
      a **control/finalization** gap (the §5.AA `aborted`/final-answer-watchdog + retry-ladder territory), NOT a parse/output
      issue. **KEY finding:** across every model swept, narration-leak count is **0** — the §5.O parse-and-recover hardening
      holds; the remaining non-termination cases are §5.AA control problems, not output-format problems. Remaining:
      phi-4-mini-reasoning (sweeping), phi-4-reasoning-plus + deepseek (not currently loaded) + the unfinished presets.
      (Folds into §5.O — that section IS the output-robustness sweep; §5.Z just tracks its all-models coverage.)
  - [ ] Finish phi-4-mini-reasoning sweep (in progress)
  - [ ] Sweep phi-4-reasoning-plus + deepseek (await load)
  - [ ] Complete unfinished output-robustness presets in §5.O
  - [ ] Update cross-model-verification.md with final sweep results
- [ ] **Embedding / code-intelligence flows**, decomposed:
  - [ ] Sweep current embedder (`text-embedding-nomic-embed-text-v1.5@q8_0`) across use cases
  - [ ] Record results in cross-model-verification.md
  - [ ] Re-run with each new loaded embedder (add to roster watch list)
- [x] **Temporal-awareness lighthouse (§5.AC) — ALL 9 PASS (2026-06-26)** (`verify-temporal-awareness-live.mts`) — a real
      chat turn with the host clock injected; asserts the model grounds in the injected "now" (places a current-year past
      month in the past, which its ~2024 training prior would call the future). **9/9 across the whole roster**: gemma-4-e2b
      (2B), gemma-4-e4b, qwen3-8b, qwen2.5-coder-14b, qwen3.5-9b, nemotron-3-nano-4b, phi-4-mini-reasoning,
      phi-4-reasoning-plus, **deepseek-r1** (no crash this run — replied *"According to the authoritative current date/time
      (groundtruth), today is 2026-06-26 … in the past, as it occurred earlier this year"*, quoting the block verbatim).
      The lighthouse is robust regardless of model.
      - **(2026-06-30) Desync fix + re-verify on a 27B.** The §5.AC date-only cache-stability win (default block is now
        `<current_date>`, not `<current_datetime>`) had silently broken this script's two `<current_datetime>` assertions →
        it reported a false **INCOMPLETE** (model behavior was correct all along). Fixed to prefix-match `<current_date`
        (covers BOTH `<current_date>` and `<current_datetime>`). **Re-verified live on `qwopus3.6-27b-v2-mlx`** (resident,
        USE-only — no load): **PASS ✓** all four — block carries today + leads the prompt, reply grounds year 2026, and
        places `2026-03-01` in the PAST (training-prior overridden; the model's own reasoning quoted the injected
        "Authoritative current date … 2026-06-30 (Tuesday)"). The first 27B confirmation, post-date-only-change.
> **Sweep-derived hardening candidates (record-as-found; promote to §5.O when worked):**
- [x] **Final-answer-repeat finalization watchdog — WIRED + TESTED (2026-06-28)** (from the qwen3.5-9b single-card sweep).
      A model that finishes the work then **loops re-emitting an identical no-tool "Done!" final message** used to sit
      `running` until the slow no-diff/wall-time budget parked it (default 20 no-diff checkpoints), so the already-done work
      stayed stuck. **Fix:** a **5th `AutonomyBudgetWatchdog` guardrail** (`repeated_final_answer`,
      [autonomy-budget-watchdog.ts](src/nklein-agent/autonomy-budget-watchdog.ts)) parks for review after
      `NKLEIN_MAX_REPEATED_FINAL_ANSWERS = 3` consecutive review checkpoints that re-emit the **same** whitespace-normalized
      final message at the **same commit** (no new diff). Seam confirmed by the trace: a no-tool final answer is emitted
      only at the `result`/`done` → `awaiting_review` transition (which is exactly when the watchdog runs), and requiring
      no-new-commit too means a genuinely-progressing task is never parked on message text — it's a faster (3 vs 20),
      more-specific variant of the no-diff guard. Reuses the exported `normalizeFinalAnswer`; resets per task. 5 watchdog
      tests (parks on 3 identical@same-commit; no park on varying text; no park on identical text with new commits; no-final
      cleared + resetTask) + the 7 `detectRepeatedFinalAnswer` detector tests; tsc+biome+suite green. **Opportunistic
      follow-up (not blocking):** observe a live park when a model exhibits the loop (`NKLEIN_VERIFY_MODEL=qwen3.5-9b-mlx-m5max
      NKLEIN_VERIFY_DUMP_ACTIVITIES=1 tsx scripts/verify-task-completion.mts`) — the loop is stochastic so it isn't a
      deterministic gate; the unit tests + the traced data-flow are the verification. **Detector** (also usable standalone /
      chat-path): `detectRepeatedFinalAnswer(finalAnswers, {minRepeats=3, minLen})`
      ([nklein-response-loop-detection.ts](src/nklein-agent/nklein-response-loop-detection.ts)) — pure + deterministic,
      takes the ordered NO-TOOL final-answer texts and reports the trailing identical run; the watchdog guardrail uses the
      same `normalizeFinalAnswer` with its own incremental {message,commit,count} state (mirroring the no-diff guard). NB
      the repeated-*tool-call* case is separately handled by `RepeatedToolCallGuard` (on `emitSummary` while running), so
      this watchdog targets the distinct no-tool final-message loop.
- [x] **Chat-path narrated-tool-call recovery — DONE (2026-06-26)** — `completeWithTools`
      ([nklein-local-llm-client.ts](src/nklein-agent/nklein-local-llm-client.ts)) used to parse ONLY LM Studio's native
      `tool_calls`; it now also runs `parseNarratedToolCalls` over the model's `content` **and** `reasoning_content`
      when tools were offered but no structured call came back — mirroring the swarm path's `afterModel` recovery so a
      model that narrates its call as text in the chat surface still gets dispatched. Added the **Microsoft Phi
      `[TOOL_REQUEST]{…}[END_TOOL_REQUEST]`** format to `parseNarratedToolCalls` (shared with the swarm path) + 3 unit
      tests. **BUT the live phi diagnostic (calling `completeWithTools` against phi-4-mini directly) showed this does NOT
      by itself fix phi:** with a SIMPLE 1-tool prompt phi emits a clean STRUCTURED `tool_call` (LM Studio normalizes it),
      so phi CAN call tools — it fails the 6-tool `create_card`/`run_command` harness because of **task COMPLEXITY** (too
      many tools + the full agent-loop prompt), not narration. That insight launches the new **[§5.AA](#5aa)** adaptive
      model-robustness arc. **DONE (2026-07-07 verify):** `stripNarratedToolCallMarkup` already handles plain-prose
      `Tool call: name(args)` (via `PLAIN_PROSE_TOOL_CALL`) — both strip (display) and recover (execute, via
      `parsePlainProseToolCalls`) paths ship with unit coverage in `nklein-narrated-tool-call.test.ts`.
>
> **Open LLM-interactive tasks inherit this requirement automatically** — when §5.0.1 (autonomous agent), §5.S
> (auto-clarify), §5.V (pipeline / chat e2e), §5.H (native-core integration), §5.B (audio rubric scoring), etc. reach
> their live-verify step, that step means **all loaded models**, recorded in the matrix — not a single-model proof.


### 5.U — Deep architecture refactor: no large monolith files *(migrated from todo.md 2026-07-06; ACTIVE — Opus polishing flagship)*
> **Goal:** decompose the large monolith files into cohesive, single-responsibility modules — **behavior-preserving +
> test-gated**, one bounded cluster per commit, the existing tests as the safety net (NEVER weaken a test to pass a
> refactor). **The extraction pattern (§4A tribal knowledge):** pull a PURE sub-computation (or a DI-injectable I/O helper)
> out of a monolith into a new focused module + its own unit test; the original imports it back and delegates. No ripple
> when the moved cluster's deps are all shared-module imports. For I/O helpers (retry loops, poll loops), inject `sleep` /
> the probe functions so the control flow is deterministically testable without real timers or live services.
>
> **Live tally (see [docs/dev/autonomous-run-2026-07-05.md](docs/dev/autonomous-run-2026-07-05.md) for the per-slice log):**
> - `nklein-provider-service.ts`: 1651 → **933** — extracted `nklein-provider-settings-summary`, `nklein-litellm-model-list`,
>   `nklein-managed-provider-credentials`, `nklein-provider-selection-store`, `nklein-model-list-settings`,
>   `nklein-kanban-access-policy`, and `nklein-baseurl-model-discovery` (the two base-URL fetchers + direct fetch-mocked
>   coverage — §5.U+§5.V) (+ 3 earlier).
> - `runtime-server.ts`: 2527 → **2230** — extracted `bounded-dedup-set`, `workspace-state-lock-retry`, `review-sandbox-result`,
> - `runtime-server.ts` (cont.): also lifted `terminal-retry-sweep-policy` — the pure debounce/redrive-bypass gate out of
>   `retryWaitingCardsAfterTerminal` (the redrive-BYPASSES-debounce invariant was inline + untested; +4 tests).
> - `runtime-server.ts` (cont.): lifted `speculative-delivery-target` — the pure §5.AW best-of-N delivery-branch choice
>   (in-process reviewPreferred authoritative over the persisted fallback; delivered-only), inline + untested (+5 tests).
>   `runtime-server-http` (readRequestBody + getRemoteIp), `nklein-runtime-terminal-telemetry` (the two terminal-summary
>   telemetry recorders), and `nklein-plan-integration-gate-runner` (the server-side plan gate) — the last two lifted from
>   INSIDE the createRuntimeServer closure.
> - `nklein-mcp-runtime-service.ts`: 949 → **762** — extracted `nklein-mcp-oauth-settings-store` + `nklein-mcp-transport-factory`
>   + `nklein-mcp-oauth-callback` (all were untested → +26 tests).
> - `nklein-agent-sandbox.ts`: 1090 → **1071** — extracted `nklein-agent-sandbox-predicates` (was untested → +4 tests).
> - `nklein-event-adapter.ts`: 806 → **768** — extracted `nklein-event-adapter-tool-activity` (was untested → +3 tests).
> - `nklein-large-file-workflow.ts`: 781 → **740** — extracted `nklein-large-file-workflow-helpers` (was untested → +10 tests).
> - `nklein-task-session-service.ts`: 4886 → **2773** (−43% across the run) — the flagship. After the pure-fn lifts +
>   ~13 collaborator splits (residency/lease/focus-chain/team-progress/park/timeout/sandbox-review/context-budget/
>   failure-emitter/retrieval), the AUXILIARY-SECONDARY-SESSION seam (acceptance/reviewer-selection/harness/mirror/merge/
>   second-opinion/plan-critique runners), the adaptive-budget + context-overflow controllers, the §5.AQ prompt-warmth
>   ledger, and the runtime observation recorders. **Remainder = the entangled PRIMARY lifecycle** (startTaskSession /
>   sendTaskSessionInput / dispatchResolvedTaskInput / handleTaskEvent) — a David-gated boundary (approve the seam first,
>   as with the review-cluster).
> - `nklein-session-runtime.ts`: 1487 → **1228** (−259) — extracted the whole `kanban-context-focus` SDK runtime extension
>   into `nklein-context-focus-extension.ts` (beforeModel/afterModel/afterTool hooks: repo-map orientation, §5.N focus-chain +
>   §5.AD goal re-anchor, §5.O two-phase narrowing, narrated-call recovery, stall self-observation, large-file workflow). Moved
>   the two module-**global** re-anchor maps into the new module behind 3 accessors (record/forget/clearAll) — net encapsulation
>   win. `doesNKleinToolInvalidateRepoMap` re-exported so the existing test is untouched (test net unweakened). Verbatim move.
> - **Post-Fable additive slices (Opus):** `fitness-table-view` (§5.AL read endpoint + pure view builder, +5 tests) ·
>   `board-dag-model` (§5.U/§5.V web — extracted the DAG view's cycle-detection/layout, +10 tests). §5.Z (live env,
>   heavy roster + egress live): egress e2e 6/6 · chat-agent-tools 6/6 (+W3.1 regression) · command-exec + decompose-
>   isolation re-confirmed — all logged in cross-model-verification.md.
> - **57 slices so far (35 §5.U extractions + 22 §5.V coverage batches), ~350 new unit tests, zero behavior changes** (pre-commit
>   fast suite gates each). §5.V high-value pure-logic coverage SATURATED (slice 42). **Slices 56–57 diversified to provider-service
>   1463 → 1291 (−172): CustomProviderManager (custom-provider CRUD) + ModelDiscoveryApi (catalog/models/endpoint-discovery), each
>   with a fail-closed-on-cloud security test. task-session-service 4886 → 4040 this run
>   (−846, ~17%) — 10 collaborator splits (residency 45, lease-cache 47, focus-chain 48, team-progress 49, ParkController 50,
>   TimeoutController 51, SandboxReviewFinalizer 52 [−286, biggest], ContextBudgetController 53 [−87], TaskFailureEmitter 54 [−69],
>   RetrievalToolsBuilder 55 [−66, +live fail-closed test]) + wrapper cleanup (46). All three entangled splits (Park, Timeout,
>   SandboxReview) proved autonomously safe when the boundary is clear; the Timeout split even IMPROVED coverage.**
>   Flagship patterns proven: (1) lift pure `this`-free private methods into core guard modules,
>   (2) lift state-free INNER closures out of the big createRuntimeServer / class bodies, (3) lift pure sub-computations out of
>   stateful methods — all safe, behavior-preserving + coverage-adding.
>
> **§5.V api-validation coverage — COMPLETE (slices 21–26, +57 tests):** all ~35 `src/core/api-validation.ts` parsers with
> real post-schema logic (trim / emptiness / normalization / dedup / tolerant-null) are now characterized. The remaining ~5
> (advisor build/send, dogfood, config-save, workspace-state-save) are PURE `schema.parse` passthroughs — intentionally left
> (a test would only re-assert Zod; the schema IS the contract). The untrusted tRPC input boundary is now covered.
>
> **§5.V veins DONE:** api-validation (all logic-bearing parsers), runtime-config-normalizers (7 gaps), speculative +
> retrieval resolver normalizers + self-observation severity guard, server path/host helpers (normalizeRequestPath +
> getAllowedHostHeaders, slice 29).
>
> **A broad src-wide coverage-gap scan (slice 29) shows substantial veins REMAIN — the backlog is NOT winding down.** Ranked
> by untested-export count, prioritizing security-relevant + pure:
> - ~~`security/passcode-manager.ts` (4) — SECURITY~~ DONE slice 30 (rate-limiter, +6 tests).
> - ~~`core/windows-cmd-launch.ts` (3) — SECURITY-adjacent~~ DONE slice 31 (escaping/launch builders, +5 tests).
> - ~~`commands/task/task-plan-gap-prompts.ts` (4)~~ DONE slice 32 (+8 tests). ~~`nklein-context-window-policy.ts` (3)~~ DONE
>   slice 33 (+3 tests).
> - ~~`nklein-agent/nklein-task-start-guard.ts` (3)~~ DONE slice 35 (+7). ~~`decomposition/plan-task-routing.ts` (3)~~ DONE
>   slice 34 (+7, left the heavier previewNKleinPlanTaskGraph orchestrator).
> - ~~`core/runtime-endpoint.ts`~~ DONE slice 36 (origin builders, +3; TLS getter + fetch-timeout installer skipped).
> - ~~`nklein-agent/nklein-session-state.ts` (17) — the big vein~~ DONE slices 37–39 (+19 tests, all 17 exports: pure helpers,
>   clones, builders, and the entry mutators incl. the full tool-call lifecycle).
> - ~~`nklein-provider-model-parsing.ts`~~ DONE slice 40. ~~`operator-board-health.ts` summarizeBoardHealth~~ DONE slice 41.
>   ~~`runtime-config.ts` toGlobalRuntimeConfigState~~ DONE slice 42.
>
> **§5.V HIGH-VALUE COVERAGE SATURATED (slice 42 finding).** A broad scan (export function + const, all of src) shows the
> remaining untested exports are dominated by `*-api-contract.ts` Zod SCHEMA/type declarations — transitively tested via the
> now-fully-covered parsers + every consumer; a direct test would only re-assert Zod. The rest of the tail is LOW-VALUE:
> trivial path-joins (getRuntime*ConfigPath), I/O-bound fns (dev-test-project-registry, sentry-node), and vendored
> SDK-boundary passthroughs. Do NOT pad with schema smoke-tests. If a future change adds real post-schema/pure logic, cover
> it then. Optional genuine-but-modest leftovers: `summarizeWorkspaceBoardStreams` (streams/staleness path).
> - `core/runtime-endpoint.ts` (4) — url/endpoint builders (some already tested; check the gaps).
> - `nklein-agent/nklein-session-state.ts` (17) — LARGE but mixed: many are stateful mutators (createMessage/updateSummary)
>   — triage for the genuinely pure ones only.
> - SKIP: `sdk-runtime-boundary.ts` (7) / `sdk-provider-boundary.ts` (4) — thin vendored-SDK passthroughs (testing wraps the SDK).
>
> Method unchanged: `grep -w` untested exported fns → read body → characterization tests, no source change; skip
> `schema.parse` passthroughs, singleton getters, I/O handlers, and SDK wrappers.
>
> **§5.U THIRD PATTERN (2026-07-06, slice 43):** beyond (1) lifting pure `this`-free methods and (2) lifting state-free inner
> closures, there's (3) **lifting a PURE sub-computation OUT of a stateful method** — the method keeps its IO/orchestration and
> delegates the pure step to a new tested module. Reviewer-candidate selection (`resolveWorkerRealId`/`buildReviewerCandidates`)
> came out of `pickDiverseReviewerModel` this way (+5 tests, service 4873→4859). This reopens safe, bounded flagship progress.
>
> **★ §5.U REVIEW-CLUSTER SEAM PROPOSAL (2026-07-06, awaiting David's approval — he chose "propose a seam, I approve first").**
> The cluster is bigger than first estimated: **~1100 lines** (task-session-service 2513→~3630), 7 public methods + 3 helpers +
> 3 state fields: `verifyTaskAcceptanceInSandbox`, `pickDiverseEscalationModel`, `runSecondOpinionReviewSession`(+Inner) +
> `pickDiverseReviewerModel` + `inFlightSecondOpinionReviewTaskIds`, `runSpeculativeMirrorSession`+`cancelSpeculativeMirror` +
> `canceledSpeculativeMirrorTaskIds`, `runPlanCritiqueSession`+`buildPlanCritiqueRequestHandler` + `planCritiqueRuns` budget,
> `runMergeResolutionSession`.
> **The boundary IS clear once named (resolves the "ambiguous" worry):** this is the **AUXILIARY SECONDARY-SESSION** concern —
> every method spins up a bounded, sandboxed, `::`-suffixed SYNTHETIC session (`::review` / `::plan-critique` / `::acceptance`
> / mirror) to EVALUATE/ASSIST the primary task, then collects a typed verdict and tears down. They share one machinery:
> resolve a diverse model → build a launch config → `prepareWorkspace` (bounded queue wait) → `setSandbox` → run ONE bounded
> turn via `startRuntimeTaskSessionFromLaunchConfig` with an `onXSubmitted` callback → collect verdict → dispose. Crucially they
> DEPEND ON the core session-spawn (one dep) but DO NOT touch the primary start/stop/send/abort lifecycle — a clean dependency
> DIRECTION, not entanglement. That is the seam.
> **Recommended shape (2 layers, ~6 bounded commits):** (1) extract a shared `SecondarySessionHarness(deps)` — the spawn/wait/
> collect/teardown skeleton; (2) then move each runner onto it as its own commit: ReviewRunner (+diverse-model pick + inFlight
> guard), PlanCritiqueRunner (+budget), SpeculativeMirror (+cancel guard), MergeResolutionRunner, AcceptanceVerifier. Net: the
> single biggest reduction (~1100 lines; task-session-service 4040 → ~2950). Deps (~10 accessors): getAgentSandboxManager,
> getLaunchConfig, getSandboxState, startRuntimeSession, recordObservation, getPauseController, modelEndpoint/providerId
> accessors (for the diverse-model pick), emit pipeline.
> **Risk + test strategy:** no fast-suite net (contract/integration only) → verbatim moves + NEW characterization tests with
> mocked deps per runner (asserts: respects the in-flight/cancel/budget guards; fails closed when no sandbox; wires the right
> synthetic taskId + launch config), with the contract/integration suite as the behavioral backstop. **Three decisions for
> David:** (a) confirm "auxiliary secondary-session" is the seam; (b) granularity — the 2-layer 6-commit split (rec) vs one big
> AuxiliarySessionOrchestrator commit; (c) OK to use characterization tests as the net for this tier.
> **★ SEAM COMPLETE (2026-07-06, 6/6):** all auxiliary secondary-session runners extracted, each gated by
> tsc+biome+fast+swarm-deterministic-pass, behavior byte-identical. 1 AcceptanceVerifier · 2 pickDiverseReviewerModel ·
> 3 SecondarySessionHarness (+review) · 4 PlanCritique(on-harness) · 5 SpeculativeMirror(standalone) · 6 MergeResolution
> (standalone). **task-session-service 4886 → 3392 (seam) → 3293 (+adaptive-budget cluster, `b03a2854`) this run.** The
> adaptive-budget/quality-budget cluster: `createAdaptiveBudgetController(deps)` owns the W2.3a learned quality budgets (read
> by ContextBudgetController) + the W1.1b stall-signature adaptive retry, all 3 state maps/flags; verbatim move, lazy-arrow
> deps, 5 characterization tests, gated incl. swarm-deterministic-pass. **→ 3157 (+context-overflow cluster, `0652a6f7`):**
> `createContextOverflowController(deps)` owns the reactive `recoverAfterOverflow` + proactive `compactBeforeOverflow`; their
> identical restart-or-rebuild tail collapsed into one `restartOrStartWithMessages` helper (DRY win), 6 tests. **→ 2773
> (2026-07-06 iteration, +4): prompt-warmth ledger (`ad57d82b`, zero-dep self-contained), second-opinion review runner
> (`5ec0f3aa`) + plan-critique runner (`1e858df7`) — the review-session cluster now FULLY extracted as standalone
> harness-based runners — and the runtime observation recorders (`e6f8c045`, +§5.V coverage of previously-untested wiring).
> task-session-service 4886 → 2773 (−43%); every cohesive AUXILIARY cluster extracted, the remainder is the entangled
> primary lifecycle (David-gated boundary).** Learnings:
> review + plan-critique share the harness
> (void runBoundedTurn, additive primaryTaskId-optional baseRef); mirror + merge diverge (own boolean/settled-timeout
> runBoundedTurn, cancel-state / git-merge reproduction) → standalone via the named StartRuntimeTaskSessionFromLaunchConfigInput
> dep-type (shared nklein-runtime-session-input module). The original approval below.
>
> **✅ APPROVED BY DAVID (2026-07-06):** (a) YES — "auxiliary secondary-session" is the seam; (b) the 2-layer, ~6 bounded-commit
> split (shared `SecondarySessionHarness` → then ReviewRunner / PlanCritiqueRunner / SpeculativeMirror / MergeResolution /
> AcceptanceVerifier, each its own commit); (c) **STRONGER than characterization-only — David requires a FULL INTEGRATION PASS
> PER COMMIT**: each runner extraction gets new characterization unit tests AND the relevant heavy contract/integration tests
> (runtime boot) run + green before moving to the next. **READY TO EXECUTE** (verify the integration-suite infra is available
> first — earlier the swarm-bounce integration test needed a backend). Sequenced after / alongside SWARM recovery increments 2–3.
> **DESIGN REFINEMENT (2026-07-06, read the runners):** the 5 runners are HETEROGENEOUS, so sequence the 6 commits by ascending
> intricacy: (1) `verifyTaskAcceptanceInSandbox` is already THIN — resolves the result commit + delegates to the already-extracted
> `runNKleinAcceptanceGateInSandbox(sandboxManager, pauseController)`; a ~33-line trivial wrapper move (do it FIRST, low-risk
> warm-up + harness-dep shakeout). (2) The real `SecondarySessionHarness` skeleton lives in the review/critique/mirror runners
> (check sandboxManager → resolve diverse model → build `::`-launch-config → prepareWorkspace [bounded 180s queue wait] →
> setSandbox → runBoundedTurn via startRuntimeSession with an `onXSubmitted` callback → collect verdict → teardown) — extract the
> harness from `runSecondOpinionReviewSessionInner` (the cleanest exemplar) SECOND, then move PlanCritique / SpeculativeMirror /
> MergeResolution onto it. Order: acceptance-verifier → harness(from review) → the other 3. Each commit: verbatim move +
> characterization tests + a full integration pass (Docker confirmed UP here → the gate is viable). Large multi-turn effort;
> NOT to be rushed at a long turn's tail (no fast-suite net; behavior must stay byte-identical).
> **PROGRESS + HETEROGENEITY FINDING (2026-07-06):** commits 1–3 landed (AcceptanceVerifier, pickDiverseReviewerModel,
> SecondarySessionHarness — the review runner rewired onto it; each gated by tsc+biome+fast+swarm-deterministic-pass;
> task-session-service 4040 → 3922). ⚠ The remaining runners are NOT identical to review: the **speculative-mirror** runner
> (~2749–2921) has a `runBoundedTurn` that returns **`"settled" | "timeout"`** (the review one returns `void`). So moving the
> mirror onto the harness needs a FORWARD-COMPATIBLE harness tweak — make `runBoundedTurn` return the turn outcome (`void`
> callers like review simply ignore it). Check plan-critique + merge for the same. Sequence remaining: 4 PlanCritique (also
> extract/keep the ~500-line buildPlanCritiqueRequestHandler separately — it's a request handler, not session skeleton),
> 5 SpeculativeMirror (needs the outcome-returning runBoundedTurn), 6 MergeResolution. Each still one bounded commit +
> characterization tests + the integration gate.
>
> **§5.U FOURTH (biggest) PATTERN — COLLABORATOR SPLIT, proven autonomous+safe (slice 45):** move a cohesive concern (a
> cluster of methods + its DEDICATED state) out of the class into a `createXWatcher(deps)` collaborator with a small deps
> interface; the service instantiates it + delegates. Residency watcher was the first (−52 lines, 134 tests green). Do it
> when state is cleanly separable (ideal: a single Map/field) + the deps interface is clear. DONE so far: residency watcher (45),
> runtime-setup lease cache (47), focus-chain store (48), team-progress emitter (49); decomposition-nudge wrappers inlined (46).
> **The clean single-Map-with-owned-lifecycle concerns in task-session-service are now largely mined (4 splits).** Remaining
> single-collection fields are NOT good candidates: `explicitDecompositionTaskIds` (bare Set, no logic), `lastRecordedRunStateByTaskId`
> (tiny dedup), `adaptiveRetryStateByTaskId` (cross-concern), `timeoutSettingsByTaskId` (entangled w/ timeout scheduler), warmth
> ledger (cross-cutting: written at prompt-assembly, read at model-selection). Next big reduction = the ENTANGLED
> orchestration clusters. These ARE actionable autonomously (test suite = safety net); they're just larger/riskier (big deps
> interfaces, subtle behavior) so START THEM WITH FRESH CONTEXT, not at a long-session tail.
> **`ParkController` — ✅ DONE slice 50 (−107 lines, biggest single reduction; first ENTANGLED split, 145 tests green). Proved
> entangled orchestration splits are autonomously safe when the boundary is CLEAR. Recipe below applies to the next ones.**
> **`TimeoutController` — ✅ DONE slice 51 (−86; second entangled split; the split IMPROVED coverage via a new fire-path
> test with fake timers; verbatim handleTaskTimeout move).**
> **`SandboxReviewFinalizer` — ✅ DONE slice 52 (−286, the BIGGEST single reduction; third/largest entangled split).**
> Extracted recordPatchCaptureStatus + shouldFinalizeSandboxReview + finalizeSandboxReview (~287 lines) verbatim into
> `createSandboxReviewFinalizer(deps)` (7-method deps: getSandboxState/getAgentSandboxManager/getTaskEntry/emitSummary/
> emitMessage/isExplicitDecomposition/getDiagnosticStoreRoot; state deps are LAZY getters for field-init-order safety). Mechanical
> `this.X → deps.X` transform (zero leftover this.*), 3 call sites rewired, +4 focused tests (shouldFinalize gate truth-table +
> finalize early-return guards). 136 tests green.
> **`ContextBudgetController` — ✅ DONE slice 53 (−87; eighth split, a CLEAN cluster).** Moved context-window resolution
> (advertised → learned-quality-derated → normalized) + the pre-send context-budget guard into
> `createContextBudgetController(deps)`; the controller OWNS the TaskContextWindowStore + exposes resolve/resolveKnown/
> prepareMessages + forget/clear. Deps are 3 lazy accessors (getModelIdForTask/getQualityBudget/recordObservation). The entangled
> compaction ORCHESTRATION (maybeCompactBeforeContextOverflow — reads persisted session + triggers restart) stays and delegates
> its pure step. Verbatim move, ~11 call sites rewired, +7 tests.
> **`TaskFailureEmitter` — ✅ DONE slice 54 (−69; ninth split).** Moved emitTaskFailure (~85 lines) into
> `createTaskFailureEmitter(deps)`: classify an SDK start/send failure (credit-limit vs local-model-unavailable vs generic),
> apply the consecutive-failure backoff (park vs await-review), emit observation + system message + summary. 9 narrow lazy-accessor
> deps (backoff tracker + active-tool set stay service-owned — both cross-cutting). 4 direct callers + 2 collaborator dep wirings
> rewired; +3 tests (first-failure→awaiting_review, threshold→failed, already-parked→no-op); the failure path was previously
> only integration-tested.
> **`RetrievalToolsBuilder` — ✅ DONE slice 55 (−66; tenth split).** Moved buildRetrievalExtraTools into
> `createRetrievalToolsBuilder(deps)`: the fail-closed §5.AC egress attach gate + SearXNG search / SSRF-guarded browse fetch /
> cited local-model synthesis adapters. 4 lazy deps (getRetrievalConfig read LIVE per build, resolveProviderId, getModelId,
> getEndpoint). Deferred in the prior iteration for a thin test net → extracted THIS time WITH the previously-missing security
> regression: +4 tests incl. the LIVE fail-closed (flip egressEnabled off on the shared config → next build() returns [], proving
> no stale capture) + synthetic-session-gets-no-egress + off/disallowed/no-backend. Building the tool never hits the network
> (adapters run only on invocation) so it tests cheaply. 9 dead retrieval imports removed from the service.
> **All entangled orchestration clusters + context-budget resolver/guard + failure-emitter + retrieval-egress builder are now
> extracted; the obvious cohesive-cluster vein in task-session-service is largely mined (4886 → 4040, −17%). Further reduction gets
> into finer-grained / more-ambiguous boundaries (the ~670-line review/critique-session cluster needs David's steer; the
> adaptive-retry cluster calls back into sendTaskSessionInput) or a shift to runtime-server (closure-state reshaping) /
> provider-service.**
> — extracted the pause/park cluster (parkActiveTasksForOperatorPause / parkTaskForPause / parkTaskForAutonomyBudget /
> resetGuardsForPark / pushParkSystemMessage / enforceAutonomyBudgets) into `createParkController(deps)`. Deps (~10):
> getTaskEntry, listSummaries, emitSummary, emitMessage, clearTaskTimeouts, autonomyBudgetWatchdog (or check/resetTask),
> repeatedToolCallGuard.resetTask, pauseController.markTaskParked, abortTaskSession, recordObservation. Boundary is CLEAR (the
> pause/park concern); gate with the existing pause tests. **Fully scoped (slice-49 iteration): 6 call sites to rewire —
> pause handler ×2 (~2747/2754), applyTurnCheckpoint (enforceAutonomyBudgets), and watchdog+nudger callback wirings ×3
> (~631/639/640). TYPE-MATCH: parkTaskFor{Pause,AutonomyBudget}'s input `{taskId, entry, message, metadata}` is referenced by
> AutonomyBudgetWatchdogCallbacks + the nudger callbacks — keep the ParkController input type compatible (or share a type).
> Pure imports needed: createMessage, clearActiveTurnState, updateSummary, now (nklein-session-state).** Then
> timeout-scheduling + sandbox-review finalization similarly.
> Note: runtime-server's state is in the createRuntimeServer CLOSURE (not fields) — harder; provider-service already 1463.
>
> **§5.U RUNTIME-SERVER SURVEY (2026-07-06) — the safe vein is worked out; remaining clusters are the higher-risk tier.**
> `createRuntimeServer` is a single ~2280-line closure. The clean state-free lifts are done (bounded-dedup-set,
> workspace-state-lock-retry, review-sandbox-result, runtime-server-http). The ~24 remaining inner closures capture the dense
> shared workspace state (scope Maps, merge chains, dedup sets, speculative-mirror/idle ticks) — no clean chunky PURE lift left.
> The meatier cohesive clusters are deep orchestration: plan-integration-gate (surface+run, ~140 lines), and the big
> headless-auto-review finalization (finalizeHeadlessAutoReviewTask ~436 lines + reconcile). CRITICAL: **`createRuntimeServer`
> itself is NOT covered by the fast suite** — the test/runtime files that mention runtime-server test the ALREADY-EXTRACTED
> helpers (runtime-server-http, ws-upgrade-passcode) + work-package modules; the closure's orchestration is only
> contract/integration-tested (NOT in test:fast). So a runtime-server closure-cluster extraction has the SAME profile as the
> provider-service cloud clusters + the task-session-service review cluster: large-deps + NO independent fast-net → I'd rely on
> tsc + my own characterization tests (weaker assurance). This is David's-steer / careful-effort tier, not a safe autonomous
> bounded commit. **Verdict: the safe, well-net-covered §5.U vein is now worked out across ALL THREE monoliths
> (task-session-service 4886→4040 −17%, provider-service 1651→1291 −360, runtime-server clean lifts done).**
> **CAVEAT on candidates:** verify state is genuinely SEPARABLE first. `timeout scheduling` is NOT clean —
> `clearTaskTimeouts` coordinates the residency watcher + `activeToolTaskIds` (cross-concern), and `handleTaskTimeout`
> orchestrates abort+fail; leave it (or needs David's boundary steer). `sandbox-review finalization` similarly touches
> `sandboxState` + review runner + emits — likely entangled. **Look for the residency/lease shape: a single dedicated
> Map/field + a lifecycle that only calls OUT via a small deps interface.** Verify each with the task-session-service suite.
> Also keep: chunky pure sub-computation lifts. **CAVEAT (slice 44):** the small-pure-lift (third) pattern only shrinks when the
> third pattern only REDUCES line count when the lifted computation is CHUNKY relative to its call site — a SMALL lift
> (e.g. adaptive-retry policy, +4 lines net) is a cohesion+coverage win but not a size win. Target chunky inline
> computations for actual flagship shrinkage; real line-reduction at scale still needs the collaborator split.
>
> **STRATEGY NOTE (2026-07-06, corrected):** the big-3's pure-function seams are done, but "no large monolith files" spans
> the whole tree — the **next tier** of large files (mcp-runtime-service, workspace-state 1046, agent-sandbox 1090,
> projects-api 1001, task-board-mutations 764, dev.ts 1230) still has clean cohesive seams, several of them UNTESTED, so
> each extraction is **§5.U (decomposition) + §5.V (coverage) at once**. Mine these first; the risky big-3 class-splits
> (task-session-service collaborators, `createRuntimeServer` closure) are a multi-commit DI-threading undertaking best
> started with a fresh context budget.

### 5.AO — DEFERRED: extensive model-attribute A/B hardening sessions *(2026-06-29, user — PARKED until "first proven workflow paths" land)*
> **User steer (2026-06-29):** do **extensive A/B testing across ALL available model attributes / characteristics** at a
> LATER point. **For now we keep punching through !Klein's basic core implementation** to reach confidence in the **"first
> proven workflow paths"**; THEN we return to extensive hardening sessions. This is the explicit pairing with the
> capable-model-first pivot (§5 banner): drive depth now with a strong model, broad model hardening later.
- [-] **The A/B matrix to run later (parked, not counted as ready work):** systematically A/B every model lever we've
      mapped, on the e2e capstone + chat tool flows + the difficulty ladder — **format** (GGUF vs MLX — the standing
      open question, §5.AN + `model-catalog-recommendations.md`), **quant** (q4/q8/bf16 per family — extend the 2026-06-29
      gemma 2B q4-vs-q8 result), **reasoning control** (`/no_think` ↔ `/think`, reasoning intensity per §5.AE apiProfile),
      **context window** (40k vs larger), **sampling** (temperature/top-p per skill), and **per-skill apiProfile** combos.
      Capture each as a sweep-log table + fold verdicts into the §5.AL catalog. **Trigger to un-park:** the "first proven
      workflow paths" are reliably green on the capable driver (the §5.0.3 MCF ladder passes end-to-end) — then resume the
      broad small/less-capable-model sweeps (§5.O/§5.Z) AND this attribute matrix together as the dedicated hardening phase.


### 5.BF — ★ DOUBLE-CHECK the 2026-07-03 Fable session (do with Opus 4.8 + Fable together when Fable returns ~2026-07-04) *(2026-07-03, user directive)*
> **User directive (2026-07-03, mid-session, on switching to Opus 4.8):** *"take a note and add a task in todo.md to
> doublecheck all of the work — we will now continue using opus4.8, with fable when it's available again (in ~18h)."*
> A large batch of chat/board wiring landed FAST in one Fable session; the user wants a deliberate second-pass review
> **once Fable is available again (est. 2026-07-04, ~18h from this note)**, ideally Opus 4.8 + Fable in tandem, BEFORE
> this work is treated as trusted/settled. Not a rewrite — a verification pass (correctness, edge cases, invariants,
> that the wiring actually reaches the model/board at runtime, not just in unit tests). Adversarial workflow-style
> review is appropriate (ultracode).
>
> **PRELIMINARY OPUS PASS ALREADY RUN (2026-07-03, commit `9434dd29`):** an adversarial verification workflow
> (6 review hunters × 2-of-3-skeptic kill) over the six commits found + FIXED 3 confirmed defects — (1) MEDIUM: the
> §5.AU relay could permanently LOSE mailbox guidance on a failed start (consume-before-start → now read-nondestructive
> + `markCardMailboxConsumedUpTo` only after success); (2) LOW: the §5.BD rejection counter attributed multi-tool
> turns to the first tool only (→ `extractRejectedToolNames`); (3) LOW: activity ticks stopped driving sticky-follow
> at the 60 cap (→ newest-tick timestamp not array length). A 4th candidate did not survive verification. The formal
> Fable+Opus pass should still run (a second model sees different things) but can treat these three as closed and
> focus on what a single Opus pass may have missed — especially runtime behavior the unit tests don't exercise.
>
> **Scope — every commit from this session (`816c2fa7..HEAD` on `feat/kanban-reliability-context-upgrade`):**
- [ ] **`816c2fa7` — run42 autopsy trio (§5.AN):** #41 the tool_input_rejection counter now fires in the
      event-adapter ERROR branch (`isPreExecutionToolRejection`) — verify it can't DOUBLE-count when a rejection is
      also a tool-finished event; #42 edit_file tolerance v2 (numeric-string `insert_line` coercion + `{path,
      new_text}` = whole-file replace) — verify the whole-file-replace path still honors protected-path/containment/
      line-limit/secret guards (the commit claims it does); the 100%-reuse telemetry (`identical === previous`).
- [ ] **`28d5c4ca` — git-hook env scrub in decomposition tests (§4A):** confirm `createGitProcessEnv()` at every
      spawn; the gotcha is recorded in §4A — sanity-check no OTHER test spawns raw-env `git init`/`commit` in a
      tmpdir (same hijack class).
- [ ] **`c741edbb` — §5.BB chat phase 2 (web-ui):** activity ticks (`board-activity-ticker.ts` pure diff — check the
      first-snapshot-seeds-silently + 60-cap + session-appears-already-failed tick logic) and the @-mention composer
      (`composer-mention.ts` — the `getActiveMention` email/whitespace guards, ranking, `applyMention` caret math).
      No DOM test for the panel (repo convention) — eyeball the keyboard handling (Enter submits only when popover
      closed; ↑/↓/Tab/Esc) and the timeline interleave/sort tie-break.
- [ ] **`05eb5a13` — §5.AU front-door wiring:** `resolveMessageTargetIndex` in `chat-service.sendMessage`; verify a
      GOAL-routed turn adds ZERO to the prompt (byte-stable §5.AQ claim), the note-strength-by-rung (directive vs
      soft-focus vs ask-don't-guess), explicit-handle-persists-focus, and that the live index in runtime-api
      (`deriveStreams` + persisted streams, `stream-<slug>` id alignment with the client composer) actually matches.
- [ ] **`9a9f27b2` — §5.AU "talking to X" chip:** wire `focus` exposure + clear-only `clearFocus`; check the chip
      renders/clears and that clients genuinely can't SET focus over the wire (only @handle does, server-side).
- [ ] **`6b076676` — §5.AU item 6 `send_to_card` relay (the biggest, review hardest):** the `(state × intent)`
      effect core + the NEW deterministic intent classifier (is "go with option B" really guidance not steer? is the
      question-opener regex too greedy?); the INVARIANT that a blocked card never starts; the live-delivery →
      mailbox-fallback path; and **the mailbox CONSUMPTION at `handleStartTaskSession`** — verify EVERY start path
      funnels through it (UI, autoStart, queued drain, re-drive) so consumed notes fold into the opening prompt and
      are never double-consumed or dropped; verify the `getActiveTaskSessions` live wiring resolves the right service.
- [ ] **Cross-cutting:** run the deterministic integration harnesses (swarm-deterministic{,-pass,-bounce}, ONE AT A
      TIME) — the relay touches `start-task-session.ts` (prompt now carries the mailbox addendum), a review/delivery-
      adjacent path the harnesses guard and test:fast doesn't. Confirm the §5.AU relay's prompt-addendum change
      didn't shift start-prompt token estimation / difficulty in a way that moves model selection.
- [ ] After the pass: fold any findings into fixes, then mark this settled. Related open §5.AU items (rung-5 LLM
      disambiguator, the candidate-picker on needs_clarify, live UI read for server-pushed messages 5b/8) stay their
      own tasks — this is verification of what shipped, not the remaining build.


### 5.AX — UI VISUAL OVERHAUL: a modern, clean, distinctive "!Klein" design system *(2026-07-02, user)*
> **User framing (2026-07-02):** *"apply a nice UI overhaul — make it look MUCH nicer than the original Cline kanban (which I already like, but we want to be better and have a bit our OWN style). Make it modern, clean, ATTRACTIVE for coders / managers / non-tech. Make the UI intuitive and comprehensive."* This is the VISUAL/identity track (distinct from the §5.AX-sibling UI/UX *functional* audit in §5.0.4 P2 / the ui-ux audit — that fixes flows; THIS makes it beautiful + branded). Base = the Cline webview kanban (liked), so EVOLVE it, don't rip it out.
>
> **Audiences (design for all three without a mode-switch war):** CODERS (dense, keyboard-first, info-rich — the board/DAG/diffs/logs), MANAGERS (overview-first — streams, health/progress rollups, "what needs me"), NON-TECH (approachable language, no jargon walls, clear status). Achieve with **progressive disclosure + a density toggle** (comfortable ↔ compact), not three separate UIs.
>
> **Design-system to define + build (a real token system, not ad-hoc CSS):**
> - **Identity:** a distinct "!Klein" mark + wordmark (the "!" is the brand hook), a signature accent color, a restrained modern palette; DARK + LIGHT themes as first-class (respect the IDE/host theme, but with our identity layered on). A named theme (e.g. a cool-slate base + one vivid accent for state/action).
> - **Tokens:** color (semantic: surface/elevated/border/text/accent/state-{running,blocked,review,done,error}), typography scale (a clean UI sans + a mono for code/ids), spacing scale, radius, elevation/shadow, motion (fast, subtle transitions — card moves, state changes, the "agent thinking" pulse).
> - **Components:** cards (state color-coding + model/family chip + progress + "N pending notes" mailbox badge), columns/lanes, the streams overview (health · progress · frontier rollup — §5.AU), the DAG view (readable, zoomable), chat (message types: user/agent/system/board-feedback distinct; the "talking to X" target chip + breadcrumb — §5.AU), settings (grouped, searchable, with good defaults + inline help), the model/fleet view (who's loaded/busy/idle — ties §5.AW eager-utilization; a live fleet-activity strip is a signature feature), diffs/result-branch review UI.
> - **Feel:** modern + clean + calm (not noisy); motion communicates state (a card lighting up when its agent acts); empty/loading/error states designed, not default; accessible (contrast, focus rings, keyboard nav).
>
> **A SIGNATURE differentiator vs Cline:** make the LIVE SWARM legible + delightful — a fleet strip / board that shows models working in parallel (which model is on which card, who's reviewing whom, deliberations happening), turning !Klein's multi-model nature into the visual hero. This is unique to !Klein and sells the "swarm" story to every audience.
>
> **DECIDED (user 2026-07-02, on the dark-first mockup docs/dev/mockups/klein-dark-first.html):**
> - **Direction:** cool-technical, DARK-FIRST (light theme still first-class, layered later).
> - **Accent system: TWO accents, semantic — CYAN primary (UI accent, actions, focus, live state) + VIOLET reserved for AI/agent-authored elements** (agent messages, model badges, deliberation/critique surfaces, the "!Klein said/did this" markers). This visually separates "the tool" (cyan) from "the swarm's own output" (violet) — a signature that no other kanban has.
> - **Mark: ABSTRACT SWARM MARK** — a geometric mark evoking converging nodes / a small constellation (the multi-model swarm as the hero), NOT the literal !K monogram. Develop 2-3 SVG options; the "!" hook can live in the wordmark alongside.
> - **Scope: FULL RESTYLE IN ONE PASS** — board + chat + settings restyled together against the token system for one coherent visual jump (not incremental).
> **BUILD PROGRESS:** (1) ✓ mark exploration → user picked CONSTELLATION-K; (2) ✓ IDENTITY + TOKEN LAYER SHIPPED — NKleinMark evolved to constellation-K (two-accent + live pulse; brand/klein-mark.tsx lockup), a first-class `klein` theme (registry + terminal colors + [data-theme=klein] palette: near-black cool-slate, cyan accent, violet accent-2) made the DEFAULT look for unset users, sidebar header rebranded; 832 web-ui tests green. REMAINING (3) full component-by-component restyle board+chat+settings — the token palette already cascades (components reference semantic tokens), so this is polish/density/motion per component + the §5.AU streams/DAG/fleet-strip signature surfaces + the mockup's per-card model+warmth+ladder chrome. NEXT non-code owed: full icon-size SVG set (16/32/128/512 + light variant) + app/favicon assets. **Approach:** (1) inventory the current webview components + styling (find the CSS/theme system); (2) define the token system + a couple of high-fidelity mockups (get user buy-in on direction BEFORE mass restyle); (3) restyle component-by-component behind the tokens (no behavior change first, then UX improvements from the functional audit). **USER QUESTIONS:** brand direction — any color/mood preference (e.g. cool/technical vs warm/friendly), a name/vibe for the theme, and a logo/mark idea for "!Klein"? Dark-first or light-first? Converges with the ui-ux functional audit (§5.0.4 P2) · §5.AU (streams/addressing UI) · §5.AW (fleet-activity view) · §5.AG (operator UX).


### 5.AY — Legion5pro MoE evaluation: can expert-offload beat "small model fully in VRAM"? *(2026-07-02, user — POST-MATURITY, before an early release)*
> **User framing (2026-07-02):** *"we basically identified that running a second cpu-only model on legion5pro is not a
> good idea since it slows down the gpu model by a factor of 4 .. evaluate (if necessary test and measure) if and how
> we could run a MoE model on that machine to get the most out of the fast gpu and potentially get a bit around the
> limited 8GB VRAM by having some less relevant part on sysram .. the task is to clarify if there is any interesting
> option or if everything boils down to only have a small model sitting in the fast vram and gpu .. if that is the
> result, then it's okay."* **Schedule: only after the main !Klein implementation reaches maturity** (approaching an
> early-release state) — this is a hardware-utilization optimization, not a feature blocker.
>
> **Context (measured, 2026-07-02):** legion5pro = fast 8GB-VRAM GPU + CPU/sysram. A fully-GPU 4B coder runs ~68 tok/s;
> adding a CPU-only co-model was NET-NEGATIVE (the GPU model slowed ~4× — memory-bandwidth/scheduler contention), so
> the current doctrine is "run the GPU model ALONE" (docs/dev/gpu-offload-and-moe.md + the fleet-throughput notes).
> - [ ] **Candidate survey:** which current MoE models fit the shape "active experts small enough for 8GB VRAM, total
>       weights fine in 32-64GB sysram"? (e.g. small MoE coders; check llama.cpp/LM Studio `--n-cpu-moe` / expert-offload
>       support on Windows/Linux for that box; llmfit can pre-screen fit.) Note per-token expert routing means the "less
>       relevant part" is NOT statically separable — measure real decode speed, don't trust the shape argument.
> - [ ] **Measure (only if a candidate looks plausible):** decode tok/s + prefill + first-token latency for (a) dense
>       small model fully in VRAM (baseline, today's coder-gpu), (b) MoE with experts on sysram / attention+router on
>       GPU, (c) MoE fully on CPU for reference. Same prompt set; measure under a REAL !Klein worker load, not just a
>       bench prompt. Use the on-device guardrail; don't churn the user's machine unattended (memory: user-managed).
> - [ ] **Verdict + doctrine update:** either "MoE X at N tok/s beats the dense 4B at quality-per-second for role Y —
>       adopt for legion" or "everything boils down to a small dense model in VRAM — CONFIRMED, close the question".
>       Record either way in docs/dev/gpu-offload-and-moe.md + the model-capability catalog + fleet sweet-spots memory.
>


### 5.AZ — Public-release repo preparation: cleanup, history, and presentation *(2026-07-02, user — POST-MATURITY, gates the early release)*
> **User framing (2026-07-02):** *"talking about releasing an early version, there is then also still a lot of things
> to do to cleanup the branch, to make sure we have a repo that is nicely prepared to show to the public."* **Schedule:
> only after implementations reach maturity** — the last mile before an early public version.
> - [ ] **Branch/history cleanup:** decide the public history shape (squash the ~120-commit working branch vs curated
>       history vs fresh-root release branch); merge or retire `feat/kanban-reliability-context-upgrade`; prune stale
>       branches; verify no secrets/tokens/local paths/personal data anywhere in history (use a scanner, not eyeballs —
>       e.g. gitleaks/trufflehog run over FULL history; the fleet logs + sweep rows quote local paths → scrub or exclude).
> - [ ] **Repo hygiene:** LICENSE decision (vendored Cline SDK license compatibility + attribution!), NOTICE/credits,
>       README (what !Klein is, the local-only/Docker-isolation posture, hardware expectations, quickstart), CONTRIBUTING,
>       SECURITY.md (local-only threat model), issue templates. Screenshots/gif of the board+chat once §5.AX lands.
> - [ ] **Content audit:** todo.md/done.md/docs/dev/* are full of internal working notes, machine names, and user
>       context — decide what ships (curated docs/) vs what stays private (working notes); CHANGELOG grooming to a
>       public voice; strip dev-test fixtures that reference private infra; make sure the model-capability catalog and
>       integrations registry read as neutral docs.
>       **★ SRC/TEST-CODE hostname+secret pass DONE (2026-07-07, Opus):** audited `src/**` + `web-ui/src/**` +
>       `web-ui/tests/**` for personal machine names, emails, private LAN IPs, `.local` hosts, and token/secret
>       literals. One genuine user-facing leak found + fixed: the Per-machine concurrency editor placeholder hardcoded
>       `m4mini.local` (→ neutral `localhost`), plus its 5 test-fixture references (commits `ec4f3499`, `49533195`).
>       Clean otherwise: no private IPs, no `sk-`/`ghp_`/AWS/PEM secret literals, no other `.local` hosts. Left intact
>       (correct): the `m5max`/`coder-gpu` mentions in model-lineage/online-lookup/stable-identity comments are teaching
>       examples of the anti-pattern, and `eval-prompt-corpus`'s `mail.local` is synthetic exfil test data. **Still
>       open:** the docs/todo/done working-notes curation + the FULL-git-HISTORY scanner sweep (gitleaks/trufflehog).
> - [ ] **Release engineering:** version scheme, `npm run build` + sandbox image build reproducible on a clean machine,
>       install/run docs verified on a fresh user profile, smoke-test checklist (the deterministic harness suite is the
>       release gate: v1 HOLD + v2 PASS + v3 bounce must be green).
>       **★ FULL-SUITE HEALTH SNAPSHOT (2026-07-07, Opus) — entire test surface GREEN except 1 diagnosed stale test:**
>       test:fast 8090/8090 (750 files) · contract 275/275 · integration 41/42 · protected 123/123 · web-ui 956/956
>       (≈9445 tests). The ONE integration failure (runtime-state-stream "stale review cards to trash on shutdown") is a
>       PRE-EXISTING stale test asserting the pre-W2.2 trash-everything behavior that reconcile-don't-destroy
>       deliberately superseded — surfaced as `task_5f7170d9`, NOT a product bug (see run log). Also validates the 7-lift
>       §5.U refactoring arc end-to-end (provider-service / workspace-state / cli.ts). NOTE the coverage gap this exposed:
>       `test:fast` (the pre-commit gate) runs only test/runtime + test/utilities, so contract/integration/protected/
>       web-ui regressions land silently until a full run — a CI job that runs ALL suites is the real release gate.
>       **★★ BUILT-ARTIFACT SMOKE — 3 P0 RELEASE BLOCKERS FOUND + FIXED (2026-07-07, Opus).** The ENTIRE test surface
>       (~9400 tests) runs SOURCE, never the production BUNDLE — so three bundle-only P0s sat undetected. Running the
>       actual build + built binary found + fixed all three: (1) `scripts/build.mjs` failed — `playwright` (browse_url
>       tool) not in esbuild externals → externalized playwright/playwright-core/chromium-bidi/fsevents (commit
>       f1b5562b). (2) `node dist/cli.js --version` CRASHED — nklein-dev-test-project.ts read fixtures at module-init →
>       lazy-loaded the scenarios (6c2a0461). (3) the built SERVER (primary use) crashed on start with `__filename is
>       not defined` — a bundled CJS dep uses the CJS globals absent in ESM → shimmed `__filename`/`__dirname` in the
>       build banner (7c027105). VERIFIED end-to-end: built server starts in an isolated temp HOME, `GET /` + `projects
>       .list` → HTTP 200, clean shutdown. **RELEASE-GATE PROCEDURE (add to CI): `npm run build && (start dist/cli.js on
>       a free port, curl /, kill)` — a built-artifact smoke that no unit/integration test replaces.**
> - [ ] **★ Gate the VENDORED SDK suite (finding 2026-07-03).** Repo `test:fast`/`vitest` EXCLUDE `vendor/**`, so the
>       forked SDK's own tests never run in CI — and our fork edits silently rot them. Live proof: `cd
>       vendor/cline-sdk/packages/core && npx vitest run` had **5 pre-existing failures** — 1 read_files schema test
>       stale after §5.BD boundary fix #40, and 4 from the `.cline`→`.nklein` workspace-dir rebrand (plugin-install +
>       user-instruction-config-loader) + 3 more in `@cline/shared` storage paths (same rebrand). **All 8 now FIXED
>       (commits 2da7e50d, 7ed422fb, 485e2fb8). Every runnable vendored package is GREEN: core 1224 · shared 205 ·
>       llms 334 · agents 46 (sdk has no vitest config).** **`npm run test:vendor` ADDED (scripts/test-vendor.mjs) —
>       runs all 4 vendored suites (1814 tests green).** **DONE — the STAGED-VENDORED-FILES GUARD shipped in
>       `.husky/pre-commit`:** when a commit stages any `vendor/**` file, the hook runs `npm run test:vendor` and blocks
>       the commit on failure — catching fork drift at the source WITHOUT the ~30s cost on ordinary (non-vendored)
>       commits (the `^vendor/`-anchored `$STAGED_FILES` grep skips otherwise). Confirmed green (agents 46 · core 1224 ·
>       shared 205 · llms 334 = 1814) before wiring. Remaining (later, if a hosted CI is stood up): a CI job mirror.
>       (Rebrand caveat
>       learned: NOT every `.cline` is stale — home-scoped `CLINE_DIR`, an EXPLICITLY-set CLINE_DIR path,
>       `resolvePluginConfigSearchPaths[0]` legacy-first, and `.cline/skills` back-compat subdirs are intentional; fix
>       per failing assertion against the SOURCE, never a blanket replace — a blanket flip wrongly changed
>       `resolvePluginConfigSearchPaths[0]` and the test caught it.)
>


### 5.BG — Model identity: key observed/measured info by the STABLE model key, not the LM Studio runtime id *(2026-07-06, David directive)*
> **David:** LM Studio runtime ids are NOT stable — a user renames instances (`coder-gpu`, `gpu-coder`, `-m5max`) any
> time. So collect / persist / look up model-related info by **stable model metadata + the real model name**, never the
> runtime id.
>
> **DONE (bounded, non-wired flow):** `deriveModelFamily` (model-online-lookup.ts) no longer hardcodes machine tokens
> (`m5max|m4mini`); `buildProvisionalCatalogEntry` now prefers the stable `descriptor.modelKey`. (commit — see run log.)
>
> **David decided (AskUserQuestion 2026-07-06):** key by `descriptor.modelKey` alone (runtime id → display alias); best-effort re-key on load (merge collapsed rows, unmatched decay). **Increment 1 DONE:** pure `stable-model-identity.ts` primitive (+7). **Increment 2 DONE:** self-observations now key off the stable key on the primary local-start path (handler threads descriptor.modelKey → TaskModelEndpointStore.getStableModelKey → resolveTaskModelIdentity; fallback-safe). **★ CORRECTION (2026-07-07):** increments 2/3 stamped the stable key on the WRITE, but the whole telemetry READ/routing side keys off the RUNTIME id (candidates from `d.runtimeId` → `entry.key`; verdict matches `entry.modelId`) — a silent write/read MISMATCH that breaks the stall penalty + model-behavior lookup. REVERTED the two consumer changes (resolveTaskModelIdentity, deriveTaskFitnessRecord) to the runtime id; KEPT the harmless scaffolding (store getStableModelKey slot, summary.modelKey field + emitSummary enrichment, the primitive). **CORRECT design:** switch the candidate/registry KEY SOURCE (d.runtimeId → d.modelKey) + all reads TOGETHER in one coordinated, READ-side-tested change — larger hot-path/persisted-data change, flag for David.
>
> **Superseded increments (kept scaffolding only):**
>
> **OPEN (wiring — re-keys PERSISTED telemetry):** the live keying is SPLIT. Capability/
> routing (`resolveLoadedModelProfile`) + lineage/diverse-escalation already key off the stable `descriptor.modelKey` ✓.
> But **self-observations + fitness key off the UNSTABLE runtime id** — `resolveTaskModelIdentity` →
> `modelEndpoint.getModelId(taskId)` (the launch/endpoint id), stamped by `recordObservationWithModel` on every telemetry
> row, and `ModelFitnessFingerprint` keys by it. **Effect:** renaming an LM Studio instance FRAGMENTS its measured
> fitness/observation history. **Proposed:** resolve `descriptor.modelKey` for a running task and stamp THAT as the model
> identity on observations + fitness (keep the runtime id only as a display alias); decide migration for existing rows
> (re-key vs. let them decay). Needs David's sign-off on approach (persisted-data change) before implementing.

> **★ ROUTING-CLUSTER SCOPE CONFIRMED (2026-07-07) — recommend a dedicated, reviewed, integration-tested effort, NOT the grind.**
> The remaining routing flip is a REGISTRY-IDENTITY REFACTOR, not a value swap: `NKleinModelRegistryEntry` has only
> `modelId` (used for BOTH the evidence key AND launch), and `nklein-model-registry-deserialize` RE-DERIVES `entry.key`
> from `entry.modelId` — so the stable-key switch needs a persisted SCHEMA change (add `entry.modelKey`), a migration,
> and breaking the `entry.key = f(modelId)` invariant across ~12 sites (candidate builder, deserialize, registry,
> ledger write, residency set, verdict). The **residency flip carries a double-start hazard** (if `runningModelKeys` and
> `candidate.entry.key` diverge, a running model looks "free" → the same model starts twice → resource exhaustion), and
> there are **no integration tests for the routing/residency path** — the unit guards catch key-derivation mismatches but
> not selection/residency behavior. **Delivered safely in the grind:** the `deriveModelFamily` fix, the fitness/display
> heal-on-rename, the candidate↔ledger alignment guard, and the inert scaffolding (store `getStableModelKey`, summary
> `modelKey`, the primitive). The routing cluster is left consistent + green (runtime-keyed) pending a focused effort.
>
> **★ FLIP ATTEMPTED 2026-07-07 (Opus) → reverted on the design blocker below. ★ DECISION OWED — David.** Wired the
> additive foundation tsc-green, then a READ-side trace revealed the one fact that makes this a design choice, not a
> mechanical flip: **the stable `modelKey` is only knowable for LOADED models** (it comes from the live LM Studio
> descriptor). A config/role candidate for a COLD model has no descriptor → no stable key → must fall back to the runtime
> id. So a naive flip yields a **MIXED keyspace** — the same model keys STABLE when it was loaded at decision time and
> RUNTIME when it was not, splitting its ledger/residency rows across two keys by load-state-at-write. That defeats the
> rename-robustness the flip is for. **Pick the keying model before finishing:** (a) **persist a `runtimeId to modelKey`
> map** (learned whenever a model loads) so the stable key resolves even for a cold model → uniformly stable [recommended
> — the only option that fully delivers intent]; (b) **re-key on load** (write runtime, migrate rows when the descriptor
> reappears — eventual convergence, transient split); (c) **loaded-only** (cold candidates stay runtime — partial). The
> WIP was reverted to the consistent all-runtime tree; the alignment guard remains committed and fails loudly on any
> one-sided flip, so it is safe to resume from here once (a)/(b)/(c) is chosen. See run log 2026-07-07 for the full trace.
