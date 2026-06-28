# Autonomous decisions log (for end-of-run review with the user)

## NORTH STAR (2026-06-25, user) — the lens for every decision
**Make small local LLMs succeed on large, complex tasks and deliver real products.** Local LLMs only (Docker
isolation strict; host-mode only with explicit user opt-in). Models: qwen3-8b → 120B, but **build the rails to work
with SMALL models first** (bigger/more-capable or more-context models then just go faster / take bigger steps). The
core mechanism is **decompose everything into really small pieces** so even a ~16GB-RAM model can work through the
biggest, most complex scenarios. **Never give up on complexity — pay the bill with iterations + waiting time instead.**
All todo.md items are "set"; if a contradiction surfaces, prepare so only LOW-EFFORT finalization is needed when the
user is next available (don't block).

## Additional confirmed guidance (rounds 3–4, 2026-06-25)
- **Config:** most settings global (one place); a small set genuinely project-specific — AND **allow a per-project
  override for *almost every* global setting** (global defaults + per-project override layer; clear inherits/overridden
  indicator). Project settings get their own menu.
- **Project-settings entry point:** add a **visible gear on the active project** (and/or board header) for one-click
  access, keep it in the per-project `⋯` menu too. (The dialog already exists; it was just undiscoverable.)
- **Expose-all-features audit:** no specific hidden-feature list from the user → audit systematically (CLI/config vs UI)
  and surface everything; ensure every setting is UI-exposed + properly grouped (regroup scattered settings).
- **Smoothness** is a first-class quality the UI/feature e2e tests must cover (no specific perf pain point named).
- **Test coverage goal:** *complete* coverage of all workflows (decompose→merge pipeline, all chat functions, board/
  card lifecycle + lanes, settings/config + isolation) — no priority ranking; completeness is the point ("to control
  the whole complexity").
- **§5.J look & feel:** refined, modern, professional **dark** (Linear/Raycast-grade restraint), distinct from
  Cline-Kanban, not flashy. I mock up directions; user picks. (No hard "freeze restyling" guardrail given — but I'll
  still get a pick before landing a full restyle.)
- **Live model sweeps (2026-06-25, user):** the live verification harnesses (decompose / promote / Suite 10) should
  **sweep across all loaded LM Studio models**, now including **`microsoft/phi-4-mini-reasoning`** and
  **`deepseek-r1-0528-qwen3-8b-mlx`** (newly loaded) alongside the north-star **qwen3-8b**. **deepseek may crash/unload
  mid-sweep** — if it vanishes from `/v1/models`, take a note that it was dropped (we *want* it covered) and continue with
  the rest; do **not** block the sweep on it. Crash-resilience for the local provider is a deferred follow-up, not part of
  the current sweep work.


Standing directive (2026-06-25): during the long autonomous run, **work every todo.md item**; escalate to the user
only for a genuine missing-decision blocker (high bar — NOT a minor choice that's cheap to rework later). For every
decision I make below that bar, record it here so the user and I can review them together once the autonomous run is
done. (There is a todo item for that review.)

Format: one row per decision — what was ambiguous, what I chose, and why / how easily it can be reworked.

## Confirmed with the user up front (2026-06-25) — not autonomous, recorded for context
- **Architecture pass scope:** systems-analysis + safe behavior-preserving simplifications NOW (state/data/activity
  flows, ownership, separation-of-concerns); the big file-decomposition (§5.U) + the 862-line SDK-boundary inlining
  (§5.R) stay deferred.
- **§5.B planning/refinement lane:** build now, full design. Promotion Planning→In-Progress = **explicit tool the
  agent calls** (user said "choose the robust one"; explicit is most robust vs weak models). Skip-guard = **always
  refine, no skip** (correctness over speed). 
- **Defaults:** flip BOTH now — native NKlein agent core = default runtime; core-py = on by default. **Hard flip, no
  fallback** (surface a clear error if unavailable rather than silently falling back).
- **Testing:** two layers — fast deterministic CI-gate-able layer + real live-model/Docker punch-through e2e
  harnesses. No CI infra yet (local prototyping, pre-first-merge), so I run the full suite incl. the slow e2e
  periodically myself and keep it green. Run order: quick wins → §5.B → comprehensive tests → systems-analysis.
- **Look & feel (§5.J):** I propose 2–3 restyle directions as screenshots; the user picks.
- **Ship mode:** local commits only — no `git push`, no PRs.
- **Runtime restart:** OK to restart the runtime (+ rebuild) to live-verify backend fixes end-to-end.

## Working mode (2026-06-25, user) — heavy parallel subagents
- **Use subagents heavily**, with **fast coding models / lower reasoning** where the task suits it (mechanical, well-
  scoped UI/refactor/test work). Keep core/risky/cross-cutting work (default flips, §5.B core flow, security) careful
  (me or a higher-reasoning agent).
- **Coordinate to avoid collisions:** partition into **disjoint file sets**; parallelize independent chunks (prefer
  `isolation: "worktree"` + background for parallel *coding* agents so they never fight the working tree/index; merge
  their branches when done), sequence dependent ones. Read-only audits (Explore) can run alongside anything. Goal:
  maximize output/throughput, minimize rework from collisions.

## Prepared, high-bar decisions DEFERRED to the user (not autonomous — staged so finalization is low-effort)
- **(2026-06-25) ⭐ THE BIG ARC — deep whole-codebase refactor + possible backend→Python port (todo §5.X).** The user
  set the direction: refactor the whole codebase for clear structure/testability/maintainability/efficiency/correctness,
  **possibly porting the entire server/backend to Python**, with **full deep test coverage (§5.V, incl. e2e + UI) as the
  hard precondition / safety net**. I prepared (no code yet, per the gate): (1) reframed §5.V as the **port-resilient
  regression oracle** — tests must assert behavior through STABLE SEAMS (tRPC/HTTP contract, CLI, web-ui, on-disk
  formats, Docker boundaries), NOT TS internals, so the same suite validates a TS or a Python backend identically;
  (2) wrote §5.X with Phase 0 (land §5.V) → Phase 1 (TS-internal deep refactor = execute §5.U findings end-to-end,
  behavior-preserving) → Phase 2 (the Python port, **high-bar DECISION REQUIRED**). **Open questions staged for the user
  (Phase 2):** port scope (whole server vs some layers), the web-ui/CLI boundary, stack (FastAPI/Pydantic + how the
  `@nkleinbot/*` TS agent SDK is replaced/bridged — the long pole), migration shape (strangler-fig vs big-bang), what
  stays TS (web-ui; shared contract generated from one source), and sequencing vs the north star. **My prepared
  recommendation:** strangler-fig behind the §5.V contract oracle; web-ui stays TS; contract schemas from one source;
  port the agent-runtime last or keep it as a bridged service. **Nothing starts until §5.V is real + green.** Low-effort
  for the user to finalize: pick the Phase-2 scope/shape from the staged options (or say "Phase 1 only for now").

## Clarification pass (2026-06-25, user answers — these are DECISIONS, not autonomous)
- **§5.X deep refactor / Python port = "plan now, build after §5.V".** Design the port (strangler-fig behind the
  contract oracle, web-ui stays TS, shared schemas) AND do the TS-internal deep refactor (Phase 1) now; do not START the
  actual Python port until the §5.V port-resilient test net is green. → §5.V is the gating linchpin.
- **Defaults = "build the prereqs now, then flip"** (see the resolved contradiction above). Active workstream.
- **Autonomous chat agent (§5.M) = "promote to active now".** Build the real autonomous chat agent (focus chain, memory,
  tools, knowledge fetch, browser) soon, in parallel with the test/refactor work — no longer a "later" follow-up.
- **Look & feel (§5.J) = "defer indefinitely".** Current look is fine; do NOT produce restyle mockups now. §5.J parked.

## Clarification pass 2 (2026-06-25, "clarify all the constraints" — DECISIONS)
- **Model-dependent §5.V suites (Suite 4 pipeline, Suite 5 chat send/stream) = deterministic MOCK-LLM fast-gate** (wired
  via a **custom local provider** pointing at the mock, sidestepping the lmstudio live-only quirk). Live Suite 10 stays
  real LM Studio.
- **Honor a configured LM Studio endpoint = YES, complete the fix.** A `baseUrl` set for the built-in `lmstudio`
  provider must flow to the chat (and the agent), so running LM Studio on a non-default port works. lmstudio is
  `isLiveOnlyProviderId`, so its saved baseUrl isn't returned like a custom provider's — that gap is the work to close.
- **Autonomous chat agent (§5.M) = FULL Cline-style from the first build** (browser, knowledge fetch, autonomous
  project/card creation + work) — NOT an incremental foundation. **But sequenced AFTER §5.V** (see next).
- **Sequencing = FINISH §5.V FIRST.** Complete the remaining test suites (the port-resilient oracle) before starting
  the chat agent or the §5.X refactor. The safety net is the linchpin. (Supersedes "interleave".)
  - **✅ MILESTONE (2026-06-25): §5.V is COMPLETE.** All suites green: Suite 1 (HTTP tRPC CRUD, 16), 2 (plan-artifact
    pipeline, 12), 3 (CLI→WS board events, 2), 4 (rescoped — covered by lane/promotion units + live Suite 10), 5 (chat
    HTTP + streaming incl. the SSE `streamMessage` subscription, 14), 6 (on-disk format parity, 10), 7/8/9 (Playwright:
    plan-review / settings / review+recovery, 5+6+11), 10 (LIVE: decompose isolation + the Increment-C auto-promote
    sweep across qwen3-8b/phi/deepseek), 11 (core-py contract parity, 25), 12 (CLI task subcommands, 14), 13 (smoothness/
    perf, 4). The full TS contract suite runs 77/77 together; the fast gate is 1516 green. **This unblocks §5.M (chat
    agent) and §5.X Phase 1 (TS-internal refactor) — both can now start, with the regression oracle as the safety net.**

## Clarification pass 3 (2026-06-25, "any open questions?" — DECISIONS)
- **Next priority = FINISH §5.M chat agent first** (G3a→G3b→G4→G5→G6) before the §5.X refactor/port. The right-sidebar
  agent becomes fully "Cline but stronger" before other big work.
- **G3b unsafe-command classification = ALLOWLIST safe commands** (most conservative). Only a known-safe set
  (ls/cat/build/test/git status/…) flows as "safe"; **everything else is treated as potentially-unsafe** → the explicit
  risk callout + dedicated acknowledgement (per-command, or the general "I accept the risk" ack that needs extra-extra
  confirmation). Accept the friction for safety; the user is informed + owns the risk.
- **G6 browser/internet = HEADLESS BROWSER (Playwright).** The agent drives a real browser (navigate, read rendered
  pages, click) — not just text fetch. It's the toggleable capability (off by default, user enables). Reuse the
  repo's existing Playwright (the working env already drives it).
- **§5.X Python port = STRANGLER-FIG (the prepared recommendation).** Incrementally move backend layers to Python
  (FastAPI/Pydantic) behind the §5.V contract oracle; **web-ui stays TS**; shared contract from one source; the
  `@nkleinbot` agent SDK is **bridged/ported last**. Sequenced AFTER §5.M (per the priority above).

## Autonomous decisions (below the escalation bar)
- **(2026-06-25) §5.B promotion mechanism = explicit agent tool** (user said "choose the robust one"). Rationale:
  explicit > inferring from turn-end, robust against weak local models (parse-and-recover principle). Low rework.
- **(2026-06-25) ✅ RESOLVED — defaults contradiction → "build the prereqs now, then flip".** I flagged that hard-flipping
  native-agent-core=default + core-py=on **now** would BREAK the runtime: (a) the native core `src/agent-core/` is not
  imported by any runtime/session code yet (the native-core→task-execution integration is unbuilt); (b) core-py
  default-on needs the sidecar bundled + auto-started first. **Clarification-pass answer (user):** *build the prereqs
  now, then flip.* So this becomes an **active high-priority workstream** (no longer deferred): (1) wire `src/agent-core/`
  into the runtime/session execution path so a task can actually run on the native core; (2) bundle core-py + auto-start
  it on runtime launch; (3) THEN hard-flip both defaults (no silent fallback; clear error if genuinely unavailable). Note
  the coupling with §5.X: the user also chose "plan the Python port now, build after §5.V".
  - **⚠️ SCOPE FLAG (2026-06-25, investigated — needs a quick user yes/no) — the two prereqs are VERY different sizes,
    and one couples hard with the port.** Verified: `src/agent-core/` is **2 files / 285 lines** (a `runAgentLoop` +
    `DecideAction` skeleton with clean types) and is **genuinely unintegrated** — *nothing* in the runtime/session code
    imports it (the only "agent-core" hits in src are comments). So **"native core = default runtime" is not a small
    integration — it means building a FULL native agent runtime** on that skeleton to replace the `@nkleinbot` SDK host
    (tool dispatch, streaming, hooks, context compaction, session persistence — all of `sdk-runtime-boundary` +
    `nklein-task-session-service`). One of the largest builds in the project. **AND building a full *TS* native runtime
    now, right before a possible *Python* backend port (§5.X), is likely throwaway** (re-done in Python). **The core-py
    half is the opposite: tractable + port-aligned** (bundle the existing Python sidecar + auto-start it — core-py is
    already Python, so not wasted by the port). **Prepared recommendation (low-effort to finalize):** split the flip —
    (i) do the **core-py** prereq now + flip core-py-on; (ii) **hold the native-core-default flip** until the §5.X port
    direction is settled (build the native runtime in whichever language wins, likely Python). I did NOT start the full
    TS native-runtime build (that would be running blindly into a huge, possibly-throwaway effort). **→ batched into the
    next clarification round; until then I proceed on core-py + everything else and leave native-core-default unstarted.**
    - **UPDATE (2026-06-25): core-py half DONE.** core-py was already default-ON (stale doc fixed); built the missing
      **auto-start** (`src/server/klein-core-sidecar.ts`, wired in `cli.ts`), verified unit + live + integration. The
      "bundle a Python env for packaged installs" sub-task remains (dev works; packaged no-ops gracefully).
      **native-core-default still HELD pending the §5.X port decision** — unchanged.
- **(2026-06-25) Orchestration of the first parallel batch:** chat-polish (web-ui) delegated to a worktree subagent;
  feature/UI exposure audit delegated to a read-only Explore subagent; the risky **defaults hard-flip** kept by me
  (needs runtime verify). Disjoint file sets, so no collisions.
- **(2026-06-25) Chat session label — token count deferred (real backend dependency, not a cheap UI add).** The user
  asked the session label to show "messages + tokens + last-message timestamp." Delivered started-timestamp + message
  count + last-activity; **omitted tokens** because the §5.M chat schemas carry no usage field — surfacing it needs the
  chat send loop to capture per-turn LLM usage, persist a running total on the session, and expose it in the schema.
  That's a separable feature, logged as a follow-up under the chat-polish item. Low rework; not blocking. Verified the
  subagent's web-ui work myself before commit (typecheck + biome + full 694-test web suite all green).
- **(2026-06-26) Naming cleanup — fork origin + fabricated author corrected; one deferred sub-decision.** User reported
  agents *repeatedly* surface confabulated attributions ("authored by NKlein Bot Inc.", "Forked from NKlein Kanban") and
  asked to clean it up: "NKlein Kanban → Cline Kanban" (the real upstream) and "NKlein → !Klein where user-facing,
  non-code". **Investigated + confirmed the truth:** the repo root commit (`6954ff79`) is **Saoud Rizwan's** `initial
  commit` → we forked from **Cline**, and **"NKlein Bot Inc." is fabricated**. **Fixed (clear-cut):** fork-origin prose
  "NKlein Kanban" → "Cline Kanban" in README/CONTRIBUTING/docs/architecture/docs/README/RELEASE_WORKFLOW; fabricated
  author "NKlein Bot Inc." → "!Klein contributors" in LICENSE + README; added a durable **naming-truth note to AGENTS.md**
  + a guard comment on the legacy commit-message constant. **Deliberately NOT changed (out of the user's "non-code"
  scope):** code identifiers (`NKlein SDK`/`NKlein agent`/`NKlein*` types, `@nkleinbot/*`, `nklein-*.ts`, the `nklein`
  CLI), the `LEGACY_KANBAN_INITIAL_COMMIT_MESSAGE = "…NKlein Kanban"` git-history match string (a fact, not a label), the
  vendored SDK under `vendor/`, and the `todo.md` work-log. The UI has **no** user-visible "NKlein" product strings
  (verified). **⚠️ DEFERRED sub-decision (low-bar, easily reworked):** the exact **LICENSE copyright holder** — I defaulted
  to "!Klein contributors" (non-fabricated, conventional OSS) rather than invent an entity or presume your legal name.
  You may prefer your own name/org, and/or to **formally credit Cline's upstream copyright** (Apache 2.0 §4(c) asks a
  derivative to retain the original attribution — a NOTICE file crediting Cline would be the clean way). One-line fix when
  you decide.
  - **✅ RESOLVED (2026-06-27, user):** keep **"!Klein contributors"** as the holder **+ the Cline NOTICE**. Already
    fully satisfied — `NOTICE` exists and credits Saoud Rizwan / the Cline project upstream (Apache-2.0 §4) with
    "!Klein contributors" holding the modifications. No change needed.

## Clarification pass (2026-06-27, user — "clarify all open questions / decisions") — DECISIONS
Reviewed this whole log with the user (the §5.A "review the autonomous-decisions log" item). The vast majority of
entries above were already-resolved; the four genuinely-open ones were decided:
- **LICENSE holder = "!Klein contributors" + Cline NOTICE.** Already in place (see the RESOLVED note above) — no work.
- **native-core-default flip = HOLD until the §5.X port language is settled.** Confirms the prior held state: do NOT
  build the full TS native agent runtime now (likely throwaway under the Python port, which bridges/ports the agent SDK
  last). Keep the `@nkleinbot` SDK host meanwhile; build the native runtime in whichever language wins. No TS-native-
  runtime work proceeds.
- **Chat "sandboxed" scope naming = RENAME for clarity (→ "host access") + KEEP the session-wide risk ack.** The scopes
  whose names imply Docker isolation actually grant host fs/shell access under a session-wide "I accept the risk" opt-in
  (by-design §5.M host opt-in). Fix the misleading USER-FACING labels so it's clear they're host access; keep the
  session-wide acknowledgement granularity (no move to per-action). Tracked as an actionable item in §5.M.
- **Parallel-backlog audit doc = DELETE.** Fully consolidated into todo.md (§5.AK / §5.AB / WORKING MODE); deleted per
  the consolidate-and-delete convention.

## 2026-06-28 — Phase ordering for the "stabilize + sweep" goal (pre-decision, review)
The goal asked for: (1) full e2e stabilization reference, then (2) three full LM-Studio model sweeps on dev-test
projects with hardening, then (3) grind the backlog. **Pre-decision:** Phase 1 = restore the e2e suite to green +
fix the bugs it surfaces (done: promptBlock null-crash, board-card title-collapse; suite green at 46) — that is a
solid regression net. The deeper e2e build-out (workspace-aware mock for project-switch, chat-procedure mocking,
dynamic-WS switch-stall repro, deep board-lifecycle/drag) is **high-plumbing-effort and is deferred to interleave with
Phase 3**, because the live model sweeps (Phase 2) exercise the real backend+UI and surface more, and need the live
env that is available now. Logged the deferred e2e items under §5.V. Confirm if you'd rather I build the full e2e
plumbing before sweeping.
