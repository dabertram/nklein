# !Klein — done.md (the shipped / finished archive)

> **This is the completed-work archive — the counterpart to [todo.md](todo.md).** `todo.md` holds only what is
> **not yet finished**; everything **fully done** lives here. The split keeps `todo.md` a lean, honest list of
> *remaining* work while preserving the full record of what already exists so an agent **knows what's built and does
> not rebuild it** (the original purpose of the old "§6 SHIPPED" section, now the heart of this file).
>
> **The standing rule that fills this file (mirrored authoritatively in `todo.md`):** when a current work package is
> delivered and verified, move it here in the same commit (alongside any user-facing `CHANGELOG.md` entry). Keep its
> current id and mention the legacy `§5.*` topic when useful.
>
> **Anti-chaos invariants:**
> - **Package ids are stable after the 2026-07-13 consolidation.** Older `§5.*` ids remain searchable through the
>   alias map in `todo.md` and the legacy headings preserved below.
> - **Append-only archive.** Group by the same section ids; don't rewrite a migrated item except to fix a stale
>   cross-reference. The verbose per-commit detail is preserved as-moved (it's already the historical record).
> - **No open status belongs here.** A shipped baseline may be `[x]` with its genuine residue cross-linked to a distinct
>   package in `todo.md`; `[ ]`, `[~]`, `[>]`, and `[?]` are reserved for the current queue.
> - **Counts live in `todo.md`.** The ready/blocked greps run on `todo.md` only; `done.md` is not counted.
>
> **Status legend:** `[x]` shipped and verified. Historical prose is evidence, not an active task list.
>
> **Last reconciled:** 2026-07-13 against `feat/nklein-upcoming` at `0bfbbb02`; all secondary Markdown task trackers
> were consolidated into the ordered queue and this archive.

---

## 2026-07-13 backlog consolidation archive

- [x] **Branch and Markdown reconciliation.** Fetched `origin`/`upstream`; confirmed the branch was 63 ahead and 0
  behind; audited all 177 tracked Markdown files; separated 18 secondary task/handoff prompts from maintained product,
  legal, operational, research, vendor, fixture, and scenario documentation.
- [x] **C0–C2 milestone foundation.** Single-card delivery, planning/decomposition, and review/delivery challenge
  baselines were completed; C3–C8/CAP remain as explicit gates in `todo.md` phases 6–7.
- [x] **Simulator foundation.** The local simulator, LM Studio-compatible shim, 20 perfect + 20 flaky scenario sets,
  record/distill proxy, runtime flow harness, and multi-card verifier exist and pass their focused suites. Remaining UI,
  failure-coverage, mid-stream-stall, and telemetry-hardening work is tracked in H7.1–H7.4.
- [x] **Wave 3 operator/chat UI.** Shared rich chat renderer, stop/stall controls, five zoom levels, focus-chain strip,
  board DAG, needs-you badge/inbox path, mailbox counts, truncation indicator, and approved dependency-edge treatment
  shipped and were verified in the Fable pass.
- [x] **Desktop baseline and LAN serving.** Electron shell, tray activity/pause/open controls, autostart, one-project
  auto-resume, packaged macOS build pipeline, safe opt-in LAN bind, loopback trust, passcode display/auth, restart flow,
  and Settings controls are code-complete (`4b43ba32`). Packaged interaction and updater/migration work remain queued.
- [x] **Zero-token liveness detector.** `listZeroTokenWedgedSessions` and its runtime caller interrupt pre-first-turn
  zombie sessions and release poisoned model capacity (`d68e7a9f`); root-cause/watchdog integration proofs are P0.1–P0.3.
- [x] **Agent Skills safety cores.** Source-trust classification (`fc8a8f3b`), import/TOFU decision composition
  (`50f64af9`), and no-auto-execute bundle gating (`2d53faf4`) shipped with pure tests. Effectful import/execution flows
  remain F4.20–F4.27.
- [x] **Recent correctness/cleanup.** Local-model crash guidance (`347d441f`), deferred workspace-metadata store
  notifications (`47e08165`), obsolete Linear preset removal (`6eba9f4b`), and zero-token liveness shipped.
- [x] **Release command pointers.** `.claude/commands/release.md` and `.nkleinrules/workflows/release.md` are pure
  pointers to `RELEASE_WORKFLOW.md`, removing the former duplicated workflow decision.
- [x] **Python sidecar endpoint phases.** `/v1/compress`, `/v1/embed`, `/v1/repomap`, `/v1/decompose/select`, and
  `/v1/agent/run` are implemented and tested. The final product architecture remains TypeScript; the sidecar is an
  optional local capability, not a migration roadmap.
- [x] **Dev-test specification enrichment.** All 36 numbered benchmark specs contain the v2 extensions and 3B-ready
  build guides; the two one-off authoring prompts were retired after completion.
- [x] **Historical planning files retired.** Vision/rules still in force moved to `todo.md`; completed outcomes and
  representative evidence moved here; remaining work became one of the ordered packages. Full verbose history remains
  available in Git at `0bfbbb02` and its ancestors without acting as a second backlog.

## 2026-07-13 Phase 0 stop-the-line fixes

- [x] **P0.1 — Eliminate the queued-drain/pre-first-turn planning wedge** *(legacy §12; `9c4fa3d2`).* The primary
  SDK bootstrap/send bypassed model-turn admission, so forced queue drain could start a child while the seed's
  decomposition callback and SDK turn were still unwinding. Primary, re-drive, and auxiliary turns now share the same
  admission gate. A deterministic seed-unwind→forced-child regression is green, the full 124-test task-session suite and
  9,264-test fast gate passed, the decomposition→child→review simulator passed three serial runs, and a guarded live
  Qwen3-8B/40k run on m5max reproduced the exact queued handoff, completed the child's first turn, review, and delivery
  without a zero-token admitted session.
- [x] **P0.2 — Make the board watchdog observable and non-wedgeable** *(legacy §12).* Live evidence showed the HTTP
  process responsive and LM Studio idle while every workspace-scoped request and shutdown state load waited. The proven
  poisoning path was an existing-workspace read taking the global index write lock and awaiting Git inspection whose
  `execFile` timeout defaulted to unbounded; the exact first Git command from the stopped run was not recoverable
  post-hoc. Existing reads now bypass that write lock, metadata mutations retain it, Git probes are bounded, and the
  watchdog uses a strict direct-by-ID board read behind an independently bounded tick. Persisted tick-entry/load-stage
  telemetry distinguishes interval failure, scope mismatch, timeout, and handler failure; a real-timer integration
  proves the next tick recovers after an injected never-settling snapshot, and shutdown now disposes watchdog,
  speculative, idle-work, and deferred-retry timers. The focused watchdog (3), workspace-state (18), and typecheck gates
  pass; the state suite's surfaced stale Ready-lane expectations were corrected in the same increment.
- [x] **P0.3 — Prove zero-token self-healing end to end** *(legacy §12).* Production primary/re-drive turns stamp an
  optimistic healthy heartbeat before their SDK/model call; the original detector treated any historical heartbeat or
  status as permanent liveness, so its null-heartbeat unit fixture could pass while every real zombie was excluded.
  Pre-token heartbeats now expire as renewable leases: a recent heartbeat protects slow prefill, while a still-running,
  token-less session beyond the generous bound is recoverable regardless of its stale qualitative status. A spawned
  runtime + real Docker sandbox integration holds the first mock-model response before its first byte, observes the
  watchdog interrupt the production-shaped session, proves admission capacity release through a second model request,
  and drains the recovered seed and child through review/delivery. The child deliberately delays its first response
  across several watchdog ticks but inside the lease and is not interrupted. Detector tests (10), the end-to-end rail
  (1), typecheck, lint, and the full fast gate are green.
- [x] **P0.4 — Execute transient-`aborted` retries at the shared model-call seam** *(legacy §5.AA/§5.Z).* Swarm model
  turns now pass through the previously-built buffered `AgentModel` recovery decorator at the actual SDK model-call
  boundary. A provider/runtime `finish:aborted`, transient `finish:error`, or thrown transport failure gets two bounded
  same-model retries; discarded text, reasoning, usage, and partial output never reach the agent loop. The request's
  outer abort signal is authoritative, so user/session cancellation is terminal, and any emitted tool call suppresses
  replay to avoid duplicated side effects. Raw cancellation text with no signal provenance is terminal too. Wrapped
  turns disable the AI SDK's nested retry loop, leaving one authoritative initial-plus-two total budget instead of a
  possible 3×3 request multiplication. Buffered tokens renew liveness out of band, so safe replacement does not
  create a false zero-token zombie. The AI SDK bridge now preserves abort parts instead of collapsing them to `stop`,
  and the vendored local runtime exposes a narrowly-scoped, non-serializable model-wrapper socket recorded in its patch
  ledger. Interactive/non-stream calls share the same abort-aware classifier: plain and tool completions retry safely;
  immediate chat streaming retries only before the first visible chunk. The real SDK `AgentRuntime` regression proves
  one recovered assistant message, explicit cancellation/tool-call/budget guards are pinned, the spawned-runtime Docker
  zero-token rail remains green, focused runtime tests (221), vendored gateway (88) and wrapper-socket (12) tests,
  typecheck, lint, SDK rebuild, the 9,290-test fast gate, and all 129 protected tests pass. A guarded live
  Qwen3-8B/40k high-power C0 lap then exercised the production SDK wrapper normally: it wrote and captured the exact
  `hello.txt`, reached review in about six seconds, and cleaned up its sandbox; the owned model was unloaded afterward.
- [x] **P0.5 — Fix the remaining `task-command-exit` launch case** *(legacy §5.U; reconciled 2026-07-13).* This was a
  stale backlog entry: the four-case integration is already fully green. The earlier fixes made spawned source commands
  resolve the vendored SDK aliases, run the shared server from a neutral cwd, and identify !Klein's protected source
  checkout from its install location rather than the server cwd (`a2a88586`, `b4a904dd`, `4967aa8e`). The final launch
  fixture deliberately registers its project through the write path before exercising read-only `task list`
  (`36b91973`): reads retain `autoCreateIfMissing:false`, bare launch does not silently add arbitrary git directories,
  and self-project confirmation remains explicit. Re-verification passed all 4 task-command-exit integration cases and
  all 11 invocation-parser cases without weakening either guard.
- [x] **P0.6 — Finish the project-switch stall investigation** *(legacy §5.V).* The original empty-board stall was
  traced and fixed in `204f2c18`: snapshots identify the stream's resolved workspace, stale mismatches reconnect with
  bounded backoff, and workspace-tagged frames cannot leak across projects. The final rapid-navigation pass found two
  additional races. First, while A remained the last streamed project and B was pending, clicking A to reverse course
  was discarded as a no-op; navigation now compares against the requested target, so the last click wins. Second,
  overlapping WebSocket handshakes could finish config loads out of order and leave the registry's active
  id/path/config tuple split across projects; a monotonic selection epoch now commits that tuple atomically and makes
  stale handshakes inert (clearing a project invalidates in-flight selections too). A deterministic A→B→A→B Playwright
  regression records the actual socket sequence, injects a stale snapshot and late old-project chat frame, and proves
  the destination board, task chat, and Settings config all settle without reload. Deferred-config unit tests pin both
  server and browser latest-wins behavior; the 9 registry tests, all 1,052 web tests, 130 protected tests, and both
  navigation e2e cases (three consecutive laps each) pass.
- [x] **P0.7 — Close the deterministic-bounce acceptance-workspace race** *(reconciled 2026-07-13).* This was reopened
  from an early diagnosis in the retired autonomous log even though the same log later recorded the root cause and fix.
  Concurrent acceptance checks for one card reused `<task>::acceptance`; one check's `finally` cleanup could destroy the
  other's live sandbox placement. Commit `9b80d20f` gave every invocation a distinct monotonic
  `<task>::acceptance-<seq>` identity, while acceptance resolution pins the delivered result commit to the explicit
  owning repository and finalization/rerun guards are scoped by workspace plus task. Later finalization hardening
  (`decbb772`, `fc36dd67`) made durable-controller-shifted re-review requests latest-round safe. The existing full
  bounce→rework→approve→fresh-acceptance→merge regression now always starts the durable scheduler instead of relying on
  an external environment override. Repeated scheduler-off and scheduler-on laps pass; the focused acceptance race
  suite remains green.

- [x] **P0.8 — Resolve the genuine no-result-branch/evidence failure class** *(legacy §5.AI; delivered 2026-07-13).*
  The intermittent "terminal card with no result branch and no explanation" outcome had three proven holes, all fixed
  fail-closed:
  1. **Capture failures were swallowed as benign.** A workspace that disappeared before capture was logged as info
     "nothing to capture" and the round ended silently. A disappeared workspace is not evidence the worker made no
     changes: capture failure now emits a typed `sandbox_patch_capture_failed` marker, flips the session to `failed`
     with an actionable card warning (workspace-unavailable reason preserved in diagnostics), releases the placement,
     and — when a fast bounce already owns a new round — records the failure as superseded instead of clobbering the
     live round.
  2. **An explicit stop skipped salvage.** `stopTaskSession` disposed and forgot the sandbox *before* emitting the
     interrupted summary, so the terminal-salvage hook (`captureTerminalRunSummary → finalizeSandboxReview`) saw no
     sandbox: no capture, no marker, no prior-work rebound. When the finalizer can still salvage (placement without a
     captured result branch, or a capture in flight), stop now leaves teardown to it.
  3. **Shutdown raced result assembly.** Finalization (patch capture → host-side result-branch assembly → durable
     marker → interrupted-round rebounds) was fire-and-forget; service disposal could clear state and stop Docker
     under it. Finalizations are now tracked and drained in `dispose()`, and the empty-capture interrupted path
     *awaits* its prior-result-branch probe, rebinding the card into review (`interrupted_prior_work_rebound`) before
     shutdown completes.
  On top of the fixed capture pipeline, evidence and review results are typed and actionable end to end:
  `resolveReviewSandboxResult` returns `{status, resultCommit}` and never accepts a result branch while work is still
  in flight (new `isActiveWorkSessionState`: running/queued/paused) or a capture is unsettled/failed;
  `runWithSettledReviewSandboxArtifact` fail-closes the reviewer→acceptance→merge suffix on pending/failed capture.
  `collectTaskEvidence` returns a `RuntimeTaskEvidenceCapture` (`result_branch` / `no_changes` / `capture_failed` /
  `capture_pending` / `evidence_failed` / `diff_failed` / `no_capture`, each with a recommended action), reads a
  stable marker+ref snapshot (retrying when capture races the probe), pins delivered artifacts to their persisted
  receipt and verifies the Git ref still matches, diffs the immutable capture commit (`commit^..commit`, never the
  moving branch), and never substitutes the dirty host checkout for missing task evidence; the evidence drawer and
  recovery panel surface the status and action in the UI. Full gate green: typecheck, web:typecheck, lint, test:fast
  (9328), protected (134), web-ui vitest (1052), affected Playwright specs (25).

- [x] **P0.9a — Presence-keyed legacy-worktree sweep at startup** *(first P0.9 leaf; delivered 2026-07-13).* New
  `src/workspace/legacy-worktree-sweep.ts`: a one-shot startup sweep, keyed purely on the existence of the global
  `~/…/worktrees` home (a clean machine no-ops on one `access()` miss). Each `<taskId>/<label>` entry resolves its
  parent repository from the worktree's own `.git` file — not from board/agent ids — snapshots uncommitted work into
  the trashed-task-patches store (same naming the trash cleanup understands), `git worktree remove --force`s it
  (prune + raw-remove fallback), then removes empty parents, the home dir, the retired `worktree-sync-state` store,
  and pre-§5.A setup locks (for both discovered repos and the registered workspaces passed by `runtime-server`).
  The shutdown coordinator's agent-id-keyed (`usesLegacyHostTaskWorkspace`) interrupted-task worktree cleanup and its
  shutdown-time lock sweep are deleted — shutdown now only persists interrupted state. Covered by
  `legacy-worktree-sweep.test.ts` (clean no-op + lock clear, live worktree with tracked+untracked snapshot,
  unresolvable-entry raw removal) and the updated shutdown-coordinator integration suite.

## 5. Completed open-work (finished `§5` items — ids preserved from `todo.md`)

> These sections reached 100% `[x]` and were moved here from `todo.md` §5 in their delivering commits. Their ids are
> unchanged so cross-references keep working.

### 5.A — Finish strict-isolation reconciliation & live verification (completed items)
- [x] **Docker sandbox efficiency/isolation profile audit + settings.** *(Raised 2026-07-09, user: prefer leaner Docker
      resource use; possibly one shared container with dedicated Unix users per agent, but user decides the balance.)*
      Current live fleet runs can leave several `nklein-agent-sandbox-*` containers alive at once; that may be correct for
      strict per-task isolation, but it needs a deliberate product setting instead of an implicit runtime shape. Audit the
      actual `AgentSandboxManager` pool/container model, container naming/reaping, mount lifecycle, per-task cwd lifecycle
      (including the live `chdir /workspaces/<taskId> ... no such file or directory` evidence), result capture/delivery
      lifecycle (2026-07-09 m4mini fleet run: focus-chain marked formatter files done and model-performance recorded
      `sandbox_patch_captured`, but the host dev workspace only contained `.nklein/nklein/workspace/*` metadata and no
      `src/formatters/*` after the agent abort), and resource cost under multi-card swarms. Then design and, if sound,
      implement global + project settings for an **isolation profile**:
      lean shared project container, strict per-task/per-agent containers, and/or shared global container only if the
      threat model holds. Shared-container profiles must use separate in-container users, separate workdirs,
      least-privilege ownership/umask, process cleanup, per-task cwd existence checks, no host fallback, unchanged
      `--network none` default, and fail-closed degradation when the requested profile cannot preserve isolation.
      **FIRST SETTINGS INCREMENT SHIPPED (2026-07-09):** code audit found the current `AgentSandboxManager` already uses a
      lean shared pool by default (`sandboxMaxContainers=1`, `sandboxAgentsPerContainer=0`) while still assigning
      deterministic per-task Unix users and `/workspaces/<taskId>` workdirs. The runtime config now makes that product
      decision explicit via `sandboxIsolationProfileDefault` (`lean_shared` default for low-spec hardware, legacy numeric
      configs infer `custom`) and `sandboxIsolationProfileOverride` for projects. `strict_per_agent` forces one agent per
      container and defaults its container cap to 4 when no cap is configured; direct numeric pool edits become `custom`.
      Settings exposes the global profile and project override, and tests cover resolver semantics, persistence,
      component save payloads, and the Playwright settings save path. **LEAN-PROFILE CONTAINMENT PROOF SHIPPED
      (2026-07-09):** the live Docker integration suite now asserts that two simultaneous tasks on the lean shared
      profile run in the same container but different UIDs, that each task workspace is mode `700`, and that a sibling
      task cannot read or write another task's workspace; the same run confirmed teardown left no labeled agent sandbox
      containers behind. **PROFILE COUNT/RESOURCE SNAPSHOT DONE (2026-07-09):** integration coverage now proves two
      simultaneous tasks use one lean shared container versus two strict per-agent containers; a live `docker stats
      --no-stream` probe on the same two-task shape measured lean = 1 container at ~856 KiB idle / 0.00% CPU, strict = 2
      containers at ~736 KiB + ~864 KiB idle / 0.00% CPU. **CAPTURE/LIFECYCLE ROOT CAUSE RESOLVED (2026-07-09):**
      `sandbox_patch_captured` means `applyTaskPatchToResultBranch` successfully wrote an `nklein/tasks/<task>` result
      branch; it does **not** mean those files are present in the host checkout before delivery merge. The fleet verifier
      now prints changed files and a tree sample for every result branch and explicitly reports whether the host checkout
      is clean, so future preserved workspaces distinguish "captured but unmerged" from "not captured."

### 5.E — Cache-key hygiene & fuzz coverage
- [x] **Telemetry/session caches keyed beyond task-id** — model-performance + knowledge-tool caches include
      `workspacePathHash`; locked by regression tests (same task id across two workspaces → two observations).
- [x] **Near-valid tool-payload fuzz suite** — extended beyond `decompose_project` to
      `expand_task`/`write_file(s)`/discovery tools; fixed `expand_task` raw-`taskGraph` parse (now uses
      `repairJsonStringValue`). ([test/runtime/nklein-agent/nklein-tool-payload-fuzz.test.ts](test/runtime/nklein-agent/nklein-tool-payload-fuzz.test.ts))

### 5.K — Second-opinion reviewer workflow ✅ *(complete; raised 2026-06-22)*
> Every worker card gets a real reviewer-role second opinion (full loop, up to 20 rounds, stall + identical-loop
> detection) — was config-only before.
- [x] **decision core** (`review-loop.ts`) — approve→deliver / request_changes→bounce / park (round-limit/stall/loop)
- [x] **reviewer tool + orchestration core** — `submit_review` (verdict/summary/feedback/insight) +
      `review-orchestration.ts` (gate, fingerprint, seed/bounce prompts, transition); unit-tested
- [x] **live wiring** — `runSecondOpinionReviewSession` runs a synthetic `<taskId>::review` session from the result
      branch and gates delivery in `finalizeHeadlessAutoReviewTask` (approve→deliver, request_changes→bounce to In
      Progress, park→stays in Review); fail-safe to the prior auto-complete on error
- [x] **board state + transitions** — card `review` object (CRDT-compatible); `runSecondOpinionReviewForTask`
      persists each round + re-drives the worker on bounce
- [x] **settings + UI** — `secondOpinionReviewEnabled` (default on) + `reviewMaxRounds` (default 20); Settings → Tasks
      toggle + max-rounds input; card-detail review panel (verdict/summary/feedback/sign-off/parked-reason)

### 5.Q — Model telemetry & performance-stats consistency *(raised 2026-06-23)*
> User saw the same model listed multiple times. **Diagnosed (2026-06-23): the data is clean** (registry +
> observations have no id variance); the duplication was the **display** — aggregates keyed by scope × role ×
> project × version rendered flat, so one model fills many rows. **Decided:** canonical identity = provider + model +
> canonical endpoint; aggregate globally per model, keep the breakdowns.
- [x] **Display fix** — the Model Performance dialog leads with a **By Model (global)** table
      (`rollUpAggregatesByModel` consolidates overall-scope role splits into one row per model, exact recomputed
      success rate); per-scope×role relabeled **Breakdowns**. Unit-tested. (Resolves the user-visible duplication.)
- [x] **Backend `byModel` aggregate** (precision follow-up) — `groupByModel` in
      [src/telemetry/model-performance-stats.ts](src/telemetry/model-performance-stats.ts) emits a `model`-scope
      aggregate recomputed from raw observations, keyed by provider + normalized-model + canonical endpoint, so
      success rate **and** timing are exact and loopback spellings dedup. Extracted the registry's
      `normalizeEndpoint`/`normalizeModelId`/`normalizeProviderId` into shared
      [src/core/model-identity.ts](src/core/model-identity.ts) — now used by the registry, the endpoint scheduler
      (loopback canonicalization now also fixes per-endpoint swarm serialization), and telemetry, so all three
      agree. web-ui `selectModelRollups` prefers the precise server aggregate (with Avg Time), falling back to the
      client roll-up for older servers. Unit-tested both sides + the loopback-dedup case.

### 5.T — Settings/UI polish *(raised 2026-06-23, from a Swarm/Settings review)*
- [x] **Make the "Local swarm guardrails" values configurable** (they're fixed today) + a **"Reset to defaults"** button. *(DONE 2026-06-24)*
  - [x] **Prerequisite (2026-06-24): single source of truth.** The turn/wall-time/no-diff limits were module-private
        constants in `nklein-task-session-service.ts` while the Settings display hardcoded matching strings ("12 turns"/
        "2 hours"/"4 repeats") — a drift risk. Promoted them to the api-contract
        (`RUNTIME_NKLEIN_MAX_AUTONOMOUS_TURNS_PER_TASK` / `_WALL_TIME_MS` / `_MAX_REPEATED_NO_DIFF_CHECKPOINTS`,
        next to `RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH`); the runtime guardrail logic imports them (aliased) and the
        Settings rows now render straight from them (`formatWallTimeHours`). Display is byte-identical; web 689 tests green.
  - [x] **Backend configurability (2026-06-24).** Added `swarmGuardrails` to the runtime config — a nested
        object (`maxAutonomousTurnsPerTask` / `maxAutonomousWallTimeMs` / `maxRepeatedNoDiffCheckpoints` /
        `maxRepeatedToolCallsPerTask`) with `DEFAULT_RUNTIME_SWARM_GUARDRAILS` + bounded `normalizeRuntimeSwarmGuardrails`
        + `areRuntimeSwarmGuardrailsEqual` in [src/core/api-contract.ts](src/core/api-contract.ts), threaded through
        `runtime-config.ts` (read/preserve/round-trip, modeled on `agentRulesets`) + the config response builder. The
        guardrail watchdog (`enforceAutonomyBudgets` + the repeated-tool-limit) now reads the **configured** values via a
        new `service.setSwarmGuardrails(...)` seam (set at construction + refreshed on the cached service in
        `runtime-server.ts`), not the contract constants. Each value clamps to a sane range (turns 1–1000, wall-time
        1 min–7 days, no-diff 1–100, tool-calls 2–100). Unit-tested: config defaults/round-trip/clamp/preserve +
        guard-honors-lowered-and-raised-limit. tsc + biome + fast (1349) green.
  - [x] **Settings editor (2026-06-24, web-ui).** The "Local swarm guardrails" section now renders the four per-task
        limits as number inputs seeded from the loaded config (wall-time edited in hours), each with an out-of-range
        inline hint (clamped on save) + a section **"Reset to defaults"** button (disabled when already at defaults).
        The static "Card batch budget" + "Repeated tool/API mistakes (SDK limit)" rows stay read-only. Shared
        `swarmGuardrailsToInputs`/`inputsToSwarmGuardrails` round-trip through `normalizeRuntimeSwarmGuardrails`. web
        tsc + biome + full web suite (84 files / 691 tests incl. new edit-and-save + reset tests) green. *(Visual
        Playwright pass folds into the §5.A UI verification session; behavior is fully unit-locked.)*
- [x] **Per-model concurrency multiplier** *(DONE 2026-06-24)* — LM Studio lets the user set concurrent requests per
      model, so allow attaching a "multiplier" to a selected model to reflect its parallel-request capacity (feeds the
      swarm scheduler).
  - [x] **Backend (2026-06-24).** Added a per-model `maxConcurrentRequests` registry constraint (default null = 1) with
        `normalizeConstraints` + a `setMaxConcurrentRequests` registry setter, a `saveNKleinModelMaxConcurrentRequests`
        tRPC procedure (local-only guard, mirrors the context-window override) + contract request/response schemas +
        parse helper. `scheduleNKleinEndpointStart` ([nklein-endpoint-scheduler.ts](src/nklein-agent/nklein-endpoint-scheduler.ts))
        now counts running sessions on the shared endpoint and allows up to the model's limit before holding the next
        start (capacity note in the block reason). Default 1 = unchanged serialization. Unit-tested: scheduler
        allows-N-then-blocks + registry set/clamp/clear. tsc + biome + boundary + fast (1351) green.
  - [x] **Settings editor (2026-06-24, web-ui).** `NKleinModelRegistryPanel` gains a per-model **"Parallel requests"**
        number input (Save/Clear, min 1, out-of-range hint) next to the context-window override, wired through both
        consumers (Settings dialog + agent chat model panel) to a new `saveNKleinModelMaxConcurrentRequests` client
        mutation. web tsc + biome + full web suite (84 files / 692 tests incl. a new save test) green. *(Live
        parallel-run observation folds into the §5.A UI verification session; the scheduler decision is unit-locked.)*
- [x] **Clarify "concurrent cards" vs "parallel agents"** *(DONE 2026-06-24)* — they **map 1:1** (each running card
      drives exactly one agent session; team-delegation sub-agents are a gated within-task exception, not a separate
      swarm-level dial), so per the decision the board concurrency-cap tooltip is relabeled **"Concurrent cards
      (parallel agents)"** with a description spelling out the 1:1 mapping. No separate "parallel agents" setting needed.
      (aria-label kept as "Max concurrent tasks" — relied on by a test + screen readers.)
- [x] **Move the model-roles model selector up next to the default model selector** *(DONE 2026-06-24)* — relocated
      the "Model roles" block to sit right after the default-model setup section + its context-window panel (above the
      code-intelligence embeddings / advisor / dev-tools blocks), so the default model and the per-role models are
      grouped. Web tsc + biome + dialog tests (32) green; live Playwright Settings render still clean.
- [x] **Revisit the bottom "Project" reference + "script shortcuts"** *(DECIDED 2026-06-24: KEEP both)* — inspected:
      the "Project" reference is a **clickable project-config-path** line (`<project>/.nklein/nklein/config.json`, opens
      the file) and "Script shortcuts" is a working **per-project command-shortcut editor** (named label + command,
      add/remove). Both are legitimate, clearly-labeled power-user features, not stray cruft — keep as-is. (If we
      later want to reduce clutter, they could move behind a "Project advanced" disclosure, but no change now.)
- [x] **Deactivate the "read the docs" links** *(DONE 2026-06-24)* — the only such link (Settings dialog footer, → the
      not-yet-published `docs.nklein.bot`) is now a **disabled** "Read the docs (not yet available)" button with a
      native-`title` "coming soon" hint, instead of opening a dead link. (The onboarding carousel's other external links
      go to real ollama/lmstudio download pages — left as-is.) web tsc + biome + full web-ui suite (689) green.

### 5.Y — Security hardening backlog *(raised 2026-06-26 from a static security review)*
> A whole-repo static security review (runtime auth, tRPC procedures, chat tools, filesystem boundaries, sandbox
> integration, Electron shell, frontend) surfaced 12 findings (1 Critical, 3 High, 6 Medium, 2 Low). It aligns directly
> with the North Star (**strict Docker isolation; host access only with explicit opt-in**) — several findings are where
> the *actual* boundary is weaker than that design intends. **Split by whether a fix is posture-neutral hardening (do
> autonomously) or touches a deliberate §5.M/host-opt-in design choice (needs a user posture call — flagged ⚠️).** Full
> evidence + file:line + remediation per finding in the audit doc.
- [x] **CRITICAL #1 — chat "safe" classifier no longer mis-labels code-executing/file-writing commands as safe** —
      DONE (owner steer, 2026-06-26: *"we have the 'I accept the risk' mode anyway, so the important thing is not to
      deceive the user by classifying commands wrong for the stricter modes — and not let them slip through there;
      fully-open mode still allows all"*). So the fix is **correct categorization, not blocking**: re-categorized
      `node -e`/`-p`/`--print` (arbitrary JS) and `sed`/`awk`/`xargs`/`tee` (write/exec — sed -i / tee write, xargs execs,
      awk can do both) as **unsafe** in `chat-command-safety.ts`, so they require acknowledgement in the stricter modes
      (only read-only `node --version`/`sort`/`tr`/`jq`/etc. stay auto-safe). `npm test` / `npm run <test|typecheck|lint|
      build|check>` deliberately stay safe (the owner's G3b build/test intent — already scoped to those args). +12
      regression tests (the audit's false-safe payloads now assert unsafe). Verified: 163 chat-command-safety tests green
      + biome. (The broader raw-shell `runtime.runCommand` endpoint is the separate #2.)
- [x] **HIGH #2 ⚠️ — `runtime.runCommand` is raw browser→host shell.** The endpoint accepts any command string and
      spawns it with `shell:true` + `env:process.env` (`cli.ts`); the only real UI use is "open workspace in editor"
      (a constrained client-built command). **Done (2026-06-26, §5.Y #2+#9 together):** both `runCommand` and `openFile`
      now immediately refuse with a clear FORBIDDEN tRPC error ("Host-local action unavailable in remote mode — runs on
      the server host, not your machine") when `deps.isRemoteMode` is true. Local mode is fully unchanged. `isRemoteMode`
      is an optional bool on `CreateRuntimeApiDependencies` (defaults false → tests unchanged); `runtime-server.ts`
      threads the already-computed `isRemoteMode = isKanbanRemoteHost()` into `createRuntimeApi`. 7 new tests cover both
      modes for both endpoints. Gate: tsc 0 · biome clean · 1866 fast tests · web:typecheck 0. *Deferred richer
      follow-up:* replace with typed intents (`openWorkspace({targetId})`) + allowlist server-side for a defense-in-depth
      hardening of local mode too.
- [x] **HIGH #3 — chat workspace file tools escape via symlinks** — DONE (`84a4f97c`). `resolveWithinWorkspace` was
      lexical-only and reads/lists/writes followed symlinks → a `repo/link -> ~/.ssh` escaped even in read-only scopes.
      Fixed by layering `assertRealPathWithinWorkspace` (realpaths both root + target before every read/list/write;
      writes walk up to the nearest existing ancestor so new-file creation still works; errors stay workspace-relative,
      no host-path leak; the CLI `--allow-write` path shares the resolver so it's covered too). **Verified:** tsc + biome +
      16 new symlink-escape regression tests (file/dir/deep-nested escapes rejected for read/list/write; within-workspace
      symlinks still work) + full fast gate green.
- [x] **HIGH #4 — NKlein file tools rely on caller sandboxing, don't enforce containment.** `write_file`/`edit_file`/
      `read_large_file` accept absolute paths; protection is only the Docker proxy when present (home sessions are
      host-cwd). Enforce workspace containment inside each tool + the approval policy; reject host-absolute/`..`/symlink
      paths unless an explicit audited host session. (Ties to the "agents never see host" invariant.) **DONE
      (2026-06-26):** added a single shared helper `src/nklein-agent/nklein-tool-path-containment.ts` —
      `confineToolPath(workspaceRoot, rawPath, {sandboxWorkdir?})` (load-bearing synchronous lexical confinement: a
      target is allowed iff it resolves within the root; absolute-within-root + workspace-relative allowed, host-
      absolute-outside + `..` rejected with a non-leaky message) plus `assertRealToolPathWithinRoot` (realpath/symlink-
      escape check, nearest-existing-ancestor for not-yet-created writes, mirrors `chat-workspace-tools`). The single
      root each tool/approval already had IS the correct legitimate root: in-container task tool root = the in-container
      `/workspaces/<taskId>` (so container paths stay allowed — the sandbox dir IS the root); home/chat host-cwd session
      root = the host project cwd (host-absolute within it stays allowed); the approval policy is host-rooted but gets
      `sandboxWorkdir = buildAgentSandboxWorkdir(taskId)` (skipped for home sessions) so a non-home task's container
      paths stay allowed. Wired into `nklein-write-files-tool` (write_file/write_files), `nklein-edit-file-tool`,
      `nklein-large-file-workflow` (read_large_file `readNext`), and the approval policy
      (`nklein-runtime-setup.ts` `approveToolPathContainment` as the first gate, covering read_files/read_large_file too).
      Docker proxy untouched (proxy `execute` forwards into the container where the real tool runs with root
      `/workspaces/<taskId>`; the in-tool check runs container-side). No CHANGELOG (internal defense-in-depth, not a
      containment bug reachable on `main` — the sandbox proxy was the live boundary). Tests: unit tests for the shared
      helper + tool-level + approval-level coverage (host-absolute-outside / `..` / symlink → rejected; container path /
      workspace-relative / home-session-host-path-within-root → allowed). Full `test:fast` green (1922).
- [x] **MED #5 — chat `browse_url` SSRF.** Only checks http/https → can fetch `127.0.0.1`/RFC1918/link-local/cloud-
      metadata. Block private/loopback/link-local/metadata ranges; re-check after redirects; disable in remote mode w/o
      opt-in. **DONE (2026-06-26):** mode-based default — in remote (`--host`) mode the tool resolves the hostname via
      DNS before navigating, checks the IP against blocked ranges (loopback, RFC1918, link-local/169.254, CGNAT, IPv6
      loopback/unique-local/link-local), and re-checks the final URL after redirects. Literal IP addresses are
      checked directly without DNS. Local mode leaves internal addresses allowed (the "agent verifies its own dev
      server" use case). Uses `ipaddr.js` (already in node_modules) for range checks. Threaded `isRemoteMode` through
      `buildChatAgentToolDepsResolver` → `createBrowserTools`. Unit-tested: `isPrivateOrReservedIp` pure helper (all
      ranges, edge octets, public=false); remote mode refuses literal loopback/metadata/RFC1918/IPv6; allows public
      IPs; redirect-to-internal caught; local mode allows everything. A per-session override toggle is a possible
      follow-up.
- [x] **MED #6 — internal bearer token propagated via `process.env` to all child processes** (terminals, sidecar,
      sandbox, user commands inherit `NKLEIN_INTERNAL_AUTH_TOKEN`). Scrub it from spawned terminals/sidecars/sandbox/user
      commands; pass only to the specific trusted subprocesses that need runtime-API access. **PARTIAL (2026-06-26):**
      added the reusable `stripInternalAuthTokenFromEnv` helper (`src/security/passcode-manager.ts`) and applied it to the
      **chat `run_command` spawn** (highest-value, model-driven RCE surface — pairs with CRITICAL #1; unit + real-spawn
      tests) AND the **core-py sidecar spawn** (a passive ML service that never calls the runtime API). **The Docker agent
      sandbox is already safe** — verified the sandbox code does not forward host env into the container (Docker doesn't
      auto-inherit it), so the token never enters the agent container. **DONE (2026-06-26) — terminals scrubbed** at the
      single `PtySession.spawn` choke point (`src/terminal/pty-session.ts`): `env: stripInternalAuthTokenFromEnv(env ??
      process.env)` (the `?? process.env` also covers the no-override case, where node-pty would otherwise inherit
      process.env + its token). **The feared delicacy dissolved on inspection:** (1) the token is generated *only* in
      remote mode (when the passcode is active) → the scrub is a **no-op in local mode**, so local `nklein task` (loopback,
      no-auth) is unaffected; (2) in remote mode a (possibly *remote*) user terminal must **not** hold the trusted bypass
      token — that IS the escalation concern, so scrubbing is the correct posture, not a regression; (3) the agent tool
      path is **containerized (not a PTY)**, and the runtime spawns the trusted runtime-API CLIs (`nklein task`/hooks)
      directly **without** this scrub, so they still inherit the token. Legit token-keepers stay intact (the CLI
      runtime-API callers via `getRuntimeFetch`). 2 regression tests (override + no-override cases) in `pty-session.test.ts`;
      tsc + biome + 44 terminal tests green. **This completes §5.Y (12/12).**
- [x] **MED #7 ⚠️ — remote mode could run plaintext HTTP + `--no-passcode`** — DONE (owner confirmed they use remote
      mode → high priority). A non-loopback (`--host`) bind now **refuses to start over plain HTTP** unless TLS is
      configured (`--cert`/`--key`), with a clear remediation error; the explicit opt-out `--insecure-remote-http`
      starts it anyway behind a prominent cleartext WARNING. `--no-passcode` on a non-loopback bind now ALSO requires
      the new `--dangerously-disable-remote-auth` flag (prominent "API exposed unauthenticated" warning); on loopback
      both flags behave exactly as before (no new friction). Decision logic is a pure, exhaustively-tested helper
      `resolveRemoteSecurityPolicy` (`src/security/remote-security-policy.ts`), wired into `runMainCommand` in `cli.ts`
      after TLS validation. Cookie `Secure` stays TLS-gated (correct); when TLS is on, responses now also send
      `Strict-Transport-Security` (via the pure `buildTlsHardeningHeaders` helper, used in `runtime-server.ts`).
      **Tests:** 15 in `test/runtime/security/remote-security-policy.test.ts` (all 4 mandated scenarios + HSTS). Gate:
      tsc 0 · biome clean · 1842 fast tests green. CHANGELOG `## [Upcoming]` entry added (user-facing startup change).
- [x] **MED #8 ⚠️ — folder picker / addProject expose broad host FS to remote users** (`filesystemRoot = "/"`, absolute
      paths, arbitrary git-init). In remote mode, restrict browsing/creation to configured roots; return paths relative
      to the allowed root.
      **Done (2026-06-26):** `src/workspace/remote-path-confinement.ts` — pure `confineToAllowedRoots` + `resolveRemoteBrowseRoots`
      helpers. `CreateProjectsApiDependencies` gains `isRemoteMode` + `allowedBrowseRoots`. In remote mode: `filesystemRoot`
      narrows to `allowedBrowseRoots[0]` (home dir); `listDirectoryContents` rejects any path outside every allowed root;
      `addProject` rejects both explicit paths and custom clone destinations outside allowed roots. Local mode fully unchanged.
      `runtime-server.ts` computes roots once at startup from `loadGlobalRuntimeConfig().workspaceBaseDir`. Tests: 10 new
      cases in `projects-api.test.ts` covering the pure helpers + API confinement in both modes. Gate: tsc 0 · biome clean ·
      1860 fast tests green. CHANGELOG `## [Upcoming]` entry added.
- [x] **MED #9 — `runtime.openFile` opens arbitrary host paths/URLs** via the `open` package, no validation. **Done
      (2026-06-26, §5.Y #2+#9 together):** refused in remote mode (same guard as #2 above). *Deferred richer follow-up:*
      replace with typed intents for known artifacts (data dir, evidence bundle, plan artifact) validated against a known
      root; validate every target in local mode too.
- [x] **MED #10 — desktop shell trusts a spoofable `<title>!Klein</title>` health check** to attach its preload bridge.
      **DONE (2026-06-26).** Replaced title-only trust with a nonce-authenticated handshake (§5.Y #10): the desktop generates
      a 32-byte cryptographic nonce when spawning its own runtime, passes it via `NKLEIN_DESKTOP_NONCE` env var, and verifies
      the echo on `GET /api/desktop-health` before attaching the preload bridge. Pure `resolveDesktopTrust` helper in
      `packages/desktop/src/runtime-trust.ts`. Packaged builds refuse pre-existing and nonce-failing runtimes; dev builds
      allow title-liveness fallback with a warning. `getActiveNonce()` accessor for test introspection. Runtime server echoes
      nonce on the new endpoint only when the env var is set (never logged). 19 new nonce-handshake tests in
      `packages/desktop/test/runtime-trust.test.ts`; all 263 desktop tests pass (1 pre-existing env failure excluded).
      tsc + biome + 1922 root fast tests green.
- [x] **LOW #11 — host-action audit log records only `tool.name`, not the command/URL/cwd** — DONE (`33827d15`). The
      gated executor recorded `detail: tool.name` for every call. Fixed by a new pure `buildAuditDetail` module
      (`src/chat/chat-audit-detail.ts`): `run_command` → the command (+ cwd), `browse_url` → the URL, file tools → the
      workspace-relative path, fallback → tool name. **Redaction:** 4 layers (named secret flags `--token=…`, HTTP auth
      headers, known-secret env assignments, bare high-entropy tokens) + host-absolute paths suppressed; detail capped at
      512 chars. **Verified:** tsc + biome + 36 unit tests + 5 executor integration assertions + full fast gate green.
- [x] **LOW #12 — runtime app served with no CSP / hardening headers.** Add a CSP tuned for the bundled FE + local API/
      WS, plus `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`; test the
      headers. (`dangerouslySetInnerHTML` is currently only Prism output, which escaped raw `<` in testing — defense in
      depth, not an active XSS.) **PARTIAL (2026-06-26):** added the three standard-safe headers — `X-Content-Type-Options:
      nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` — to the asset response in `runtime-server.ts`
      (gate-verified: tsc + 1799 fast tests). **DONE (2026-06-26):** added the CSP (`script-src 'self'`; `style-src 'self'
      'unsafe-inline'`; `connect-src 'self' ws: wss:`; `img-src 'self' data: blob:`; `font-src 'self' data:`;
      `object-src 'none'`; `base-uri 'self'`; `frame-ancestors 'none'`). To enable strict `script-src 'self'` without a
      nonce, the SW registration inline script was moved from `index.html` to `main.tsx` — built HTML now has zero inline
      scripts. Live-verified the STRONG way: loaded the built app **with the CSP header actually active** (a static
      server emitting the real CSP, not a header-less vite preview, which cannot surface a violation) — root innerHTML
      912 chars, 0 CSP violations. That active-CSP load caught two inherited-fork artifacts the preview missed:
      (a) **Sentry** shipped a hardcoded *upstream* DSN (errors + session replays going to Cline's Sentry account) → now
      env-gated (`VITE_SENTRY_DSN` / `NKLEIN_SENTRY_DSN`|`SENTRY_DSN`; inert by default → no telemetry leak, `connect-src`
      stays tight; matches the existing PostHog env-gate); (b) the **task-start onboarding carousel** streamed Cline demo
      videos from external signed S3 URLs (`github.com/user-attachments` → `*.s3.amazonaws.com`) → removed rather than
      punch an S3 hole in the CSP (slides render title+description via a new `hasOnboardingMediaSource` guard).
      Regression tests in `test/runtime/security/remote-security-policy.test.ts`; web suite 712 green.
      **Fork-artifact sweep done (2026-06-26 — CLEAN):** Sentry was the *only* hardcoded phone-home endpoint (now
      env-gated); PostHog is already env-gated (`isTelemetryEnabled()` requires a key → inert without one); the remaining
      `telemetry.*` hits are LOCAL self-observation JSONL (evidence bundles / dogfood), not phone-home; branding is clean
      (no `NKlein Bot Inc.`/`Bot Inc`/user-facing `NKlein Kanban` — the lone `LEGACY_KANBAN_INITIAL_COMMIT_MESSAGE` is a
      deliberate git-history-matched back-compat string per AGENTS.md). **Remaining content follow-up:** !Klein needs its
      own self-hosted onboarding media (then no CSP change — `'self'` covers it).
> **Suggested order — UPDATED with owner decisions (2026-06-26).** Done so far: ✅ #3 (symlink), ✅ #11 (audit detail),
> ✅ #1 (correct categorization — the owner's actual ask), ✅ #6 (chat + sidecar + terminals — internal token scrubbed at
> the `PtySession.spawn` choke point), ✅ #7 (remote
> HTTPS-by-default + `--no-passcode` gating + HSTS), ✅ #12 (headers + CSP + Sentry-DSN env-gate + Cline onboarding-media
> removal, live-verified with the CSP header ACTIVE), ✅ #8 (folder-picker / addProject
> confinement in remote mode), ✅ #2 + ✅ #9 (runCommand + openFile refused in remote mode), ✅ #5 (chat browse_url SSRF
> guard in remote mode), ✅ #4 (NKlein file-tool + approval-policy workspace containment, defense-in-depth), ✅ #10 (nonce
> handshake). **Remaining:** NONE — the §5.Y security backlog is COMPLETE (12/12). Each fix got a regression test.

---

## 6. SHIPPED — already implemented (do not rebuild)

> Crossed off. Grouped by area; file pointers in `todo.md` §1.4 / §5 / `AGENTS.md`.

### 6.1 Local-only platform & cloud lockdown
- [x] Single default-deny policy (`LOCAL_PROVIDER_IDS = {ollama, lmstudio, lm-studio}`, `isLocalProvider`/
      `isLocalBaseUrl` for localhost/RFC-1918/CGNAT/`*.local`, managed-OAuth denied, typed
      `CloudProviderDisabledError`), gated at `resolveLaunchConfig`, re-asserted at task start and router/role
      resolution; cloud-pinned cards hard-stop. Catalog/picker/roles/onboarding/settings filter cloud out;
      `normalizeAgentId` clamps persisted cloud ids → `nklein`. Boundary scan test guards the policy file.

### 6.2 Reliability core
- [x] Never-overflow pre-send guard (same source as the context bar; compacts, or a specific "your message is
      larger than the working budget" message). Real effective window = `min(advertised, override, sanity
      ceiling)` (old 200k clamp removed). Local-appropriate timeouts (no 1s bug; generous floors; `unlimited`
      honored; positive timeouts scale up from measured MCSR speed; cold-start pessimistic prior). Error back-off
      / park instead of telemetry storms. Session restart/resume via persisted launch config (no host
      session-map casting). Acceptance gate uses non-login shell / direct exec with streamed buffer.

### 6.3 Context budget visualization
- [x] Per-task `ContextBudgetBreakdown` (system · tool schemas · prompt · file content · history · reserved
      working · reserved output) against the real window; segmented green→gold→orange→red full-width bar in chat
      + compact form on cards; graceful degrade.

### 6.4 Model Capability & Speed Registry (MCSR)
- [x] Per-model capability + measured prefill/decode/TTFT speed (EWMA, fractional, debounced), capability prior
      weighted `1/(1+samples)`, 30-day half-life decay. Effective context-window resolution (advertised/observed/
      override, ≥32k). Chat Model Telemetry panel + Settings with per-model context Save/Clear, zero-sample
      prompt, stale-row prune + per-row delete, shared loaded-model filter.
- [x] *(2026-06-22)* **Loopback endpoint canonicalization** — `localhost`/`127.0.0.1`/`0.0.0.0`/`::1` and
      trailing slashes are normalized in the registry key, so the same local model isn't registered/displayed
      twice (once selected-but-blank, once with telemetry); persisted duplicates merge on load.

### 6.5 Parallel local swarm executor
- [x] `maxConcurrentTasks` enforced across single/batch/dependency/runtime starts; auto-start unblocked cards on
      completion/commit under the cap; per-endpoint serialization with typed `endpoint_busy` + `retryAfterMs` +
      opt-in queued admission; file-overlap-aware scheduling (`filesLikelyTouched`); dependency-ordered
      auto-merge of reviewed worktrees (conflicts spawn a Planning integration card); shared decision blackboard
      (`decisions.md`); per-model tool routing; swarm guardrails (turn/wall-time budgets, no-diff + repeated-tool
      watchdogs, 12-card batch budget, workspace Pause/Resume stop signal) — surfaced in Settings.

### 6.6 Autonomous decomposition & planning
- [x] `decompose_project` / `expand_task` with sizing-contract + graph/reference validation; recursive bounded
      expand to terminal leaves with connected-local-model fit guard; plan artifacts under
      `<project>/.nklein/nklein/plans/<slug>/` (`spec.md`, `plan.md`, `tasks.json`, `questions.md`, `summary.md`,
      `decisions.md`, `revisions.md`, idempotent apply); cards land in Planning and flow into execution;
      naive-idea → clarifying questions (option chips) → reviewable plain-language plan; adaptive re-planning on
      `plan-gap` events.
- [x] **Dependency-coherence validation + deep-domain aids** *(2026-06-21)*: graph-quality checks reject
      incoherent DAGs (free-floating test/docs cards), warn on sparse/isolated/reversed/UI-without-domain graphs;
      generated cards carry `knowledgeDebt`; the `kanban-decompose` workflow mandates a knowledge-acquisition +
      "under-decomposed by 10x/100x?" scope-pressure pass. ([src/nklein-agent/nklein-decomposition-graph-quality.ts](src/nklein-agent/nklein-decomposition-graph-quality.ts))
- [x] **Works under strict isolation** *(restored 2026-06-19)*: decomposition tools are trusted control-plane
      (mutate only `~/.nklein/nklein/` artifacts + the board, never the working tree), stay host-side during
      sandboxed planning, with the host workspace root forwarded so artifacts/board resolve to the owning
      workspace. Live-verified: a 1-shot prompt → Planning DAG → started card with isolation ON.
- [x] *(2026-06-22)* **Planning-card start fixes** — the Start (play) button now works on Planning cards, a
      plan-mode card starts in place without dropping the kickoff, dragging Planning→In Progress launches an
      approved act-mode card, and "Approve for execution" launches the task when none is running.

### 6.7 Codebase intelligence
- [x] TypeScript-AST + PageRank repo map (lexical fallback), personalization boosts, invalidated after mutating
      tools. Code index with provider/model-separated dense vectors, `local_lexical` honest fallback,
      OpenAI-compatible local embedding endpoints, hybrid lexical+semantic+repo-map search, cache GC. Settings
      Code-intelligence panel + board chip; global + per-project embedding overrides. Knowledge/tool-usage JSONL
      telemetry aggregated by project/version/model/role/tool/category/outcome, shown in the stats view.
- [x] Knowledge-expansion baseline *(started 2026-06-21)*: decomposition mandates knowledge-acquisition +
      scope-pressure and cards record `knowledgeDebt`. The distinct correlation follow-up is `todo.md` F1.1.

### 6.8 Operator UI & observability (swarm cockpit)
- [x] Running cards show role/model, token bar, tok/s, elapsed, current tool, turn count; global swarm header
      (running/waiting/blocked, per-endpoint grouping, concurrency slider, Pause/Resume, code-intel chip); MCSR
      panel; Planning DAG review with fit badges + "Approve for execution" + revised-plan flags; per-card
      diagnostics drawer (telemetry, no LLM); "what !Klein is doing right now" activity surface; first-run
      local-model setup wizard; progressive disclosure + feature-visibility coverage matrix; statistics view
      (model performance + knowledge-tool usage).
- [x] *(2026-06-21)* **OpenHands-style "watch the agent's hands"** per-card **Watch** tab: live
      state/model/elapsed/current-tool, an accumulated activity timeline, the files it is changing this run, and
      a jump to its terminal.
- *(cross-link, not a separate item — tracked in `todo.md` §5.A)* **Open:** browser-only live verification of the
      cockpit + isolation status/pool UI — see `todo.md` §5.A (the Playwright UI pass + the "pool-control inspection"
      still-owed items).

### 6.9 Strict Docker agent isolation
- [x] Pinned `nklein/agent-sandbox` image, in-container tool-runner (`/opt/nklein/tool-runner.cjs`),
      `AgentSandboxManager` boundary (docker CLI). Configurable container **pool** (max containers,
      agents-per-container, CPU/RAM, idle timeout, FIFO queue; Shared/Dedicated presets; `--network none`,
      `--cap-drop ALL`, `no-new-privileges`, `--read-only`, tmpfs, per-container named volume, ro project mount).
      Per-task uid + `/workspaces/<taskId>`; clone-in / patch-out via `nklein/tasks/<task>` result branches
      applied host-side with a temp index (`commit-tree`, no host checkout mutation). All host-touching agent
      surfaces routed through the container (default executors, acceptance gate, repo_map/search/file-discovery/
      read_large_file/write_file(s) proxies); local-exec MCP default-denied; `webFetch` disabled under no-egress.
      Fail-closed preflight at start + startup; no-host-execution guard tests; Docker-gated integration tests;
      orphan reaping; killswitch; Settings isolation status + pool controls.
- [x] Live-verified end-to-end (2026-06-19, real LM Studio task in Docker, clean teardown, fail-closed).
- [x] **Classified patch-capture & stall diagnostics** *(2026-06-21)*: typed corrupt-vs-non-applying patch
      classification, failing file/hunk extraction, failing patch preserved under `patch-failures/`, structured
      stream/tool inactivity-timeout card note (last activity/tool, captured?, resume safety).
      ([src/workspace/task-patch-capture-diagnostics.ts](src/workspace/task-patch-capture-diagnostics.ts))
- [x] **Host-worktree creation retirement baseline:** no live path creates/reads a task worktree; task work is captured
      from Docker into result branches. The distinct migrated-board cleanup/module-removal follow-up is `todo.md` P0.9.

### 6.10 Polyglot core, native agent core & local-model SOTA *(postdates the predecessor docs)*
- [x] **Python core sidecar** (`core-py/`, FastAPI, local-only): constrained generation (`/v1/generate`,
      `/v1/generate_structured` — full sampling + grammar/JSON-schema decoding via own `llama-cpp-python` or a
      proxied local OpenAI server), ML services (`/v1/compress` LLMLingua-2-style, `/v1/embed` lexical/
      sentence-transformers, `/v1/repomap` PageRank), native ReAct agent loop (`/v1/agent/run` with
      path-contained tools + aider-style fuzzy edit), decomposition quality (`/v1/decompose/select`
      coherence + best-of-N), reasoning-model fallback (verified vs qwen3.5). Opt-in via `NKLEIN_CORE_PY`
      (default off), auto-fallback when unreachable. `KleinCoreClient` is a drop-in for the local client.
- [x] **TS native agent core** (`src/agent-core/`): constrained tool-calling (ReAct) loop on the !Klein-owned
      local client with stall/loop + max-turn guards and a JSON-schema-constrained action decider.
- [x] **Local-model SOTA helpers:** per-model/role sampling policy (`resolveLocalSamplingOptions`), shared
      JSON-repair (`repairJsonValue`), best-of-N decomposition self-consistency, LLMLingua-2-style selective
      compression (+ ONNX scorer download/update manager), `LocalLlmClient` with full sampling + grammar
      constrained decoding, aider-style `edit_file` fuzzy ladder, `run_command` tool.
- [x] **LM Studio live-only selection fix:** discover loaded models from the live endpoint, fall back to the
      catalog localhost base URL when none saved, auto-select the first loaded model (don't trust stale catalog
      defaults like `openai/gpt-oss-20b`).
- [x] **Audio-VST / psytrance autonomous dev-test preset** (left-sidebar Dev Test Scenarios, same
      create-and-start flow) + DSP benchmark harness (first successful autonomous run recorded). *(Rubric scoring
      still open — `todo.md` §5.B.)*
- [x] **Modern DAW Foundation dev-test preset** *(2026-06-22)* — the maximal stress fixture: a `daw_foundation`
      preset that scaffolds a project from a comprehensive, full-modern-DAW-parity spec
      ([scripts/dev-fixtures/daw-foundation-spec.md](scripts/dev-fixtures/daw-foundation-spec.md) — Ableton/FL/
      Bitwig/Logic/Cubase/Studio One/Reason/Reaper signature workflows, modular environment, MCP control, linked
      multi-window/web, SOTA quality bar) plus a real tested `timebase` seed
      ([scripts/dev-fixtures/daw-foundation/](scripts/dev-fixtures/daw-foundation/)). Scenario uses a new
      `specificationPath` so the full spec is a real file (not crammed into the prompt); the seed prompt is
      realistic ambitious-user voice demanding deep decomposition, explicit knowledge debt, heavy external-
      knowledge fetching, real DSP + golden tests, and a release-quality SOTA bar. Intended to push 9B local
      models to their limits and showcase 120B+ models. *(Domain rubric scoring still open — `todo.md` §5.B.)*
- [x] **`THIRD_PARTY_NOTICES.md`** documenting re-implementation-with-attribution of ecosystem techniques
      (aider, Roo Code, Continue — Apache-2.0; OpenHands — MIT), excluding AGPL-3.0 to keep !Klein Apache-2.0.

### 6.11 Runtime control, chat UX, self-improvement, security, portability baseline
- [x] Board pause halts the agent loop at the per-turn checkpoint (`"paused"` park state; auto-resume; gates
      sandbox executors + acceptance gate); per-card pause/resume (`paused-tasks.json`, tRPC, board toggle);
      finished-card Replay (`replayCardsEnabled`, default off, confirm-gated, destructive reset); per-message
      chat timestamps + full-width context bar.
- [x] Self-observation telemetry sink (path-redacted, secret-pattern-broadened, rotation); evidence bundle +
      one-click "Create evidence"; gated "Create !Klein self-improvement project"; dogfood backlog engine
      (sizing-clamped); smoke-eval harness (local roster); evidence/diff drawer; ⌘K palette; developer surfaces
      behind a persistent **Developer Mode** toggle. **Protected test suite** (`test/protected/`, 9 files / 79
      tests, `npm run test:protected`) + `agent-write-guard` (protected-path + secret-write block, structured
      approval surfaced in chat, audited) — strict-isolation guards included in the manifest (human-approved).
- [x] Electron hardening (contextIsolation, no nodeIntegration, sandbox, webSecurity, deny-by-default popups,
      same-origin nav, CSP fallback, packaged devtools off; runtime bound to `127.0.0.1`; hardened
      Set-Cookie/session token; secret scanning in the agent-write path). Workspace-identity hardening
      (explicit-only registration, self-project confirmation surviving removal, task-worktree→owning-workspace
      resolution, accidental-project repair, board-vs-runtime persistence split, board-save conflict
      rebase/retry). Add-Project UX (one controlled dialog; Existing-Folder + New-Folder flows). Guidance skills
      (`security`/`ui`/`ts`) as on-demand `/nklein-*` workflows.
- [x] **Project portability baseline:** runtime-home stays the fast local index/cache, but board state, session
      summaries, revision metadata, and workspace identity mirror into `<project>/.nklein/nklein/workspace/` and
      can recover from that mirror. **Full portable CRDT state** (per-field LWW board CRDT
      [src/state/portable-board-crdt.ts](src/state/portable-board-crdt.ts), committed store
      [src/state/portable-board-store.ts](src/state/portable-board-store.ts), export/import with machine-local
      `nkleinSettings` stripped on import, live wiring into save/load, card-trash tombstones, per-machine
      `replica-id`, cross-machine-recovery integration test) is shipped. The distinct schema/browser proof is
      `todo.md` G6.5a.

### 6.12 SDK vendoring & repo integration *(2026-06-22)*
- [x] The agent SDK is vendored fully in-repo under `vendor/nklein-sdk/{core,agents,llms,shared}` (committed
      dist), the daemon/branding rebrand applied, and the `@nklein/*` external-package wrapper removed in favor
      of in-repo path aliases (`scripts/nklein-sdk-alias.mjs` for vitest/esbuild, `tsconfig` paths for tsc/tsx),
      with the SDK's runtime deps hoisted to the root manifest. The SDK is now repo-owned and editable.
- [x] **Hub-daemon crash fix:** the SDK session host runs on the in-process `local` backend, so the SDK's broken
      cron/automation hub daemon (an upstream defect) is never spawned. !Klein doesn't use scheduled-agent
      features.

### 6.13 Recovery, artifact application, review actions, settings clarity & diagnostics *(follow-up-2 hardening)*
> These distinct shipped features were under-represented in earlier passes of this doc; itemized here so they're
> not mistaken for open work or rebuilt.
- [x] **Lost-session recovery.** Heartbeat-`lost` sessions are detected and parked into a needs-attention /
      review-style state when useful output/artifacts exist, exposing **Resume / Mark interrupted / Apply pending
      artifacts** actions, preserving transcript + artifact refs, and showing a human-readable reason on the card.
      A **lost-heartbeat policy** setting chooses **Park + Actions** (default) vs **Keep running** for manual
      operators. *(Confirmed live: the captured task config carries `lostHeartbeatPolicy: "park"`.)*
- [x] **Decomposition artifact application & review.** Generated graphs are **workspace-owned artifacts**
      (artifact id, owning workspace id, source-task provenance, validation status), applied idempotently by
      `{workspaceId, artifactId}` (never by slug/cwd). A global **auto-apply** setting (default on) + a **per-card
      override**; when auto-apply is off, an **inline pending-artifact review** (kind / task count / dependency
      count / validation / timestamp, with **Apply / Reject**) on the source card. Fixed the "chat says 10 tasks
      generated but the parent board has none" accidental-task-worktree bug class, with regression coverage.
- [x] **Auto-review trustworthiness.** Auto-review runs when cards reach Review; if it can't run, or *claims
      success with no commit/PR/branch effect*, the card is flagged with a specific reason + recovery action;
      review-checkpoint capture failures that affect recovery are surfaced (harmless cleanup noise stays out of
      the UI but is recorded).
- [x] **Verify & Merge card actions.** A **Verify** action on Review/Planning cards when an `Acceptance check:`
      line is detected (runs in the right workspace; shows status / output summary / failure reason); a
      Review-lane **Merge** action showing progress, conflicts, skipped tasks, and cleanup status.
- [x] **Settings clarity & safety.** "Effective context" + "Context override" labels with token **units** and
      visually-distinct inherited/default/effective values; full `RuntimeTaskNKleinSettings` exposed with **human
      labels** (context scope, timeouts) instead of raw keys like `requestTimeoutMs`; model-role overrides
      preserve provider/model/reasoning/context-scope/timeout; fixture model ids (`small-local-model`, etc.)
      guarded from leaking into user-facing selectors.
- [x] **Project/workspace health diagnostics.** Checks for accidental worktree projects, missing parent
      workspaces, lost sessions with pending artifacts, and stale never-applied/rejected artifacts — surfaced in
      Developer Tools / a project-health area — plus telemetry for workspace-resolver decisions (explicit id /
      path / parent-worktree / existing-index / rejected auto-registration) and artifact lifecycle events.
- [x] **Code-intelligence is project-scoped.** Moved out of Global Settings into the selected-project sidebar
      panel (indexing status, embedding provider/model, last-indexed, errors; hidden when no project is selected),
      with global default + per-project embedding override. **This is the precedent for §5.I-3** (move the
      remaining per-project overrides off Global Settings).
- [x] **Reliability/robustness/UX details** *(follow-up-1)*: graceful single-oversized-prompt degrade;
      `route_up`/router reason-string accuracy; plain-language park reasons; decomposition DAG **dry-run
      preview**; **test-first decomposition** default for suitable cards; prompt-prefix caching + multi-endpoint
      parallelism nudges + aggressive tool-schema trimming for weak models; app icon/logo; endpoint reachability
      + model discovery.

### 5.U — `src/commands/task.ts` CLI decomposition ✅ COMPLETE (2026-06-27) *(a finished cohesive sub-tree of the still-open §5.U architecture review — moved early per the "move finished sub-trees early" rule)*

task.ts went from a ~2870-line monolith to ~568 lines (**−80%**): all command + helper logic extracted into 17 per-concern modules under `src/commands/task/`, and `registerTaskCommand` split into a thin dispatcher + 7 register helpers. Each slice below was tsc + biome + `test:fast` (2443) green. *(The historical `task-command-exit` follow-up is now resolved and archived as P0.5 above.)*

  - **`src/commands/task.ts` (~2870 → 2751)** *(umbrella — slices below are the counted work; 5 done, the remaining
        slice is the open child)* — the `nklein task` CLI conflates many concerns: acceptance-failure +
        plan-gap classification/evidence, decomposition routing + rejection recording, NKlein-settings build/format
        helpers, task-command target/workspace resolution, the tRPC client factory, and ~a dozen subcommand
        registrations. Split into `commands/task/` (e.g. `task-acceptance-plan-gap.ts`, `task-nklein-settings.ts`,
        `task-target-resolution.ts`, per-subcommand registration files) with `task.ts` as the thin registrar.
        - [x] **slice 1 (2026-06-24):** extracted the 5 pure NKlein-settings helpers + `ParsedTaskNKleinReasoningEffort`
              into `commands/task/task-nklein-settings.ts` (no I/O; covered by `task-verify.test.ts`).
        - [x] **slice 2 (2026-06-24):** extracted the pure acceptance-failure → plan-gap classification (parse / should-record /
              build-evidence / classifiers / classify) into `commands/task/task-acceptance-plan-gap.ts`. task.ts 2870→2633.
        - [x] **slice 3 (2026-06-24):** extracted the 6 pure plan-gap/merge card prompt + revision builders into
              `commands/task/task-plan-gap-prompts.ts` (the `add*CardToBoard` mutators stay in task.ts and import them).
              task.ts 2633→2509.
        - [x] **slice 4 (2026-06-24):** extracted the runtime-workspace + tRPC-client infrastructure (createRuntimeTrpcClient,
              resolve/ensure workspace, notify, load-mutate-notify `updateRuntimeWorkspaceState`, resolveTaskBaseRef +
              `RuntimeWorkspaceMutationResult`) into `commands/task/task-runtime-workspace.ts`. task.ts 2509→2433
              (cumulative 2870→2433, −437). All ~60 call sites resolve via import (tsc-verified, no call-site changes).
        - [x] **slice 5 (2026-06-24):** extracted the shared command types (`LIST_TASK_COLUMNS`/`ListTaskColumn`/
              `TaskCommandTarget`/`ResolvedTaskCommandTarget` → `commands/task/task-command-types.ts`) and the pure
              board-record query/format + target/column resolution (`findTaskRecord`, `findTasksInColumn`,
              `formatTaskRecord`, `formatDependencyRecord`, `getLinkFailureMessage`, `resolveTaskCommandTarget`,
              `parseListColumn` → `commands/task/task-record-format.ts`). task.ts 2433→2294 (cumulative 2870→2294, −576/−20%).
        - [x] **slice 6 (2026-06-27):** extracted the plan-gap → card concern (`markTaskNeedsDecompositionOnBoard`,
              `findBoardTaskByTitle`, `addPlanGap{Integration,Decision,Scope}CardToBoard` + the `DEFAULT_NEEDS_DECOMPOSITION_REASON`
              const) → `commands/task/task-plan-gap-cards.ts` (a clean one-way move — the module imports the already-separate
              `task-plan-gap-prompts` + board mutations, never task.ts, so no cycle). `recordDecompositionRejection` stayed
              (its `toErrorMessage` dep would entangle). Two consumers (`record-plan-gap.ts`, `task-verify.test.ts`) repointed;
              tsc + biome + task-verify (8 of the moved fns' tests) + contract + `test:fast` (2443) green. task.ts 2326→2150
              (cumulative 2870→2150, −720/−25%).
        - [x] **slice 7 (2026-06-27):** extracted `buildDecompositionRoutingCandidates` (builds the runnable model routing
              candidates from the default provider + per-role config) → `commands/task/task-decomposition-routing.ts`. Pure
              of task.ts internals (only provider service + model registry + start-guard), internal-only consumer repointed
              via import. task.ts 2150→2093 (cumulative 2870→2093, −777/−27%). tsc + biome + `test:fast` (2443) green.
        - [x] **slice 8 (2026-06-27):** extracted the pure CLI arg parsers (`slugifyPlanTaskId`, `parseAutoMergeColumn`,
              `parseAutoReviewMode`, `parseAgentId` + `VALID_AGENT_IDS`, `parseOptionalStringOrDefault`) →
              `commands/task/task-command-parsers.ts`. All internal-only, no task.ts-internal deps; imported back.
              task.ts 2093→2045 (cumulative 2870→2045, −825/−29%). tsc + biome + `test:fast` (2443) green.
        - [x] **slice 9 (2026-06-27):** extracted the two read-only leaf commands (`listTasks`, `reportBoardHealth`) →
              `commands/task/task-read-commands.ts` (resolve workspace → query state → project a JSON record; no mutation,
              no dependency on the other command impls). task.ts 2045→1996 (**under 2000**; cumulative 2870→1996,
              −874/−30%). tsc + biome + `test:fast` green.
        - [x] **slice 10 (2026-06-27):** extracted the dependency commands (`linkTasks`, `unlinkTasks`) →
              `commands/task/task-dependency-commands.ts` (leaf mutate-commands over the shared `updateRuntimeWorkspaceState`
              helper + board mutations; no other-command deps). task.ts 1996→1931 (cumulative 2870→1931, −939/−33%).
              tsc + biome + `test:fast` (2443) green.
        - [x] **slice 11 (2026-06-27):** extracted the shared CLI output utils (`toErrorMessage`, `printJson`) →
              `task-command-output.ts` and the runtime-action helpers (`stopTaskRuntimeSession`, `deleteTaskWorkspace`) →
              `task-runtime-actions.ts` (its first consumer — `deleteTaskWorkspace` uses `toErrorMessage`). The shared
              output module breaks the recurring `toErrorMessage` entanglement that was blocking further extraction (a
              submodule needing it no longer has to import task.ts → no cycle). task.ts 1931→1889 (cumulative 2870→1889,
              −981/−34%). tsc + biome + `test:fast` (2443) green.
        - [x] **slice 12 (2026-06-27):** extracted the swarm-stop control commands (`requestTaskSwarmStopCommand`,
              `clearTaskSwarmStopCommand`) → `commands/task/task-swarm-commands.ts` (leaf commands over the swarm
              guardrails). task.ts 1889→1863 (cumulative 2870→1863, **−1007/−35%**, over 1000 lines out). tsc + biome +
              `test:fast` (2443) green.
        - [x] **slice 13 (2026-06-27):** extracted the "expand a saved plan task" command (`expandSavedPlanTaskCommand` +
              its `parseReplacementTasksJson` helper) → `commands/task/task-plan-expand-command.ts` (self-contained leaf —
              the central `decomposeTaskGraph` does not use the helper). task.ts 1863→1819 (cumulative 2870→1819,
              −1051/−37%). tsc + biome + `test:fast` (2443) green.
        - [x] **slice 14 (2026-06-27):** extracted the decompose cluster — `decomposeTaskGraph` (the ~95-line central
              command: apply a plan's task-graph onto the board via the routing candidates) + `recordDecompositionRejection`
              + its `DecompositionRejectionInput`/`RecordSelfObservation` types → `commands/task/task-decompose-command.ts`.
              Enabled by the slice-11 `toErrorMessage` unblock (the rejection telemetry needs it). `task-verify.test.ts`
              repointed. task.ts 1819→1678 (cumulative 2870→1678, **−1192/−42%**). tsc + biome + task-verify + contract +
              `test:fast` green.
        - [x] **slice 15 (2026-06-27):** extracted the create/update commands (`createTask`, `updateTaskCommand`) →
              `commands/task/task-crud-commands.ts` (leaf mutate-commands over `updateRuntimeWorkspaceState` + board
              mutations). task.ts 1678→1534 (cumulative 2870→1534, **−1336/−47%**, nearly halved). tsc + biome +
              `test:fast` (2443) green.
        - [x] **slice 16 (2026-06-27):** extracted the `startTask` lifecycle command (validate source column, file-overlap
              guard, start the native sandbox session handling queued/needs-decomposition, move to the active lane) →
              `commands/task/task-start-command.ts` (leaf; uses the already-extracted `markTaskNeedsDecompositionOnBoard`).
              task.ts 1534→1410 (cumulative 2870→1410, **−1460/−51%**, over half the original extracted). tsc + biome +
              `test:fast` (2443) green.
        - [x] **slice 17 (2026-06-27):** extracted `runVerifyTaskAcceptanceCommand` + its DI interfaces
              (`VerifyTaskAcceptanceDependencies` / `RuntimeTaskAcceptanceVerifyMutationClient`) →
              `commands/task/task-verify-command.ts` (self-contained, collaborators injectable for testing; not entangled
              with finishTask). `task-verify.test.ts` repointed. task.ts 1410→1299 (cumulative 2870→1299, **−1571/−55%**).
              tsc + biome + task-verify + contract + `test:fast` green.
        - [x] **slice 18 (2026-06-27):** extracted the plan-slug inference helpers (`inferNKleinPlanSlugForTask` +
              `matchesPlanBoardTaskId`) → `commands/task/task-plan-slug.ts` (a shared helper — 3 external consumers
              repointed: `expand-plan-task.ts`, `record-plan-gap.ts`, `task-verify.test.ts`). task.ts 1299→1244
              (cumulative 2870→1244, **−1626/−57%**). tsc + biome + `test:fast` (2443) green. *(Remaining: the `finishTask`
              cluster [`finishTask`/`finishTaskById` + `autoMergeFinishedTaskWorktree`/`recordTaskWorktreeMergeObservations`/
              `createIntegrationCardForMergeConflict`/`mergeTaskWorktreesCommand`] — cohesive but the biggest, most
              cross-calling block — plus `recordTaskPlanGapCommand` and the `registerTaskCommand` subcommand split.)*
        - [x] **slice 19 (2026-06-27):** extracted `deleteTaskCommand` (delete a task by id or a whole column, then stop
              live sessions + delete worktrees) → `commands/task/task-delete-command.ts`; relocated the shared
              `columnCanHaveLiveTaskSession` board-column predicate → `task-command-types.ts` (used by both delete + the
              finish cluster, so it had to leave task.ts to avoid a cycle). task.ts 1244→1139 (cumulative 2870→1139,
              **−1731/−60%**). tsc + biome + `test:fast` (2443) green. *(Remaining: the `finishTask` cluster [finish +
              auto-merge + integration-card + merge-command, the most cross-calling block], `recordTaskPlanGapCommand`,
              and the `registerTaskCommand` subcommand-registration scaffolding.)*
        - [x] **slice 20 (2026-06-27):** extracted the whole finishTask/worktree-merge cluster (the ~385-line contiguous,
              self-contained block: `finishTask` + `mergeTaskWorktreesCommand` + private helpers `finishTaskById`,
              `autoMergeFinishedTaskWorktree`, `recordTaskWorktreeMergeObservations`, `createIntegrationCardForMergeConflict`
              + the `Finish*` types) → `commands/task/task-finish-commands.ts`. Cohesive (cross-calls stayed intra-module),
              so a clean one-way move. task.ts 1139→731 (cumulative 2870→731, **−2139/−75%**, three-quarters extracted).
              tsc + biome + `test:fast` (2443) green.
        - [x] **slice 21 (2026-06-27):** extracted `recordTaskPlanGapCommand` → `commands/task/task-record-plan-gap-command.ts`
              (record a plan-gap observation + cross-linking revision + companion Planning card for the card-creating
              kinds; leaf command). task.ts 731→547 (cumulative 2870→547, **−2323/−81%**). **task.ts is no longer a
              monolith** — what remains is essentially the `registerTaskCommand` Commander subcommand wiring (+ the small
              `runTaskCommand`/`parseOptionalBooleanOption` helpers) over the now-21 extracted per-concern modules. tsc +
              biome + `test:fast` (2443) green. The §5.U "no large monolith" goal is **met for task.ts** (2870→547).
        - [x] **slice 22 (2026-06-27):** split the 482-line `registerTaskCommand` into a thin dispatcher + 7 per-concern
              register helpers (`registerTask{Read,Crud,MergeAndSwarm,Plan,Finish,Graph,Start}…Commands`) — the large
              function is gone; each helper holds a navigable group of subcommand definitions. tsc + biome + `test:fast`
              (2443) green. ⚠️ **Pre-existing, UNRELATED test failure noticed (NOT from this change — confirmed by stashing):**
              `test/integration/task-command-exit.integration.test.ts` was fully broken (0/4). **PARTIALLY FIXED →
              3/4 (2026-06-27):** two real, pre-existing regressions diagnosed + fixed. **(1)** the spawned CLI couldn't
              resolve the vendored-SDK `@nklein/*` aliases (`ERR_MODULE_NOT_FOUND` `@nklein/core`) because the spawn runs
              with cwd = a temp repo and tsx does cwd-relative tsconfig discovery → fixed by passing `TSX_TSCONFIG_PATH`
              (this repo's tsconfig, which has the `@nklein/*` paths) in the spawn env. **(2)** the runtime **server** was
              spawned with `cwd = projectPath`, and the self-improvement guard ([projects-api.ts](src/trpc/projects-api.ts)
              ~L434) keys "!Klein's own source repo" off `resolveGitRootIfAvailable(deps.serverCwd)` — so the server's git
              root == the project being added → false self-improvement block → fixed by running the server from the neutral
              temp HOME (non-git → no source repo → guard skipped). NOT in the green gate. **Resolved afterward:** the
              launch-only case registers the fixture through a write command before read-only `task list` (`36b91973`),
              while the source-workspace filter now uses the same install-location identity as the guard (`4967aa8e`).
              The integration is 4/4 green without making reads or bare launches auto-register projects; see P0.5 above.
        - [x] the (then-pending) per-subcommand registration split + lifting **all** command implementations
              (createTask/updateTaskCommand/startTask/finishTask/decomposeTaskGraph + the merge / dependency / read /
              delete / verify / plan-gap commands) into per-concern modules — **all done** (slices 14–22 above).

### 5.U — `src/config/runtime-config.ts` decomposition ✅ COMPLETE (2026-06-27) *(another finished cohesive sub-tree of the still-open §5.U architecture review — moved early per the "move finished sub-trees early" rule)*

The careful **2-module split** that the SCOUTED note flagged: the `normalize*` value-transformers couldn't move on their own
because they share the `DEFAULT_*` seed consts with `loadRuntimeConfig` (→ an import cycle). Solved by extracting the consts
to their own module first, then the normalizers depend on *that*, not on the loader. `runtime-config.ts`: **2103 → 1787 (−316, −15%)**.

- [x] **`runtime-config-defaults.ts`** ← the ~19 `DEFAULT_*` seed consts (+ `AUTO_SELECT_AGENT_PRIORITY`) lifted out of
      runtime-config.ts (80–105) and imported back. No external consumers, so no re-exports needed. Breaks the cycle: both
      the loader and the normalizers now depend on this leaf module.
- [x] **`runtime-config-normalizers.ts`** ← the **26 pure `normalize*` / `are*Equal` value-transformers** (the cohesive
      "config-field normalization" concern: agent-id / timeouts / shortcuts / model-roles / rulesets / embedding / int+bool
      coercers), imported back into runtime-config.ts. Depends only on `./runtime-config-defaults` + shared schemas/policies
      (`api-contract`, `agent-catalog`, `agent-rulesets`, `nklein-local-only-policy`, `debug-override`) — never on the loader.
  - The one local coupling — `normalizeDeveloperModeEnabled` used the stays-in-runtime-config `hasOwnKey` helper — was
        resolved by inlining its single moved call site (`globalConfig != null && Object.hasOwn(...)`) rather than creating a
        cycle; `hasOwnKey` stays as the change-detection helper. `readLegacyDeveloperModeEnabled` moved with the normalizers
        and is re-imported by the loader (its other caller).
  - Interspersed stay-functions (`getRuntimeHomePath`, `pickBestInstalledAgentId`, `pickBestInstalledAgentIdFromDetected`,
        the field-equality change-detection registry) correctly left in `runtime-config.ts`. Verified green: tsc + biome +
        config/utilities vitest (65 tests).


### 5.AM + 5.BD — moved from todo.md 2026-07-05 (belated migrations: fully-shipped sections that never got moved in their delivering commits)

### 5.AM — Surfaced test-failure debts (all discharged) ✅ COMPLETE — moved from todo.md 2026-07-05
> Concrete failures that have SURFACED. Top-of-queue by the §4A no-waive rule. (Currently: all discharged.)
- [x] **agent-sandbox Docker integration: flaky 137 under the full parallel suite — ROOT-CAUSED & FIXED (2026-06-29).**
      Symptom: `test/integration/agent-sandbox.integration.test.ts` execs (`mkdir`/`readFile`/`editor`…) intermittently
      returned `exitCode: 137`; passed in isolation, failed under the full `vitest run`. **Root cause (measured, not
      guessed):** `docker events` showed `kill signal=9 → die 137`, `oomKilled` UNSET → NOT a kernel OOM (the tempting
      7.7 GiB-VM/2 GiB-container theory was wrong). It was **cross-process orphan-reaping**: `runtime-server` startup calls
      `AgentSandboxManager.reapOrphanResources()`, which `docker rm -f`s EVERY container carrying the sandbox label, and
      container names are a FIXED global slot (`nklein-agent-sandbox-1`). Under the full suite, OTHER suites boot a server
      in a parallel worker — spawned backends (`startTsBackend`, used by all contract suites) AND in-process boots
      (`createRuntimeServer`, e.g. `ws-upgrade-passcode`) — and their startup reap destroyed the agent-sandbox test's LIVE
      container mid-exec → 137. (Confirmed by debug-logging the `rm -f` sites + bisecting: it tracked exactly with
      backend-spawning suites.) **Fix:** gate the startup reap — skip when `NKLEIN_SANDBOX_SKIP_STARTUP_REAP=1` (set by the
      test backend factory for spawned backends) OR `process.env.VITEST === "true"` (covers in-process boots, since
      hand-built spawn envs don't inherit VITEST). Production single-instance startup still reaps. Full suite now
      **3101/3101 green ×2 consecutive**. NOTE the latent PRODUCT fragility this exposed (separate, lower-priority):
      label-based reaping + fixed global container/volume names mean **two real !Klein instances on one host would reap
      each other's sandbox containers** — if multi-instance-per-host is ever supported, scope reaping/naming per instance.

### 5.BD — Schema-tolerance sweep across ALL SDK tool boundaries ✅ COMPLETE — moved from todo.md 2026-07-05
> **Five separate live board-freezes were caused by the same disease:** a STRICT pre-execution schema rejecting a
> semantically-obvious tool call (feedback:null #15 · tool-name echo #27 · focus-chain `name`→`text` · my
> `preferred` enum #32 · run_commands bare-string #34). The AI-SDK validates args against each tool's inputSchema
> BEFORE execute, so any strictness there turns a recoverable near-miss into 3-strikes-abandoned. LAW (§4A-worthy):
> the SDK boundary schema is for GUIDANCE, never enforcement — validate loosely at the boundary, normalize
> tolerantly in execute (aliases/synonyms/shape-coercion), and return corrective `ok:false` instructions for what
> can't be coerced.
> - [x] **SWEPT 2026-07-03:** vendored SDK boundaries loosened — run_commands (#34), editor/edit_file (#38),
>       read_files (#40), **search_codebase / apply_patch (patch|diff aliases) / fetch_web_content (lone
>       {url,prompt})** this pass — each boundary now string-or-array/alias-tolerant with the execute-side union/
>       normalizer as the real parser (SDK dist rebuilt). !Klein verdict tools (submit_review / submit_plan_critique
>       / submit_merge_resolution) dropped `required:[...]` and switched execute to safeParse → actionable ok:false
>       instead of a raw Zod pre-rejection loop. REMAINING boundaries left strict on purpose (not in the sandbox
>       worker toolset / negligible variance): skills, ask_question, submit_and_exit, browse (url unambiguous).
> - [x] **SHIPPED 2026-07-03:** pre-execution rejection counter — the event adapter's tool-finished handler
>       detects the SDK's schema-rejection signature (isPreExecutionToolRejection: "rejected before execution" /
>       "type validation failed", NOT in-execute failures) and records a `tool_input_rejection` self-observation
>       tagged toolName+modelId+providerId. After the sweep these should be rare; the counter makes a resurgence
>       visible per-tool-per-model on telemetry instead of only in an autopsy.
> - [x] **run42 evidence — tool-NAME aliasing — DONE (2026-07-03, commit ~a…):** models called unavailable names
>       (`read_file` for `read_files`) and looped on the "unavailable tool" pre-rejection. Wired at the AI-SDK's
>       `experimental_repairToolCall` hook on the provider's `streamText` call (`ai-sdk.ts`): on `NoSuchToolError`,
>       `resolveToolNameAlias(requested, offeredNames)` (new PURE core, `llms/providers/tool-name-alias.ts`, 5 tests)
>       redirects to a REAL offered tool (keeping args) — exact-normalized (readFiles→read_files) → curated synonym
>       (grep→search_codebase, bash→run_commands, ls→list_files, browse_url→fetch_web_content) → singular↔plural. It
>       only ever returns a name in the offered set (can't invent/mis-route). Only NoSuchToolError is repaired; arg
>       errors fall through to the per-tool execute normalizers (layers compose — a repaired call is re-validated).
>       Logs each alias. SDK rebuilt; vendored llms green (339); repo green (6585). Live-confirm at sweep time.
> - [x] **run38 evidence — `read_files` double-encoded array — DONE:** the EVIDENCED whole-`files`-string shape
>       (`{"files": "[{\"path\": ..."}`) is decoded in `read_files`' execute() (fix #40, vendored `definitions.ts`).
>       **Extended 2026-07-03:** the PER-ELEMENT sibling (`{"files": ["{\"path\":\"a.ts\"}"]}` — an array whose
>       element is a stringified object) was silently mis-read as a bogus path literally named `{"path":...}`; now
>       `normalizeReadFilesEntry` decodes a string element that parses to an object carrying `path`, while a plain
>       path (incl. one that merely starts with `{`) stays literal. Vendored suite green (52); also fixed a stale
>       vendored schema test that still asserted the pre-#40 strict shape (unnoticed because `test:fast` excludes
>       `vendor/**` — worth a periodic `cd vendor/cline-sdk/packages/core && vitest run` in the release gate).
> - [x] **run36/38 evidence — interrupted-salvage universal net — DONE (verified 2026-07-03):** the #29
>       board-liveness watchdog rescues an `interrupted` card that still has a prior result branch —
>       `rescueInterruptedTaskWithPriorWork` rebinds it into review (salvage → judge). Deliberately scoped to the
>       **IN_PROGRESS lane only** (NOT all non-terminal lanes as originally phrased): a review-lane card is already
>       being judged and a HELD card there has an interrupted session by design (#33), so re-rescuing would loop
>       hold→stop→rebind→re-review forever. Tested (rebound → awaiting_review, task-session-service.test.ts
>       2557/4108/4178). Any residual lane-coverage gap (e.g. a docker-409 abandon landing outside in_progress) is a
>       sweep-time finding — the documented run36/38 case is covered.
> - [x] **run37 evidence — `edit_file` insert-shape — DONE (verified 2026-07-03):** `{path, insert_line, new_text}`
>       is fully handled end-to-end — the edit_file boundary schema requires only `path` (insert_line: number|string|
>       null, new_text: string|null, edits optional), and `parseEditFileRequest` normalizes the shape to an insert
>       (both numeric and numeric-string insert_line; tested lines 24/33/74). Fixed across #38 + #42. The submit_review
>       `"name": null` sibling was fixed as #37. Nothing left here.
