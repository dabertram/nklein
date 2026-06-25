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
