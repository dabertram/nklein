# Session handoff — 2026-07-25 (evening shutdown)

Autonomous streak on `feat/nklein-upcoming` (continuation of the 2026-07-23 session). Everything below is
committed; the working tree should be clean apart from this file. Full running history:
`~/.claude/projects/-Users-david-GIT-nklein/memory/session-2026-07-23-streak.md` (per-milestone, with commits).

## Shipped this session (all committed + validated)

- **★ N10 crash-recovery matrix 6/6 GREEN** ("6/6 SIGKILL phases recovered cleanly") — 13 real defects found and
  fixed across worker lifecycle, delivery, durable scheduler, compaction, and trigger seams. Highlights:
  - Detached rescue/idle reviews now re-enter `finalizeHeadlessAutoReviewTask` on a delivered verdict.
  - W2.2 startup recovery splits orphans: result-branch keepers → Review, no-capture orphans → Ready (re-drive).
  - `reportCompletion` accepts succeeded-on-ready (crash-recovery completion racing boot-reclaim).
  - Compaction cell: proactive-path design + `NKLEIN_CONTEXT_COMPACT_RATIO` env knob (default 0.92 unchanged).
  - Trigger templates: `autoReviewEnabled` (default TRUE) + optional `testability`/`testabilityReason`.
- **★ F1.34c audit COMPLETE: 20/20 recorded scenario sets drain perfect-run green** under default-ON test-driven
  mode (`238af0807` closes it in todo.md). The stack that got there:
  - 53 upfront `not_testable` declarations patched into recorded decompose args (patcher:
    `scratchpad/patch-scenario-testability.py`), plus 2 file-scope alignments (set 01).
  - aimock review-classifier: anchored review-seed prefix (resume-based reviews without `submit_review`).
  - Acceptance gate: run-level offline-verdict cache (setups 70s → ~30ms after first proven offline).
  - Test-driven gate derives `not_testable` for decomposition sources via `generatedFromPlan` linkage.
  - Sim concurrency levers: `NKLEIN_PER_MACHINE_MAX_CONCURRENCY=4` + new `NKLEIN_SHARED_ENDPOINT_MAX_CONCURRENCY=3`
    in scenario mode (real-fleet defaults untouched).
  - Admission hardenings (all keepers): every await under the per-workspace admission serialization mutex is
    bounded with settled fallbacks; fair-queue reservations expire 60s after their waiter stops polling; the two
    formerly-silent admission branches log; aux session starts + aux model streams stamp phases; parent-exemption
    and fresh-start self-ghost exemption in admission.
- **P16.7b field-report review UI** (`8ac9485b8`): `field-report-assembly` core + `runtime.fieldReportCandidates`
  tRPC + Trust & Privacy raw-bytes review panel (51 tests).
- **N10.e2big** resolved by the worktree chip session (large-file write policy; todo marked done).

## INTERRUPTED by shutdown — restart these

1. **N13 nightly `--double-run` live pass** was mid-soak (42 sequential cell drains). Re-run:
   `npx tsx src/cli.ts dev nightly --double-run --json > nightly-double-run.json 2> nightly-double-run.log`
   (hours; sequential; writes flake-quarantine verdicts). It was killed mid-run — check for leaked containers:
   `docker ps --format '{{.Names}}' | grep simflow | xargs -I{} docker rm -f {}`.
2. **Chip session task_1ca58cf7** ("Resolve large-file write ceiling") was running in a separate local session —
   verify whether it finished/merged; its earlier sibling already landed `agent-write-guard.ts` +
   `tool-runner-protocol.ts` (swept into my commits, green together).

## Next queue (post-F11, in order)

- **N2 cells** run.
- **P17.1a mlx-serve trial on qwable** — authorized by David (reuse existing model files, NO new downloads;
  fleet was released post-F11; check `lms ps` state first).
- **F12.78b** paired harness on resident 8B/9B.
- Small open hardenings: **F1.34d** (repeated-tool-call guard vs incremental decompose route — todo entry),
  **N10 watchdog stalled-review classifier** (verdict-less review-lane card with no review record), scenario-mode
  container reap on the harness throw path, sim reviewer hermeticity leak (loaded_fallback hit real gateway —
  todo N10 follow-up).
- Then the broader ready backlog top-down (P16.6b needs an idle model; P17.x interop; P18/P20/P22/P23…).

## Gotchas refreshed this session

- aimock cycled turns index by the request's ASSISTANT-MESSAGE COUNT; a post-crash rescue review is a fresh
  session (count 0) — key later rounds by needle (e.g. `the card "…" (review round 2)`).
- The dev-test monitor's stagnation settle tears the runtime down — post-teardown silence looks like a freeze.
- `git add -A`/-u sweeps concurrent worktree-session changes into your commit — stage explicitly.
- Solo scenario drain: `HOME=$(mktemp -d) NKLEIN_SIMFLOW_SCENARIO=NN NKLEIN_SIMFLOW_RUNTIME_PORT=<port>
  NKLEIN_SIMFLOW_TIMEOUT_MS=900000 npx tsx scripts/verify-simulated-flow.mts`.
- The /goal Stop-hook loop was active (dynamic /loop, ~15-25 min wakeups) — restart it with
  `/loop until goal is reached, keep going and keep working through the backlog while waiting for background tasks`.
