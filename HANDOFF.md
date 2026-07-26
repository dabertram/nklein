# Session handoff — 2026-07-26 (going offline)

Autonomous streak on `feat/nklein-upcoming` (continuation of the 07-23/07-25 sessions; legion + m4mini OFFLINE,
local m5max only). Everything below is committed; working tree should be clean apart from this file. Full history:
`~/.claude/projects/-Users-david-GIT-nklein/memory/session-2026-07-26-n5-close.md` + basic-memory note
"N5 flaky violations root cause" (bugs folder).

## ★ Headline: N5/N13 nightly CLOSED — FULL GREEN

Final double-run v3: **21/21 cells passed, 0 violated packs (was 12/21), quarantine empty, embedded crash
matrix 6/6, overall ok:true.** Both profiles, all 10 registered projects.

ONE race manufactured every flaky-pack violation (forensics walked the retained planning:8 HOME):
1. A delivered card's cleanup stop raced a late finalize (lost-heartbeat park flip) — capture hit
   `workspace_disposed_before_capture`, the catch flipped the just-delivered card to FAILED + set
   `infrastructureFailure`. Telemetry tell: `moved review → completed` → `"Lost session marked interrupted."`
   → capture failure.
2. The dev-test monitor breaks IMMEDIATELY on infrastructureFailure → harness stopped the in-process aimock
   while the runtime was still dispatching fresh durable leases → ECONNREFUSED on first model turn → cards
   stranded in planning (ledger silent right after `lease_acquired`), dependents starved.

## Commits this session (all validated, pre-commit green)

- `66e845fce` watchdog: runtime-alive marooned in-progress card reconcile (earlier in session)
- `0a61e59e3` **delivery-settled contract** (the root fix): `TaskSandboxStateStore.markDeliverySettled` set by
  `completeDeliveredTaskAndCascade` BEFORE its cleanup stop; finalizer entry/shouldFinalize/salvage refuse new
  finalizations once settled; finalizer CATCH treats an in-flight capture failing after settle as benign
  supersede (no failed summary, no capture-error status). Cleared only by a fresh `setSandbox`; survives
  `deleteSandbox`. + sim replay models (`sim/` prefix) exempt from capability trims (`isSimulatorReplayModelId`
  — "qwen" marker had disabled `editor` for sim/qwen-fast-coder → manufactured unavailable-tool errors). +
  graph-quality classifier: file evidence beats domain-word title match ("coverage" dispatch cards writing
  src/*.mjs were hard-rejected as floating verifiers). + scenario-01 recording drift (editor/apply_patch →
  edit_file; s40 docs card + implementation dep). + harness: flaky runs now assert FULL DRAIN too.
- `d0ffbfbf1` harness reaps its own `simflow-<pid>-*` containers on every exit path.
- `4692dc290` **per-profile quiet exemptions**: packs carry `quietExemptionsByProfile`; core-invariants exempts
  `runtime_error` for flaky ONLY (watchdog stays asserted both); runner applies via `applyProfileToPack`. +
  flaky spec-coverage recording patches for 01/07/09/20 (their 10-card decompose graphs failed today's
  spec-coverage validation; cycled replay can only re-serve the same turn → repeated-call guard parked the
  seed — F1.34d's nightly face; patched per the gate's own remedy).
- `35f674371` todo: N5 closure note.
- `320d3a6dc` **hermeticity sweep**: `resolveDefaultLocalModelBaseUrl()` honors
  `NKLEIN_NIGHTLY_MODEL_GATEWAY_URL`; all 28 default-gateway fallback sites (14 files) now resolve through it —
  closes the "sim rescue reviewer consulted the real gateway (loaded_fallback qwen3-8b)" leak.
- `e77c26b2c` **durable fail-lease-fast**: a controller dispatch that no-ops in `autoStartTaskIds` settles its
  lease AT THE SKIP SITE with the reason (completed lane ⇒ delivered/cascade; paused/trashed/missing/unmet-deps
  ⇒ failed now); review/in-progress/active-session skips stay lease-neutral. Ends the 5-minute silent lease burn.
- `433812983`, + two docs commits: N2 audit ledger + recovered=false root-cause (see below).

## N2 mechanism audit — DONE (recorded in todo.md under N2)

Agent-swept 42 fresh journals from the green v3 run. PROVEN: decompose/cards/worker/capture, review approve AND
bounce, delivery merge gate + BLOCKING sub-gates live (insufficient_tests ×38, reward_hack ×20,
mutation_adequacy enforced), acceptance evidence ×730, test-driven gate BOUNCING ×72, retry ladder ×2268,
re-drive ×34, context capping, admission ×7476, taint labels, flaky families (429/empty/stall/malformed).
**NO PROOF — each needs an explicit profile/action + invariant (list with details in todo.md N2):** steering,
loop guards, park/resume, budget_wall, model_failover (endpoint-level DID fire), taint GATE action, syntax
guard, reasoning-only recovery (integrity test CLAIMS it exists in recordings — reconcile!), fail_closed naming.
**recovered=false on all 2,268 retries = STRUCTURAL sim limit, not a bug**: assistant-count-indexed cycled
turns serve the SAME fault to every in-turn retry; sim recovery happens at session re-drive. If in-turn proof
is wanted: aimock needs serve-count-aware turn advancement (also enables reasoning-only recovery proof).

## Next queue (in order)

1. Turn N2 no-proofs into recording profiles/invariants (steering + budget_wall look cheapest; the
   reasoning-only integrity-test discrepancy should be reconciled first — it may be a false claim in the
   static test).
2. F1.34d — repeated-tool-call guard vs the LIVE incremental decompose route (the nightly face is fixed via
   recording patches; the live-model question stands). Retained HOMEs from 07-25 are gone; needs a fresh repro.
3. Offline-acceptance decision (a3): flaky bounces re-run real `npm test` in the offline sandbox →
   deterministic failure; options in todo.md (cell-mode acceptance stub / offline-aware verdicts /
   recording-declared offline-safe acceptance). 01×perfect classifies "failed (acceptance failing)" for this
   reason while lanes drain clean — cosmetic but misleading.
4. mlx-serve perf curves (kv-quant/prefix-cache/PLD tokens-per-sec) + P17.1 runtime adapter — needs an idle
   machine (don't benchmark under other load). Binary + models already on m5max from the passed trial.
5. F12.78b paired harness; then broader ready backlog top-down.

## Gotchas (new this session)

- **The nightly double-run executes from the WORKING TREE** — per-cell children re-import src fresh; freeze
  src/ edits while one runs (scripts/docs are safe if tsc-clean).
- Cell HOMEs retained under `/var/folders/_k/…/T/nklein-nightly-<NN>-*`; the per-cell ledger is at
  `<dir>/ledger/*.jsonl` (NOT .nklein/nklein/agent-attempt-ledger). ~127 accumulated dirs — safe to clean the
  stale ones if disk matters.
- Solo scenario drain command unchanged (HANDOFF 07-25 / §4A); flaky runs now MUST fully drain or the harness
  throws (`<run> left cards undrained`).
- Biome pre-commit: fix staged formatting with
  `npx biome check --staged --no-errors-on-unmatched --files-ignore-unknown=true --write` then re-add.
- The /goal Stop-hook loop was active (dynamic /loop, ~20 min wakeups) — restart with
  `/loop until goal is reached, keep going and keep working through the backlog while waiting for background tasks`.

## State to be aware of

- Task list: #3 (backlog top-down) still in_progress — everything else completed. N5 = task #8 completed.
- No background tasks left running; no leaked simflow containers (verified 0 before the last runs; the harness
  now self-reaps).
- basic-memory: "N5 flaky violations root cause…" (bugs) updated with the RESOLVED outcome.
- todo.md carries the full N5 closure + N2 audit + all follow-up framing; done.md not yet updated with an N5
  entry (todo.md checkpoint is authoritative per repo convention).
