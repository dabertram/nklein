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

## Autonomous decisions (below the escalation bar)
- **(2026-06-25) §5.B promotion mechanism = explicit agent tool** (user said "choose the robust one"). Rationale:
  explicit > inferring from turn-end, robust against weak local models (parse-and-recover principle). Low rework.
- **(2026-06-25) ⚠️ CONTRADICTION — defaults "hard flip both now" NOT done; deferred.** The user decided to hard-flip
  native-agent-core=default + core-py=on now (no fallback). But these are **not flag-flips**: per §5.H's own engineering
  note + the unchecked prereqs, (a) the native core `src/agent-core/` is **not imported by any runtime/session code yet**
  (the native-core→task-execution integration is unbuilt) — flipping the default points the runtime at nothing; (b)
  core-py default-on needs the sidecar **bundled + auto-started** first, and "default-on, no fallback" before that would
  hard-fail every task. Hard-flipping now would BREAK the runtime — counter to "never run blindly into the dark." So:
  sensible default = **do NOT flip**; these become the §5.H prerequisite workstream. **Needs the user** to decide:
  build the (large) prereqs now, or keep both opt-in until then. Flagged to the user in-session; revisit at the end-review.
- **(2026-06-25) Orchestration of the first parallel batch:** chat-polish (web-ui) delegated to a worktree subagent;
  feature/UI exposure audit delegated to a read-only Explore subagent; the risky **defaults hard-flip** kept by me
  (needs runtime verify). Disjoint file sets, so no collisions.
