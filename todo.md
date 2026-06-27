# !Klein — todo.md (single source of truth for development)

> **This is the one durable dev artifact.** It replaces `specsheet.md`, `plan.md`,
> `iteration-instructions.md`, `follow-up-1.md … follow-up-6.md`, and
> `findings-from-follow-up-work-4.md` (all consolidated here and deleted).
>
> **An agent is told only one of two things:** *"work on `todo.md`"* or *"add to `todo.md`"* — and must
> get everything it needs from this file. So: the rules of engagement, what's left, and why the project is shaped
> the way it is all live here. **Finished work lives in its sibling [done.md](done.md)** (the shipped archive) — and
> a finished item moves there in the SAME commit that ships it (the "DONE → done.md" rule in §5's intro). So
> `todo.md` = what's *left*; `done.md` = what's *done*.
>
> **Status legend:** `[x]` done (shipped & verified — and moved to [done.md](done.md)) · `[~]` in progress / partial / shipped-but-degraded ·
> `[ ]` open & **ready** (an actionable leaf you can start now — the count of these ≈ ready work left) ·
> `[?]` blocked on the **user** (needs a decision / spec / answer only they can give) ·
> `[>]` blocked on **another task** (waits on a named prerequisite's outcome — note it inline, e.g. "(needs §5.H)") ·
> `[-]` deferred / superseded (intentionally not now; kept for traceability) ·
> umbrella/grouping rows that only collect children are plain **bold rows without a checkbox** so they don't inflate the count.
> Greps: ready = `grep -c '^\s*- \[ \]'` · waiting-on-user = `grep -c '^\s*- \[?\]'` · task-blocked = `grep -c '^\s*- \[>\]'`.
> (The old informal prose prefixes `LATER:`/`BLOCKED:` are now formalized into the `[-]`/`[?]` markers above; env is
> **not** a blocker — the working session has Docker + the `nklein/agent-sandbox` image, a live LM Studio with loaded
> models, and a Playwright browser, so Docker/browser/live-model verification is actionable here, not blocked.)
>
> **Last reconciled:** 2026-06-22 (against `main..HEAD`, the codebase, and the predecessor planning chain —
> including a line-by-line re-verification pass over all 10 source docs: follow-up-1/2/3 are 100% shipped,
> follow-up-4/5 open items map to §5.A, and the distinct follow-up-2 hardening features are itemized in §6.13).
>
> ## ⚙️ WORKING MODE — AUTONOMOUS, FULL CAPABILITIES (do NOT forget; do NOT re-litigate)
> The agent has **all needed capabilities and tools** in the working environment and uses them **itself**: a
> **headless browser (Playwright)** it drives for any UI work + verification, **Docker** + the `nklein/agent-sandbox`
> image, a **live LM Studio** with loaded models, the **dev-test projects** + `collect evidence`, and the full repo
> toolchain. **There are NO babysitting / "watched" sessions.** ALL user interaction is limited to **adding specs,
> guiding direction, and asking/answering clarifying questions** — **everything else is done autonomously**:
> implementation, browser/UI interaction + verification, Docker/sandbox runs, dev-test sweeps, and all live
> verification. **Never defer work by assuming a missing capability or a need for the user to watch/click.** If a
> change needs UI/live verification, the agent drives the browser / Docker / models itself.
>
> ### Workflow rules (settled across this dev chain — do NOT re-litigate, do NOT ask about these again)
> - **Decide priority/order yourself.** When the user has not stated an explicit preference between tasks, the
>   agent picks the order (using §5.0 + the priority notes as the default) and proceeds. Do **not** stop to ask
>   "which should I do?" or report-and-wait for a steer on prioritization. Trust your judgment — you are a highly
>   skilled worker.
> - **Never stop for "budget shape".** A big/long task is split into **committed increments** and the work
>   continues — commit in between and keep going. Do **not** checkpoint, hand off, or pause just because a context
>   window is filling. (Splitting across windows is fine, but it means *commit the increment and continue*, not
>   *stop and report*.)
> - **Don't stop to narrate or wait for approval** when there is actionable work — keep producing. Prefer doing
>   over reporting; a short status is fine *after* a chunk lands, never instead of the work.
> - **Commit incrementally without being asked** (this is the standing instruction for this repo; it overrides the
>   generic "never commit unless asked" guardrail). Every commit must be **green** — the pre-commit gate (`tsc` +
>   `biome` + fast tests) — and must keep `CHANGELOG.md` `## [Upcoming]` and this `todo.md` current in the same
>   change.
> - **Verify via `tsc` / `biome` / tests + live Playwright/Docker — NOT the IDE diagnostics**, which are frequently
>   stale/phantom in this repo (redeclared/parse-error cascades mid-edit). Trust the real compiler/test output.
> - **The only legitimate reasons to pause** are a genuine spec/clarification question only the user can answer, or
>   a hard external blocker. Capability and context-budget are never the reason.
> - **Fanning out to subagents — default solo, delegate only safely** *(2026-06-27, standing)*. Throughput comes from
>   *dispatchable structure*, not from spawning more writers at the current repo shape (more parallel writers on the
>   same monolith files just multiply conflicts, stale edits, and integration failures). **Default is solo-sequential**
>   on the main tree — the proven-safe mode here. **Parallel git-worktree subagents are BANNED** in this env: worktrees
>   share `.git/config`, so one worktree's dev-test/test git op flips the shared `core.bare` for all and their working
>   trees cross-contaminate (real incidents — see AGENTS.md). When you *do* delegate, delegate only **disjoint,
>   self-contained** packages (pure/core/test, or one **non-hot** module), each handed a **Work Package Contract**
>   (intent · write-scope · forbidden paths · interfaces · acceptance gates · evidence required) and returning a
>   **Merge-Readiness Pack**; **never parallel-*write* a hot file**, and prefer independent clones / patch bundles over
>   shared worktrees if external isolation is ever needed. **You remain the sole trunk integrator** and the sole owner
>   of `todo.md` / `done.md` / `CHANGELOG.md` — a worker proposes exact doc bullets in its final message; you apply them.
>   The hot-file ownership map (Green/Yellow/Red), the verification path→gate manifest, the full templates, and the
>   structure-refactor ladder that *makes* the repo dispatchable all live in **§5.AK** (self-contained, below). The same
>   discipline is the blueprint for !Klein's OWN multi-agent mode over user projects — small local models need this
>   structure even *more* (§5.AK direction 2).

---

## 1. Prime directives — never violate

1. **LOCAL MODELS ONLY.** `CLOUD_ENABLED = false`
   ([src/nklein-agent/nklein-local-only-policy.ts](src/nklein-agent/nklein-local-only-policy.ts)). No path, default,
   setting, or UI may reach a paid/cloud LLM. Cloud providers don't render, can't be selected, and cloud-pinned
   cards hard-stop. Re-enabling cloud is a single deliberate reviewed code change — never a feature you add.
2. **STRICT DOCKER AGENT ISOLATION IS MANDATORY, UNCONDITIONAL, FAIL-CLOSED.** Every agent shell command and
   filesystem read/write runs inside a Docker container; the host runtime never executes shell/FS on the LLM's
   behalf. No host fallback, no "disable isolation" toggle, no degraded mode. If Docker/the image is
   unavailable, agent tasks refuse to start. **Bright line:** board / plan / !Klein-state mutation is *trusted
   control-plane* and may run host-side; the user's-repo file/shell/edit/patch/search is *data-plane* and must be
   sandboxed.
3. **≥32k context minimum.** `NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000`, enforced at every entry. No oversized
   prompt is ever sent — over-budget turns compact or the task stops. No hardcoded window/speed constants in
   routing/budget decisions.
4. **UPSTREAM-CLEAN SDK BOUNDARY.** Every feature is a `src/nklein-agent/` plug-in on an official SDK socket.
   `npm run check:nklein-boundary` must stay green. (See §11 for the note that the SDK itself is now vendored
   in-repo under `vendor/nklein-sdk/` — that is repo-owned and editable; the boundary rule is about not forking
   the SDK's *internal* contracts gratuitously.)
5. **PROTECTED TESTS ARE HUMAN-GATED.** You may not weaken or change anything in `test/protected/**`,
   `vitest.protected.config.ts`, or `test/protected/protected-tests.json` without **explicit user approval** via
   a structured `{intent, diff, reason, expectedEffects}` proposal. Default is deny.
6. **Follow `AGENTS.md` / `CLAUDE.md`:** no `any`, no inline/dynamic imports, prefer SDK types, `react-use`
   hooks in web-ui, Tailwind over inline styles, small single-responsibility files, and keep `CHANGELOG.md`
   `## [Upcoming]` current **in the same change** as the code.
7. **WORK THE BACKLOG — do not stop for interaction unless absolutely necessary** *(2026-06-23, standing)*. Grind
   §5 toward zero without report-and-wait checkpoints. A genuinely blocking question/decision (spec ambiguity only
   the user can resolve, or an irreversible/outward-facing action) *may* be asked — but **defer it when reasonably
   possible**: take the sensible default, record the assumption, keep moving, and batch deferred questions for one
   later pass once the pile is worked down. Capability, context-budget, and "which task next" are **never** reasons
   to stop — decide and proceed, committing green increments continuously.
8. **`/clear` at clean breakpoints** *(2026-06-23, standing)*. When you reach a point where the long chat history is
   no longer needed — a milestone is committed **and** all durable state lives in `todo.md` / `AGENTS.md` / `git`
   (the chat holds nothing that isn't in files) — run `/clear` to reset the context window (faster + cheaper, keeps
   the prompt cache lean). This is only safe because state is *always* persisted to those files, never to chat alone;
   keep it that way so a clear never loses anything.

### Product identity
!Klein is a local-autonomous, multi-LLM **kanban swarm** for software work. A user drops a high-level idea on
the board; !Klein decomposes it into a dependency-linked DAG of right-sized cards and runs them with local LLM
agents — in parallel where safe — entirely on the user's own hardware. Branding: in-app `!Klein`,
OS/packaging `nKlein`, identifiers `nklein`. The repo name and the `kanban.repositoryCreatedByKanban` git
marker are intentional keeps.

---

## 2. The iteration loop (how to work)

Repeat until the stop condition (§3) is met:

1. **Sync context.** Read this file (§1 directives, §5 open work). Run `git log --oneline -10` and `git status`.
2. **Pick the highest-value open item** from §5, in this priority order:
   1. Anything that unblocks the headline goal: a single high-level prompt → Planning-lane DAG → cards that
      auto-start and run, **with strict isolation ON**.
   2. Safety/correctness (isolation invariants, guardrails, protected-test coverage gaps).
   3. Enumerated open items (§5.A–§5.G).
   4. Backlog / newly-raised items (§5.H–§5.I) that are ready (no unresolved user clarification).
   If comparable, prefer the smallest safe step that ships value.
3. **Deep analysis before coding.** Read the actual implementation, not just this doc. Re-grep quoted
   symbols — line numbers drift. Confirm the gap is real. If the right approach is genuinely ambiguous in a
   way the codebase can't resolve (architecture-shaping decisions, anything touching the invariants), **ask the
   user** — don't guess.
4. **Implement** to production quality. Add **well-selected** tests (§4). Stay within the SDK boundary.
5. **Verify** (the gates below). Everything green before an item is "done".
6. **Update docs in the same change:** flip the checkbox here, and add a user-facing `CHANGELOG.md`
   `## [Upcoming]` bullet. If you're adding a genuinely new capability, write its spec in §5 **first**. **If the
   change *finishes* a top-level item or section (its whole tree is now `[x]`), move that subtree to
   [done.md](done.md) in this same commit** (leave the one-line stub here) — the DONE→done.md rule in §5's intro.
7. **Commit cadence:** collect ~10–15 completed items (or a coherent themed batch), then commit and push —
   keep the remote current without micro-commits. Commit sooner if you hit a milestone, are about to do
   something risky, the tree is getting large, or a handoff is imminent. Work on the feature branch
   (`feat/kanban-reliability-context-upgrade`), never `main`. End every commit message with
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Verification gates — run before marking ANY item `[x]`
- `npm run typecheck` · `npm run web:typecheck` — 0 errors.
- `npm run lint` — clean · `npm run check:nklein-boundary` — passes.
- `npm run test:fast` plus the specific `npx vitest run test/runtime/...` suites for what you touched — green.
- `npm run test:protected` — green (and you did not modify it without approval).
- web-ui changes: `npm --prefix web-ui run test` for the affected components.
- isolation/Docker changes: run the Docker-gated integration tests if a daemon is available; they must skip
  cleanly when not.
- If a user-relevant UI/flow can't be unit-verified, either run the dev build and observe, or **record the
  manual-verification debt** under §5.A — never silently mark it done.

Never mark `[x]` until its gate passes. Report failures honestly, with output.

---

## 3. Stop condition — when "nothing is left to do"

When every §5 item is done or blocked on the user/an environment, and no correctness/safety/UX gap survives
deep analysis:
1. Final verification pass; make sure this file is in sync.
2. **Do not invent low-value churn to look busy. Stop.**
3. Report: what was accomplished this run, the verification status, and what's now blocked on the user (e.g.
   the portable-state clarifications in §5.F, the manual isolation/UI verification in §5.A that needs a
   Docker-enabled interactive browser session).
4. **Ask the user for new feature ideas.** Offer 2–4 concrete, invariant-respecting proposals of your own as a
   starting point. New ideas get written into §5 first, then worked.

---

## 4. Test selection philosophy (well-selected, not exhaustive)
- Lock **product behavior and invariants**, not implementation trivia. A focused regression for each bug fixed
  and each invariant a small model could plausibly weaken.
- The **protected suite** is the floor that lets small/weak LLMs work on !Klein safely. It must cover the
  load-bearing invariants (local-only policy, context/overflow, timeout scaling, swarm guardrails, workspace
  identity, decomposition apply, the strict-isolation no-host-execution + fail-closed-start guards). Add to the
  protected manifest **only via the human-approval path** (§1.5).
- Keep suites fast and non-hanging. If CI hangs on Node 22, suspect a live subprocess / real SDK-host boot
  before a slow test body (see `.plan/docs/node22-ci-hanging-tests-investigation.md`).

---

## 5. OPEN WORK (the actual todo)

> Everything shipped/finished now lives in **[done.md](done.md)** (the `## 6. SHIPPED` archive + the completed `§5`
> sections), so an agent knows what exists and doesn't rebuild it. The items below are what's **left**. Each is
> independently landable.
>
> **★ DONE → `done.md`, in the SAME commit that ships the code (2026-06-27, user — STANDING, do NOT re-litigate).**
> `todo.md` holds only **not-yet-finished** work; **finished work moves to [done.md](done.md)**. When a top-level item
> or a whole section becomes fully `[x]` (delivered + verified), **move that whole subtree — keeping its `§x.y` id and
> nesting — into `done.md` in the SAME change that delivers the code** (the same commit that flips it green also moves
> it, next to the `CHANGELOG.md` `## [Upcoming]` bullet). Anti-chaos rules so this stays smooth:
> - **Migration unit = a *top-level* `[x]` item or a fully-`[x]` section.** Move the complete subtree; never half of one.
> - **A `[~]` umbrella stays WHOLE in `todo.md`** (its done children are in-flight context for the open siblings) until
>   its top box flips to `[x]` — then the whole subtree migrates. `[-]` deferred/superseded items also stay here (deferred ≠ done).
> - **Preserve `§`-ids on the move** so cross-file references keep resolving (a completed `§5.x`/`§6.x` keeps its id in
>   `done.md`). Leave a **one-line stub** in `todo.md` at the moved section's place (`### 5.x — … ✅ COMPLETE → moved to
>   done.md`) so the numbering still reads continuously and "where did it go?" is answered in place.
> - **`done.md` is an append-only archive** — group by the same ids; don't rewrite a migrated item except to fix a cross-ref.
> - **The ready/blocked greps below count `todo.md` only**; `done.md` is not counted. (So moving done work out keeps the
>   "ready work left" count honest — that's the point.)
>
> **★ `todo.md` IS SELF-CONTAINED — integrate details INLINE, never cross-reference for them (2026-06-27, user —
> STANDING, do NOT re-litigate).** `todo.md` is **THE ONE guiding document for *future* work**; `done.md` is the archive
> of what's *already done* (and `CHANGELOG.md` = user-facing release notes). **Every actionable detail an item needs in
> order to be worked MUST live in `todo.md` itself.** Do **NOT** defer the *what / how* of an item to an external
> `.plan/docs/*` memo (or any other file) via a "see doc §X for the detail" cross-reference — **cross-referencing for
> details creates circular dependencies and loses detail when those docs drift or are forgotten.** A `.plan/docs/*` doc
> MAY exist as deep background / derivations / sources, and you may cite it purely as **provenance** (e.g.
> "(background + sources: …)") — but a reader must be able to **execute the item from `todo.md` alone, without opening
> it**. When you touch an existing item that defers detail to a doc, **integrate that detail inline** as part of that
> work. (Citing `done.md`/§-ids for *already-shipped context* is fine — that's the done-archive split, not detail-deferral.)
>
> **Tracking convention (2026-06-23): use nested checkbox lists, up to ~6 levels deep, so progress is visible at a
> glance** — a multi-commit effort becomes a tree of `[x]`/`[~]`/`[ ]` sub-items, NOT prose under one checkbox. As
> work lands, **flip the nested boxes** (and tag each with its short commit hash) rather than appending DONE-notes;
> the verbose per-commit detail belongs in CHANGELOG `## [Upcoming]` + git, not here. §5.A is the worked example.
> Once a whole top-level item's tree is `[x]`, it graduates from "flip in place" to "move to `done.md`" (the rule above).
>
> **Cross-model verification convention (2026-06-26, user — standing, do NOT re-litigate): every task that involves
> real LLM interactivity must be verified on EVERY loaded local model, not just the one it was first proven on.** This
> is a **retro-verification** obligation for already-`[x]` done tasks (the user asked to run these "at the next best
> opportunity") AND part of the **done-bar** for open LLM-interactive tasks. The model roster, the deepseek
> crash-resilience caveat (a model that vanishes mid-run is recorded DROPPED and the sweep continues with the rest),
> the methodology, and the enumerated per-flow sweep checkboxes all live in **[§5.Z](#5z)** — the single source of
> truth. Rather than editing every task line, a task's single-model live proof (e.g. "verified on qwen3-8b") keeps its
> text and its cross-model obligation is tracked as a §5.Z checkbox + a row in
> [cross-model-verification.md](cross-model-verification.md).

### 5.0.1 — Long-run mandate + decisions (2026-06-25; FINAL — supersedes earlier "parked" steers where they conflict)
> The user front-loaded a batch of decisions so the agent can run autonomously for a long stretch toward a
> **fully-resolved todo.md**. Meta-rules: **work every item**; escalate only a genuine missing-decision blocker
> (HIGH bar — not minor reworkable choices: take the sensible default + **log it in
> [.plan/autonomous-decisions.md](.plan/autonomous-decisions.md)** for end-of-run review). **Ship mode: local
> commits only — no push / no PRs.** Runtime restart to live-verify backend fixes is OK. Decisions:
> - **Run order:** (1) quick wins — chat sidebar inner-resize fix + chat-session relabel + flip the two defaults;
>   (2) **§5.B planning/refinement lane** (full design); (3) **comprehensive test coverage** (two layers); (4)
>   **systems-analysis safe simplifications** (state/data/activity flows + ownership/SoC). §5.U file-decomposition +
>   §5.R SDK-boundary inlining stay **deferred**; only the behavior-preserving systems simplifications run now.
> - **THE BIG ARC (2026-06-25, user) → new [§5.X](#5x):** a **deep whole-codebase refactor** (clear structure,
>   testability, maintainability, efficiency, correctness), possibly **porting the entire server/backend to Python** —
>   **gated on §5.V full deep test coverage as the port-resilient regression oracle** (tests assert behavior through
>   stable seams, not TS internals, so they survive a backend rewrite). Sequencing: **§5.V first → §5.X Phase 1 TS-internal
>   refactor → §5.X Phase 2 Python port (high-bar DECISION, prepared not started).** This raises §5.V's priority: it is now
>   the linchpin precondition, not just "more coverage."
> - **§5.B:** Planning→In-Progress promotion = an **explicit tool the agent calls** when the plan still holds (else it
>   replans/decomposes). **Always refine, no skip-guard.** Every started card routes through Planning/Refinement first.
> - **Defaults (RESOLVED 2026-06-25 clarification pass): "build the prereqs now, then flip".** Hard-flipping today would
>   break the runtime (native-core `src/agent-core/` isn't wired into task execution; core-py isn't bundled/auto-started),
>   so this is an **active workstream → §5.H**: (1) integrate `src/agent-core/` into the runtime/session execution path;
>   (2) bundle core-py + auto-start it on launch; (3) THEN hard-flip both (native core = default runtime, core-py = on),
>   no silent fallback, clear error if unavailable. NOT a flag-flip — build first.
> - **More clarification-pass answers (2026-06-25):** **§5.X port = plan now, build after §5.V** (§5.V is the gating
>   precondition); **autonomous chat agent (§5.M) = promote to ACTIVE now**; **§5.J look & feel = defer indefinitely**
>   (no mockups now).
> - **Testing:** two layers — fast deterministic gate + real live-model/Docker punch-through e2e (new dev-test
>   projects covering all use cases + all chat functions + deep UI/UX path coverage). No CI infra yet → run the full
>   suite incl. slow e2e periodically and keep green. (New §5.V below.)
> - **§5.J look & feel:** I mock up 2–3 restyle directions as screenshots; the user picks.
- [x] **Chat sidebar polish (2026-06-25, user)** — (a) **DONE** — the right chat sidebar's inner elements now reflow on
      width drag: session-list `aside` is proportional + bounded (`w-[38%] min-w-[160px] max-w-[220px]`), and a full
      `min-w-0`/`overflow-hidden` chain through ChatPanel → body → transcript → composer → MessageBubble lets flex
      children shrink below content size. (b) **DONE** — session list relabel: `buildSessionMeta` (single source of
      truth) renders "Started Jun 25 14:32 · 4 msgs · Last Jun 25 15:01" (message count only for the loaded/selected
      session; "last activity" only when >30 s after creation). All in [chat-sidebar.tsx](web-ui/src/components/chat/chat-sidebar.tsx).
  - **Token count in the session label (follow-up)** *(grouping — the 4 buried sub-steps below are the counted commits)*
        — omitted for now: the §5.M chat schemas
        ([chat-api-contract.ts](src/core/chat-api-contract.ts) `runtimeChatSession`/`runtimeChatMessage`) carry **no
        usage/token field**, so it's a real backend feature, not a UI add. Cheap once usage is tracked. Sub-steps
        (buried in the original prose):
    - [ ] capture per-turn usage from the LLM in the chat send loop
    - [ ] persist a running token total on the session record (or per message)
    - [ ] expose it in the schema/broadcast
    - [ ] render it where the `buildSessionMeta` comment marks the spot
  - [-] **Later:** generated session title via embedding/LLM (replaces the literal "New chat"). *(deferred: nicety,
        prefixed "Later" by decision.)*
- [~] **Autonomous chat agent — NOW ACTIVE** *(2026-06-25, user clarification pass — "promote to active now")* — the
      right-sidebar chat agent should do **real autonomous work**: focus chain, memory, tools, knowledge fetching,
      browser, etc. — like Cline but stronger, and able to use the project/card/task structure in the background (work an
      existing project or create a new one). Build it soon, in parallel with the test/refactor work (was "later"; the
      user promoted it).
      **EXPANDED 2026-06-26 (grounded in the §5.M code — building blocks all exist):** `runChatAgentLoop`
      ([chat-agent-loop.ts](src/chat/chat-agent-loop.ts)) is a **per-message** tool loop (model→tools→repeat *until it
      answers the user*, bounded by `maxIterations`), the gated tool suite (board/browser/command/workspace/focus-chain),
      the focus chain ([chat-focus-chain.ts](src/chat/chat-focus-chain.ts)), and memory (short/long/consolidation) are
      built. What's missing is the **autonomous *driver* on top** — a goal-driven loop that self-paces across many turns
      without per-message input. Subtasks:
  - [x] **Driver loop `runAutonomousChatAgent` (DONE 2026-06-26)** — `src/chat/chat-autonomous-loop.ts`: pure, injected
        orchestration (mirrors `runChatAgentLoop` + the §5.B guardrail collaborators). Given a **goal**, runs turn after
        turn {wall-time guard → `runTurn` toward the next step → on goal_complete/needs_user stop → else update the
        no-progress streak + read focus-chain progress → stop if the plan is all-done} bounded by a turn + wall-time
        budget + a repeated-no-tool-progress park. **6 stop reasons** map to the swarm-guardrail semantics: `completed`,
        `paused_needs_user`, `budget_turns_exhausted`, `budget_wall_time_exhausted`, `stalled_no_progress`. `runTurn` +
        `readPlanProgress` + the clock are injected → **7 unit tests** (each stop reason + streak-reset), tsc + biome green.
        Live wiring (`runTurn` ← `runChatAgentLoop` with goal+plan+tools, `readPlanProgress` ← focus-chain summary) is the
        next subtask.
    - [x] **control tools + turn interpreter (DONE 2026-06-26)** — `src/chat/chat-autonomous-control-tools.ts`: the two
          flow-signal tools the driver gives the agent — `request_user_input` (pause+ask) and `declare_goal_complete`
          (end the run) — both pure signals on the always-allowed `sandbox_read` kind, capturing into a per-turn
          `signals` object; plus `interpretAutonomousTurnOutcome(loopResult, signals, controlToolNames)` mapping a
          finished `runChatAgentLoop` turn → the driver's outcome (question→needs_user, completion→goal_complete, else
          progressed; "tool progress" counts only non-control steps so a spin/ask still trips the stall guard). 7 unit
          tests, tsc+biome green.
    - [x] **wiring adapters (DONE 2026-06-26)** — `src/chat/chat-autonomous-wiring.ts`: `readAutonomousChatPlanProgress`
          (the driver's `readPlanProgress` = `summarizeFocusChain` over the persisted chain, counting `done + skipped` as
          resolved so `done >= total` matches the chain's own "complete") and `buildAutonomousChatTurnRunner` (the driver's
          `runTurn`: per turn mints the control tools, builds the plan-then-execute / continue goal directive, calls the
          injected `runTurnWithControls`, maps via `interpretAutonomousTurnOutcome`). 5 unit tests; tsc+biome green. So the
          pure driver + both its injected deps now exist + are tested.
    - [x] **composition entrypoint `runAutonomousChatSession` (DONE 2026-06-26)** — `chat-autonomous-wiring.ts`: ties the
          pure driver + the control-tool turn runner + `readPlanProgress` together, with the chat machinery injected
          (`assembleTurnDeps` builds the per-turn gated tool deps WITH the control tools merged; `runAgentTurn` runs one
          `runChatAgentTurn` against the goal directive). Unavailable model/workspace pauses the run via the needs_user
          path instead of spinning the budget. 3 composition unit tests (unavailable→pause, declare_goal_complete→completed,
          multi-turn→plan-all-done); tsc+biome green. **So the entire autonomous-agent logic is now built + tested behind
          injected seams.**
    - [x] **chat-service `runAutonomous` + resolver `extra` (DONE 2026-06-26)** — the agent is now **backend-runnable**.
          `buildChatAgentToolDepsResolver` (`runtime-api.ts`) takes an optional `extra: ChatToolSet` merged into its
          `tools`/`definitions` (interactive passes none; behavior-preserving — 477 chat+runtime-api tests green). `ChatService`
          gained `runAutonomous({ sessionId, goal, budget, maxIterationsPerTurn? })`, which reuses `sendMessage`'s store-deps
          machinery to build the `AutonomousChatSessionDeps` (`assembleTurnDeps` = `resolveAgentToolDeps(session, extra)`,
          `runAgentTurn` = one `runChatAgentTurn`, `readPlanProgress` = the focus-chain summary) and drives
          `runAutonomousChatSession`. 2 integration tests through the real chat machinery (declare_goal_complete→completed,
          missing-session→null). So `chatService.runAutonomous(...)` runs a full autonomous loop end-to-end today.
    - [x] **tRPC start/status procedure + background drive (DONE 2026-06-26)** — the agent is now **wire-reachable**.
          `createAutonomousChatRunController` (`runtime-api/autonomous-chat-run.ts`): an in-memory per-session run registry
          + `start` (kicks off `chatService.runAutonomous` in the background, bounded by the global `swarmGuardrails`
          budget — one run per session, returns the in-flight status if already running; a failed run surfaces in
          `finalText`) + `status` (running? last stop reason / turns / plan progress). Contract schemas added to
          `chat-api-contract.ts` (`runtimeChatStartAutonomous*` + `runtimeChatAutonomousRunStatus`), handlers in
          `runtime-api.ts`, procedures `chat.startAutonomousRun` (mutation) + `chat.autonomousRunStatus` (query) in
          `app-router.ts`. The run's turns persist to the transcript as it goes, so the existing chat UI already shows the
          conversation grow. 4 controller unit tests + contract (272) + runtime-api (87) green; tsc + biome green.
    - [x] **goal-intake UI (DONE 2026-06-26)** — `useChatData` gained `autonomousStatus` + `startAutonomousRun(goal)`
          (calls `chat.startAutonomousRun`, then a self-cancelling poll loop on `chat.autonomousRunStatus` that refreshes
          the transcript as the agent works). `ChatPanel` gained an `AutonomousRunBar` above the composer: a goal field +
          "Auto" button (disabled while running / no session) + a compact live status line (working · N/M steps, or the
          final stop reason · turns). Render-verified: web:typecheck + web:build green (no chat component test exists to
          extend). *(No Stop control yet — the run is budget-bounded; mid-run cancel would need a backend signal.)*
    - [x] **browser render-check (DONE 2026-06-26)** — booted `dev:full`, opened the chat sidebar + created a session,
          confirmed the `AutonomousRunBar` renders (goal field + Auto button), the Auto button disables on an empty goal +
          enables once a goal is typed, **zero console/page errors**. Reusable smoke at
          [scripts/verify-chat-autonomous-ui.mts](scripts/verify-chat-autonomous-ui.mts); screenshot confirmed the bar sits
          cleanly above the composer.
    - [x] **live-model run — VERIFIED end-to-end (2026-06-26)** — booted `dev:full` against a live LM Studio (qwen3-8b
          loaded), started a real autonomous run from the sidebar, and the loop drove the model to a clean stop:
          **"✓ Goal complete · 1 turn · 1/1 steps"** — the agent planned via `update_focus_chain`, fired
          `declare_goal_complete`, the driver completed, the focus-chain progress read 1/1, and the turn persisted to the
          transcript (screenshot-confirmed). Reusable smoke at
          [scripts/verify-chat-autonomous-live.mts](scripts/verify-chat-autonomous-live.mts). **So the §5.0.1 core — drive
          a goal → plan → tools → completion — is now proven at EVERY layer (unit + integration + tRPC + render + live
          model).** *(The broader §5.0.1 subtasks below — background board/card orchestration, the 2 owed memory items,
          deeper pause/resume — are enhancements on this working core.)*
  - [x] **Focus chain as the driver's plan state (DONE — proven live 2026-06-26)** — the agent updates the chain via
        `update_focus_chain` (persisted across turns) and the driver reads its summary via `readAutonomousChatPlanProgress`
        (counting done+skipped) to detect all-steps-complete. The live run showed "1/1 steps" drive a clean completion.
  - [x] **Goal intake + "go autonomous" affordance (DONE 2026-06-26)** — the `AutonomousRunBar` (goal field + Auto button +
        live focus-chain/stop-reason status). *(A mid-run Stop control is a future enhancement — would need a backend
        cancel signal; the run is budget-bounded so it always terminates.)*
  - [ ] **Background project/card work** — let the driver operate the board via the existing `chat-board-tools`: pick up
        an existing project's cards or create a project + seed cards, then start/monitor them (bridge to the swarm). Decide
        the boundary: the chat agent *orchestrates* board cards vs. *does* the work itself.
  - [x] **Knowledge fetching wired into the driver (DONE 2026-06-26)** — each autonomous turn assembles the session's full
        gated tool set (the runtime-api resolver builds read_file/list_dir/get_board + browse_url for browser-enabled
        sessions, per scope) and the goal directive tells the agent to "use your tools to do real work", so the loop can
        reach for repo + board + web context. *(Proactive retrieval prompting can be tuned later, but the tools are wired.)*
  - [ ] **Memory wiring (the 2 §5.M owed items)** — `≥32k-floor budget integration` + `access-all-loaded-projects scope`
        so the driver has durable working memory across a long run.
  - [ ] **Pause/resume + genuine-question handling** — the driver pauses for a real clarifying question (reuse §5.S
        auto-clarify) and resumes on the user's answer; never silently blocks.
  - [ ] **Live-verify end-to-end** — drive a real autonomous run on a dev-test project with a small local model
        (Playwright + the loop): goal → focus chain → tool work → durable side effects, within budget.
- [x] **Review the autonomous-decisions log with the user** *(2026-06-25; DONE 2026-06-27)* — walked through
      [.plan/autonomous-decisions.md](.plan/autonomous-decisions.md) with the user. Most entries were already-resolved;
      the four open decisions were settled (see the "Clarification pass (2026-06-27)" section there): LICENSE holder =
      "!Klein contributors" + Cline NOTICE (already in place); native-core-default flip = HOLD until §5.X port settled;
      chat "sandboxed" scope naming = rename to "host access" for clarity + keep the session-wide ack (tracked in §5.M);
      the parallel-backlog audit doc = deleted (consolidated into §5.AK).

### 5.0.2 — Milestone ladder + substrate-first sequencing *(2026-06-26, from an external spec audit — navigation aid, do NOT re-litigate)*
> An external audit of this file (459 §5 items) made a correct structural point: the new ambition arcs (§5.AA adaptive
> robustness, §5.AB role→model selection, §5.AC online+temporal, §5.AD context, §5.AE dynamic skills) are individually
> strong but **all depend on the same missing substrate** — a per-attempt evidence stream — and the spec lacked a
> machine-readable milestone/dependency structure, making task-selection expensive. The disciplined response (NOT more
> feature sections): one substrate section (**[§5.AF](#5af)**), this milestone callout, an operator-UX section
> (**[§5.AG](#5ag)**), and a **tiered** cross-model done-bar (§5.Z). Full reasoning + the system component map + the
> Attempt-Ledger schema + the tool-capability-manifest facets live in
> **[.plan/docs/substrate-and-milestones.md](.plan/docs/substrate-and-milestones.md)**.
>
> **Milestone ladder (the progress backbone):**
> - **M0 — single-card reliable** — one card → implement → `awaiting_review` → correct result branch, across the roster.
>   **DONE** (§5.Z verify-task-completion 8/9).
> - **M1 — decompose → multi-card → merge, unattended** — a goal → DAG → cascade → all cards → review → merge, surviving
>   restarts. Mechanism PROVEN (§5.V); the unattended/restart-survivable run needs the **§5.AF durable scheduler**.
> - **M2 — all-model adaptive** — the §5.AA retry ladder + §5.AB selection driving every assignment off the **§5.AF
>   ledger**; weak models lifted, no circles. Needs the ledger + profile persistence (the pure cores exist, unfed).
> - **M3 — online freshness** — §5.AC temporal (DONE) + online retrieval + freshness cache in the research roles.
> - **M4 — self-improving (quarantined)** — !Klein proposes patches to itself, gated by protected-tests + replay-eval +
>   security review before landing (the §5.AF self-improvement quarantine).
>
> **Substrate-first rule:** M2/M3/M4 all sit on §5.AF. Build the **Agent Attempt Ledger** first → make
> `ModelBehaviorProfile` (§5.AA) / MCSR (§6.4) / the §5.Z matrix / `ModelFitness` (§5.AB) **projections** of it → then the
> ambition arcs have real data instead of being parallel dreams. Don't widen the ambition fronts before the substrate is real.
>
> **Small-LLM optimization research addendum (2026-06-27):** a 12-agent online research pass (concurrency-capped at 6;
> requested ceiling was "up to 50") is captured in
> **[.plan/docs/small-llm-agent-optimization-research.md](.plan/docs/small-llm-agent-optimization-research.md)**. It
> validates the substrate-first order and sharpens the main correction: the ledger should be a **workflow event log +
> attempt evidence stream** (leases, admission/resource events, idempotency/replay boundaries, tool results, and model
> attempts), because small models need the harness to own long-horizon state. Follow-on backlog ideas should be folded
> into existing sections, not added as new ambition fronts: deterministic repair kernels (§5.B/§5.AA), BFCL-style tool
> probes + repeat-run reliability (§5.V/§5.Z), `ProceduralSkillBank` as validated/quarantined skill memory (§5.AE),
> `RetrievedEvidence` + citation verification (§5.AC), provenance/taint + egress/MCP policy (§5.L/security), and
> confidence/resource-aware routing (§5.AB).

### 5.0 — Clarification decisions (2026-06-23 pass; all FINAL unless re-decided)
> The user went through every open question in §5. Recorded here so the tasks are actionable without further
> clarification; the per-section items below are annotated to match.
> - **NEXT / priority order:** **§5.A worktree retirement first**, then **§5.R de-SDK integration**, then the
>   bigger feature builds (§5.H / §5.M / §5.O / …). The §5.S user-questions UI lands at the bottom (after all
>   currently planned tasks).
> - **AUTONOMOUS-RUN NOTE (2026-06-23):** §5.A and §5.R both need interactive/live verification (shell-on-task
>   `docker exec` rework; web-ui native-agent fallback rework; the de-SDK boundary inlining touches the whole agent
>   runtime) — **do them in a browser/Docker-watched session, not blind.** Meanwhile the unattended grind takes the
>   clearly-safe, fully-test-verifiable backend items first: **§5.Q** (telemetry identity), **§5.I#1 residuals**,
>   **§5.B knowledge-tool signal**, **§5.O CLI sweep orchestrator**.
> - **§5.A:** **Full retirement now** — remove terminal/CLI agents from `RUNTIME_AGENT_CATALOG` + the web-ui
>   legacy path, rework shell-on-task to `docker exec` into the task's sandbox, delete the worktree modules +
>   saved-host-patch path; verify the review/diff/merge + shell UI in-browser (env has Docker + browser).
> - **§5.H:** **Build both prerequisites now, then flip** — native-core→task-execution integration AND
>   python-core auto-start/bundle (+ Settings health line), then make native-core the default runtime (SDK
>   fallback intact) and python-core default-on.
> - **§5.M:** build **memory system first** (sensible defaults, tunable in settings); **fold the home agent into
>   the unified agent** as a selectable scope/role (migrate its session model into the new store). (Signal-first,
>   one-session-per-thread, 3 execution modes, isolated-by-default memory remain as previously decided.)
> - **§5.Q:** canonical model identity = **provider + model + canonical endpoint** (canonicalize loopback /
>   trailing-slash like the MCSR loopback fix; only true duplicates merge); aggregate globally per model.
> - **§5.O (SCOPE TIGHTENED 2026-06-24 — see the §5.O callout):** the **CLI orchestrator** + parallel-fan-out
>   dev-test projects are built. In-scope sweep work now is **small-model OUTPUT robustness only** (results →
>   `local-llm-tests.md`); **performance/efficiency comparison + quant / K-V-cache / context-size sweeps are HARD +
>   STRICTLY out of scope** until the user calls a version release-able.
> - **§5.L:** next delivery follow-up = **per-project delivery override**, built **with the §5.I#3 project-settings
>   modal** (where per-project settings belong).
> - **§5.B:** **build** the knowledge-tool-usage decomposition signal (backend correlation + Settings stats
>   column); **I draft** the audio-VST domain rubric + scorer.
> - **§5.I#1:** build **all three** residuals — idle-unload timer, verified sha256 in the manifest, in-panel
>   model-override picker.
> - **§5.P:** **keep deferred** until we reach it (it's the last task; boundary depends on how everything lands).

### 5.A — Finish strict-isolation reconciliation & live verification
- [x] **Created-workspace location guard (2026-06-25, user-directed safety fix after a real pollution incident).** A
      dev-test scaffold (`scaffoldNKleinDevTestProject`) whose `parentDir` resolved inside the repo seeded ~23 fixture
      commits onto the working branch + flipped `core.bare=true` (broke all work-tree git ops). Fix:
      [src/config/workspace-location.ts](src/config/workspace-location.ts) `resolveSafeCreatedWorkspaceParentDir` confines
      created workspaces to a configured path (`NKLEIN_DEV_WORKSPACE_DIR`) or the `~/.nklein/dev-workspaces` home default,
      **refusing/redirecting anything at/below !Klein's parent folder**; wired into `scaffoldNKleinDevTestProject` (returns
      `parentDirSafetyRedirect` for logging). 8 unit tests; `vitest.config.ts` now excludes `.claude/**` (agent worktrees).
      Incident + recovery recipe recorded in AGENTS.md. **Also hardened the pre-commit hook (`.husky/pre-commit`, user-
      directed "make sure these issues don't happen again"):** it `cd`s to the git toplevel, **auto-heals a stray
      `core.bare=true`** (the flip that wedged all git ops), **skips gracefully in a non-!Klein repo** (sentinel on the
      `package.json` name — a temp/dev-test repo can't be blocked), and **refuses to commit `.claude/worktrees/` gitlinks**.
      Verified: syntax, sentinel match, and the bare→heal→false transition. **Follow-up:** expose the workspace base dir
      as a first-class **global setting** in the UI (env + option work today; ties into §5.W); apply the same
      `resolveSafeCreatedWorkspaceParentDir` guard to git-clone / other creation sites.
- [~] **Retire the host worktree subsystem** *(decided: retire; terminal/CLI agents stay disabled under
      local-only).* Boundary predicate `usesLegacyHostTaskWorkspace` ([src/core/agent-catalog.ts](src/core/agent-catalog.ts));
      shell-on-task = `docker exec` into the task's sandbox (no host checkout). Full plan +
      surface inventory: [.plan/docs/section-5a-worktree-retirement-watched-session.md](.plan/docs/section-5a-worktree-retirement-watched-session.md).
      Per-commit detail lives in CHANGELOG `## [Upcoming]` + git. **Status: increments 1–2 done; increment 3 ~80%
      (C1–C7c done, C7d/C7e/C8 left); increment 4 pending.**
  - [x] **Increment 1 — catalog + web-ui native-agent → nklein-only**
    - [x] 1a — local-aware readiness (`isNKleinLocalModelConfigured`; dropped the CLI fallback)
    - [x] 1b — `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS = ["nklein"]` (picker + settings nklein-only)
    - [x] browser gate — boot smoke, 0 console errors, no spurious "No agent configured"
  - [x] **Increment 2 — shell-on-task → `docker exec`**
    - [x] 2a — sandbox shell seam (`getTaskShellTarget` + `buildAgentSandboxInteractiveShellArgs`)
    - [x] 2b — `startShellSession` wiring (`docker exec -it -u <uid> -w /workspaces/<task>`), live-verified
    - [x] gate closed — node-pty ↔ `docker exec -it` ↔ login shell verified end-to-end
  - [~] **Increment 3 — retire the worktree consumers + delete the machinery** (each = one green commit)
    - [x] step 1 — `startShellSession` worktree-free (dropped the `resolveTaskCwd({ ensure:true })` fallback) `816d7e07`
    - [x] C1 — review log/refs/diff → result-branch (`workspace-api`) `60945cc3`
    - [x] C2 — `loadChanges`/git-summary/discard drop `resolveTaskCwd` `203a9002`
    - [x] C3 — acceptance-auto-repair → sandbox-only `a6487e33`
    - [x] C4 — auto-merge → result-branch-only (KEPT — it's the live delivery merge) `87073a84`
    - [x] C5 — runtime-api `resolveExistingTaskCwdOrEnsure` removed (killed worktree-create-on-miss) `8415cdfc`
    - [x] C6a — workspace-metadata-monitor → home-git-only `76d09e8f`
    - [x] C6b — web-ui dead worktree-prep removed (+live Playwright) `47f4bb54`
    - [x] C7a — `nklein task` CLI worktree plumbing retired `4de877f0`
    - [x] C7b — `ensureWorktree` + `getTaskContext` tRPC procedures removed `50ac2006`
    - [x] C7c — host-worktree CREATION machinery deleted; `task-worktree.ts` slimmed to cleanup `f595fae0`
    - [x] **C7d — deleted the dead `src/terminal/*` CLI-agent integration** *(surgical — `TerminalSessionManager`
          is LIVE for shell; **live-shell verify still pending in increment 4**)*
      - [x] delete `commands/hooks.ts` + `commands/hook-events/*` (the `nklein hooks` CLI) + the `hooks-api` tRPC
            ingest + `parseHookIngestRequest` + ingest schemas (step 1; `RuntimeHookEvent` kept for adapters)
      - [x] kept shell infra (`pty-session`, `ws-server`, `terminal-protocol-filter`, `terminal-input`,
            `terminal-session-service`, `terminal-state-mirror`, `output-utils`, session-manager's shell path)
      - [x] remove the dead terminal-agent `startTaskSession` path from `runtime-api` (step 2) — handler now
            always takes the NKlein path (terminal `startTaskSession`/`applyTurnCheckpoint` branch + the
            `previousTerminalAgentId`/`useNKleinPath`/persisted-session-probe resolution deleted); concurrency
            counts NKlein summaries only; `terminalManager.getSummary`/`listSummaries` no longer read here.
            6 obsolete terminal-path tests removed, chat-clear test converted to the NKlein path.
      - [x] step 3a — remove the dead terminal stop/input fallbacks in `runtime-api` + delete the 4 zero-caller
            hook-driven manager methods (`transitionToReview`/`applyHookActivity`/`transitionToRunning`/
            `applyTurnCheckpoint`) + their 2 obsolete tests. (1333 tests green.)
      - [x] step 3b — deleted `session-manager.startTaskSession` + all agent-only internals (workspace-trust,
            Codex startup/prompt, output-transition adapters, egress env, auto-restart machinery) + trimmed
            `ActiveProcessState`/`SessionEntry` to shell-only; deleted the 7 helper files + 5 obsolete test files
            (940→427 lines). Shell path is a behavioral no-op. KEPT `agent-registry` + `command-discovery` (live
            non-agent consumers). 1300 tests green. **Live-shell verify still pending (increment 4).**
      - [x] step 3c — removed now-unused `runtimeHookEventSchema`/`RuntimeHookEvent` from `api-contract` (no
            consumers after the adapters were deleted). `RuntimeTaskHookActivity` kept (still on the summary).
    - [x] **C7e — web-ui task-workspace-info store cleanup** — removed the dead `taskWorkspaceInfoByTaskId` store
          API + consumers (App.tsx navbar path/subtitle/hint, top-bar git-status, `selectedTaskBaseRef` prop,
          use-board-interactions `clearTaskWorkspaceInfo`); kept the `taskWorkspaceSnapshot` half. Zero behavior
          change; web-ui tsc/biome/683 tests + live Playwright (0 console errors). *(`task-trash-warning-dialog`
          is an unused component using the contract type — left alone.)*
    - [x] **C8 — follow-up orphan cleanup** — deleted `session-state-machine.ts` + `output-utils.ts`, orphaned by
          the agent-launcher removal (zero references). `src/terminal/` now = live shell + config surface (8 files).
    - [>] **C8b — schema/catalog/predicate shrink (DEFERRED — coupled to plan.md §2.B)** *(investigated 2026-06-23:
          NOT safe-to-do yet; blocked on plan.md §2.B — the host-worktree module deletion + re-homing migrated-board
          cleanup off the agent-id boundary)*. `usesLegacyHostTaskWorkspace(agentId)` returns true for any non-nklein id and still
          **drives legacy host-worktree cleanup on shutdown** for migrated pre-§5.A boards (`shutdown-coordinator.ts`,
          via the kept `task-worktree` cleanup surface) — it is a **live back-compat boundary, not dead code**.
          Shrinking `runtimeAgentIdSchema`/`RUNTIME_AGENT_CATALOG` to nklein-only is a broad contract + web-ui +
          CLI change (summary.agentId, catalog UI, `task.ts`/`dev.ts`) flagged by AGENTS.md as needing UI verification.
          Do together with the full host-worktree *module* deletion (plan.md §2.B), once migrated-board cleanup is
          re-homed off the agent-id boundary.
  - [~] **Increment 4 — live verification pass**
    - [x] **strict-isolation on a real task** — `scripts/verify-strict-isolation.mts` (isolated HOME, live LM Studio
          `qwen/qwen3-8b`, real Docker sandbox) **PASS (2026-06-23)**: sandbox container `nklein-agent-sandbox-1`
          appeared, session advanced, **no host worktree** under `~/.nklein/nklein/worktrees`, containers cleaned up.
    - [x] **runtime boot-smoke** after the session-manager refactor — fresh `tsx src/cli.ts` on an isolated HOME boots
          clean (HTTP 200), no errors from the deleted modules.
    - [x] updated the AGENTS.md worktree tribal-knowledge to reflect C7c/C7d (creation + agent launcher deleted;
          shell decoupled; legacy cleanup + `usesLegacyHostTaskWorkspace` are live-not-dead). *(Not a full "retired"
          flip — the worktree modules survive for legacy cleanup; that's plan.md §2.B.)*
    - [ ] Playwright UI pass (review lane diff/verify/merge; shell-on-task opens a container shell; project-health no
          false worktree warnings) — needs a non-disruptive isolated UI session.
  - [x] **✅ MILESTONE (2026-06-23):** no live nklein flow creates or reads a host worktree — every path runs off the
        `nklein/tasks/<task>` result branch / Docker sandbox; only legacy on-disk *cleanup* survives (for users
        upgrading from worktree builds).
  - **HARDEN — agents must never see host paths** *(raised 2026-06-23; from a real decompose evidence bundle; umbrella —
        the granular work is the children below)*. A dev-test **decompose** run leaked the host workspace path to the
        agent: its first reasoning + `read_files` input used `/private/var/folders/.../T/nklein-…/specification.md` (the
        host mount), not the sandbox path. Root: the agent's cwd/working-directory context is the host path, and surfaces
        (the `read_files` block error, evidence `summary.md`/`config-snapshot.json`) echo it. (`read_large_file`'s own
        result already returns the relative path.) Per the new AGENTS.md "agents must never see host details" rule:
    - [x] **agent cwd → sandbox path (DONE 2026-06-24).** `nklein-session-runtime` now hands the agent-core
          `config.cwd = buildAgentSandboxWorkdir(taskId)` (`/workspaces/<taskId>`) for sandboxed task sessions
          (home/chat sessions keep the host cwd) — so the "working directory" the model is told is the sandbox path,
          never the host mount. **Live strict-isolation PASS** with the change (core accepts the sandbox cwd, tools
          execute, container appears, clean teardown) + unit test asserting both branches.
    - [x] **system-prompt `<env>` working-directory → sandbox path (DONE 2026-06-24; the PRIMARY leak).** The cwd fix
          above was necessary but **not sufficient**: the SDK system prompt embeds an `<env>` block with a
          "Working Directory: <cwd>" line (`getNKleinDefaultSystemPrompt`, **every** provider), and the service built
          it from the **host** `request.cwd`. So a sandboxed agent read its own system prompt, saw the host mount path,
          and issued `read_files`/`list_files` against host absolute paths. Found by a new **live decompose harness**
          ([scripts/verify-decompose-isolation.mts](scripts/verify-decompose-isolation.mts)) — not by unit tests/code
          reading. Fix: both the agent-core `config.cwd` AND the system-prompt cwd now derive from one shared
          `resolveNKleinAgentPerceivedCwd(taskId, hostCwd)` ([src/nklein-agent/nklein-agent-sandbox.ts](src/nklein-agent/nklein-agent-sandbox.ts))
          so they can never drift again. **Live decompose PASS** (real LM Studio task, decompose_project called, zero
          host-path leaks in agent output, clean teardown) + regression test that builds the real SDK system prompt and
          asserts it carries the sandbox workdir, never the host mount.
    - [x] read_files block error: **resolved transitively** — it echoes the agent's *requested* path
          (`readRequest.path`), and with the cwd fix the agent now requests sandbox/relative paths, so no host path
          leaks there. Evidence `summary.md`/`config-snapshot.json` keep the host workspace path **on purpose** (it's
          host-side: the user needs it to locate the bundle's workspace) — not an agent-facing leak.
    - [x] **`decompose_project` tool result no longer leaks host paths to the agent (DONE 2026-06-24).** The result
          is agent-facing but returned absolute host `*Path` fields (`specPath`/`planPath`/…/`taskGraphPath`), a
          `--project-path <host>` CLI hint, and could interpolate a host path from an apply-error message into the
          `instruction`. Now: the `*Path` fields are **workspace-relative** (`toWorkspaceRelativeArtifactPath`), the
          `--project-path` arg is dropped, and `applied.message` is run through `redactWorkspacePathForAgent` before it
          enters the instruction. Host-side consumers (runtime-api / CLI / evidence) read absolute paths straight from
          the plan-artifact writer — unchanged. Regression test asserts no `*Path`/instruction contains the host
          workspace path. ([src/nklein-agent/nklein-decomposition-tool.ts](src/nklein-agent/nklein-decomposition-tool.ts))
    - [x] **confirmed on a real decompose run that the agent emits only sandbox/relative paths (DONE 2026-06-24)** —
          `scripts/verify-decompose-isolation.mts` runs a real LM Studio decompose in a Docker sandbox and captures
          every agent-emitted activity (reasoning text, tool-input summaries, final message), asserting none contains
          the host project path. PASS after the system-prompt fix (it FAILED before — caught the primary leak).
    - [x] **dev-test projects run through the same Docker sandbox isolation as real tasks** — verified via the live
          harness above: it exercises the **same** `NKleinTaskSessionService.startTaskSession` path dev-test scenarios
          use (sandbox prep + sandbox-proxied tools + sandbox cwd), and the agent saw only `/workspaces/<taskId>`. A
          formal `nklein dev test-project` decompose can fold into the broader Playwright/dev-test pass, but the
          isolation mechanism is now proven on the shared code path.
    - [ ] workspace-relative display wherever a host path would surface to the user/agent (evidence summaries too).
    - *(scope note, not a work item)* only exception: user intentionally opted out of Docker isolation (future
        full-privileged host-agent mode).
- [x] **Repo-map orientation restored under isolation (DONE 2026-06-24)** *(found while fixing the system-prompt leak;
      functionality regression, NOT a leak)*. The context-focus extension built the repo map + git-changes from
      `request.cwd`, which under isolation is the **sandbox** path `/workspaces/<taskId>` — nonexistent on the host — so
      `buildNKleinRepoMap` read nothing and the agent got **no orientation rail** (silently empty) on every isolated
      task. Fix: `createKanbanContextFocusExtension` now takes a separate `orientationWorkspacePath` (the host
      `workspaceRoot`, via `artifactWorkspacePath`) for the host-side *control-plane* orientation reads (repo map +
      `getWorkspaceChanges`), which render **relative** paths only — no host-path leak. The large-file workflow keeps
      the sandbox cwd (it's already inert under isolation — the agent's real `read_large_file` is the sandbox-proxied
      tool — so no behavior change there), and the agent-perceived `config.cwd`/system-prompt stay the sandbox path via
      `resolveNKleinAgentPerceivedCwd`. **Design default taken:** the host workspaceRoot reflects the live project, not
      the sandbox `baseRef` checkout — acceptable for codebase orientation. **Live-verified**: `verify-decompose-isolation.mts`
      now shows the repo-map rail injected (154–156 chars of symbols from a 2-file fixture) AND still zero host-path leaks.
- [~] **UI live-verification debts** *(actionable — Docker + browser + LM Studio available this session).* The
      headless path is verified (`scripts/verify-strict-isolation.mts` ran a real NKlein task in a shared Docker
      sandbox against LM Studio, no host worktree, clean teardown, fail-closed on missing image, clean
      telemetry).
  - [x] **Settings render + isolation status verified live (2026-06-24)** via a new headless-Playwright harness
        [scripts/verify-settings-ui.mts](scripts/verify-settings-ui.mts) (drives the running dev app, dismisses the
        first-run dialog, opens Settings): **Agent isolation** status renders (Docker sandbox ready, daemon
        Available, image `nklein/agent-sandbox:0.0.1`), Developer Mode toggle + "Local !Klein agent (cloud disabled)"
        show, and this session's editors render — the **swarm-guardrails** number inputs + Reset, **Parallel
        requests** concurrency field, and the **Python core** health line — with **zero console/page errors**.
        Screenshot evidence at `/tmp/nklein-settings-ui.png`.
  - [ ] **Still owed (needs a loaded project + live models/tasks):** pool-control inspection with a real pool +
        queue, model-registry prune with entries, live loaded-model line, embedding auto-discovery; and the swarm
        concurrency cap + sandbox-pool queue composing visibly in the card/header UI during a run.
- [~] **Isolation polish.** UX for paused / queued / sandbox-unavailable card states + an isolation empty state;
      consider extracting sandbox-lifecycle/pause out of the large
      [src/nklein-agent/nklein-task-session-service.ts](src/nklein-agent/nklein-task-session-service.ts); reconcile
      docs so the planning ("L3") story isn't overstated.
  - [x] **queued state surfaced** (the swarm-header "Queued N" list, above) and **sandbox-unavailable surfaced**
        (2026-06-24): the swarm header shows a red **"Sandbox unavailable"** chip (with the daemon/image failure
        message as its title) whenever `agentSandboxStatus.state === "blocked"`, so the operator sees that
        fail-closed isolation will stop tasks from starting. web-tested.
  - [x] **empty-board getting-started banner (2026-06-24)** — when a project is loaded but the board has no cards
        (across all non-trash lanes), a banner below the swarm header invites "create your first task" with a CTA, and
        surfaces an **"Isolation unavailable"** marker (with the daemon/image failure message) when the Docker sandbox
        is `blocked`, so a new/empty board explains itself instead of showing six blank columns. Web-tested (renders +
        CTA fires + hidden once any card exists).
  - [ ] still TODO: paused-card polish, and the session-service sandbox-lifecycle extraction (overlaps the §5.U
        decompose finding — coupled, needs the careful pass).
- [~] **UI re-checks to fold into the verification session above:** confirm the decomposition DAG dry-run
      preview still renders; confirm plain-language park reasons display; run a fresh-config local dogfood day on
      the in-use model and assert the telemetry diff shows zero insufficient-balance / 1s-timeout / >1M-overflow /
      provider-error events. *(AGENTS.md worktree tribal-knowledge is already reconciled to the
      container-primary + result-branch model.)*
  - [x] **DAG dry-run preview + plain-language park reasons render-checks (2026-06-24)** — both are already
        regression-locked by `card-detail-view.test.tsx` ("shows a planning DAG review panel for linked Planning
        cards" asserts the "Plan DAG" preview renders; the lost-session / warning tests assert the human-readable
        `warningMessage` park reason displays). No new work owed for these two.
  - [ ] still owed: the fresh-config dogfood telemetry-diff day (needs a real multi-card run on the in-use model).

### 5.B — Decomposition quality & the knowledge-expansion loop
> **PRIORITY PIVOT (2026-06-24, user):** *"postpone the work on monoliths until later and continue with making !Klein
> actually work."* §5.U (monolith decomposition) is parked mid-flight (lots already landed — task.ts −20%, runtime-api
> −17%, provider-service −13%, card-detail-view −55%, project-navigation-panel −47%, all green + committed). Focus now:
> fix the **weird errors/behaviours in planning**, and the new **decompose-graph visualization** below.
- [x] **Decompose no longer loops on an implementation card whose prompt mentions tests** *(DONE 2026-06-24, from a real
      DAW-foundation decompose evidence bundle)* — `assessNKleinPlanTaskGraphQuality` classified test/docs cards from the
      *whole prompt body*, so "Implement TempoMap class … ensure compatibility with timebase.test.js" (touching
      `src/timebase.ts`) was flagged a **test card** with an impossible "must depend on an implementation card" violation
      → the decomposer re-submitted against the contradiction until it stalled ("why did processing stall?"). Fix: classify
      test/docs by **title + touched-files** (the card's identity), not the prompt body. Regression-tested
      ([nklein-decomposition-graph-quality.test.ts](test/runtime/nklein-agent/nklein-decomposition-graph-quality.test.ts)).
- [x] **Render the decompose graph visually in chat (incl. on validation errors)** *(DONE 2026-06-24, user)* — the
      `decompose_project` tool message now renders the proposed task-graph DAG inline (nodes = cards, edges = `dependsOn`,
      layered by longest-path depth) via `detail-panels/decomposition-graph-view.tsx`, wired into `ToolMessageBlock`
      (auto-expanded; renders for failed graphs too with a red "failed validation" header). Self-contained layered SVG, no
      graph lib; tolerant of malformed JSON / cycles / unknown-or-self dependency ids. Unit-tested (4 cases) +
      `web typecheck` + `web vitest` (694) green. *(Still owed: a live in-chat screenshot from a real decompose run.)*
- [x] **(follow-up) loop-resilience for decompose validation failures** *(DONE 2026-06-25)* — even with correct
      classification, a genuinely invalid graph re-submitted with slightly-varied inputs slips past the full-input
      repeated-call guard. Extended the existing repeated-failure-target guard (`enforceRepeatedFailureTargetGuard`) to also
      fingerprint `decompose_project` failures by the tool, so 4 consecutive graph-validation failures **park** the task
      (`awaiting_review`, guardrail `repeated_decomposition_failures`) with a message pointing at the proposed graph +
      validation errors. Regression-tested (varied-input failures still park).
- **Planning/refinement lane for *every* card before In Progress** *(raised 2026-06-24, from the start-lane fix; umbrella
      — Increments A+B are `[x]`; Increment C is code-done but its **live-verify is still pending** (folded into the §5.V
      Suite 10 sweep), so this feature is NOT yet fully `[x]` — it flips when C's live-verify lands)* — the user's
      workflow idea: **all** started cards should pass through **Planning** first
      (rename the lane in spirit to "**Planning / Refinement**"), not just decompose/plan-mode cards. In that phase the
      agent **re-validates the
      card against the latest overall project state** before doing the work — a planning card spawns/updates child
      cards as today; a *work* card gets a quick refinement pass ("do the original idea + acceptance still hold given
      everything merged since?") and only then transitions itself to In Progress. **Goal: never work an out-of-date
      plan.** *(Today's start-lane fix moves a started card to Planning OR In-Progress by its `startInPlanMode`; this
      makes it always-Planning-first + adds the refinement step + the agent-driven Planning→In-Progress transition —
      a real workflow feature: a refinement prompt/seam, a lane transition the agent triggers, and a no-progress/skip
      guard so trivially-still-valid cards don't burn turns.)* **Refinement weight is DYNAMIC (decided with the user
      2026-06-24): the agent picks how heavy to go — from a lightweight "does the card's content/acceptance still
      hold?" confirmation, up to deep re-reasoning + rewriting the card and even **re-decomposing / replanning the task
      graph** when the project's direction or merged follow-ups have moved on. The point is to never work an outdated
      plan, so a large replanning is on-purpose when warranted, not avoided.** Build the seam so the agent can choose
      lightweight→XXXL per what the task + current project state need (and skip fast when nothing changed).
  - [x] **Increment A — the `begin_implementation` promotion tool (2026-06-25)** — new self-gating trusted control-plane
        tool ([nklein-promotion-tool.ts](src/nklein-agent/nklein-promotion-tool.ts)) that moves a card Planning→In Progress
        via `mutateWorkspaceState`. **Self-gates on the card's own `startInPlanMode`**: refuses a planning/decompose card
        (→ "call decompose_project") so a misbehaving model can't shove a planning card into Implementation, and so the
        resume path needs no flag threading; idempotent no-op when already In Progress; refuses terminal/missing. Wired
        through `nklein-session-runtime` (attached only when the service passes `onCardPromoted`, gated to non-home
        sessions at both start sites) and `runtime-server` (broadcasts the board on promotion). 6 unit tests green; tsc +
        biome green. **Dormant until Increment B** (routing still sends work cards straight to In Progress, so the tool is
        present but unused — the agent isn't yet prompted to call it).
  - [x] **Increment B — route every started card to Planning first + work-card refinement prompt (2026-06-25)** —
        DONE. Added a single `STARTED_CARD_ENTRY_LANE = "planning"` source of truth in
        [task-board-mutations.ts](src/core/task-board-mutations.ts) and routed **all three** start paths through it
        (the lane reconcile + `runtime-server` queued-start drain + auto-start-linked drain — the old per-site
        `startInPlanMode ? planning : in_progress` duplication is gone). The reconcile is now a source→target map:
        Backlog→Planning (refine first) and Review→In Progress (a resumed recovered review card), leaving Planning/In
        Progress/terminal untouched (never pull a resumed card backward; decompose children already in Planning stay to
        refine). Added `buildNKleinRefinementSystemPrompt` + threaded an `isRefinableWorkCard` flag (non-home, non-plan-
        mode) through `buildNKleinStartPromptParts` so a work card opens with the refinement preamble (re-validate →
        dynamic depth → `begin_implementation`/`decompose_project`). Updated the lane-reconcile + runtime-api + task-
        session-service tests + a new prompt-selection suite; full fast suite green (1506).
  - [x] **Increment C (hardening) — auto-promote recovery: CODE DONE (2026-06-25), live-verify pending (folded into the
        Suite 10 sweep below).** Extracted `promoteCardToImplementation({workspacePath, taskId, onPromoted, refinementNotes})
        → PromotionOutcome` from [nklein-promotion-tool.ts](src/nklein-agent/nklein-promotion-tool.ts) (the shared mutator +
        `onPromoted` broadcast; `begin_implementation`'s `execute` now just delegates + maps the outcome to its instruction
        string). Hooked it into the `requestToolApproval` wrapper's **catch-all** `if (approval.approved &&
        REPO_MAP_INVALIDATING_TOOL_NAMES.has(...))` block in [nklein-session-runtime.ts](src/nklein-agent/nklein-session-runtime.ts):
        when a work-card session (one with `request.onCardPromoted` wired) gets its **first** approved repo-mutating tool
        (write_file/write_files/edit_file/apply_patch/bash/…), it auto-promotes Planning→In Progress before the write runs.
        Best-effort + one-shot (`autoPromoteSettled` guard so we mutate the board at most once/session; a board-lock hiccup
        is swallowed so it never blocks the legitimate write), and idempotent (already-in-progress is a no-op, self-gates on
        `startInPlanMode` exactly like the explicit tool). **Seam wiring confirmed:** `requestToolApproval` IS provided for
        Docker-sandboxed work cards (passed at both `nklein-task-session-service` start sites via
        `runtimeSetup.createToolApproval(...)`), so the hook fires for real sandboxed tasks. Unit-tested:
        `promoteCardToImplementation` directly (promoted/already-implementing/planning-card/missing outcomes + `onPromoted`
        fires only on a move) **and** the tool still passes its 6 existing cases — `nklein-promotion-tool.test.ts` 10/10;
        full nklein-sdk runtime + lane-reconcile 722 green; root tsc + biome green.
    - [x] **LIVE-VERIFIED 2026-06-25 across the model sweep** (`scripts/verify-autopromote-recovery.mts` — seeds a work
          card in Planning, starts a REAL Docker-sandboxed session with `onCardPromoted` wired, polls the on-disk board
          until the card reaches In Progress, reports whether it advanced via `begin_implementation` or the auto-promote
          recovery). Sweep results:
          - **qwen/qwen3-8b** → PASS via the **RECOVERY path**: the model skipped `begin_implementation`, wrote the file
            directly, and the card auto-promoted Planning→In Progress (sandbox seen, `onCardPromoted` fired once from
            planning, zero host-path leaks, clean teardown). This is the exact Increment C scenario proven end-to-end.
          - **deepseek-r1-0528-qwen3-8b** → PASS via the **explicit path**: called `begin_implementation`, promoted once,
            reached In Progress — confirms the recovery seam is idempotent (no double-promote when the explicit tool fired).
          - **microsoft/phi-4-mini-reasoning** → did NOT write anything within 240s (stayed in Planning, no promotion).
            **Correct Increment C behavior** (it fires only when a mutating tool is actually approved — no false promotion),
            and a north-star capability-floor data point: this 3.8B reasoning model couldn't drive the sandboxed tool loop
            to a write here. *(Follow-up, NOT an Increment C defect: investigate whether phi narrates tool calls in an
            unrecovered format or just exhausts turns reasoning — track under the weak-model output-recovery theme.)*
          - deepseek stayed loaded through the whole sweep (no crash this run); the note+skip path is in the harness if it
            unloads next time.
- [x] **`decompose_project` malformed/empty-call recovery** — relax the boundary `inputSchema` (drop `required`,
      allow extra props) so `execute` always runs; in-handler validation returns a compact directive (names missing
      fields, "don't resend empty"); `repairJsonStringValue` recovers stringified/typo'd payloads; fuzz-tested.
      ([src/nklein-agent/nklein-decomposition-tool.ts](src/nklein-agent/nklein-decomposition-tool.ts))
- [x] **Open-question default auto-recovery (2026-06-24, real evidence)** — an `open` clarifying question with
      options but no `assumption`/`answer` used to throw "add an `assumption`"; weak models couldn't comply and
      re-sent the identical decompose call, looping until the guard paused the task. `deriveOpenQuestionDefaults`
      now auto-supplies a default from the question's `recommended` (else first) option so planning proceeds; the
      question stays `open` for later clarification (§5.S). Parse-and-recover, unit-tested.
- [x] **Knowledge-tool usage as a decomposition-quality signal** — backend correlator
      ([src/telemetry/knowledge-tool-decomposition-signal.ts](src/telemetry/knowledge-tool-decomposition-signal.ts))
      flags whether retrieval/code-index/architecture tools ran *before* a decomposition (anchored on
      `decomposition_applied`), rolled up per scope × role × model + surfaced in the "Decomposition Knowledge" stats
      section. Unit + read-path tested.
- **Audio dev-test rubric** — score the audio-VST fixture against a domain rubric (preset + harness shipped; this is the
      *scoring*; umbrella — the 4 scoring axes below are the counted work):
  - [ ] DSP correctness + measured phase alignment
  - [ ] groove invariants + effect-guardrail sweeps
  - [ ] full UI control coverage
  - [ ] prototype-vs-real-VST docs
- [~] **DETERMINISTIC REPAIR KERNEL for bugfix/regression cards + richer per-card contracts (2026-06-27, small-LLM
      research pass).** For bug/repair work, constrain the pipeline instead of giving the small model general agency:
      **`reproduce → localize → generate N patch candidates → validate → rank → refine`**.
      **ORCHESTRATION CORE DONE (2026-06-27):** [src/core/repair-kernel.ts](src/core/repair-kernel.ts) — pure
      `runRepairKernel(deps, config)` drives the phase-gated pipeline with every effectful step INJECTED
      (`reproduce`/`localize`/`generateCandidates`/`validate`), `rankCandidateValidations` (repro > regression > checks,
      then smaller diff), the refine-round loop, the `cannot_reproduce` short-circuit, and ALWAYS terminating with the
      best result (`fixed` / `no_candidate_passed` with the best partial / `no_candidate`). 6 unit tests. **Still owed
      (the WIRING):** real tools behind each step — AST/symbol/call-graph **localization** that cannot edit,
      spectrum-based fault localization when tests exist, the N-candidate **generator** as a narrow model subtask, the
      **validator** running repro+regression+typecheck/lint, and ledgering (§5.AF) the candidates/validator
      results/ranking rationale; plus the full rank inputs (touched-file plausibility × reviewer evidence × learned
      priors) the pure core leaves as injectable tiebreaks. Mechanics: a **reproduction
      test** is a first-class fail-before/pass-after artifact; **localization** uses AST/symbol/import/call-graph tools
      (plus spectrum-based fault localization when tests exist) and **cannot edit**; generate **N candidate patches**, not
      one; **rank** by repro-pass × regression-pass × typecheck/lint × diff-size × touched-file plausibility × reviewer
      evidence × learned priors. **Phase-gated tools:** localization can't mutate; the patching phase sees only the chosen
      context; validation sees the commands + structured failures. **Ledger (§5.AF)** the localization candidates, patch
      candidates, validator results, refinement deltas, and the final ranking rationale. The hard orchestration lives in
      the harness; the model only does narrow generative subtasks (the small-model thesis). **Enrich generated card
      specs** with `preconditions / inputs / expectedOutputs / acceptanceChecks / nonGoals / dependencyOutputsConsumed /
      rollbackOrRepairHints / downstreamInvalidationRules` so a card is executable node-locally, and add controller repair
      semantics (retry-node / refine-spec / split-node / add-dependency / invalidate-downstream / re-review /
      global-re-decompose-only-as-last-resort).

### 5.C — Run summaries & timeout diagnostics
- [x] **Timeout provenance + stats** — run summaries stamp `timeoutSource`
      (role_override/global_config/autonomous_default); `summarizeTimeoutOutcomes` groups timeout runs by
      provider × model × source × role × scenario (role inferred at capture; scenario from `devtest-<scenario>-<ts>`).
      Unit-tested. ([src/state/task-run-summary-store.ts](src/state/task-run-summary-store.ts))
- [~] **Real wiring for `runDevTestProject`** — side-effecting seams (`createDevTestStateReader`,
      `discoverDevTestCleanupEntries`) wired into `nklein dev test-project` + `dev cleanup-report`
      ([src/commands/dev.ts](src/commands/dev.ts)).
  - [x] **live-path verification (2026-06-24)** — ran against the live runtime (:4173) + Docker + LM Studio:
        `dev cleanup-report --json` correctly discovered + **sized** a real leftover dev-test workspace (468 KiB,
        one `dev_test_workspace` entry, retained 0 for the active run); `dev test-project --preset mid_task --json`
        ran the full **start → monitor → classify → JSON** path end-to-end (exit 0, `runtimeReachable: true`,
        emitted a classification). *(The seeded card didn't execute an agent because this runtime has no loaded
        project to seed into — the real agent-in-Docker run is covered by `scripts/verify-strict-isolation.mts`,
        which scaffolds its own isolated project. The command path + cleanup sizing are the parts this debt owed.)*

### 5.E — Cache-key hygiene & fuzz coverage ✅ COMPLETE → moved to [done.md](done.md#5e--cache-key-hygiene--fuzz-coverage)

### 5.F — Portable "project state in the repository" (cross-machine continuation)
> CRDT conflict model (automatic merge). Board CRDT + committed store + export/import with local-model re-resolution
> + save/load wiring are shipped (§6).
- [x] **Committed-state schema migration** — `readPortableBoardCrdt` → `migratePortableBoardCrdt` (forward-migration
      registry; refuses newer-than-known; a future bump = one registry entry).
      ([src/state/portable-board-crdt.ts](src/state/portable-board-crdt.ts))
- [x] **Decided scope (policy, keep):** repo-committed = board/CRDT, DAG, card progress, `knowledgeDebt`,
      decomposition (pretty-printed JSON); machine-local (never committed) = model registry/speeds, endpoints,
      sandbox/container state, telemetry, secrets, absolute paths, worktree/result-branch artifacts. No
      secrets/abs-paths committed; provenance survives a different checkout; roles/fit re-resolve on the target machine.
- [ ] **Verify the reconcile UX** — cross-machine fetch-and-continue end-to-end (Playwright).

### 5.G — Backlog (promote into a worked item when picked up)
- **Plug-and-play, batteries-included Docker delivery** — ship a self-contained image + a provided
      `docker-compose.yml`: copy compose → `docker compose up` → working !Klein, bundling runtime + built web-ui +
      Python core + ALL internal models (offline for everything !Klein-internal). Umbrella — the counted deliverables are
      the children below (incl. the acceptance check):
  - [ ] bake in all internal models — code-embedding GGUF (~84MB nomic-embed Q4_K_M), the ONNX/LLMLingua
        compression scorer, any Python-core helper model (no first-run downloads for !Klein's own models)
  - [ ] agent-work LLM stays user-provided + EXTERNAL (via `host.docker.internal`) — no bundled engine, no baked
        default model; preserves host GPU/Metal + free choice of model/quant/runtime
  - [ ] Docker-in-Docker — nested privileged daemon inside the compose (no host `docker.sock`); document it
  - [ ] two host mounts — (1) projects folder, (2) runtime-state folder (`~/.nklein`); both host-visible/persisted
  - [ ] expose runtime + web-ui ports; keep local-only/no-cloud defaults (sandboxes stay `--network none`)
  - [ ] acceptance: fresh machine + Docker → `docker compose up` (user sets endpoint + 2 mounts) → working board/
        decomposition/sandboxed parallel-exec/review-merge, zero internal-model downloads, state survives re-up
- [ ] **CI-able dogfood smoke** — scripted 1-shot → decomposition → parallel exec → merge on a tiny model, as a CI gate.
- [x] **Explicit in-UI sandbox queue list** *(DONE 2026-06-24)* — the Local-swarm header now shows a **Queued N**
      chip (when any task is in the sandbox pool's FIFO `queued` state) whose hover title lists the queued task
      titles in wait order. Previously only the per-card "queued" state existed. web tsc + biome + suite (700) green.
- [x] **Main-board role/agent visibility** *(DONE 2026-06-24)* — the Local-swarm header now shows a role strip:
      clickable **Architect / Worker / Reviewer** chips (only for roles with running work) that focus a running
      agent of that role on click. Reads the **persisted** `summary.role` (stamped at start, §5.U finding above) —
      no `startInPlanMode` inference. web-tested (chips render + click-to-focus calls onCardSelect); live render clean.
- [x] **Board-level merge-status history surface** *(2026-06-24)*.
  - [x] **durable store + recording (2026-06-24)** — added [merge-history-store.ts](src/state/merge-history-store.ts)
        (JSONL per workspace, `recordMergeHistory`/`readMergeHistory`/`buildMergeHistoryRecord`); the runtime-server
        auto-merge site now records each dependency-ordered merge pass (ok / mergedTaskIds / skippedTaskIds /
        conflictedPaths / reason), best-effort so it never blocks the merge. Unit-tested (build + round-trip).
  - [x] **tRPC read procedure + board-header surface (2026-06-24)** — `runtimeMergeHistoryRecord/ResponseSchema`
        in the contract, `getMergeHistory` handler (reads newest-first, limit 50) + procedure, `fetchMergeHistory`
        web-ui client, and a swarm-header merge chip in [kanban-board.tsx](web-ui/src/components/kanban-board.tsx)
        (green "Merged N" / red "Merge conflicts N" with a per-pass `title` tooltip), refreshed on project switch
        and whenever the running count changes. Board chip render-tested.
- [x] **Acceptance-failure classification taxonomy** — pure classifier
      ([src/core/acceptance-failure-taxonomy.ts](src/core/acceptance-failure-taxonomy.ts)) (command-not-found,
      missing-script/dep, type/lint/compile error, test-failure, timeout, unknown) with label + next-step hint,
      wired onto the gate result + rendered on the card's Verify result. Tested.

### 5.H — Polyglot / native-agent-core workstream *(active)*
> Direction: !Klein grows its own capabilities — a local-only Python core sidecar (`core-py/`, FastAPI) + a
> TS-native agent core (`src/agent-core/`). Shipped: §6.10. Engineering reality (2026-06-22): both "default-now"
> decisions are prerequisites, not flag-flips — native-core isn't imported by any runtime/session code yet, and
> python-core default-on is worse than opt-in until the sidecar is bundled + auto-started.
>
> **DEFAULTS PREREQS — resolved + scope-flagged (2026-06-25).** User: "build the prereqs now, then flip." Investigation
> (recorded in [.plan/autonomous-decisions.md](.plan/autonomous-decisions.md)) found the two halves are very different:
> - **core-py default-on = DONE 2026-06-25.** `resolveKleinCorePyConfig` already defaults **ON** (opt-out via
>   `NKLEIN_CORE_PY=0`; the old "opt-in/default-OFF" doc comment was stale — fixed). The missing half was **auto-start**:
>   the runtime now launches the sidecar on boot via the new [klein-core-sidecar.ts](src/server/klein-core-sidecar.ts)
>   (`startKleinCorePySidecar`, wired in `cli.ts` fire-and-forget + stopped in `close`), so the default actually delivers.
>   **Non-fatal** (missing `uv`/core-py / unhealthy → null → in-process fallback; never blocks boot). Verified: 6 unit
>   tests + live boot (sidecar came up on :3585, runtime un-blocked) + the integration test still green & hermetic
>   (`NKLEIN_CORE_PY=0` set in the test backend spawner). *(Still owed — the "bundle" half: ship a Python env so it
>   auto-starts in a packaged install, not just dev where `<repo>/core-py` + `uv` exist. Today it no-ops gracefully when
>   core-py isn't on disk.)*
> - **native-core default = a FULL native agent runtime build**, not a small integration: `src/agent-core/` is a 285-line
>   skeleton (`runAgentLoop`/`DecideAction` types) with **zero runtime imports**; making it the default means replacing
>   the whole `@nkleinbot` SDK host (tool dispatch, streaming, hooks, context compaction, session persistence). That is
>   huge AND likely throwaway right before a possible Python backend port. **→ HOLD the native-core-default flip pending
>   the §5.X port-direction decision. ✅ CONFIRMED BY THE USER (2026-06-27 clarification): HOLD — do not build the TS
>   native runtime now (likely throwaway under the Python port, which bridges/ports the agent SDK last); keep the
>   `@nkleinbot` SDK host; build the native runtime in whichever language wins. native-core-default NOT started.**
- [x] **Embedding story decided + shipped** — `local_gguf` (nomic-embed-text-v1.5) in-process via the Python core,
      default in `runtimeCodeEmbeddingProviderSchema`, degrading to `local_lexical` when the core is off. (→ §5.I #1)
- **Promote the native agent core to DEFAULT runtime** (SDK host = automatic fallback) *(decided 2026-06-22; umbrella —
      the children are the counted work, all three HELD per the §5.H callout: native-core-default is a full agent-runtime
      build that's "huge AND likely throwaway right before a possible Python backend port", so it's held pending the §5.X
      port-direction decision. That decision is **still pending** — §5.X (line 2377) is "plan now, build after §5.V; final
      port scope decided once §5.V is green", i.e. the port is NOT dropped — so the hold stands and the children below are
      `[>]` blocked-on-task until §5.V lands + the port scope is called.)*:
  - [>] build the native-core → task-execution integration (sandboxed tools, session lifecycle) — the missing prereq *(gated on the §5.X port-direction decision — see the §5.H callout)*
  - [>] switch default selection; keep the SDK reachable on failure *(gated on the §5.X port-direction decision)*
  - [>] assert strict isolation still holds for native-core data-plane tools (thorough tests + clean fallback) *(gated on the §5.X port-direction decision)*
- **Python core default-ON + Settings health** *(decided 2026-06-22; umbrella — the counted work is the children.
      Default-on + auto-start + the Settings health line are DONE (2026-06-25, see the §5.H callout); only the "bundle"
      half — ship a packaged Python env so it auto-starts in an installed build — remains open.)*:
  - [ ] bundle/package the `core-py` sidecar so auto-start is reliable in a packaged install (today it no-ops gracefully when `core-py`/`uv` aren't on disk)
  - [x] **auto-start on launch (2026-06-25)** — keep auto-fallback when unreachable. Runtime launches the sidecar on boot via [klein-core-sidecar.ts](src/server/klein-core-sidecar.ts) (`startKleinCorePySidecar`, wired in `cli.ts` fire-and-forget, stopped in `close`); non-fatal (missing `uv`/core-py / unhealthy → in-process fallback, never blocks boot). Verified: 6 unit tests + live boot (sidecar on :3585, runtime un-blocked). (See the §5.H callout.)
  - [x] **Settings health line (2026-06-24)** — `KleinCorePyHealthLine` under the !Klein model panel: enabled state,
        a live `GET /health` probe (running / not-reachable), the endpoint, and a hint to set `NKLEIN_CORE_PY=1` when
        disabled. (Shipped earlier this session; CHANGELOG'd.)
    - [x] **running + endpoint/port (2026-06-24)** — `getKleinCorePyHealth` tRPC query (config `enabled` + live
          `probeKleinCorePyHealth`) feeds a self-contained `KleinCorePyHealthLine` rendered under the Settings model
          panel: Running / Not reachable / Disabled + endpoint, with an `NKLEIN_CORE_PY=1` hint. Component unit-tested.
    - [ ] model-loaded detail (needs the core `/health` to report the resident model)

### 5.I — Newly raised in chat (2026-06-22)
- [x] **#1 — Built-in llama.cpp code-embedding model (auto-download, in-process)** — Python core embeds an in-process
      quantized GGUF (`embedding=True`) on `/v1/embed`; host-side download manager streams it with progress +
      integrity check; `local_gguf` provider lazily ensures + degrades to `local_lexical`; default in the schema
      (dense active only when the core is on); Code-intelligence panel shows status.
      ([src/nklein-agent/nklein-code-embeddings.ts](src/nklein-agent/nklein-code-embeddings.ts),
      [src/nklein-agent/nklein-embedding-model-manager.ts](src/nklein-agent/nklein-embedding-model-manager.ts))
  - [x] in-panel override = "Configure embedding model" link → Project Settings (single source of truth)
  - [x] host-side idle-unload timer (frees the resident model after ~2 min idle)
  - [x] verified `sha256` in `DEFAULT_EMBEDDING_MODEL_MANIFEST` (download integrity check now runs)
- [~] **#2 — Benchmark the baked-in embedder + decide on two-layer retrieval** *(ties §5.G)*:
  - [x] **measured throughput/latency** (2026-06-23, `scripts/embed-bench.mts`; nomic-embed-text-v1.5 **Q4_K_M** =
        the manifest model, via LM Studio **Metal/GPU**, 500 real code chunks avg ~1.3k chars): **~20 texts/sec**,
        per-text **p50 48ms / p95 75ms**; **batching gives no speedup** (batch 16/64 ≈ same ~19–20/sec). Lexical
        baseline (in-process sparse tokens) = **~8,400 texts/sec (~420× faster)**. ⇒ a full cold dense index is the
        bottleneck (~1k chunks ≈ 50s; ~20k ≈ 17min); incremental re-embed of a few changed files is sub-second.
        **NB:** this is the **GPU upper bound** — the in-image **CPU-only** path will be slower, widening the gap.
  - [ ] still TODO: in-image **CPU-only** cold-load + index-build numbers (no Metal); recall@k for lexical-only vs
        dense-only vs **lexical→dense rerank** — does dense pay its way on retrieval *quality*?
  - [x] user-hosted `openai_compatible` fast path **confirmed supported** (GPU box / LM Studio / Ollama; configurable
        global + per-project; degrades to lexical when absent) — `createNKleinCodeEmbeddingProviderFromSettings`.
  - [ ] **decision (leaning, from the numbers):** keep **lexical as the instant always-on layer**; make dense
        **layer-2 opt-in / background** (auto-on when a user GPU endpoint is connected; for the baked-in CPU GGUF,
        build the dense index lazily in the background instead of blocking first use) — 420× cost can't be paid up front.
- [x] **#3 — Per-project overrides moved out of Global Settings** — a Project Settings dialog (from the project "⋯"
      menu) hosts the per-project code-embedding override via `save({ codeEmbeddingOverride })` (scoped partial
      merge); shared embedding form extracted; override removed from the global dialog (global = defaults only).
      ([web-ui/src/components/project-settings-dialog.tsx](web-ui/src/components/project-settings-dialog.tsx),
      [web-ui/src/components/code-embedding-fields.tsx](web-ui/src/components/code-embedding-fields.tsx))
- **#4 — Multiple models per role + per-task best-fit selection** *(deep design; not a quick win; umbrella — the 5
      sub-deliverables below are the counted work)*. **→ EXPANDED into [§5.AB](#5ab) (2026-06-26, user)** — the richer
      model-evaluation + automatic role→model assignment + parallel-balancing + retry-against-all-models crown; the 5
      sub-deliverables here (difficulty estimate, MCSR metrics, one-to-many config, user override, inspectable reasoning)
      are its inputs. Today each role binds one model. *Decided 2026-06-22:* estimate task difficulty → match to MCSR
      capability/speed, capability-weighted (most-capable free model that fits the ≥32k budget; speed tiebreaker; easy
      cards take the fast/small model); user can pin/prefer/weight per role.
  - [ ] task-difficulty estimate (objective text, expected file/context footprint, acceptance shape, bounce history)
  - [ ] per-model metrics from MCSR (§6.4) — extend if missing, don't duplicate
  - [ ] one-to-many role→model config + free-vs-busy assignment in the swarm executor (§6.5)
  - [ ] user override (pin / preference order / speed-vs-capability weight) per role
  - [ ] inspectable selection reasoning (why this model for this task)
- [~] **#5 — Universal hover tooltips (name + short description for every element)** — via the `ELEMENT_TOOLTIPS`
      registry + `ElementTooltip` primitive (§6.13); single source of truth; focus-accessible.
  - [x] high-value icon-only controls: top-bar, board-column, board-card, card-detail, swarm cockpit, git-history
        "Discard", terminal "Close"
  - [x] **§5.M chat surface (2026-06-24)** — the icon-only chat controls now use the registry: `top-bar.chat` (the
        navbar Chat button, switched from a plain `Tooltip` to `ElementTooltip`) + `chat.delete-session` (the
        per-session delete). Web tsc + full web vitest (705) green; chat-UI Playwright re-verified.
  - [x] **project sidebar (2026-06-25):** the per-project actions menu trigger (`project.actions`, every ProjectRow's
        Ellipsis — wrapped via `ElementTooltip` outside the `DropdownMenu.Trigger asChild`, valid Radix Slot-chain) and the
        mobile collapse button (`project.collapse-sidebar`). web tsc + vitest (694) green.
  - [ ] remaining tail: settings section headers/fields, model-registry row actions

### 5.K — Second-opinion reviewer workflow ✅ COMPLETE → moved to [done.md](done.md#5k--second-opinion-reviewer-workflow--complete-raised-2026-06-22)

### 5.L — Per-role capability rulesets + agent web/browser access *(active; raised + decided 2026-06-22)*
> **Goal:** unleash the swarm with real capabilities (incl. web/browser) governed by per-role rulesets. **Hard
> invariants (never relax):** Docker isolation mandatory + fail-closed (#2 — never run on host; cap-drop ALL,
> no-new-privileges, ro rootfs, ro project mounts); cloud-LLM lockdown absolute (#1 — "open" = web/data egress +
> tools, NEVER a cloud model); ≥32k floor.
- [~] **Two parallel 5-tier dials, per-role overridable, default `fully_open`**
  > capability: strict → less_strict → medium → more_open → fully_open (all in-sandbox). delivery (separate dial):
  > strict → less_strict → medium → more_open → fully_open; **self-merge ALLOWED on green gates** (decided 2026-06-23,
  > adaptable global/per-project/per-card). granularity: one global preset + per-role override for both dials.
  - [x] pure core (`src/core/agent-rulesets.ts`) — both tier enums + capability/delivery matrices + resolvers; tested
  - [x] schema + config — `agentRulesetsConfigSchema`; loads/preserves in `runtime-config.ts` (default fully_open)
  - [x] sandbox network activation (VERIFIED LIVE) — tier → `--network` (none/bridge), allowlist fail-closed, under
        `--cap-drop ALL --read-only --security-opt no-new-privileges`
  - [~] tool gating — `resolveAgentToolAccess` built + tested; **remaining:** thread into `nklein-session-runtime`
        (web-research enable), a sandbox-side headless-browser tool, MCP gating
  - [~] delivery gate — `decideDeliveryAction` wired into `finalizeHeadlessAutoReviewTask` (review + tests +
        protected-path gates; default `fully_open` → merge incl. self-merge; protected-path change holds);
        **remaining:** auto-perform commit/open_pr, a measured regression delta, per-project + per-card overrides
  - [ ] per-role network override (needs policy-keyed pools — a pooled container's `--network` is fixed at creation;
        allowlist needs a real egress proxy)
  - [x] **Settings UI + write-path (DONE 2026-06-24)** — surfaced `agentRulesets` in the config response
        (`buildRuntimeConfigResponse`, the missing read-path half) and added a self-contained
        [AgentRulesetsSettingsPanel](web-ui/src/components/agent-rulesets-settings-panel.tsx): both dials
        (Capability + Delivery autonomy) with a global preset picker + per-role override selects (architect/worker/
        reviewer, "Use global" clears), tier copy sourced from the contract's `AGENT_*_TIER_INFO`. Wired into the
        General settings section; the dialog already tracked `agentRulesets` state + threaded it through the save
        path (`updateRuntimeConfig`/`updateGlobalRuntimeConfig`). Component-tested (render + change + add/clear
        override) + dialog suite (35) green; live Playwright Settings render clean.
- [ ] **PROVENANCE/TAINT + a real EGRESS broker — assume prompt injection SUCCEEDS, protect the sinks (2026-06-27,
      small-LLM research pass).** Once online
      retrieval (§5.AC), the browser (§5.M G6), and MCP are live, model-facing content is untrusted. Add a **capability
      broker** between the model and every tool that decides `allow | deny | one-time-confirm | require-fresh-trusted-plan`
      from `{ effective ruleset, role, source provenance, tool trust, current taint labels, requested action, target
      path/domain/server, is-sink? }`. **Taint labels** (`repo_instruction / web / mcp / private_repo / secret_like /
      user_trusted / runtime_policy`) with the rule: **repo/web/MCP content can guide STYLE but never modify
      capabilities, approvals, network, secrets, git-delivery, or host access without a trusted plan + confirmation**
      (remote MCP annotations are hints, not trust). **Egress broker:** DNS/SNI/domain allowlist, deny IP-literals + LAN
      by default, network-attempt audit, per-action approvals. **Audit task-agent actions too** (sandbox bash, file
      r/w, patch capture/apply, MCP calls, egress attempts, protected-path denials, approvals — not just chat host
      actions). Folds into the §5.AF tool-capability manifest + the resolved §5.Y posture; harden tier (rootless Docker /
      seccomp / pinned digest) is a later option.

### 5.M — Unified agentic coding chat + private messenger bridge *(raised + decided 2026-06-22/23)*
> **Goal:** a board-independent strong coding agent (Claude/Codex/Cline-class) on small local models via good memory
> management, reachable privately from the user's phone, touching the host only under explicit auth. **Decided:**
> ONE unified agent (the kanban agent folds in as a selectable scope/role — no separate UI), sessions configured by
> selectable use-case presets (scope × role); messenger = Signal first (signal-cli linked device), WhatsApp later,
> transport-agnostic bridge, one session per thread; reuse the NKlein agent core + tools. **Invariant:** the
> autonomous swarm stays Docker-isolated/no-host (#2) unchanged; host access is chat-only, never default, always
> typed-confirmed + logged; cloud lockdown (#1) + ≥32k floor everywhere. **Presets:** base = coding + board ops;
> scopes = project-sandboxed (default) / all-loaded-projects / host-access (typed-confirm); roles =
> planner-architect, reviewer (§5.K), debugger, researcher (§5.L tiers), system-operator (host persona).

> **⭐ CAPABILITY-COVERAGE AUDIT (2026-06-25, user: "agents running commands, test if things execute at runtime, and
> focus_chain etc — make sure we cover everything properly").** Audited the chat agent's real capability surface and
> found two agents with very different coverage — this is the gap to close so the **right-sidebar** agent is genuinely
> "Cline but stronger":
> | Capability | CLI agent (`nklein chat --workspace`) | Web-UI right-sidebar (`chat.sendMessage`/`streamMessage`) |
> |---|---|---|
> | turn loop | **tool-using** (`runChatAgentTurn` + gated executor) | **plain completion** (`runChatTurn`) — **NO TOOLS** ⚠️ |
> | read_file / list_dir | ✅ | ❌ |
> | write_file (confirm-gated) | ✅ (`--allow-write`) | ❌ |
> | get_board (board awareness) | ✅ (2026-06-25, this pass) | ❌ |
> | **run_command / execute at runtime** | ❌ **(nobody has it)** | ❌ |
> | board mutations (create/start card) | ❌ | ❌ |
> | focus chain (§5.N) | ❌ | ❌ |
> | browser (§5.L) / knowledge-fetch (§5.B) | ❌ | ❌ |
> The **execution-mode gate** (`chat-execution-mode.ts`) + the **audit log** already exist and are sound — the work is
> wiring the capabilities through them. **Prioritized gap checklist (build incrementally, live-verify execution):**
>   - [x] **G1 — `get_board` board-awareness tool (read-only, 2026-06-25)** — [chat-board-tools.ts](src/chat/chat-board-tools.ts)
>         (`sandbox_read`, path-free summary, injected loader, 6 unit tests); wired into the CLI agent. The read half of
>         "use the project/card/task structure".
>   - [x] **G2 — `run_command` execution tool (2026-06-25) — the user's #1: "test if things execute at runtime".**
>         [chat-command-tool.ts](src/chat/chat-command-tool.ts): a `host_command` tool that runs a shell command in the
>         workspace (shell spawn, wall-clock timeout, output capped so it can't blow context) and returns exit code +
>         stdout + stderr. Gated by the §5.M invariant — **denied** in the default `isolated_readonly`, **confirm + audit**
>         in host-capable modes (never silent). Wired into the CLI agent behind **`--allow-commands`** (which elevates to
>         `sandbox_with_host_escape` and confirm-prompts each run). 7 unit tests (injected runner). **LIVE-VERIFIED**
>         (`scripts/verify-chat-command-exec.mts`, qwen3-8b): the agent ran `cat MARKER.txt` and its reply echoed the
>         marker — only possible if the command genuinely executed and its output flowed back. Runtime execution proven,
>         not just mocked.
>   - [~] **G3 — wire the TOOL-USING loop into the web-ui right-sidebar agent.** ✅ **G3a backend (merged)** + ✅ **Wave-2b
>         scope-driven resolver (2026-06-25, solo):** `buildChatAgentToolDepsResolver` (runtime-api) now maps the session
>         **scope → execution mode + tool set** — chat_only→`isolated_readonly` (read-only floor), current/all→
>         `sandbox_with_host_escape`, host→`host`; every session gets read tools + `get_board` + **`update_focus_chain`**
>         (G4, always), and **can-act scopes also get `create_card`** (G5, gated `control_plane`); `readFocusChain` threads
>         into the turn. Contract 77/77 (Suite 5 unaffected — its sessions have no active workspace → plain path). **STILL
>         TODO (wave-2b cont.):** ✅ **scope selector UI DONE (2026-06-25)** — `Chat only · Current · All · ⚠️ Host`
>         in the chat session header (`chat-sidebar.tsx`), wired to `updateSession({scope})`, + a tooltip + a 5-test
>         Playwright spec (`web-ui/tests/chat-scope.spec.ts`); host shown with ⚠️ + a `TODO(§5.M)` to gate it on a future
>         global setting + typed confirmation (no such setting exists yet). Verified: web typecheck + web vitest (694) +
>         Playwright 5/5. **Remaining:** the **G3b risk-ack confirm UI** (to safely offer `run_command` in the web-ui —
>         held until the confirm dialog exists), and the **G6 browser on/off toggle** wiring. Original gap context:
>         (`chat-service.sendMessage`/`streamMessage` once called the plain `runChatTurn`) — the biggest gap: the agent the user actually means couldn't call ANY
>         tool today. Route it through `runChatAgentTurn` + the gated executor + the session's scope/mode. **DIRECTION
>         (2026-06-25, user answers — DECISIONS):**
>         - **Scope-DRIVEN, not a new default — the selector already exists.** The chat session `scope` is the control:
>           **current project** / **all loaded projects** / **host** (host only if the user enabled it in settings). G3
>           maps that existing scope → which workspace root(s) the tools see + the execution mode (current→active
>           workspace + sandbox-ish; all→every loaded project; host→host mode). Don't invent a new default; honor the
>           session scope.
>         - **Permission AXES (2026-06-25, user) — scope is one of THREE orthogonal controls:**
>           1. **Scope (where):** current project / all projects / host (above).
>           2. **Mutation capability (what):** a **"chat only"** option = the agent **cannot use any tool that changes
>              anything** (read-only — `read_file`/`list_dir`/`get_board` are fine since they change nothing; no
>              `write_file`/`run_command`/board-mutation). This is a first-class user-selectable mode (the most restrictive,
>              and a great default for "just talk + read"). **G3a's read-only slice IS the "chat only" mode** — build it
>              first and surface it as that named option. **UI DECISION (2026-06-25, user): ONE selector reads
>              `chat-only · current · all · host`** (chat-only is the read-only floor as a 4th peer entry, NOT a separate
>              switch). So the chat scope enum gains a `chat_only` value (maps: current=`project_sandboxed`,
>              all=`all_projects`, host=`host_access`); chat-only ⇒ read-only tools only.
>           3. **Browser / internet access (reach):** an **independent on/off toggle** the user controls (orthogonal to
>              scope + mutation) — enable/disable the agent's web/browser + internet tools (ties into G6 + §5.L). Off by
>              default; a chat-only session can still have browser ON or OFF.
>         - **Host / unsafe commands = a RISK-ACKNOWLEDGEMENT model, not a hard limit (user: "we don't limit the user
>           strictly, but we definitely inform about risk and pass responsibility to the user").** Two requirements:
>           (1) **differentiate SAFE vs POTENTIALLY-UNSAFE commands — DECIDED 2026-06-25 = ALLOWLIST** (most conservative):
>           only a curated known-safe set (ls/cat/pwd/build/test/`git status`/typecheck/lint/…) is "safe"; **everything
>           else is potentially-unsafe** → the risk callout + dedicated ack. (Accept the friction for safety; user is
>           informed + owns the risk.); (2) the confirmation **informs the risk and
>           passes responsibility** to the user via EITHER **per-unsafe-command acknowledgement** OR a **general "I accept
>           the risk" acknowledgement that itself requires an extra-extra confirmation to enable**. Safe commands flow with
>           the normal confirm; unsafe ones get the explicit risk callout + dedicated ack. (This is a distinct sub-feature
>           → see **G3b** below; security-sensitive, build carefully.)
>         - **Streaming = HYBRID (user pick).** Workspace-less/simple chats keep **token-by-token** streaming via plain
>           `runChatTurn`; tool-using turns go through the agent loop and stream **tool-activity events + the final reply**
>           (the loop isn't token-streaming, so emit per-tool-call/result events then the reply).
>         **Build order:** (a) **[x] G3a — read-only slice BACKEND (2026-06-25)** — the web-ui right-sidebar chat now
>         routes through the tool-using agent loop with READ-ONLY tools when a project is active. `chat-service` gains a
>         `resolveAgentToolDeps(session) → {model, executeTool, appendToolExchange} | null` seam (mirrors `resolveModelDeps`,
>         keeps the service decoupled from the tool infra); `sendMessage` runs `runChatAgentTurn` when it's non-null, else
>         plain `runChatTurn`. `runtime-api` fills it from the **active workspace** (`getActiveWorkspacePath`): builds
>         `createWorkspaceReadTools` (`read_file`/`list_dir`) + `createBoardReadTools` (`get_board`), an `isolated_readonly`
>         `createGatedChatToolExecutor` (all `sandbox_read` = always-allowed, no confirm) + `createChatAgentModel`, audited via
>         `recordChatHostAction`; returns **null** with no active workspace → plain path (so §5.V Suite 5, which has no active
>         workspace, stays token-streaming — verified, full contract suite green). **Hybrid streaming** implemented: the loop
>         threads an optional `onToken` to the FINAL (no-tool) answer (re-issued as a tools-disabled streaming call), so a
>         tool-routed turn that uses no tools still emits token deltas. Chat scope enum gains `chat_only` (contract zod +
>         store union/list). Unit + contract tests added/green (tsc + biome clean). **Still TODO for G3a:** the scope selector
>         **UI** (`chat-only · current · all · host`) + mapping all→every loaded project / host→host mode (this backend uses
>         the active workspace + isolated_readonly only) — separate web-ui task. (b) **G3b — safe/unsafe command risk
>         model. ✅ INCREMENT 1 DONE (2026-06-25):** the web-ui resolver now offers `run_command` to can-act scopes with
>         a **classifier-gated `confirm`** — a SAFE command (allowlist) auto-approves, an UNSAFE one is denied (contract
>         77/77, oracle intact). ✅ **INCREMENT 2 backend DONE (2026-06-25):** added a **per-session `riskAcknowledged`**
>         flag (contract + store + service, back-compat default false, create/update + a round-trip test); the resolver's
>         `confirm` now lets an UNSAFE command run **only when `riskAcknowledged` is set** (else denied). **Remaining (UI):**
>         a **toggle** on the chat session (in the header by the scope selector) that flips `riskAcknowledged` behind an
>         **extra-confirmation dialog** ("this lets the agent run unsafe commands — are you sure?"), + surfacing the
>         safe/unsafe verdict. (The heavier per-command interactive over-stream confirm is deferred in favor of this
>         simpler general-ack the user explicitly allowed.)
>         **⚠️ G3a IMPLEMENTATION CAVEATS (found while scoping 2026-06-25 — handle in the focused build):**
>         (1) **Don't regress §5.V Suite 5** — its `streamMessage` test asserts MULTIPLE token deltas; if a tool-using
>         session routes through `runChatAgentTurn` (which is NOT token-streaming), that assertion breaks. So tool-use must
>         be **opt-in / scope-gated**, and the Suite-5 send/stream sessions must stay on the **plain** `runChatTurn` path
>         (they have no workspace-agent scope) — verify the full contract suite stays green. (2) **Contract enum** — adding
>         `chat_only` to `runtimeChatSessionScope` ripples to the zod schema + store + UI selector + existing scope tests;
>         do it as its own clean step. (3) **Workspace threading** — `chat-service` has no project root; inject a
>         `resolveAgentToolDeps(session) → {model, executeTool, appendToolExchange} | null` (mirrors the existing
>         `resolveModelDeps` seam) that `runtime-api` fills from the active workspace, returning null for non-agent
>         sessions so they stay plain. Keep `chat-service` decoupled from the tool infrastructure.
>   - [x] **G4 — focus chain (§5.N) in the chat agent — MODULE DONE (2026-06-25, solo).** `src/chat/chat-focus-chain.ts`:
>         a per-session focus-chain store (reuses the pure `src/core/focus-chain.ts` shape + normalize/timing/format) +
>         `createFocusChainTools` (the `update_focus_chain` tool, `sandbox_read` = always-allowed). `runChatAgentTurn` now
>         re-anchors the chain into the turn (leading system note) when `readFocusChain` is provided. 11 unit tests. **Ready
>         to wire** into the CLI + web-ui tool sets in Wave 2b (the tool + the `readFocusChain` dep aren't passed by a
>         caller yet — same ready-to-wire state as G3b/G5).
>   - [x] **G5 — board mutations — `create_card` MODULE DONE (2026-06-25, agent E, merged).** `createBoardMutationTools`
>         in `chat-board-tools.ts` + a new `control_plane` action kind (gate: deny in `isolated_readonly`/chat-only, allow
>         in host-capable modes — board writes are trusted !Klein-owned control-plane, no confirm). 21 board+gate tests.
>         Ready to wire in Wave 2b. (`start_card` deferred — starting a task is a separate session-start flow.)
>   - [x] **G6 — browser tool — WIRED + LIVE-PROVEN (2026-06-25, solo).** `src/chat/chat-browser-tool.ts`
>         (`createBrowserTools` → `browse_url`, actionKind `host_command`): a headless **Playwright** browser
>         (`import { chromium } from "playwright"`) that navigates + returns the rendered page's title + text, capped,
>         injected `BrowserDeps` so the 13 unit tests use a fake. Validates http/https, safe error messages (no host
>         paths). **Now wired behind a per-session `browserEnabled` toggle** (off by default, orthogonal to scope —
>         mirrors `riskAcknowledged` end-to-end: contract schema + store back-compat + service + the `buildChatAgentToolDepsResolver`
>         resolver, which offers `browse_url` only when enabled and approves its host_command confirm via the toggle). It's
>         a host action, so the mode gate still **denies** it in chat-only and **confirms** it in can-act scopes — the
>         toggle IS that consent. **CLI parity:** `nklein chat --browser` (elevates to the host-capable mode + confirm-prompts
>         each navigation). **web-ui:** a 🌐 "Enable browser" toggle next to the ⚠️ unsafe-commands toggle (can-act scopes
>         only; immediate flip, no extra-confirm dialog since browsing read-only pages is lower-risk) — 5 Playwright tests
>         (`chat-browser-toggle.spec.ts`). **Live-proven:** `scripts/verify-chat-browse.mts` drives the real CLI agent
>         (qwen3-8b) at a local page; asserts it USED browse_url AND the page marker flowed back (Chromium genuinely
>         rendered it). Needs `npx playwright install chromium` once (now installed: headless-shell 1228). (§5.L per-role
>         rulesets + knowledge-fetch can layer on the same toggle later.)
>   - [x] **G7 — comprehensive live coverage — DONE (2026-06-25, solo).** Each capability is live-proven with its own
>         CLI harness (real qwen3-8b, isolated HOME, asserts the tool was used AND the real side effect persisted):
>         **run_command** runs a shell command + its output flows back (`scripts/verify-chat-command-exec.mts`),
>         **create_card** does autonomous board work (`scripts/verify-chat-create-card.mts`, card read back via
>         `loadWorkspaceState`), **browse_url** browses a real page (`scripts/verify-chat-browse.mts`, Chromium rendered).
>         **The capstone** (`scripts/verify-chat-agent-e2e.mts`) drives the FULL tool-using agent through ONE multi-step
>         session — read a file → run a command + see output → create a card → maintain a focus chain — and asserts the
>         agent used all four tools AND both durable side effects held (the file marker flowed back into the reply + the
>         card persisted on the board). PASSES reliably on qwen3-8b (an 8B model composes all four in one turn).

- [x] **Chat session model & store** — board-independent sessions, persisted transcripts, stable ids, multiple
      concurrent; separate from board/task state (not kanban cards). **(store + transcript + tRPC surface + UI all
      shipped 2026-06-24.)**
  - [x] **session store (2026-06-24)** — [src/chat/chat-session-store.ts](src/chat/chat-session-store.ts): the
        durable session-metadata layer (`ChatSession` = id / title / scope / role / timestamps; scope ∈
        project_sandboxed|all_projects|host_access, role ∈ planner_architect|reviewer|debugger|researcher|
        system_operator, defaults = most-isolated + planner). Append-only JSONL event log replayed to the current
        set (crash-safe, concurrency-safe like the other stores), with create/list/get/update/delete + injectable
        `rootDir`/`now`. Unit-tested (round-trip, update bumps updatedAt, delete, newest-first replay, defaults).
  - [x] **transcript store (2026-06-24)** — [src/chat/chat-transcript-store.ts](src/chat/chat-transcript-store.ts):
        the per-session message log (`ChatMessage` = id / role user|assistant|system / content / createdAt), one
        append-only JSONL file per session (hashed id filename, concurrency-/crash-safe), with `appendChatMessage` /
        `readChatTranscript` (optional `limit` → most-recent N for the lean window) / `clearChatTranscript`. Unit-tested
        (per-session isolation, ordering, recent-N limit, clear).
  - [x] **tRPC/contract surface + agent runtime (2026-06-24)** — the `chat` sub-router
        ([app-router.ts](src/trpc/app-router.ts)) over [chat-service.ts](src/chat/chat-service.ts) exposes sessions +
        transcripts + send/stream to the web-ui (and, later, the bridge). (Messenger bridge consumer still LATER.)
- [x] **Chat agent runtime** — interactive multi-turn loop on the NKlein core + full tool suite; new entry point + streaming. **(shipped 2026-06-24: tool-using agent loop + read/write tools + confirm gate + §5.O dedup; CLI `nklein chat`; tRPC send/stream + web-ui dialog with token streaming.)**
  - [x] **context → prompt pipeline (2026-06-24)** — [src/chat/chat-turn-context.ts](src/chat/chat-turn-context.ts):
        `composeChatTurnContext` ties the §5.M memory foundations together into the pure heart of a turn (short-term
        lean-window split + overflow summary + long-term semantic recall + the standing goal → `{ goal, summary,
        recalledMemories, recentMessages }`); `renderChatTurnPrompt` then renders that into the ordered model message
        list (goal + summary + recalled memories as leading `system` notes, then the verbatim recent transcript, then
        the new user message). Model calls (summarize, embed) injected → fully unit-tested (window/summary/recall +
        render ordering + empty-note omission).
  - [x] **turn loop + LIVE verification (2026-06-24)** — [src/chat/chat-runtime.ts](src/chat/chat-runtime.ts):
        `runChatTurn` drives a turn end-to-end — load prior transcript + memories, compose+render the prompt (goal +
        lean window + recalled memories), call the model, persist the user message + assistant reply. All side effects
        (stores, model `complete`, summarize, embed, token estimate) injected → unit-tested (compose+persist order +
        prompt anchoring; query-matched recall). **Live-verified** by
        [scripts/verify-chat-runtime.mts](scripts/verify-chat-runtime.mts): a real turn against LM Studio `qwen3-8b`
        recalled a seeded memory, anchored the goal, got an on-topic reply *reflecting the recalled preferences*, and
        persisted both messages — PASS.
  - [x] **local-model adapter (2026-06-24)** — [src/chat/chat-local-llm-adapter.ts](src/chat/chat-local-llm-adapter.ts):
        `createChatModelDeps(client)` provides `runChatTurn`'s `complete` + `summarize` from a `LocalLlmClient`
        (fail-closed vs cloud, invariant #1), mapping the rendered prompt to the client's messages and stripping inline
        `<think>` reasoning (the robustness fix found during live qwen3 verification). Interface-typed client → unit-
        tested with a fake. Reused by the CLI wiring.
  - [x] **`nklein chat` entry point + LIVE verification (2026-06-24)** — [src/commands/chat.ts](src/commands/chat.ts):
        a board-independent CLI that discovers the loaded local model from the endpoint (`discoverLoadedModelId`,
        AGENTS.md), constructs a fail-closed `LocalLlmClient`, and drives one `runChatTurn` against it — creating/
        continuing a session (with `--goal`), recalling memory, persisting the turn to the runtime home. `--session`
        continues, `--json` for scripting. **Live-verified**: `nklein chat --message … --goal …` discovered
        `qwen/qwen3-8b`, created the session, and returned a correct concise reply (the chat agent is usable from the
        terminal). Discovery unit-tested.
  - [x] **interactive multi-turn REPL (2026-06-24)** — `runChatConversation` ([chat-runtime.ts](src/chat/chat-runtime.ts))
        loops read-line → turn → reply until EOF/`/exit` (blank lines skipped; I/O injected → unit-tested), and
        `nklein chat` with **no** `--message` enters it (a stdin readline adapter feeds the loop). **Live-verified**:
        `printf '…\n/exit\n' | nklein chat` held a real multi-turn conversation against `qwen3-8b`. (Across-invocation
        multi-turn also already works via `--session <id>`, which reloads the transcript + recalls memory each turn.)
  - [x] **token streaming (2026-06-24)** — `LocalLlmClient.completeStream`
        ([nklein-local-llm-client.ts](src/nklein-agent/nklein-local-llm-client.ts)) parses OpenAI SSE deltas; the chat
        adapter's `complete(prompt, onToken)` streams via it when an `onToken` is given (else falls back to a
        non-streaming completion), and `runChatTurn`/`runChatConversation` thread `onToken` so the REPL prints tokens
        as they arrive (persisting the reasoning-stripped reply). Unit-tested (stream path + fallback); **live-verified**
        — the `nklein chat` REPL streamed a real qwen3-8b reply token-by-token.
  - [~] **tool-using agent loop — core (2026-06-24)** — [src/chat/chat-agent-loop.ts](src/chat/chat-agent-loop.ts):
        `runChatAgentLoop` is the pure orchestration of "model → (maybe) tool calls → execute → feed results back →
        repeat until it answers", bounded by `maxIterations` with a forced tools-disabled final turn. Model call +
        tool execution + the message-fold are injected → unit-tested (executes-then-answers, no-tools-immediate-answer,
        iteration-limit-forces-final). Tool governance (the §5.M host-access invariant) lives in the injected
        executor (the execution-mode gate + audit store, already built).
    - [x] **gated tool executor (2026-06-24)** — [src/chat/chat-tool-executor.ts](src/chat/chat-tool-executor.ts):
          `createGatedChatToolExecutor` is the loop's `executeTool` — per call it applies `decideChatActionAccess`
          (allow→run / confirm→run-only-if-confirmed / deny→refuse) and records **every** call to the audit log
          (executed or not), with the tools' side effects + confirm prompt + audit sink injected. Unit-tested (allow/
          deny/confirm-both-ways/unknown-tool). The §5.M host-access invariant is now enforced at the tool boundary.
    - [x] **tools-aware local completion (2026-06-24)** — `LocalLlmClient.completeWithTools`
          ([nklein-local-llm-client.ts](src/nklein-agent/nklein-local-llm-client.ts)) offers OpenAI function `tools`
          (`tool_choice: auto`) and parses returned `tool_calls` (decoding the JSON-string args; malformed → `{}`,
          unnamed dropped); empty tools ⇒ a plain completion. Unit-tested (tools sent + parsed; no-tools plain path).
    - [x] **agent model/exchange adapter + `runChatAgentTurn` (2026-06-24)** — `createChatAgentModel` +
          `appendChatToolExchange` ([chat-local-llm-adapter.ts](src/chat/chat-local-llm-adapter.ts)) give the loop its
          `complete` (offers tools only when allowed; strips reasoning) and fold tool results back as `system` notes;
          [chat-agent-turn.ts](src/chat/chat-agent-turn.ts) `runChatAgentTurn` ties context-compose → render → the
          agent loop (model → gated tool exec → repeat) → persist the user msg + final reply. All deps injected →
          unit-tested (tool-call→execute→answer + direct-answer paths).
    - [x] **concrete read-only workspace tools + live verification (2026-06-24)** —
          [chat-workspace-tools.ts](src/chat/chat-workspace-tools.ts) `createWorkspaceReadTools(rootDir)` gives the
          first real tool set: `read_file` + `list_dir` (both `sandbox_read`), returning the runnable `ChatTool[]`
          (for the executor) **and** the OpenAI `definitions` (for the model). Honors the host-isolation invariant —
          every arg is resolved + confined to the workspace root (absolute paths and `..` escapes refused) and all
          agent-facing copy is workspace-relative, so a host path can never leak through a tool arg/result. Unit-tested
          (read/truncate/escape/absolute/missing/list, all asserting no host path leaks). **Live-verified** via
          [scripts/verify-chat-agent-tools.mts](scripts/verify-chat-agent-tools.mts) against qwen2.5-coder-14b: the
          real model called `read_file` through the gated+audited executor and answered from the file's content (a
          unique secret token). (Initially the small model re-read 4× → forced answer; now short-circuited by the
          §5.O dedup guard below — re-verified at **1 step, no cap hit**, with a clean non-narrated answer.)
    - [x] **§5.O: repeated-tool-call dedup in the chat agent loop (2026-06-24)** — weak local models re-request the
          *same* tool call until the iteration cap (observed live: read 4×, write 6×), wasting turns and ending in a
          forced, often-narrated answer. [chat-agent-loop.ts](src/chat/chat-agent-loop.ts) now de-dups by the same
          full-input fingerprint the NKlein agent uses (`computeNKleinToolInputFingerprint` over `{name, arguments}`):
          an identical call already made this turn is **not** re-executed (the model gets a "you already have that,
          answer now" nudge), and a response that is *only* repeats short-circuits straight to the final answer.
          Genuinely new calls (differing args) always run, so an advancing workflow is never blocked. Unit-tested
          (dedup-once + force-answer, distinct-args-still-run, genuine-cap path). **Re-verified live** on both
          harnesses: read + write each dropped from 4–6 steps + cap-hit to **1 step, `hitIterationLimit: false`**, and
          the model now returns a natural answer instead of narrating the tool call.
    - [x] **tool-using `nklein chat --workspace` + REPL (2026-06-24)** — [src/commands/chat.ts](src/commands/chat.ts):
          `--workspace <dir>` flips the shipped command to the tool-using path — it offers the read-only workspace
          tools, builds the policy-gated + audited executor (`isolated_readonly`, `recordChatHostAction` sink), and
          drives `runChatAgentTurn` (single `--message`, with `toolsUsed` in `--json`) or the new
          `runChatAgentConversation` REPL (`chat-agent-turn.ts`, surfaces which tools each turn used). Stdin reader
          extracted to a shared `createStdinLineReader`. Conversation loop unit-tested; **live-verified** end-to-end
          via the CLI against qwen2.5-coder-14b (the model called `read_file` and answered from the file).
    - [x] **mutating `write_file` tool + confirm-gate, live-verified (2026-06-24)** —
          [chat-workspace-tools.ts](src/chat/chat-workspace-tools.ts) `createWorkspaceWriteTools(rootDir)` adds
          `write_file` (`sandbox_write` → a **confirm** under `isolated_readonly`), same workspace-confinement +
          relative-path invariant as the read tools (unit-tested: write/mkdir-parent/escape-refusal/content-required).
          `nklein chat --workspace --allow-write` offers it and wires a stdin `y/N` confirm prompt (shared reader for
          confirm + REPL). **Two live verifications** against qwen2.5-coder-14b: (a)
          [scripts/verify-chat-agent-write.mts](scripts/verify-chat-agent-write.mts) — a real model called
          `write_file`, the gate invoked confirm, the file was written, and the audit logged a confirmed+executed
          `sandbox_write`; (b) the CLI end-to-end with a single piped `y` — the **one approved** write executed
          (audit confirmed+executed, file = the requested content) while the model's 5 repeat calls (no further
          confirmation arrived) were correctly **refused** (audit confirmed=false, executed=false). The confirm gate
          is the safety backstop even when a flaky small model spams a mutating tool — exactly the §5.M invariant.
    - [x] **tRPC chat session/transcript surface (2026-06-24)** — the board-independent chat backend is now exposed
          over tRPC for the web-ui. [src/core/chat-api-contract.ts](src/core/chat-api-contract.ts) holds the Zod
          contract (session/message + list/get/create/update/delete + transcript), mirroring the store shapes (drops
          `schemaVersion`). [src/chat/chat-service.ts](src/chat/chat-service.ts) `createChatService({ rootDir? })` is
          the single aggregation seam over the session + transcript stores (owns the wire mapping + per-store-subdir
          root layout; injectable root → testable; the Signal bridge will reuse it). Wired into `createRuntimeApi`
          (an injectable `chatService` dep, real runtime home by default) and a non-workspace `chat` sub-router in
          [app-router.ts](src/trpc/app-router.ts). Unit-tested: the service CRUD + transcript (temp root) and the
          sub-router end-to-end (`{ sessions }`/`{ session }`/`{ deleted }`/`{ messages }` wrapping). Full fast suite
          (1468) green.
    - [x] **send-a-turn endpoint (`chat.sendMessage`) (2026-06-24)** — the live turn endpoint is wired. The chat
          service gained `sendMessage` (composes memory + goal via `runChatTurn`, persists both messages) with an
          injectable `resolveModelDeps` (read-only when omitted → throws). [src/chat/local-chat-model.ts]
          (src/chat/local-chat-model.ts) is the shared "discover a loaded local model + build its fail-closed client"
          helper now used by **both** the CLI and the runtime API (the CLI's inline copy was removed). The runtime API
          builds its chat service with `resolveLocalChatModelDeps` (per-send discovery → "no model loaded" surfaces
          as a clear error at send time), exposed as the non-workspace `chat.sendMessage` mutation. Unit-tested
          (service send + read-only-throws + unknown-session-null; router send end-to-end) and **live-verified** via
          [scripts/verify-chat-send.mts](scripts/verify-chat-send.mts) against qwen2.5-coder-14b (real reply + both
          messages persisted). Still non-streaming (returns the full reply); tRPC streaming is a later refinement.
    - [x] **web-ui chat surface (2026-06-24)** — the board-independent chat is now usable in the app. A navbar Chat
          button (always visible, next to Settings) opens [chat-dialog.tsx](web-ui/src/components/chat/chat-dialog.tsx):
          a session list (create/select/delete) on the left, the selected transcript (user/assistant/system bubbles)
          on the right, and a composer that sends a turn. Data flows through [use-chat-data.ts]
          (web-ui/src/components/chat/use-chat-data.ts) on the non-workspace `chat` tRPC client (`useTrpcQuery` +
          mutations that refetch). The chat wire types are re-exported from `api-contract.ts` so `@/runtime/types`
          surfaces them. web tsc + biome + full web vitest (705) green. **Live-verified** end-to-end via
          [scripts/verify-chat-ui.mts](scripts/verify-chat-ui.mts) (headless Chromium against the running dev stack +
          live LM Studio): opened the dialog, created a session, sent a message, and a real assistant reply ("pong")
          rendered — screenshot `/tmp/nklein-chat-ui.png`. Non-streaming for now.
    - [x] **session header: editable title / role / scope / goal (2026-06-24)** — the chat dialog's right pane now
          opens with a `SessionHeader` exposing everything the backend already supported: an editable title + goal
          (commit on blur/Enter) and role + scope `NativeSelect`s, all wired to a new `updateSession` on the data hook
          → `chat.updateSession`. Keyed by session id so drafts reset on switch. web tsc + biome + full web vitest
          (705) green; **live-verified** via [scripts/verify-chat-ui.mts](scripts/verify-chat-ui.mts) (the four header
          controls render for the selected session).
    - [x] **token streaming over tRPC SSE (2026-06-24)** — the assistant reply now streams in token-by-token instead
          of arriving whole. Server: a `chat.streamMessage` **subscription** ([app-router.ts](src/trpc/app-router.ts))
          bridges the model's push-style `onToken` into the pull-style async generator a tRPC v11 subscription yields,
          via a tested [async-queue.ts](src/chat/async-queue.ts) (`createAsyncQueue`); the service's `sendMessage`
          gained a server-side `onToken` param threaded through `runChatTurn`. Transport: the web-ui tRPC client now
          uses `splitLink` → `httpSubscriptionLink` (SSE) for subscriptions, `httpBatchLink` otherwise (the standalone
          server passes `/api/trpc` straight through, and Vite proxies `/api` un-buffered). UI: `use-chat-data`'s send
          subscribes, accumulating tokens into a growing assistant bubble (+ an optimistic user bubble) that the
          persisted transcript replaces on `done`. Unit-tested (async-queue; the subscription yields token events then
          a terminal `done`) and **live-verified** end-to-end via [scripts/verify-chat-ui.mts](scripts/verify-chat-ui.mts)
          (the reply renders through the SSE path). Root (1476) + web (705) green.
  - [-] **LATER: the Signal bridge** — **deferred by the user (2026-06-24): "defer signal credential based testing, we'll
        do later."** It needs a live Signal account/linking + credentials to integrate & test against, so it's not
        actionable autonomously right now (also surfaces as the `[?]` "Private messenger bridge" item in §5.M). When
        resumed, the open spec question is the transport approach (e.g. `signal-cli` linked-device vs. a bridge service)
        — that choice shapes the bridge abstraction, so we build it together with the credentials rather than scaffolding
        speculatively now.
- [~] **Multimodal I/O, capability-gated** — image (and audio/PDF) in/out driven off model capabilities
      (MCSR/provider metadata); degrade to text; expose modalities in UI + over the bridge.
  - [x] **capability gate (2026-06-24)** — [src/chat/chat-modality.ts](src/chat/chat-modality.ts):
        `resolveChatModalities` / `isChatModalityAllowed` map a model's `supportsVision`/`supportsAttachments`
        (existing provider/registry metadata) to allowed modalities — text always on, image/attachment gated, audio
        degraded to text (no flag yet). Pure + unit-tested. Still owed: wire it into the chat runtime + UI (offer/accept
        attachments per the gate) + carry images over the bridge.
- [~] **Execution-access modes (default = most isolated)**
  - [x] **policy gate (2026-06-24)** — [src/chat/chat-execution-mode.ts](src/chat/chat-execution-mode.ts):
        `decideChatActionAccess(mode, action)` → allow | confirm | deny, the pure single-source policy for the three
        modes (a) `isolated_readonly` (sandbox reads free, writes confirm, **all host denied**), (b)
        `sandbox_with_host_escape` (sandbox free, **every** host action confirmed), (c) `host` (host reads free, host
        **mutations still confirmed**). Conservative by construction — a host write/command is *never* silently
        allowed in any mode (exhaustive matrix test asserts this). The runtime enforces + audit-logs the decision.
  - **still owed — runtime enforcement, per mode** *(3 buried deliverables — counted as the children)*:
    - [ ] (a) read-only sandbox + opt-in user-mounted write paths
    - [ ] (b) the double-confirmed per-action host escape hatch UI + execution
    - [ ] (c) the typed host-mode phrase + audit log
- [~] **Memory — human-like short/long-term** (reuse the in-process embedder)
  - [x] **short-term lean window (2026-06-24)** — [src/chat/chat-context-window.ts](src/chat/chat-context-window.ts):
        `splitChatContextWindow` (pure, token-estimator-injected) splits a transcript into the most-recent messages
        that fit a token budget (kept verbatim) vs the older overflow, always keeping the current/last turn even if it
        alone exceeds the budget; `consolidateChatContextWindow` folds the overflow into one summary via an injected
        summarizer (model call), invoked only when something overflows. Unit-tested (budget split, last-message-kept,
        no-overflow, summarize-only-when-present). Still owed: wiring the runtime token estimator + the summarizer model.
  - [x] **long-term store + recall (2026-06-24)** — [src/chat/chat-memory-store.ts](src/chat/chat-memory-store.ts):
        persisted memories (append-only JSONL) + `recallChatMemories` — the pure, testable recall core that ranks
        session-accessible memories against a query by **cosine similarity when embeddings are present and degrades to
        lexical (Jaccard) token overlap** when the embedder is the lexical fallback (the embedder is injected; never
        fails closed), dropping zero-score matches. `accessibleChatMemories` enforces the scope (own session + shared).
        Unit-tested (append/read, scope filter, cosine+lexical similarity, embedding recall, lexical-degradation recall).
  - [x] **short→long consolidation (2026-06-24)** — `proposeConsolidatedMemories` (same module) extracts candidate
        long-term memories from a session's rolling summary (extractor injected — a model call) and keeps only the
        genuinely new ones, dropping any that near-duplicate an already-accessible memory or an earlier candidate in
        the batch (embedding cosine when available, else lexical). Pure + unit-tested (existing-dup + within-batch-dup +
        empty drop; embedding-based dedup). Still owed: wire the real embedder + extractor model + persist on session end.
  - [ ] the ≥32k-floor budget integration (memory wired against the context floor)
  - [ ] opt-in access-all-loaded-projects memory scope
- [x] **Rename the misleading chat "sandboxed" scope naming → make host-access explicit — DONE (2026-06-27, user
      decision; §5.U #1 HIGH security finding).** The can-act scopes (`project_sandboxed` / `all_projects` / `host_access`)
      all grant host fs/shell command access under a session-wide `riskAcknowledged` opt-in, but the terse labels hid that
      `Current`/`All` are host-access too (only `⚠️ Host` was flagged). **Fix:** the selector labels now read **`Current
      (host)` / `All (host)`** (+ `⚠️ Host`) ([chat-sidebar.tsx](web-ui/src/components/chat/chat-sidebar.tsx)); the
      `chat.session-scope` tooltip now spells out "these run commands on your HOST machine (not Docker-sandboxed), gated by
      the session risk acknowledgement"; and the misleading code comment is corrected. KEPT the session-wide ack (no
      per-action move, per the decision). Verified: biome + web typecheck + web vitest (742) + web:build all green; the
      `chat-scope.spec.ts` label assertions updated to match. *(The Playwright spec can't run yet — it dies at board
      render on the pre-existing e2e-harness/backend degradation tracked in §5.AK's web:e2e:smoke item, not this change.)*
      **Optional follow-up (deferred):** the contract-id rename `project_sandboxed` → a clearer id (contract-coupled, not
      cheap; the user-facing clarity is already delivered).
- [?] **Private messenger bridge** — Signal linked-device via `signal-cli` (QR pair); ONLY the paired user (reject
      others); inbound → session, replies → Signal; local, no cloud broker; transport-agnostic (WhatsApp later).
      *(blocked on the user: deferred by the user 2026-06-24 ("defer signal credential based testing, we'll do later")
      — needs a live Signal account/credentials + the transport-approach decision; see the LATER Signal-bridge note in
      the chat-runtime block above. Not actionable autonomously.)*
- [~] **Chat UI (web-ui, separate surface)** — session list, transcript, streaming, execution-mode selector,
      memory-scope toggles, Signal pairing/status; tooltips per §5.I #5.
  - [x] **core dialog (2026-06-24)** — navbar Chat button → [chat-dialog.tsx](web-ui/src/components/chat/chat-dialog.tsx):
        session list (create/select/delete), editable session header (title/role/scope/goal), transcript with
        user/assistant/system bubbles, composer, and **token streaming** over SSE. Live-verified (Playwright).
  - **still owed** *(3 distinct UI pieces — counted as the children)*:
    - [ ] an **execution-mode selector** (the modes + gate exist; the UI only sets scope/role today)
    - [ ] **memory-scope toggles**
    - [>] **Signal pairing/status** *(blocked: ships with the Signal bridge, which is `[?]`/LATER — see "Private messenger bridge")*
  - [x] **Chat → resizeable RIGHT sidebar; modal + Chat button dropped (2026-06-24)** — the §5.M chat is now a
        persistent right sidebar ([chat-sidebar.tsx](web-ui/src/components/chat/chat-sidebar.tsx), renamed from
        chat-dialog): `ChatSidebar` (collapsed-by-default thin rail with an expand button) + `ChatPanel` (the chat
        content). Drags wider via a `ResizeHandle` on its left edge; width + collapsed state persist
        ([use-chat-sidebar-layout.ts](web-ui/src/resize/use-chat-sidebar-layout.ts) + new `ChatSidebarWidth/Collapsed`
        storage keys). Removed the `ChatDialog` modal, the top-bar Chat button + `onOpenChat`, and the `top-bar.chat`
        tooltip. web tsc + full web vitest (705) green; Playwright re-verified (expand → create session → send → reply).
  - [x] **dropped the home "!Klein Agent" tab; left sidebar is projects-only (2026-06-24)** — removed the
        Projects/Agent tab bar + the agent-section render from `project-navigation-panel.tsx` (+ the dead
        `TerminalAgentHints`/tips), the `homeSidebarSection` state + `useHomeSidebarAgentPanel` wiring from App, and
        **deleted the now-dead home-session infra** (`use-home-sidebar-agent-panel.tsx` + `use-home-agent-session.ts`
        + their tests). The project-scoped home chat is now the §5.M chat's `project_sandboxed` scope. **Kept** the
        per-task card agent chats (`NKleinAgentChatPanel` / `use-nklein-chat-*`, still used by card detail). web tsc +
        full web vitest (690) green; Playwright-verified (no "!Klein Agent" tab; chat sidebar still works).
- [~] **Safety, permissions & audit** — per-action + typed host confirmations, audit log of every host action,
      messenger access-control; first-class + tested; the autonomous swarm can never reach these.
  - [x] **policy gate + audit log (2026-06-24)** — the execution-mode policy
        ([chat-execution-mode.ts](src/chat/chat-execution-mode.ts), above) decides allow/confirm/deny per action, and
        [chat-host-action-audit-store.ts](src/chat/chat-host-action-audit-store.ts) durably records **every** host
        action (session, mode, action, decision, confirmed, executed, detail) — append-only JSONL, read newest-first
        with session filter + limit. Both pure/store-level + unit-tested.
  - [x] **runtime enforcement wired (2026-06-24)** — `createGatedChatToolExecutor`
        ([chat-tool-executor.ts](src/chat/chat-tool-executor.ts)) calls the gate per tool call, prompts the typed
        confirmation (the CLI's `--allow-write` stdin `y/N`), executes only on approval, and writes the audit entry
        every time. Live-verified: a spammed `write_file` ran only the one confirmed call; the rest were refused +
        audited. Still owed: messenger access-control (with the bridge, LATER); a web-ui confirm affordance.
- [x] **Settable session goal** (Codex-style) — explicit per-session objective kept in focus across turns
      (persisted, editable, shown in UI + bridge; the §5.N focus-chain north star). **(shipped 2026-06-24: persisted +
      re-anchored into every turn + editable in the chat UI's session header; bridge surfacing LATER with the bridge.)**
  - [x] **persisted + re-anchored (2026-06-24)** — `goal` is now a first-class `ChatSession` field
        ([chat-session-store.ts](src/chat/chat-session-store.ts)): set on create, editable on update (explicit `null`
        clears, absent leaves unchanged), back-compat-defaulted for older records. `composeChatTurnContext`
        ([chat-turn-context.ts](src/chat/chat-turn-context.ts)) carries it into **every** turn's context so it stays
        in focus across turns. Unit-tested (goal create/update/clear/preserve + goal in the composed turn context).
        Surfaced + editable in the chat UI's session header (2026-06-24); over the bridge LATER with the bridge.
- [ ] **Steering messages** — mid-turn course-corrections the agent folds in without cancelling; reuse the runtime's
      `"queue" | "steer"` delivery mode; wire through UI + bridge.
- [ ] **LAYERED memory as one projection over the §5.AF substrate (2026-06-27, small-LLM research pass).**
      The chat memory core is a good start; the long-horizon
      story is four layers: **working** (active state + current step), **episodic** (the immutable §5.AF event/attempt
      ledger), **semantic** (facts/preferences/project constraints extracted from episodes), **procedural** (the §5.AE
      `ProceduralSkillBank`). Add a **turn-budget allocator** that explicitly apportions the window across system/
      invariants · objective/focus-chain · current message · recent transcript · overflow summary · semantic memories ·
      episodic evidence · procedural skills · tool defs (ties §5.AD smart-zone). Make the owed "access-all-loaded-projects
      memory" a **namespaced scope**, not a shared boolean; add memory **governance** (provenance, scopes, deletion,
      contradiction-replacement, recency/frequency/importance, reversible history) + **"why recalled"** surfacing.
      Gate broadening memory scope on an internal LongMemEval-style task (§5.V).

### 5.N — Per-agent focus chains (self-directed task checklists) *(raised 2026-06-22)*
> Every agent drafts an ordered checklist at task start + works through it — keeps small models on-task, makes
> progress legible, survives compaction. Intra-task (one card/session), distinct from `decompose_project`. All roles
> + native kanban agent + chat agents (§5.M). Needs a real todo-list visual.
- [~] **Model & store** — persisted ordered steps (text + status pending/in_progress/done/skipped) per task/session
  - [x] pure core (`src/core/focus-chain.ts`: normalize/summarize/format, cap 30) + `runtimeFocusChainSchema` on card; tested
  - [ ] per-chat-session store (§5.M) + CRDT round-trip check (additive optional field)
- [x] **Agent tool** — `update_focus_chain` (full-list re-emit, relaxed schema, `onUpdated`); unit-tested
- [~] **Wire into every agent surface** — seed "draft a chain first" into per-task prompts; reviewer checks adherence
  - [x] board agents: "Focus Chain" rule pack + tool attached in the session runtime + state-hub persists onto `card.focusChain`
  - [ ] chat-agent surface (§5.M) + optional re-prompt nudge when a task runs without a chain
- [~] **Visual representation (todo list)** — checklist UI with done/in-progress/pending
  - [x] board: `FocusChainPanel` in card detail (✓/▸/○/– + x/total), threaded through `BoardCard` + normalizer
  - [ ] chat surface (§5.M)
- [~] **More ideas**
  - [x] reviewer checks the worker followed/owned its chain (seed prompt includes it; flags unfinished/mismatched steps)
  - [x] re-anchor the chain into context on long runs/after compaction (`reanchorFocusChainMessages`, `beforeModel` hook)
  - [x] user view/edit/reorder/add steps from the UI *(DONE 2026-06-24 — toggle/add/delete/reorder all shipped)*
    - [x] **edit / add / delete / toggle (2026-06-24)** — `FocusChainPanel` in card detail is now editable: click a
          step's status marker to cycle pending→in_progress→done→skipped, delete a step (hover ×), and add a step via
          an inline input. Edits persist through the board's normal save flow via a new `updateTaskFocusChain`
          board-state helper + `handleUpdateTaskFocusChain` (use-task-editor) threaded App → CardDetailView →
          FocusChainPanel. board-state unit-tested; web suite (699) green.
    - [x] **reorder steps (2026-06-24)** — per-step ▲/▼ move buttons (hover-revealed, disabled at the ends) reorder
          the chain in place and persist via the same save flow. (Used accessible up/down controls rather than a
          drag library — simpler, keyboard/focus-friendly, no new dep.)
  - [~] per-step timing/telemetry; carry the chain into the run summary; link a step to the files/cards it touched
    - [x] **carry the chain into the run summary (2026-06-24)** — the session service tracks each task's latest
          focus chain (`focusChainByTaskId`) and stamps a `FocusChainSummary` (total/done/in-progress/pending/
          skipped/complete) onto the terminal `TaskRunSummaryRecord`; absent when no chain was drafted. Unit-tested
          (store round-trip).
    - [x] **per-step timing/telemetry (2026-06-24)** — `FocusChainStep` gains optional `startedAt`/`completedAt`
          (contract + core), stamped by !Klein (not the agent) via the pure `applyFocusChainStepTiming(previous,
          next, now)` which carries timings across the agent's wholesale re-emissions (matched by step text, so a
          reorder/edit keeps them) — `startedAt` on first-active, `completedAt` on first-finish, cleared on re-open.
          Wired into both session-service focus-chain forwarders (using the stored previous chain). The card's
          FocusChainPanel shows a compact per-step duration ("12s"/"3m"/"1h 4m") on completed steps. Core unit-tested
          (stamp/carry-forward/reorder/re-open/pending); web + fast (1366) green.
    - [ ] link a step to the files/cards it touched
- [x] **Reference & parity** *(DONE 2026-06-24)* — the board focus-chain now matches Cline/Claude-Code/Cursor
      ergonomics: a visible live checklist with ✓/▸/○/– markers + an N/total progress count (visible work-through),
      re-anchored into context after compaction, reviewer-checked, **and now user-editable** (toggle/add/delete from
      the card). Remaining nicety (drag-reorder) tracked above; the chat-surface variant is §5.M.

### 5.O — Small-model output robustness *(raised 2026-06-23; SCOPE TIGHTENED 2026-06-24 — read the callout)*
> **SCOPE — decided 2026-06-24, FINAL until the user calls a version release-able. Leaves no doubt:**
>
> **IN SCOPE (the only sweep work now) — and this is an IMPLEMENTATION task, not just documentation:** make !Klein
> robust against the varied **output of different *small* local models**. In the first rounds we sweep *only*
> different small models — run the dev-test presets across the small models the user has loaded, observe what breaks,
> and then **change !Klein's code so it handles it** (parse-and-recover, guardrails, prompt/budget fixes) so it "just
> works" regardless of the model. The deliverable is the **hardened !Klein behavior** (shipped fixes + tests); the
> findings file is only the running log alongside it. Persist each round's findings to
> **[local-llm-tests.md](local-llm-tests.md)** (which models were swept · what broke · **what was hardened in
> code**). The goal is **correctness/robustness, not measurement**.
>
> **HARD + STRICTLY OUT OF SCOPE NOW — do NOT start, do NOT measure:** comparing models on **performance or
> efficiency**, and sweeping **context sizes / weight-quant / K-V-cache quant**. It is far too early to measure or
> compare perf/efficiency, and the user is **not willing to spend the compute** on it now: the available local
> compute is for **developing, testing, and maturing !Klein toward a release-able version**. Detailed
> perf/efficiency/quant/context sweeps are **only reconsidered AFTER the feature set + behavior are stabilized and
> the user explicitly calls a version release-able** — in *later* rounds, if at all. Until then: don't.
- [x] **Repeated-tool-call guard hardened against false-pauses (structural; 2026-06-24)** — the guard used to
      fingerprint on the *lossy display summary*, so any stateful workflow tool whose summary collapsed across
      advancing calls was falsely paused as "3 repeated … with the same input" (hit twice: `read_large_file`'s
      cursor, then `decompose_project` resolving open questions — the latter paused the very call that *applied*
      the decomposition, the "paused yet completed" report). Now the guard keys on a **lossless full-input
      fingerprint** ([src/nklein-agent/nklein-tool-call-fingerprint.ts](src/nklein-agent/nklein-tool-call-fingerprint.ts),
      a key-order-independent hash of the entire parsed input, set on the `tool_call` hook activity in the event
      adapter), falling back to the summary only for back-compat. Two calls now collide **only** on genuinely
      identical input ⇒ every tool, **including future ones**, is immune by construction; a real identical-input
      loop still pauses. Extensively tested (fingerprint unit suite + guard-level end-to-end for an arbitrary
      "future" tool, both progress→no-pause and identical→pause).
- [~] **Small-model output robustness (IN SCOPE — the only sweep work now)** — run the dev-test presets across the
      *small* local models the user loads; for each, catalog the **output** failure modes (tool-call malformation,
      narration-as-tool-call, no-tool-call stalls, structured-output misses, reasoning runaways) and **harden !Klein**
      (parse-and-recover, guardrails, prompts) until it is robust to them regardless of the model. Append each round's
      findings to [local-llm-tests.md](local-llm-tests.md) (models swept · what broke · what was hardened). Goal =
      robustness, **not** measurement. Pairs with the parse-and-recover work below (§5.O tool-call formats).
  - [x] **Round 0 — methodology + the instrument problem (2026-06-24)** — stood up the loop and wrote
        [local-llm-tests.md](local-llm-tests.md). Established the **model-pin lever** (the swarm resolves its model from
        the NKlein **provider settings**, not just live discovery — set/restore via `runtime.saveNKleinProviderSettings`;
        `lms ps` lists loaded ids; pre-register a fresh repo via `projects.add` for an empty board + to dodge the
        `loadWorkspaceContext` workspace-registry lock). **Key finding: `nklein dev test-project` is the wrong
        instrument for §5.O** — it classifies **board card outcomes**, not the agent's **raw output**, and its
        card-less `startTaskSession` seed reported `started:true` but **did not execute** via the CLI path (gemma
        stayed IDLE; zero session-activity files). So there was no model output to catalog. Tried with the dev server
        both up and stopped; restored the user's model + removed the throwaway project after.
  - [x] **Round 1 — gemma-4-e2b via the chat tool-using lens; first output bug hardened (2026-06-24)** — used
        `nklein chat --workspace --model google/gemma-4-e2b-m5max` as the lens (takes `--model`, surfaces every tool
        call + reply, no Docker/swarm needed; caveat: LM Studio normalizes tool calls, so it skips the swarm's
        raw-output `recoverNarratedToolCalls` seam). Read task: clean. **Write task surfaced Finding 5 → HARDENED:**
        the write executed but gemma's **final** reply was a **narrated tool call** leaking raw `<|tool_call>…` markup
        to the user. Added [`stripNarratedToolCallMarkup`](src/nklein-agent/nklein-narrated-tool-call.ts) (reuses the
        narration-marker regexes; cuts from the first opener to EOF, keeping prose) and applied it in
        [runChatAgentTurn](src/chat/chat-agent-turn.ts) with a `Done. (used: …)` confirmation fallback. Unit-tested +
        **re-verified live** (the same write now replies `"Done. (used: write_file)"`; file still created). Logged in
        [local-llm-tests.md](local-llm-tests.md).
  - [x] **Round 2 — gemma-4-e4b + qwen3-8b via the chat lens (2026-06-24)** — write tasks clean (narration fix from
        Round 1 held; files written). Surfaced **Finding 6 (logged, not a fix): a grounding failure** — both models
        called `read_file` then ignored the result and answered from priors (qwen3-8b confabulated about *mathjs.org*;
        e4b gave a vague non-answer). That's a model-capability issue, **out of the parse-and-recover lane** ("don't
        teach the model"); candidate soft mitigation (more imperative tool-result framing) logged in
        [local-llm-tests.md](local-llm-tests.md), not implemented speculatively.
  - [x] **Round 3 — CORRECTION: the dev-test projects DO run small models (2026-06-24)** — Round 0's "the seed
        doesn't run / can't observe output" was a measurement error (watched **board columns**, decoupled from the
        **session**). Correct vehicle+lens (per the user's "use the dev test projects"): `projects.createDevTestProject`
        → pin the small model → **start the seed card** (`startTaskSession` with `prompt`+`baseRef`) → observe
        `getState().sessions[taskId]` (`state`/`reviewReason`/`latestHookActivity`) + the captured **result branch**
        (the scaffold evidence bundle is *not* updated by the run). **Verified live**: gemma-4-e2b drove `mid_task` to
        `awaiting_review` + a coherent result branch (`specification.md` +34/−12) through the swarm+Docker — the 2B
        model completed a real task; no new failure to harden (existing hardening held). Details in
        [local-llm-tests.md](local-llm-tests.md).
  - [~] **Round 4 — gemma-4-e2b also completes `complex_dag`; cataloging needs a stream subscription (2026-06-24)** —
        ran the heavier `complex_dag` preset on gemma-4-e2b: it too reached `awaiting_review` + a captured result
        branch (~171s). Both presets succeed → existing hardening holds for this 2B model (no new fix). **Lesson:**
        *polling* `getState().sessions[].latestHookActivity` only catches the terminal `sandbox_patch_captured` event;
        per-`tool_call` cataloging needs **subscribing to the runtime's live activity stream** (the WS/event feed the
        UI consumes) for the run's duration.
  - [x] **Round 5 — the capture harness lands; gemma-4-e2b swarm output is clean (2026-06-24)** — built reusable
        [scripts/sweep-capture.mts](scripts/sweep-capture.mts): one command pins a model, scaffolds a dev-test project,
        **subscribes to the `/api/runtime/ws` activity stream**, records every `task_chat_message`, runs to a terminal
        state, catalogs (tool tally / narration leaks / genuinely-repeated calls by full content / role tally), and
        restores the model + removes the project (retried). `mid_task` on gemma-4-e2b: 1329 msgs, tools
        `update_focus_chain×4/read_files×2/write_file×2`, **0 narration leaks, 0 true repeats**, `awaiting_review` —
        swarm path clean (the fingerprint guard correctly passed the *advancing* focus chain; a first coarse dedup
        mis-flagged it, fixed to full-content). Existing hardening holds; no new fix.
  - [~] **Round 6 — sweeping via the one-command harness (2026-06-24)** — gemma-4-e4b on `complex_dag`: 5514 msgs, 24
        tool calls (`read_files×10/edit_file×8/update_focus_chain×4/list_files×2`), **0 leaks, 0 true repeats**,
        `awaiting_review`. **Tally clean so far: gemma-e2b {mid_task, complex_dag} + gemma-e4b {complex_dag}.**
        Remaining one-command runs: `audio_vst`/`daw_foundation` (the other two `createDevTestProject` presets — the
        fan-out presets `wide_fanout`/`many_small` are CLI-`dev test-project`-only, not in `createDevTestProject`'s
        schema). Optionally weigh the imperative tool-result framing (Finding 6).
  - [x] **Round 7 — qwen3-8b + harness leak-detection refined (2026-06-24)** — swept the *reasoning* model qwen3-8b.
        First pass flagged false "leaks": it thinks `<tool_call>{…}` in its **reasoning channel** (recovered by
        `recoverNarratedToolCalls`). **Refined `sweep-capture.mts`** to flag a leak only in user-facing `assistant`
        content (reasoning narration reported separately, informational). Re-run: **0 assistant leaks, 0 true repeats**
        on mid_task + complex_dag, but **non-terminal in the 6–7 min window** — qwen3-8b is reasoning-heavy + slow
        (hundreds of reasoning deltas, 2–8 tool calls), **not stuck**. Characterization (Finding 7), governed by the
        wall-time guardrail; out of the parse-recover lane. gemma-e2b/e4b finish the same presets in ~3 min clean.
  - [-] **OUT OF SCOPE until release-able maturity (see the section callout)** *(deferred by decision — explicitly NOT
        started now; reconsidered only after the user calls a version release-able)*: the size × family × **weight-quant ×
        K/V-quant × context** matrix, any **performance/efficiency** comparison, and large-model efficiency tuning.
        HARD, resource-heavy, premature.
- [~] **Parallel multi-agent dev-test coverage** — DAGs that fan out widely to exercise the swarm/pool/merge/review/delivery under concurrency
  - [x] presets ship (`wide_fanout`/`deep_chain`/`mixed_dag`/`many_small`) for `nklein dev test-project`
        ([src/nklein-agent/nklein-dev-test-project.ts](src/nklein-agent/nklein-dev-test-project.ts)); unit-tested
  - [x] **dev-test fixture specs enriched (2026-06-26)** — rewrote the in-repo dev-test `specification.md` bodies
        (smoke, mid, complex-DAG, audio-VST, and all four fan-out presets) into better-specified mini-challenges
        with explicit typed entities, validation rules, and **property-based invariants** (bounded/clamped scores,
        partitioned bands, pure/total functions, valid-JSON round-trips, phase-aligned audio, correct DAG edges),
        plus dependency-ordered build guidance — calibrated as great small-local-LLM dev-test material. Kept
        deterministic (`npm test`, no live LLM/network), all scenario ids/titles + asserted prompt phrases intact,
        and added orientation READMEs to the `smoke-ts-cli`/`audio-vst-synth` fixtures.
  - [x] **Folder-based dev-test-project registry + 36-project integration (2026-06-26)** — the dev-test scenario
        prompts/specs no longer live as string constants. Each project is now a self-contained folder under the
        repo-root [`dev-test-projects/<id>/`](dev-test-projects/) (`project.json` + `specification.md` +
        `user-prompt.txt`); registering a prepared project is "add a folder + it's discovered" (no code change).
        New loader [src/nklein-agent/dev-test-project-registry.ts](src/nklein-agent/dev-test-project-registry.ts)
        discovers the folders, validates each `project.json` with a strict zod schema
        (`devTestProjectConfigSchema`: `id/title/acceptanceCommand` + optional `agentId/fixtureTemplate/
        startInPlanMode/tier/tags/enabled/complexity/specificationPath/filesLikelyTouched`), reads the two text
        files, and builds the same `NKleinDevTestProjectScenario` objects the runner/UI/CLI already consume. The
        9 named scenario constants in `nklein-dev-test-project.ts` are now **registry lookups by id** (byte-identical
        `prompt`/`specification`/`complexity`/`templateName` — every existing dev-test/projects-api test stays green
        unchanged). Migrated the 9 legacy in-code projects to folders, then **integrated all 36 enhanced specs from
        the Desktop into the repo** (`NN_<name>/` folders with synthesized `project.json`: title from H1, `tier` from
        the spec, `tags` from "Domain pressure", `startInPlanMode: true`, `agentId: nklein`, `npm test`), plus
        `_ENHANCEMENT_GUIDELINES.md` + a `README.md` documenting the format. **45 folder-defined projects total; the
        repo references nothing under `~/Desktop`.** New `dev-test-project-registry.test.ts` (10 cases: discover /
        validate / reject-malformed / load spec+prompt / preserve legacy fields). **UI wiring (2026-06-26):** contract
        extended (`runtimeDevTestRegistryEntrySchema` + `runtimeDevTestProjectRegistryResponseSchema`; `registryId`
        field on create request), new `projects.listDevTestProjects` tRPC query, `createDevTestProject` accepts
        `registryId` (resolves via `loadDevTestProjectScenario`), new `DevTestRegistryPicker` component (searchable
        + tier-grouped collapsible list), wired into `DevTestProjectCard` + `project-navigation-panel`. 4 legacy
        preset buttons kept for back-compat. Contract test in `dev-test-registry-contract.test.ts`.
  - [x] **CLI sweep orchestrator (2026-06-24)** — `nklein dev sweep` runs several dev-test presets in sequence
        (default = the parallel-fan-out set `wide_fanout,deep_chain,mixed_dag,many_small`, `--presets` overridable)
        and reports each run's classified terminal outcome. The orchestration core
        ([src/core/dev-test-sweep.ts](src/core/dev-test-sweep.ts) — `runDevTestSweep` / `summarizeDevTestSweep` /
        `formatDevTestSweepReport`) is pure with the per-preset execution injected, so it's fully unit-tested (4 cases);
        the CLI wires it to a real live run via the shared `executeDevTestPreset` (extracted from `test-project`). `--json`
        emits the structured summary (per-preset outcome + `byOutcome` rollup + `allSucceeded`) for a future CI gate.
  - [ ] run the parallel-fan-out presets under concurrency on the loaded small models + harden from observed
        failures — **output robustness only**; the quant / K-V / context matrix stays out of scope (section callout).
- [ ] **Autonomous small-model sweep tooling** — iterate the loaded *small* models unattended on top of `dev sweep`,
      appending each model's robustness findings to [local-llm-tests.md](local-llm-tests.md). Design the shape when
      we start the in-scope small-model rounds. The full model/quant/config **matrix** + perf/efficiency capture stays
      **out of scope until release-able maturity** (section callout) — do not build matrix/perf tooling now.
- [~] **Extend the agent tool-call interface to all known model-family formats** *(we own the runtime now; raised 2026-06-23)* —
      families/variants emit tool calls in different shapes (OpenAI `tool_calls`, `<tool_call>{…}</tool_call>` narration,
      Hermes/Qwen/Mistral/Anthropic-ish templates, etc.). Parse-and-recover **every** publicly-known format at the
      `afterModel` seam (extend `recoverNarratedToolCalls` in `nklein-narrated-tool-call.ts`) so weak/quantized models
      "just work" regardless of formatting — per the parse-and-recover principle (recover in !Klein, don't teach the
      model). Catalog the formats + add fixtures per family.
  - [x] **2026-06-24:** added Llama 3.1 `<|python_tag|>`, Mistral/Mixtral `[TOOL_CALLS][…]` (JSON array of calls),
        the OpenAI-shaped nested `function:{name,arguments}` object, and the Functionary `<function=NAME>{…}</function>`
        named-tag form, on top of the existing Hermes/Qwen `<tool_call>`/`<|tool_call|>`/`<function_call>`. Fixtures per
        family + a false-positive guard test. (Remaining tail: exotic per-fine-tune variants as they surface in sweeps.)
  - [x] **2026-06-25 (user loaded a DeepSeek model):** added **DeepSeek-V3/R1** — the special-token
        `<｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME ```json {…} ``` <｜tool▁call▁end｜>` form (name *outside* the
        JSON), plus the ASCII-normalized `<|tool_call_begin|>` variant some GGUF quantizations emit, multi-call outer
        `<｜tool▁calls▁begin｜>` wrapper, unfenced args, and a truncated end token. `parseNarratedToolCalls` +
        `stripNarratedToolCallMarkup` updated; 6 fixtures added.
- [x] **Simplify `read_large_file` to pure iteration (2026-06-24)** — the model now only *triggers* it with a `path`
      and advances with `cursor: "next"` (or an empty/omitted cursor); it never composes `read:`/`stitch:` cursors.
      !Klein tracks position authoritatively from its own persisted state and each result reports **index/total**
      progress (`Covered N of M lines (P%)` for chunks, `Verified N of M stitching areas` for stitching). Tool
      description + `beforeModel` rails + result instructions all steer to `"next"`; `cursor` is now optional in the
      schema (defaults to advance). Explicit cursors still validate for back-compat (stale-cursor rejection intact).
      Unit-tested: full workflow driven with only `"next"`, empty-cursor advance, plus the existing explicit-cursor
      suite. *(Re-running the whole pass when synthesis is still too large remains unaddressed — the workflow already
      parks/persists chunk context, so synthesis works from running notes; revisit only if a real case surfaces.)*
- [ ] **NARROW the tool interface for small models — tool count + ambiguity are major failure drivers (2026-06-27,
      small-LLM research pass).** Beyond parse-and-
      recover, drive a **smaller offered tool set + better feedback** off the §5.AF tool-capability manifest: **two-phase
      tool use** (first pick `none | one_tool | plan_needed` from short **tool cards** — name / one-line purpose /
      use-when / do-not-use-when / example / common-recovery — then reveal ONLY the selected tool's schema); **typed
      semantic error contracts** on every rejection (`{ code, field, expected, received, retryable, minimalValidExample,
      suggestedNextAction }`) instead of a prose error; **result handles** (`result://search/42`) instead of dumping bulk
      tool output into context; a typed **action-plan IR** for multi-step tool workflows; **grammar-constrained decoding**
      for the internal action IR where the local runtime supports it; per-provider **schema profiles** (smallest safe
      subset for LM Studio / llama.cpp grammar / OpenAI-compatible + JSON-repair fallback). This is the small-model-
      optimization layer on top of §5.O's existing robustness work + the §5.AA tool-set-reduction rung.

### 5.Q — Model telemetry & performance-stats consistency ✅ COMPLETE → moved to [done.md](done.md#5q--model-telemetry--performance-stats-consistency-raised-2026-06-23)

### 5.R — Dissolve the "internal SDK" separation; one unified codebase *(raised + clarified 2026-06-23)*
> **Goal:** stop framing any runtime part as a separate "SDK" — nKlein is one product (no reusable core today).
> Remove the `src/nklein-agent/` boundary framing so it reads as one integrated whole. **Principle:** simple, working,
> comprehensible — no fancy internals re-engineering now (the §5.P Python port supersedes the deep internals); target
> the npm dev build only. **Priority: after §5.A, before §5.H/§5.M/§5.O.** **Decided:** Layer 1 (our readable TS
> boundary) — fully inline; Layer 2 (vendored minified `@nklein/*` runtime) — keep working as an internal
> dependency, do NOT de-package the minified bundles now (deferred to §5.P).
- [x] **Honest naming — directory rename `nklein-sdk` → `nklein-agent` (2026-06-27, user: "we dont have an sdk .. lets
      be honest about this in our naming structure").** Renamed the two Layer-1 dirs `src/nklein-sdk/` → `src/nklein-agent/`
      and `test/runtime/nklein-sdk/` → `test/runtime/nklein-agent/` (`git mv`, history-preserving) + rewrote every
      `nklein-sdk/` path reference (159 files, trailing-slash-targeted so it never touched the genuinely-vendored
      `vendor/nklein-sdk/`, the `@nklein/*` aliases, `scripts/nklein-sdk-alias.mjs`, or the `sdk-*-boundary.ts` /
      `nklein-sdk-event-readers.ts` filenames — those bridge to / parse the real vendored SDK and keep their names). Updated
      biome.json's boundary-rule paths + the boundary-check-script comments + the AGENTS.md naming note (do-NOT-revert). Gates
      green: tsc · web:typecheck · biome · check:nklein-boundary · test:fast (2045). This is the *naming* slice of §5.R; the
      full layer-1 *inlining* below stays deferred.
- [-] **Inventory + inline the layer-1 boundary** *(deferred by decision — §5.0.1 (2026-06-25, FINAL): "§5.R
      SDK-boundary inlining stay deferred")* — catalog `src/nklein-agent/`'s re-exports of `@nklein/*`, inline the
      pass-through shims (`sdk-runtime-boundary.ts`, `sdk-provider-boundary.ts`) into callers, reframe the `NKlein*`
      services/tools/event-adapter/session-runtime as plain runtime code (keep an `agent-runtime/` area), drop the
      `check:nklein-boundary` discipline. No behavior change; tests green.
- [-] **Reframe the docs/mental model** *(deferred by decision — §5.0.1; pairs with the item above)* — AGENTS.md +
      comments: no "SDK boundary / plug-in / reusable core" framing; it's the internal agent runtime. Don't churn
      substantive code beyond removing the separation.

### 5.S — User-questions: auto-clarify loop + first-class UI *(raised 2026-06-23; LOWEST priority — after all other planned tasks, before §5.P)*
> **Goal:** clarifying user questions are first-class. Agents already raise them; they were force-answered + never
> shown. (The 2026-06-23 decompose fix lets an `open` question survive with a working `assumption` — §5.B.) This
> builds the flow + UI. **Default = automatic:** architect proposes → reviewer (reuse §5.K) adds an opinion →
> architect answers or ping-pongs; continue while progressing, stopped by a **multi-layered no-progress detector**
> (semantic-similarity of rounds AND agent self-check) + a generous safety cap (~30, user-adjustable) + a user hard
> limit (global/project). **Manual mode:** board-header "N pending" badge + per-card indicators → a clarifying
> dialog; each question shows ≥4 fitting options + free-text, multi-choice/radio (the asking agent picks). **Reuse:**
> the plan-artifact question schema (`nklein-plan-artifacts.ts`) + `questions.md`; §5.K reviewer infra; the embedder.
- [x] **Auto-clarify core (pure + tested)** *(DONE 2026-06-24)* — [src/core/auto-clarify.ts](src/core/auto-clarify.ts):
      `decideAutoClarifyStep(rounds, config, similarity)` is the pure architect→reviewer→architect decision over a
      card's open questions — confident answer wins immediately; otherwise the round budget (safety cap tightened by
      the operator hard limit, `resolveAutoClarifyRoundBudget`) and the multi-layered no-progress detector
      (consecutive-proposal similarity **AND** the agent's self-check) force `give_up_with_assumption`; else
      `keep_asking`. Similarity is injected so the core is pure (the wiring supplies the embedder). `applyAutoClarify
      Decision` projects the result onto the `NKleinPlanQuestion` (answered / assumed-default / open). 10 unit tests.
- [~] **Wire into the flow** — run after decomposition (+ wherever questions are raised), reusing the reviewer
      role/model; persist resolved/remaining state onto the card/plan; settings (global + per-project) for
      auto-vs-manual + the hard limit.
  - [x] **orchestration driver (DONE 2026-06-24)** — `runAutoClarifyLoop(question, deps, config)` in
        [src/core/auto-clarify.ts](src/core/auto-clarify.ts) drives the architect→reviewer→architect exchange to a
        terminal `decideAutoClarifyStep` decision (a confident proposal skips the reviewer + answers; otherwise the
        reviewer opines and it continues while progressing), persists via `applyAutoClarifyDecision`, and has a hard
        iteration bound so it always terminates. The architect `propose` / reviewer `review` / `similarity` are
        injected (`AutoClarifyTurnDeps`) — fully unit-tested (3 cases: confident-answer, stall→assumption, hard-limit).
  - **still owed — live model + flow plumbing** *(6 buried deliverables — counted as the children)*:
    - [ ] connect `propose` to the architect turn
    - [ ] connect `review` to the §5.K reviewer model *(§5.K is complete, so the gate is met)*
    - [ ] connect `similarity` to the embedder
    - [ ] invoke after `decompose_project` applies
    - [ ] persist onto the plan `questions.md` / card
    - [ ] settings (global + per-project) for auto-vs-manual + the hard limit
- [ ] **Manual-mode UI** — board-header badge + per-card indicators → clarifying dialog (≥4 options + free-text,
      multi-choice/radio per question, tooltips per §5.I #5); persist answers back through the question state.

### 5.T — Settings/UI polish ✅ COMPLETE → moved to [done.md](done.md#5t--settingsui-polish-raised-2026-06-23-from-a-swarmsettings-review)

### 5.U — Deep architecture & code-quality review → populate the backlog *(raised 2026-06-24; re-affirmed by the user 2026-06-24 — emphasis: **no large monolith files**, SOTA architecture/structure, efficiency in **both development and runtime**)*
> **Goal (meta-task):** do a deliberate, whole-codebase reasoning pass over !Klein's architecture and structure and
> surface **every** worthwhile improvement — simplification, maintainability, performance, extensibility,
> architecture, and code quality — then **write each finding into this todo.md as its own concrete, landable item**
> so we can work through them. The deliverable of the pass itself is the populated backlog (the sub-items below get
> replaced by the real findings as they're produced). **Constraints:** every proposal must respect the §1 invariants
> (local-only, strict Docker isolation, ≥32k floor, upstream-clean SDK boundary, protected tests) — flag, don't
> violate. Don't churn for its own sake (§3): prefer changes that measurably improve navigability/clarity/perf, each
> independently shippable + test-backed. Coordinate with the already-planned structural work so we don't duplicate:
> §5.R (dissolve the `src/nklein-agent/` boundary / one unified codebase), §5.P (eventual Python backend port), and the
> §5.A worktree-module shrink (plan.md §2.B) — note overlaps rather than re-deriving them.
>
> **SCOPE EXPANSION (2026-06-25, user — this is now explicitly part of §5.U, not just "no monoliths"):** the pass must
> also do a **systems-level analysis + improvement**, not only file-size decomposition. Apply the toolkit modern
> complex-systems / software-architecture analysis uses to *understand, describe, and improve a large grown system*,
> and then **implement every safe improvement it surfaces** (analysis is not the deliverable; the improved system is):
> - **State flows & state dependencies** — map where state lives, who reads/writes it, and the dependency edges between
>   stateful pieces; collapse redundant/derived state, remove hidden coupling, make ownership of each state explicit.
> - **Data flows** — trace how data moves end-to-end (CLI/UI → tRPC → runtime → session/SDK → board/workspace state →
>   back); simplify convoluted paths, kill needless transforms/round-trips, make the canonical source of each datum clear.
> - **Activity / control flow** — the dynamic behaviour: task lifecycle, the agent loop, event/summary streams, guards,
>   reconciles, broadcasts; find races/ordering hazards (e.g. the start-vs-running-transition lane bug), redundant
>   triggers, and over-/under-firing effects; simplify the orchestration while keeping the exact intended task workflow.
> - **Ownership & separation of concerns** — who *owns* each responsibility (runtime vs SDK vs web-ui vs core/state);
>   pull cross-cutting logic to one owner, remove duplicated/forked logic (e.g. the lane reconcile that had drifted into
>   two copies — now one shared helper), keep layers' boundaries clean, name seams by concern.
> The hard invariant on all of the above: **preserve the exact *wanted* behaviour the task workflows need** — simplify
> structure and flow, never change the product semantics. Each improvement still ships independently + test-backed (§3).
- [ ] **Run the review pass** — systematically read across the runtime (`src/`), the web-ui (`web-ui/src/`), the
      vendored SDK boundary (`src/nklein-agent/` + `vendor/`), the Python core (`core-py/`), state/telemetry, and the
      tRPC/contract seam. For each area assess: module boundaries & separation of concerns; oversized/multi-purpose
      files (e.g. the large `nklein-task-session-service.ts`) worth decomposing; duplication / missing shared
      utilities (the `model-identity` extraction is the template); dead or back-compat-only code; data-flow and
      hot-path performance (startup, event adapter, telemetry reads, embedding/index build); extension points for
      new tools/agents/providers; type-safety gaps; test coverage shape. Capture concrete findings, not vibes.
- [~] **Write findings into todo.md as concrete items** — promote each finding to a checkbox item under the most
      fitting §5 section (or a new one), with enough spec to be landable independently and a note on which invariant(s)
      it touches. Cross-link duplicates to §5.R / §5.P / §5.A. *(2026-06-24: wrote 3 concrete findings — DRY the
      runtime-config field plumbing, decompose `runtime-settings-dialog.tsx`, persist launch role on the summary —
      alongside the 2 earlier seed findings; then a **monolith-file inventory** promoting ~6 more oversized files to
      landable decomposition items (task.ts, runtime-api.ts, provider-service, card-detail-view, project-nav-panel, +
      a lower-priority list). The full whole-codebase pass — data-flow, hot-paths, extension points, dead code — is
      still owed.)*
- *(process note, not a discrete work item)* **Then work through them** by the normal §2 loop / §5.0 priority,
      smallest-safe-step first, each a green commit. *(The actual schedulable work is the individual promoted findings —
      S/M/R items above + the per-file decomposition slices below — each counted on its own.)*

> **Systems-analysis findings (2026-06-25, dedicated read-only pass over the task-execution/board/runtime core)** —
> mapped state/data/activity flows + ownership + SoC across `workspace-state` (the locked `mutateWorkspaceState`),
> `task-board-mutations`, `task-board-lane-reconcile`, `runtime-server`, `runtime-state-hub`, `nklein-task-session-service`,
> `nklein-decomposition-tool`, `runtime-api`. Promoted as landable items (safe-now first; each a green commit):
- [x] **(S1, DONE 2026-06-25) Dedupe `isReviewableNKleinSummary`** — extracted the byte-identical copy from
      `runtime-server.ts` + `runtime-state-hub.ts` into one exported `isReviewableNKleinSummary` in
      [src/core/task-session-guards.ts](src/core/task-session-guards.ts); both import it now. The review-gate reason set
      can no longer diverge. Pure refactor, tsc + biome + fast suite green.
- [x] **(S2, DONE 2026-06-25) Dedupe `isWorkspaceStateLockError`** — exported it from
      [workspace-state.ts](src/state/workspace-state.ts) (the canonical home) and removed the byte-identical copy in
      `runtime-server.ts`, which now imports it (its `retryWorkspaceStateLock` uses the shared one). tsc + biome + fast
      suite green. *(Left `retryWorkspaceStateLock` in runtime-server — it's the only copy, not duplicated; lifting it to
      the state layer is optional polish, not needed for the dedup.)*
- [x] **(S3, safe — DONE 2026-06-25) Export one `findBoardCardWithColumn` from `task-board-mutations.ts`** — added the
      single board-wide card+column lookup (wraps the internal `findTaskLocation`) and replaced 3 private copies: the
      start-lane reconcile's `findBoardCardById`, the §5.B promotion tool's `findCard` (the wart §5.B just added), and
      runtime-api's `findBoardCardRecordById`. tsc + 94 affected tests green. *(Remaining: `task-record-format.ts` uses a
      `{task, columnId}` shape with a different field name — left as-is, lower value; runtime-api's column-scoped
      `findBoardCardById(cards, id)` is a different helper, kept.)*
- [-] **(S4) Won't remove the synchronous `reconcileRunningTaskBoardLane` calls** — *investigated + reverted 2026-06-26:
      the "always a no-op" premise is **wrong**.* `reconcileStartedTaskBoardLane` is gated on `summary.state === "running"`,
      so it IS a no-op for a *freshly-started* card (queued/starting when `start()` returns — the hub handles that on the
      queued→running transition, `runtime-state-hub.ts:605`). BUT for **resume/already-running** summaries it does real work
      **synchronously in the request** so the API response/persisted board is immediately consistent: a started card whose
      summary is already running, and a **review→in_progress** card resumed via `sendTaskSessionInput`. Two `runtime-api`
      tests assert exactly this ("moves a started backlog card out of backlog…", "moves a recovered review task back to in
      progress after nklein input resumes it") and the hub only covers the async path — so the synchronous calls are
      **complementary, not redundant**. A "proper" version (move all reconcile to the hub, make the API response
      eventually-consistent, rewrite those 2 tests) is a behavior change for ~zero value. Leave as-is.
- [x] **(S5, low-risk) Replaced the 250 ms `setTimeout` in `completeDecompositionSourceTask`** (`runtime-server.ts`) with a
      causal `await` (2026-06-26). The sole caller (`onDecompositionApplied`) already awaits `autoStartDecompositionRootTasks`
      before it, so the source-task completion now runs deterministically after the root starts — no arbitrary settle delay.
      Errors stay non-fatal (warn). Behavior-preserving (the ordering root-starts → source-complete → drain is unchanged;
      `mutateWorkspaceState` is locked, so the delay was never needed for re-entrancy). Verified: tsc + biome + the
      session-service suite (112) green.
- [-] **(M1, moderate) Extract decomposition stall/nudge state** (the ~12 per-task Maps + `maybeContinueStalledDecomposition`)
      out of `InMemoryNKleinTaskSessionService` into a focused collaborator (inject `sendTaskSessionInput`/`cancelTaskTurn`).
      *(done — superseded by §5.X Phase 1 "M1 `DecompositionStallNudger`" (`85ffd63b`), which extracted exactly this.)*
- [ ] **(M2, moderate) Unify the session-merge** so `buildWorkspaceStateSnapshot` is the one canonical live+persisted merge
      (today `loadState` layers live NKlein summaries on top separately — effective state depends on which fn the caller used).
      *(Scoped 2026-06-26: the asymmetry is structural, not a quick move. `loadWorkspaceState` (`state/workspace-state.ts`)
      is the LOW-LEVEL persisted read — board + persisted sessions off disk, NO live layer. `buildWorkspaceStateSnapshot`
      is a closure in `server/workspace-registry.ts:334` that layers the LIVE `NKleinTaskSessionService` summaries on top —
      it lives there because the lower `workspace-state` layer can't depend on the live agent service (dependency
      direction). Unifying means either injecting a "live summaries provider" into the low layer (inversion) or routing
      every persisted-read caller through the registry merge — a real design change across workspace-state / registry /
      hub / runtime-server / workspace-api, with merge-semantics + dependency-cycle risk. Deserves a focused design pass +
      its own characterization tests; do NOT fold into a tail-of-session batch.)*
- [x] **(M3, low-med) Guarded the UI `saveState` write path** (2026-06-26) — `saveWorkspaceState` now runs
      `updateTaskDependencies(normalizeRuntimeBoardData(board))` on the incoming board (the same normalization every load
      path applies) before persisting, so a stale/buggy/hostile UI can't write illegal state (cards in unknown columns,
      non-canonical column set/order, self/dangling/duplicate dependencies the free-string dep schema accepts). Idempotent
      for valid boards (load already normalized them), so OCC (`expectedRevision`) stays the staleness guard and valid saves
      are unaffected. New integration test (`§5.U M3`) saves a malformed board and asserts the response + persisted board are
      normalized; full workspace-state integration suite (16) green.
- [ ] **(R1, risky — live verify) Extract `finalizeHeadlessAutoReviewTask`** (review→merge→complete→auto-start delivery gate)
      out of the `runtime-server` closure into a `TaskDeliveryOrchestrator`; verify against the full delivery-gate matrix.
- [ ] **(R2, risky — live verify) Collapse the dual `onSummary` subscriptions** (hub + server) into one ordered event bus so
      the implicit "hub lane-reconcile before server finalize" ordering becomes structural, not accidental.

> **Seed findings (2026-06-24, from the §5.A isolation work)** — concrete items surfaced incidentally; promoted here
> per the §5.U convention rather than lost. The full deliberate pass (above) is still owed.
- [~] **Establish + enforce a sandbox-cwd vs host-path naming convention in the agent runtime.** This session fixed a
      *class* of bug where the agent-perceived working directory (the in-container sandbox path) was conflated with the
      host-side control-plane read path, because both flowed through a single `request.cwd`: `config.cwd`, the SDK
      system-prompt `<env>` "Working Directory", and the repo-map/`getWorkspaceChanges` orientation reads all used it,
      so two leaked the host mount to the agent and one (repo map) silently read a nonexistent path. Now centralized via
      `resolveNKleinAgentPerceivedCwd` (sandbox) vs `orientationWorkspacePath`/`artifactWorkspacePath` (host).
  - [x] **convention applied to the hot path (2026-06-24)** — established the greppable vocabulary `agentPerceivedCwd`
        (sandbox-under-isolation / host for home) vs `hostWorkspaceRoot` and applied it behavior-preservingly across
        `nklein-session-runtime.ts` (the `StartNKleinSessionRuntimeRequest.cwd`/`workspaceRoot` fields are now
        documented; the dispatch defines the two named locals once and threads them; the default workspace tools +
        large-file key + agent `config.cwd` + focus-extension agent arg use `agentPerceivedCwd`; the trusted
        decomposition tool + repo-map/git orientation use `hostWorkspaceRoot`, which also **removed the latent trap**
        of passing the sandbox `request.cwd` as the decomposition tool's `workspacePath`) and the
        `nklein-task-session-service.ts` main start dispatch (`effectiveCwd` → `agentPerceivedCwd`; its `cwd` field
        documented as the host path). tsc + biome + full nklein-sdk suite (693) green.
  - [x] **restart-rebuild `ensureRuntimeSetup` host-root fix (2026-06-24).** Confirmed the mechanism end-to-end:
        `record.cwd` is the SDK-persisted `config.cwd` (`resolveNKleinAgentPerceivedCwd(...)` = `/workspaces/<taskId>`
        under isolation), so `startRuntimeTaskSessionFromLaunchConfig` (the rebuild path used when `canRestartTaskSession`
        is false — e.g. after a runtime **process restart**) was handing that sandbox path to the host `ensureRuntimeSetup`
        (rules / tool-policy / system-prompt setup, keyed on the path), silently loading **no** rules/setup on resume.
        Fixed: it now keys on the **host** root (`input.workspaceRoot?.trim() || launchConfig.workspaceRoot?.trim() ||
        input.cwd`), mirroring the main start path. Locked by a **red-green** unit test (a fake-runtime
        `simulateProcessRestart()` drives the rebuild and asserts the runtime setup resolves against `/host/project-root`,
        never `/workspaces/<taskId>`). tsc + full nklein-sdk suite (694) green.
  - [x] **restart-rebuild now re-preps the Docker sandbox + passes sandbox tools (2026-06-24).** The deeper fix:
        `startRuntimeTaskSessionFromLaunchConfig` (the chokepoint all rebuild callers funnel through) now calls
        `prepareSandboxWorkspace` (checks out the task's result branch via `resolveTaskResultBranchCommit`), perceives
        the in-container `workdir` as the agent cwd, and passes `createAgentSandboxToolExecutors`/`ExtraTools` — so a
        restarted isolated task runs with **sandbox-proxied** tools on `/workspaces/<taskId>`, never host file tools on a
        non-existent sandbox path (invariant #2). It disposes the freshly-prepped sandbox on a failed start. This also
        **fixes the send-path sibling**: `prepareSandboxWorkspace` records `sandboxRepoPathByTaskId` (host repo path), so
        `sendTaskSessionInput`'s `runtimeSetupWorkspacePath = sandboxRepoPathByTaskId.get(taskId) ?? …` now resolves the
        host root after a rebuild instead of falling back to the sandbox `workspacePath`. Skipped when the caller already
        supplied sandbox executors (it owns the sandbox). Locked by a second **red-green** unit test (fake sandbox
        manager: asserts the rebuild `prepareWorkspace`s the task against the host repo path and starts with the sandbox
        cwd + sandbox `extraTools`/`toolExecutors`). tsc + biome + full nklein-sdk suite (695) green.
  - [x] **live-verified (2026-06-24).** New harness
        [scripts/verify-restart-resume-isolation.mts](scripts/verify-restart-resume-isolation.mts) (isolated HOME, live
        LM Studio `qwen/qwen3-8b`, real Docker) runs a real isolated task in service A → sandbox container
        `nklein-agent-sandbox-1` appears + the session advances; disposes A (containers → NONE); then a **fresh** service
        B (the "restarted process") `reloadTaskSession`s it and **re-preps a sandbox container** — proving the rebuild now
        prepares the sandbox. **PASS:** resume re-prepped a container, no host worktree, **no host project path leaked to
        the agent**, no containers leftover after dispose. (Pre-fix, phase 2 would show no container.)
  - [x] **`captureTaskTurnCheckpoint` confirmed inert under isolation (2026-06-24).** It's fire-and-forget
        (`void captureTaskTurnCheckpoint({ cwd: summary.workspacePath }).then(…)`), so on a sandbox `cwd` the git ref
        command fails silently and the matching `deleteTaskTurnCheckpointRef` no-ops too — a vestige of the
        host-worktree era, superseded by the `nklein/tasks/<task>` result-branch resume path. No correctness impact; a
        candidate for removal in the §5.U service-decomposition / worktree-module cleanup, not a bug to fix here.
- [~] **Decompose the oversized `nklein-task-session-service.ts` (~3900 lines).** It conflates: session lifecycle,
      Docker sandbox prep/dispose, timeout scheduling, the swarm guardrail watchdogs (turn/wall-time/no-diff/repeated-
      tool limits), prompt assembly, the message repository, second-opinion review orchestration, and decompose-apply
      wiring. Extract focused modules (sandbox-lifecycle, timeout-scheduler, guardrail-watchdogs, prompt-assembly) behind
      the existing service. Overlaps §5.A "Isolation polish" (extract sandbox-lifecycle/pause) — do together. Pure
      refactor, no behavior change; lock with the existing suite. (Respects invariants; navigability win per §5.U.)
  - [x] **guardrail-watchdog family extracted under §5.X Phase 1 (2026-06-26):** the named "swarm guardrail watchdogs"
        target is now three focused collaborators — M1 `DecompositionStallNudger` (`85ffd63b`), M2 `RepeatedToolCallGuard`
        + repeated-failure-target (`56e641dc`), M3 `AutonomyBudgetWatchdog` (turn/wall-time/no-diff budgets, `f785d739`);
        each owns its per-task state + decision with I/O injected via callbacks, all behavior-preserving + gates green.
        **session-service 3907 → 3449 (−458).** Remaining named targets: sandbox-lifecycle, timeout-scheduler,
        prompt-assembly, message-repository (the interwoven orchestration core — no longer cleanly-separable guard seams).
  - [x] **first slice (2026-06-24):** extracted the 4 self-contained pure prompt parsers + `WORD_NUMBER_BY_TEXT` into
        [nklein-task-prompt-parsing.ts](src/nklein-agent/nklein-task-prompt-parsing.ts) (`parseRequestedMinimumTaskCount`,
        `parseAcceptanceCommand`, `isDecompositionPlanningPrompt`, `isExplicitDecompositionPrompt`) + a dedicated test.
        Behaviour identical (service suite 119 green). Chosen as the lowest-risk slice (zero in-file deps, compiler-
        verified). The bigger stateful extractions (sandbox-lifecycle, timeout-scheduler, guardrail-watchdogs) remain.
  - [x] **second slice (2026-06-24):** extracted the 3 pure SDK-event readers (`readSdkAgentEvent`,
        `readSdkSessionEvent`, `readAgentResultText`) into
        [nklein-sdk-event-readers.ts](src/nklein-agent/nklein-sdk-event-readers.ts) (importing the shared `asRecord`),
        with a dedicated test; this also made the service's local `asRecord` import dead (removed). Behaviour
        identical (service suite 109 + readers 6 green).
  - [ ] **remaining clusters are coupled (need the careful pass):** the context-budget/message-classification
        helpers share local types (`NKleinSdkContentBlock`/`NKleinSdkToolResultBlock`/`ContextHistoryTokenSegments`)
        with the service class and `stringifyToolResultContent` has an external consumer; the guardrail/repeated-tool
        helpers share `NKleinTaskRepeatedToolState` with the class. Extracting these needs the shared types moved/shared
        first (to avoid circular imports) — do in the focused decomposition pass with the stateful modules.
- [x] **Consolidate the duplicated `asRecord` helper** *(DONE 2026-06-24)* — `asRecord` was re-defined locally in 5
      `src/nklein-agent/*` files (event-adapter, model-registry, session-runtime, task-session-service, team-progress).
      Extracted the canonical strict version (non-null, non-array object) to
      [nklein-value-guards.ts](src/nklein-agent/nklein-value-guards.ts); all 5 now import it; removed the copies + the
      now-unused `JsonRecord` alias. The one behavioural reconciliation — the event-adapter copy had omitted the
      `!Array.isArray` guard — is safe (its inputs are JSON object shapes, not arrays) and locked by the full suite
      (1376 green). **`toErrorMessage` deliberately NOT consolidated:** its 3 copies have intentionally-different
      fallback strings per context ("Unknown error" / "An unexpected error occurred." / `String(error)`) — merging
      them would change user-facing messages, so they stay local.

- [~] **DRY the repetitive `runtime-config.ts` per-field plumbing** *(finding 2026-06-24, from adding `swarmGuardrails`)*.
      *(2026-06-24: safe slice landed — added `assignChangedConfigField(payload, existing, key, value, default)`
      and collapsed all **18** simple `===`-comparable diff-gated payload-write blocks (single- and multi-line) to
      one helper call each (~45 fewer lines). Behaviour identical (31 config round-trip tests green). The 4 bespoke
      payload gates keep their custom comparisons: developer-mode's legacy check, the profile-coupled timeouts, and
      the nested-object equality fields (codeEmbeddingDefaults / swarmGuardrails). The full field-descriptor registry
      across the interfaces/resolve/update functions is still owed.)*
  - [x] **resolve-ternary simplification (DONE 2026-06-24)** — collapsed the provably-redundant
        `config.X === undefined ? DEFAULT_X : normalizeX(config.X, DEFAULT_X)` ternaries in
        `writeRuntimeGlobalConfigFile`'s resolve section to plain `normalizeX(config.X, DEFAULT_X)` (the four scalar
        normalizers all fall back on `undefined`). Behaviour-identical (31 round-trip tests green, typecheck clean,
        −9 net lines). Excluded the profile-coupled timeouts and `selectedAgentId`/`selectedShortcutLabel`.
  - [x] **change-detection registry (DONE 2026-06-24)** — the first field-descriptor slice. The two long, parallel
        `nextConfig.X !== current.X` OR-chains that `updateRuntimeConfig` (project, 33 lines) and
        `updateGlobalRuntimeConfig` (global, 31 lines) each hand-maintained — a real drift risk (add a field, forget a
        chain → a genuine change silently treated as no-op) — are now one declarative `RUNTIME_*_CONFIG_CHANGE_FIELDS`
        registry (`{ key, changed }`, referential `!==` by default or a captured deep-equality for the nested
        object/array fields) consumed by `runtimeConfigStateHasChanges(...)`. A **completeness drift-guard test** asserts
        the registry covers exactly the non-derived `RuntimeConfigState` keys (red-green: dropping a field fails it), so
        the registry is the single source of truth and adding a field now *fails* until registered. Byte-identical (32
        config tests green incl. the guard; full fast suite 1387 green). Note: the `nextConfig` builders + the `next`
        param of the helper are typed `RuntimeConfigChangeComparable` (state minus the 5 derived/path fields).
  - [x] **per-field save-coverage test + nextConfig DRY (2026-06-24)** — added a data-driven test that round-trips
        each of the 25 simple scalar fields through `updateRuntimeConfig` + reload (closing the coverage gap for the
        timeouts / sandbox-pool / mode-profile / prompt-template fields and acting as a nextConfig drift guard), then
        flattened both update builders' repetitive `updates.X === undefined ? current.X : …` ternaries with shared
        `keepUpdatedValue` / `keepNormalizedValue` helpers (one uniform line per field; only the bespoke `shortcuts` /
        `codeEmbeddingOverride` per-builder lines stay explicit). Byte-identical (33 config tests + full fast 1388 green).
  - [ ] still owed (lower value): extend a `{ key, default, normalize }` descriptor to the **resolve**
        (`toRuntimeConfigState`) + the diff-gated **payload writes**. The drift risk those guard against is now already
        covered (change-detection registry + the per-field save-coverage test), so this is readability-only — pick up
        only if the resolve/payload sites grow.
      Every config field is hand-threaded through ~10–14 near-identical sites: 3 interfaces (`*FileShape`/`*State`/
      `*UpdateInput`), the `toRuntimeConfigState` resolve, `writeRuntimeGlobalConfigFile` (param + resolve + diff-gated
      payload), `createRuntimeConfigStateFromValues` (param + return), `toGlobalRuntimeConfigState`, and both
      `updateRuntimeConfig`/`updateGlobalRuntimeConfig` (nextConfig + hasChanges + write + state). Adding one field
      touches ~14 spots and is error-prone. A **field-descriptor registry** (`{ key, schema, default, normalize,
      equals }` per field) iterated by generic load/save/update helpers would collapse this to one entry per field.
      High maintainability value; no invariant touched; lock with the existing `runtime-config.test.ts` (behaviour must
      stay byte-identical).
- [ ] **Decompose the oversized `runtime-settings-dialog.tsx` (~3700 lines).** It conflates dozens of settings
      sections + their state/dirty/save wiring in one component. This session set the precedent: self-contained
      `KleinCorePyHealthLine` + `AgentRulesetsSettingsPanel` panels. Extract more sections (the swarm-guardrails
      editor, the model-roles block, the sandbox-pool fields, the timeouts) into focused `*-settings-panel.tsx`
      components that own their inputs and expose `value`/`onChange`, shrinking the dialog to composition. web-ui-only
      navigability win; lock with the existing dialog suite.
      **STARTED (2026-06-26): first slice — the MCP-suggestion parsing group** (`parseMcpSuggestionText` + its internal
      `asRecord`/`stringField`/`parseAddableMcpServer` helpers + the `ParsedMcpSuggestion` type) extracted to
      `web-ui/src/components/runtime-settings-mcp-parsing.ts` (pure, self-contained, no React/state) + a focused 7-case
      unit test it never had. **Pattern (lowest-risk first):** pull the dialog's many **pure helper groups** (model-role
      normalize/serialize, swarm-guardrail input conversion, provider/command-display helpers, …) into focused modules
      before the stateful section/hook extractions — each is a behavior-preserving move verified by the existing 36-test
      `runtime-settings-dialog.test.tsx` (the oracle) + `web:typecheck` + `web:build`. Verified green. **2 slices done:
      (1) MCP-suggestion parsing → `runtime-settings-mcp-parsing.ts` (+7-case test); (2) provider-catalog helpers
      (`normalizeProviderId` / `findProviderCatalogItem` / `formatProviderOptionLabel`) →
      `runtime-settings-provider-helpers.ts`; (3) swarm-guardrail form conversion (`WALL_TIME_BOUNDS_HOURS`,
      `SwarmGuardrailInputs`, `swarmGuardrailsToInputs`/`inputsToSwarmGuardrails`/`isGuardrailInputOutOfRange`) →
      `runtime-settings-swarm-guardrails.ts`. dialog 4430 → 4304.**
      **STATEFUL SECTION extractions now started (the user-chosen "settings-dialog sections" focus): (4) the swarm-guardrails
      editor card → `swarm-guardrails-settings-panel.tsx` (233 lines).** It's a controlled `SwarmGuardrailsSettingsPanel`
      that OWNS the real behavior (the 4 editable autonomous-run limits + per-field out-of-range flagging + reset-to-defaults)
      and takes `value`/`onChange` for the guardrail inputs plus the read-only context tiles (concurrent-cards / sandbox-pool /
      heartbeat / plan-artifacts) as plain props, so it never re-reads sibling state. The parent keeps the guardrail input
      `useState` (the unified dirty/save path needs it). The 4 field-id consts + `LOCAL_SWARM_GUARDRAIL_ROWS` moved into the
      panel; the dialog's now-unused imports were biome-pruned. **dialog 4304 → 4086 (−218).** Verified: web:typecheck +
      36-test dialog oracle (its "surfaces local swarm guardrail limits" case renders the panel through the dialog and
      asserts the input ids + seeded values) + web:build.
      **(5) the model-roles block → `model-roles-editor.tsx` (the `ModelRolesEditor` component, ~326 lines, was inline) +
      shared `runtime-settings-model-roles.ts` (the role consts/labels + normalize/serialize, used by BOTH the editor and
      the dialog's dirty/save path).** The 7 shared symbols (`MODEL_ROLE_IDS`/`ModelRoleId`/`MODEL_ROLE_LABELS` +
      `normalizeModelRolesForSettings`/`serializeModelRoles`; the two inner normalizers stay module-private) moved to the
      shared module; `REASONING_EFFORT_OPTIONS` (editor-only) moved into the editor; the editor's `React.X` type refs were
      made explicit (`Dispatch`/`SetStateAction`/`ReactElement` imports). **dialog 4086 → 3709 (−377).** Verified:
      web:typecheck + 36-test oracle + web:build.
      **(6) command-display helpers → `runtime-settings-command-display.ts`** (`quoteCommandPartForDisplay` +
      `buildDisplayedAgentCommand`, pure, shell-quotes the per-agent launch command shown in Settings). Verified:
      web:typecheck + 36-test oracle + web:build. Next clean pure-helper group: timeout-profile (`normalizeAgentTimeoutProfile`).
      **Note on the remaining "sections" (timeouts / sandbox-pool):** extracting them as controlled panels would be a
      **thin 16-prop pass-through** (8 timeout `useState`s woven through init/dirty/save) — the AGENTS.md "avoid thin shell
      wrappers" rule says don't; the clean version first consolidates the 8 vars into one state object (a bigger refactor).
      Deferred to a focused state-consolidation pass, not a quick slice.
- **Monolith-file inventory → decompose the rest** *(review-pass finding 2026-06-24; the user re-emphasized "no
      large monolith files"; umbrella — each file below is its own counted, landable decomposition item)*. A line-count
      sweep surfaced the oversized files beyond the two already tracked above (`nklein-task-session-service.ts` ~3850,
      `runtime-settings-dialog.tsx` ~4095). Each below is its own landable decomposition item — extract cohesive
      sub-modules, no behavior change, locked by the existing suites:
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
        - [ ] still TODO: the per-subcommand registration split (`registerTaskCommand` is ~470 lines) + lifting the command
              implementations (createTask/updateTaskCommand/startTask/finishTask/decomposeTaskGraph…) into per-concern
              modules. These call each other + the now-extracted infra, so they're the larger, more-entangled follow-up.
  - **`src/trpc/runtime-api.ts` (~2449 → 2314)** *(umbrella — slices below are the counted work; the remaining slice is
        the open child. NB §5.X Phase 1 has since driven this file far lower (2410 → 1353); reconcile this item's
        progress against the §5.X slices 1–8 if revisiting)* — `createRuntimeApi` is one giant object literal of every
        method (config, providers, MCP, tasks, chat, debug, update, …). Group methods into focused factory modules
        (`runtime-api/config.ts`, `/tasks.ts`, `/providers.ts`, `/chat.ts` — the chat seam is already a clean
        `chat-service`) composed into the returned object; mirrors the `CreateRuntimeApiDependencies` seam.
        - [x] **slice 1 (2026-06-24):** extracted the pure effective-task-timeout resolution (profile defaults + mode scale +
              local floor + source precedence) into `trpc/runtime-api/task-timeout-settings.ts`. runtime-api.ts 2449→2314.
        - [x] **slice 2 (2026-06-24):** extracted the GitHub-context-import subsystem (gh-CLI issue/PR-diff → import response)
              into `trpc/runtime-api/github-context-import.ts`. runtime-api.ts 2314→2253.
        - [x] **slice 3 (2026-06-24):** extracted the local-advisor-completion subsystem (Ollama `/api/chat` + OpenAI-compat
              `/chat/completions`, base-URL normalization, tolerant response parse, 120s abort) into
              `trpc/runtime-api/local-advisor-completion.ts`. Also dropped the redundant local `ResolvedNKleinLaunchConfig`
              derivation in favour of the canonical exported interface from `nklein-provider-service`. runtime-api.ts 2253→2106
              (cumulative 2449→2106, −343/−14%).
        - [x] **slice 4 (2026-06-24):** extracted the pure task-evidence rendering (bounded workspace-changes diff preview +
              the evidence-bundle diagnosing-prompt block) into `trpc/runtime-api/task-evidence-prompt.ts`. runtime-api.ts
              2106→2047 (cumulative 2449→2047, −402/−16%).
        - [x] **slice 5 (2026-06-24):** extracted the pure task-start concurrency-gate accounting (count *other* active
              project sessions + the limit-reached error) into `trpc/runtime-api/task-concurrency-gate.ts`. runtime-api.ts
              2047→2028 (cumulative 2449→2028, −421/−17%).
        - [ ] still TODO: the object-literal method grouping into factory modules (config/tasks/providers/chat) — the bigger,
              harder refactor (methods close over `createRuntimeApi`'s deps; deserves fresh context). Small leftover
              module-level helpers worth a later pass: the board-card lookups + git-commit resolution.
  - **`src/nklein-agent/nklein-provider-service.ts` (~1989 → 1744)** *(umbrella — slices below are the counted work; the
        remaining slice is the open child)* — provider selection + OAuth (nklein/oca/codex) +
        MCP settings + local-provider discovery in one. Split per provider-family / concern. (Coordinate with §5.R.)
        - [x] **slice 1 (2026-06-24):** extracted the pure discovered-model parsing/normalization (LM Studio `/api/v0|v1`
              + generic OpenAI-style payloads → `RuntimeNKleinProviderModel[]`, context-window normalization, dedupe,
              registry/fallback merges) into `nklein-agent/nklein-provider-model-parsing.ts`. Pathnames passed as `string`
              so the module stays decoupled from the service's pathname unions. provider-service 1989→1744 (−245/−12%).
        - [x] **slice 2 (2026-06-24):** consolidated the remaining pure model helpers (`toRuntimeProviderModel`,
              `sortDiscoveredProviderModels` + private `getDiscoveredModelSortRank`) into the same parsing module.
              provider-service 1744→1723 (cumulative 1989→1723, −266/−13%).
        - [ ] still TODO: the OAuth/account token helpers (pure but *pervasively* used — extracting them is high-churn /
              low navigability gain, so likely leave in place), the model-list *fetchers* (LiteLLM/LM Studio/generic endpoint
              discovery — I/O + const/schema deps, ~340 lines, a cohesive next module but deserves fresh context), the MCP
              settings, and the launch-config resolution.
  - **`web-ui/src/components/card-detail-view.tsx` (~2384 → 2330)** *(umbrella — slices below are the counted work; 10
        slices done (−55%), the remaining lower-priority slice is the open child)* — already composes `detail-panels/*`,
        but still holds many local skeleton/loading/empty/section components + resize + keyboard orchestration. Extract
        the skeleton/loading/empty panels + the bottom-terminal/workspace-changes sections into `detail-panels/`.
        - [x] **slice 1 (2026-06-24):** extracted the workspace-changes loading + empty presentational panels (and their
              private skeleton primitives) into `detail-panels/workspace-changes-skeleton.tsx`. Pure prop-driven, no
              behavior change; verified `web typecheck` + `web vitest` (690) green. card-detail-view 2384→2330.
        - [x] **slice 2 (2026-06-24):** extracted the pure task-activity model + formatters (`buildTaskActivitySteps` +
              tone/label/detail helpers + `formatDiagnosticTime`) into `detail-panels/task-activity-model.ts`. No JSX,
              no behavior change; web typecheck + vitest (690) green. card-detail-view 2330→2126 (cumulative 2384→2126, −11%).
        - [x] **slice 3 (2026-06-24):** extracted the pure planning-DAG model + formatters (`buildPlanningDagNodes` BFS over
              the dependency graph, complexity/model-fit prompt parsing, revised-card classification, node label/tone) into
              `detail-panels/planning-dag-model.ts`. No JSX; web typecheck + vitest (690) green. card-detail-view 2126→1994
              (cumulative 2384→1994, −16%).
        - [x] **slice 4 (2026-06-24):** extracted the self-contained `FocusChainPanel` (live editable focus-chain todo list)
              + its status consts + duration formatter into `detail-panels/focus-chain-panel.tsx`. web typecheck + vitest (690)
              green. card-detail-view 1994→1810 (cumulative 2384→1810, −24%).
        - [x] **slice 5 (2026-06-24):** extracted the self-contained `SecondOpinionReviewPanel` (+ its REVIEW_STATUS_META)
              into `detail-panels/second-opinion-review-panel.tsx`. web typecheck + vitest (690) green. card-detail-view
              1810→1760 (cumulative 2384→1760, −26%).
        - [x] **slice 6 (2026-06-24):** extracted the self-contained `TaskDiagnosticsPanel` (lazy local-telemetry fetch +
              refresh, collapsible) + its private `getDiagnosticSeverityClassName` into `detail-panels/task-diagnostics-panel.tsx`.
              web typecheck + vitest (690) green. card-detail-view 1760→1649 (cumulative 2384→1649, −31%).
        - [x] **slice 7 (2026-06-24):** extracted the self-contained `TaskEvidenceDrawer` (evidence-bundle path + file list +
              tabbed summary/diff/prompt viewer) into `detail-panels/task-evidence-drawer.tsx`. web typecheck + vitest (690)
              green. card-detail-view 1649→1596 (cumulative 2384→1596, −33%).
        - [x] **live verification (2026-06-24):** rebuilt web-ui + ran a Playwright smoke (`scripts/verify-card-detail-ui.mts`)
              against the preview: the app boots, the board renders (incl. the trash-below-completed layout), and opening a
              card works — **zero console/page errors**. Confirms the 7 extractions are bundle-sound; panel rendering itself is
              covered by the 690 web component tests.
        - [x] **slice 8 (2026-06-24):** extracted the `PlanningDagReviewPanel` (renders the dependency-neighbourhood DAG +
              the plan-mode "Approve for execution" action; consumes the already-extracted `planning-dag-model`) into
              `detail-panels/planning-dag-review-panel.tsx`. web typecheck + vitest (690) green. card-detail-view 1499→1491
              (cumulative 2384→1491, −37.5%).
        - [x] **slice 9 (2026-06-24):** extracted the `PendingPlanArtifactsPanel` (lists decomposition plan artifacts
              awaiting a decision + apply/reject handlers with toasts) + its `formatArtifactTimestamp` into
              `detail-panels/pending-plan-artifacts-panel.tsx`. web typecheck + vitest (690) green. card-detail-view 1491→1328
              (cumulative 2384→1328, −44%).
        - [x] **slice 10 (2026-06-24):** extracted the `TaskRecoveryActionsPanel` (verify/merge/mark-interrupted/collect-
              evidence actions + the inline TaskEvidenceDrawer) and its hasAcceptanceCheck/formatVerifyResult/formatMergeResult
              helpers into `detail-panels/task-recovery-actions-panel.tsx`. **All card-detail panels now extracted.**
              card-detail-view 1328→1072 (cumulative 2384→1072, **−55%**, 10 new `detail-panels/*` modules). web typecheck +
              vitest (690) green.
        - [ ] still TODO (lower priority): lift the resize/keyboard orchestration (`useResizeHandler` + the hotkey/escape
              effects) into a `use-card-detail-keyboard`/layout hook; the remaining file is mostly the `CardDetailView`
              composition root + the small DiffToolbar/MobileDetailTabBar/BottomTerminalSection/TaskActivitySurface helpers.
  - **`web-ui/src/components/project-navigation-panel.tsx` (~1346 → 1276)** *(umbrella — slices below are the counted
        work; 5 slices done (−47%), the remaining lower-priority slice is the open child)* — the Projects sidebar. Split
        the project list, the dev-scenario/self-improvement block, and the per-project actions menu.
        - [x] **slice 1 (2026-06-24):** extracted the keyboard-shortcuts cheatsheet (ShortcutHint + ShortcutsCard + the
              essential/more shortcut tables + platform modifier glyphs) into `project-nav/shortcuts-card.tsx`. web typecheck +
              vitest (690) green. project-navigation-panel 1346→1276.
        - [x] **slice 2 (2026-06-24):** extracted the beta `ProjectSupportFooter` (Featurebase feedback / GitHub-issues
              link) + its GITHUB_ISSUES_URL into `project-nav/project-support-footer.tsx`. web typecheck + vitest (690) green.
              project-navigation-panel 1276→1233.
        - [x] **slice 3 (2026-06-24):** extracted the `ProjectHealthCard` (per-project diagnostics + inspect/migrate/remove
              actions) into `project-nav/project-health-card.tsx`. web typecheck + vitest (690) green. project-navigation-panel
              1233→1109.
        - [x] **slice 4 (2026-06-24):** extracted the `DevTestProjectCard` (dev-scenario block: self-improvement + the
              fixture preset projects + copy-evidence/cleanup) into `project-nav/dev-test-project-card.tsx`. web typecheck +
              vitest (690) green. project-navigation-panel 1109→922 (cumulative 1346→922, −31%, 4 new `project-nav/*` modules).
        - [x] **slice 5 (2026-06-24):** extracted the `ProjectRow` + `ProjectRowSkeleton` (project list row with task-count
              badges + per-project actions menu, and the loading skeleton) + the `TaskCountBadge` type into
              `project-nav/project-row.tsx`. web typecheck + vitest (690) green. project-navigation-panel 922→708 (cumulative
              1346→708, **−47%**, 5 new `project-nav/*` modules).
        - [ ] still TODO (lower priority): the big `ProjectNavigationPanel` body itself — the drag-resize handlers + the
              project-CRUD / dev-test orchestration (createDevTestProject/cleanup/migrate/self-improvement) could move into a
              `use-project-nav-actions` hook, leaving the component as mostly layout.
  - [ ] *(also large, lower priority): `web-ui/src/App.tsx` (~1350, composition root — extract more orchestration into
        hooks), `board-card.tsx` (~1198), `use-board-interactions.ts` (~1142), ~~`nklein-decomposition-tool.ts` (~1440)~~
        (DONE — decomposed to 391 lines by §5.X Phase 1 PILOT), `nklein-session-runtime.ts` (~1421),
        `state/workspace-state.ts` (~1124).* Assess during the full §5.U pass.
- [x] **Persist the resolved launch role on the session summary** *(DONE 2026-06-24)* — added an optional `role`
      (`RuntimeModelPerformanceRole`) to `runtimeTaskSessionSummarySchema`, stamped at task start (the `entry.summary`
      chokepoint, persisting through `updateSummary`'s spread) via a shared `resolveNKleinTaskRole(taskId,
      isDecomposition)` — reviewer for `::review`, architect for an explicit decomposition, worker otherwise. The
      terminal run-summary capture now reuses the same helper so the live + run summaries agree. Unit-tested
      (worker + reviewer stamp). **Unblocks §5.G #425** — the board role strip can now read `summary.role` instead of
      inferring from `startInPlanMode`.

### 5.V — Comprehensive test coverage *(2026-06-25, user — "really complete coverage to control the whole complexity")*
> Two layers (no CI infra yet → run locally; agent keeps the full suite incl. slow e2e green periodically). **(1) Fast
> deterministic gate** — component/integration + Playwright against a built app with a mocked runtime; always green.
> **(2) Real punch-through e2e** — live LM Studio + Docker, driving NEW dev-test projects that exercise *all* use cases,
> like the existing `verify-*.mts` harnesses. **Goal: complete coverage** of every workflow + user-facing feature + UI
> element + configuration, and that everything stays **smooth**. North-star tie-in: the e2e must prove small models can
> grind a decomposed-into-tiny-pieces complex project to delivery.
>
> **⭐ THIS IS THE PRECONDITION FOR §5.X (the deep whole-codebase refactor / possible backend→Python port) (2026-06-25,
> user).** Before any large structural refactor we need a test net thick enough that a behavior regression cannot pass
> unseen. **So the tests must assert BEHAVIOR through STABLE SEAMS, not TS internals** — the tRPC/HTTP contract, the CLI,
> the web-ui, the on-disk state/CRDT formats, the Docker/agent boundaries, the live decompose→merge pipeline. Those seams
> survive a backend rewrite (incl. a Python port); tests bound to TypeScript module internals do **not** and would have to
> be rewritten in lockstep, defeating the safety net. Treat contract/e2e/UI/CLI coverage as the **port-resilient
> regression oracle**: the same suite must be runnable against the current TS backend AND a future Python backend and
> assert identical externally-observable behavior. **Sequencing: complete §5.V first → then §5.X.**

> **§5.V PROGRESS (2026-06-26 — this session).** **Contract layer (port-resilient HTTP-seam suites): 272 tests across
> Suites 1–21**, covering ~55 of ~88 tRPC procedures — workspace state/git/git-actions, board/card mutations (+revision
> conflict 409), settings/config (+per-project override no-leak), projects, chat sessions, runtime status/registry reads,
> swarm-stop. Remaining contract gaps are mostly **LIVE-ONLY** procedures (need a model/session/remote — task
> start/stop/pause/resume, streamMessage, runGitSyncAction, …) → those belong to the live-e2e layer, not more contract
> suites. **Live e2e (qwen3-8b + Docker): the north-star CORE is PROVEN** — isolation healthy; **decompose works** (after
> the `title`-recovery fix); **a card runs to `awaiting_review` with a correct, ready-to-merge result branch**. **Biggest
> remaining §5.V piece:** a FULL-RUNTIME multi-card pipeline e2e (decompose → dependency-ordered/parallel runs → review →
> merge → deliver) — needs the full server + board/lane orchestration (not the stripped in-memory harness), so it is a
> focused arc best started on a fresh context.
- [~] **Untested-pure-core unit sweep** *(parallel fast-regression layer — TS-internal, not the port oracle, but genuine
      "control the whole complexity" coverage of shipping logic that had zero tests; prioritize security/correctness-
      critical modules)*. **Started 2026-06-27:** `agent-write-guard` (129 lines, security-relevant: protected-test-path
      matching + **secret detection** — private-key/Anthropic/OpenAI/GitHub/AWS/credential-assignment patterns where a
      regex typo = a missed leak) → 15 unit tests covering normalize/count, path-normalization (backslash, `./`, exact-dir,
      lookalike-prefix non-match), approval-request defaults+truncation, and each secret pattern incl. first-match-wins
      labeling. **Also covered (2026-06-27):** `model-identity` (6 tests — provider lowercase/trim, model case-preserve,
      and the §5.Q endpoint canonicalization that maps `127.0.0.1`/`0.0.0.0`/`[::1]`/`localhost` + trailing-slash to one
      key so the registry/telemetry don't double-count); `protected-test-approval-store` (7 tests — deterministic
      sha256 key, one-time-use consume, content-fallback when no taskId, clear). **`src/core` non-schema sweep COMPLETE
      (2026-06-27):** also added `task-session-guards` (reviewable-summary single source of truth — actionable reasons
      true, interrupted/null + non-review states false), `home-agent-session` (prefix/workspace scoping incl. ws-1/ws-10
      overlap non-match), `git-process-env` (strips GIT_DIR/WORK_TREE/INDEX to stop parent-hook hijack; override wins),
      `shell` (POSIX quoting/escaping + `$SHELL` interactive resolution), `workspace-scope` (header on/off). Every
      remaining untested `src/core/*.ts` is now a `*-api-contract` zod schema already exercised by the HTTP contract
      suites. **Extended the sweep to `src/nklein-agent` + `src/config` (2026-06-27):** `nklein-value-guards` (`asRecord`
      record-vs-array/null/primitive), `nklein-slash-commands` (`/clear` lone-command match: trim/case-fold yes,
      trailing-text/different-command/no-slash no), `shortcut-utils` (`areRuntimeProjectShortcutsEqual` length+field
      diffing, absent-vs-empty icon equal), `legacy-env` (`readEnvWithLegacyFallback` current-wins-no-warn,
      legacy-fallback-warn-once-per-name via injected `env`, trim, undefined-when-unset — the `KANBAN_*→NKLEIN_*`
      deprecation path). **Pivoted to meatier modules (higher coverage-per-test) 2026-06-27:**
      `workspace/remote-path-confinement` (8 tests — SECURITY: `--host` remote-mode root confinement; allows exact+nested,
      rejects sibling-prefix `/home/user2` vs `/home/user`, `..`-traversal escape, unrelated paths, empty-roots; roots
      deduped/resolved with home first); `nklein-context-budgets` (11 tests — the 172-line token-budget math:
      unknown-window fallbacks, reserve/file-chunk caps on a 200k window, proportional scaling at 8k, floors + fractional
      truncation at 2k, and the pressure policy's low/medium/high banding + budget floor/cap + `[0.55,0.82]` compaction
      clamp across window/wall-time signals — a regression here silently breaks file-chunking/compaction);
      `nklein-pause-controller` (9 tests — card-vs-board pause scoping, parked-set tracking separate from the gate,
      `waitUntilResumed` immediate/blocking/board-still-paused resolution + abort-signal/`abortTaskWaiters` rejection);
      `isContextOverflowError` (6 tests — recognizes varied vendor overflow phrasings, rejects unrelated errors + non-Error
      values; a false negative crashes the run instead of triggering compaction recovery); `nklein-guidance-skills`
      (5 tests — the topic router: keyword + file-path routing, security>ui>ts priority when several match, null on no
      match, topic→slash-command map — a misroute injects the wrong skill guidance). **Remaining pure-unit candidates:**
      `nklein-context-overflow-compaction` (the compaction body — needs message fixtures), `nklein-watcher-registry`.
      **Skip (I/O-coupled, need an integration harness not a unit):** `workspace/project-health`,
      `workspace/turn-checkpoints` (git/fs), `nklein-mcp-settings-service`, `task-worktree-sync`.
      **Decomposition validation (north-star §5.B) 2026-06-27:** `plan-task-validation` question logic (7 tests) —
      `deriveOpenQuestionDefaults` (the AGENTS.md parse-and-recover: open question with options → assumption from the
      recommended option, else first option, stays `open`; no-options/has-default/non-open left untouched) +
      `validatePlanQuestions` (open needs a working default, answered needs an answer, assumed-default needs an
      assumption). *(Scan note: my "untested" basename heuristic has false positives when the test file is named
      differently from the source — e.g. `agent-sandbox/path-normalization.ts` IS covered by
      `agent-sandbox-path-normalization.test.ts`; content-verify with a test-import grep before assuming untested.)*
      **`plan-task-validation.ts` now FULLY covered** (+10 graph/sizing tests): `validateTaskSizingContract`
      (acceptance-command required, test-first needs a prompt, complexity ≤75 + ≤3 likely-files split gates),
      `validateTaskGraphReferences` (edge count, duplicate-id + dangling-dependency rejection),
      `normalizeTaskAcceptanceCommand` (default-command precedence, test-first cleared without a prompt, dependsOn
      dedupe/trim). **`plan-task-expansion.ts` covered (9 tests)** — the recursive split-into-tiny-pieces core:
      `uniqStrings`, `formatExpansionRevisionMarkdown` (null when nothing expanded), `getReplacementBoundaryTaskIds`
      (entry/terminal of a chain, parallel = both, cyclic throws), and `expandDecomposeProjectTasks` (no-op passthrough;
      **replaces a task with its sub-graph and rewires dependents to the terminal node**; throws on empty replacement,
      unknown id, depth-limit breach, cycle). The decomposition validation+expansion pair is now well-covered.
      **`task-record-format` CLI input/error surface (6 tests):** `resolveTaskCommandTarget` (task-id|column
      mutual-exclusion, names the command), `parseListColumn` (`done`→`completed` alias, canonical ids, invalid throws),
      `getLinkFailureMessage` (all 5 link-failure reasons → distinct messages). **Board functions now covered too**
      (+5 tests, file complete): `findTaskRecord` (locate card+column / null), `findTasksInColumn` (column membership +
      tagging), `formatTaskRecord` (core fields, autoReviewMode default, conditional agentId + session shape),
      `formatDependencyRecord` (from/to id mapping + per-task column resolution). **`plan-task-prompt.ts` covered
      (7 tests)** — completes the decomposition module trio (validation + expansion + prompt): `truncateSharedContext`
      (trim/marker), `formatSharedPlanContext` (spec+decisions sections / null), `buildTaskPrompt` (always emits
      objective+leaf-scope+pace+rounded complexity; **prepends the matching `/nklein-*` guidance command** when the task
      implies a topic; appends likely-files/acceptance/test-first/knowledge-debt/role/model-fit/shared-context only when
      set — a regression here changes the prompt every decomposed card's agent receives). **Full green re-verified at
      this milestone:** backend `test:fast` 2286 + web-ui 730 (typecheck clean).
      **`task-evidence-prompt.ts` covered (7 tests):** `renderWorkspaceChangesEvidence` (null on no changes; per-file
      diff preview with status/counts/old+new bodies; omits old/new when null + shows a rename's previous path; caps at
      20 files with an omitted-count footer; truncates an over-long body) + `buildTaskEvidencePromptBlock` (bundle/
      workspace/identity/counts; title→id fallback; "unknown" base commit) — the evidence handoff to the diagnosis agent.
      **`repeated-tool-call-guard` pure helpers (6 tests):** `getRepeatedToolCallLimit` (was UNTESTED — read_files/
      run_commands get the higher park threshold, never below the operator base, ordinary tools use the base) +
      `formatRepeatedToolCallParkMessage` (empty `decompose_project` → the weak-local-model diagnostic; generic
      repeated-call message echoing count+summary otherwise; decompose_project WITH args → generic). This is the recurring
      false-pause guard area — the pure helpers are now pinned (the stateful class is exercised via the service suite).
      **`autonomy-budget-watchdog` (8 tests — the autonomous-run SAFETY LIMITER, was fully untested):**
      `formatWallTimeDuration` (minute/hour pluralization, min-1-minute) + the `AutonomyBudgetWatchdog.check` guardrail
      ladder via injected callbacks — healthy→continue, home-agent/already-attention skip, operator-pause park, max-turns
      park, N-consecutive-no-diff park + the no-diff state machine (same-commit streak, new-commit + `resetTask` reset),
      and wall-time-exhausted park (tripped with a distant `startedAt`, no time mock needed). *(Found via a
      content-verified import-grep scan — the basename heuristic had hidden these; also still untested + worth a pass:
      `decomposition-stall-nudger`, `decomposition/plan-task-routing`, `decomposition/plan-task-board-apply`.)*
      **`plan-task-routing` pure functions covered (5 tests, 2026-06-27):** `formatTaskModelFitEvidence` (not-validated /
      default-model / a real candidate naming provider·model·role·context·capability) + `estimateTaskWallTimeMs` (null
      without a candidate, prefill+decode+ttft estimate = 21,200 for the worked case, wall-time-EWMA fallback) — reusing
      the `createEntry` `NKleinModelRegistryEntry` fixture from `nklein-task-router.test.ts` (no hacky cast). The
      heavier `selectTaskRoutingCandidate`/`previewNKleinPlanTaskGraph` (compose `routeNKleinTask`+`validate`) and the
      IO modules (`plan-task-board-apply`, `plan-artifact-apply`) remain for an integration-style pass.
      **`trpc/runtime-api/task-timeout-settings.resolveEffectiveTaskTimeoutSettings` covered (4 tests, 2026-06-27):**
      cloud-profile defaults + `autonomous_default` source; mode scaling (long 3× / extended 6× / unlimited → null);
      precedence task-override(`role_override`) > global(`global_config`) > profile-default; the local-NKlein 60s floor
      on a positive value but `0` (no bound) left alone. Real logic — it sets every task's effective agent timeouts.
      **`trpc/runtime-api/local-advisor-completion` pure helpers covered (7 tests, 2026-06-27 — exported for test):**
      `joinUrlPath` (single-slash join), `resolveAdvisorOpenAiBaseUrl` (idempotent `/v1` suffix + trailing-slash trim +
      per-provider lmstudio/ollama fallback + non-URL tolerance), `resolveAdvisorOllamaBaseUrl` (trim/default), and
      `readAdvisorTextResponse` (tolerant parse across the Ollama `message.content` / `response` / OpenAI
      `choices[].message.content`|`text` shapes, "" on unrecognized) — a parse regression would blank advisor replies.
      **`start-task-session.applyCandidateEffectiveContextWindow` covered (3 tests, exported for test):** applies a valid
      effective context window that differs (new object), leaves the config untouched when it already matches or the
      window is invalid (null/0/negative) — so a task start adopts the registry's measured window correctly.
      **`decomposition-stall-nudger.isChatOnlyDecompositionActivity` (4 tests):** the weak-model stall detector — flags a
      running `assistant_delta` that narrates a plan ("based on my analysis", "task graph", "implementation plan")
      instead of calling `decompose_project`; false when actually calling the tool, wrong source/event, no matching
      prose, or no activity. (The core recovery decision `decideDecompositionStallRecovery` was already tested.)
      **Remaining content-scan finds are heavy-fixture/IO** (`plan-task-routing` needs a full `NKleinModelRegistryEntry`;
      `plan-task-board-apply`/`plan-artifact-apply` are board-mutation/IO) → integration-harness or fresh-context work.
- [~] **Pipeline e2e** — decompose → plan-graph → planning/refinement lane → parallel run → review → merge, on new
      dev-test fixtures (small + large/complex), live model + Docker. Assert the tiny-piece decomposition + iteration path.
      **Live-verified the INFRA (2026-06-26, qwen3-8b + Docker 29.4.3 + `nklein/agent-sandbox:0.0.1`):**
      `verify-strict-isolation.mts` + `verify-decompose-isolation.mts` both PASS @180s — a real task spins up a Docker
      sandbox (`nklein-agent-sandbox-1`), the session advances, NO host worktree is created, NO host path leaks into agent
      output, containers clean up on dispose. The live task-execution + isolation path is healthy after this session's
      changes. **Two findings to chase (each its own focused investigation):**
      - ✅ **NORTH-STAR — decompose completion: ROOT-CAUSED + FIXED (2026-06-26).** An activity dump
        (`NKLEIN_VERIFY_DUMP_ACTIVITIES=1`, added to the harness) showed qwen3-8b actually decomposes fine —
        repo_map → list_files → read `specification.md` → update_focus_chain → **calls `decompose_project`
        (habit-tracker, 3 tasks, 2 questions)** — but the call was REJECTED for a missing required field `title`, forcing a
        retry. (The first run's "no call in 180s" was just latency/variance — it hadn't reached the tool yet.) The model gave
        a perfectly good `slug`; the tool was brittle. **Fix:** `decompose_project` now RECOVERS a missing title from the
        slug (`recoverMissingDecomposeProjectTitle` in `plan-task-input-parse.ts`; title dropped from the required-field
        assertion) — parse-and-recover, not re-prompt (AGENTS.md), matching the existing slug-as-title-fallback the task
        graph already used + the boundary schema's stated intent ("an omitted `title`"). Unit + tool-level regression tests
        added; 75 decomposition tests green. **Proven live (2026-06-26):** re-ran the harness post-fix — qwen3-8b now
        COMPLETES `decompose_project` (habit-tracker-core, 3 tasks: repo_map → read_files → **`Completed decompose_project`**,
        no missing-title failure). A small local model grinds a project to a valid task graph.
      - ✅ **NORTH-STAR — card completion: PROVEN (2026-06-26).** New `scripts/verify-task-completion.mts` runs a single
        implementation card to a terminal state. qwen3-8b ran "create hello.txt …" to completion: created the file,
        **"Result patch captured: nklein/tasks/verify-completion-1-…"** + a commit hash, and the session reached
        **`awaiting_review`** — a small model did real implementation work that the result-branch capture delivered.
        **Delivery confirmed:** the result branch `nklein/tasks/verify-completion-1-…` is present in the project repo with
        `hello.txt` content matching exactly — a correct, ready-to-merge deliverable (the in-memory service creates the
        branch in the repo, not just the sandbox). (Bug found + fixed while building the harness: it first checked for a
        `"review"`/`"completed"` state that doesn't exist — the session's done-state is **`awaiting_review`**; the harness
        now checks the right name + carries an `unhandledRejection` guard so a stray `session_stop` can't crash it.)
        **Still owed → MULTI-CARD PIPELINE E2E (build plan, mapped 2026-06-26).** The remaining north-star proof is one
        FULL-RUNTIME run (not the stripped in-memory harness) where the runtime's own orchestration cascades the generated
        cards. Concrete recipe: (1) `startTsBackend({cwd, homeDir})` (contract helper) for the real server; (2) configure
        the NKlein agent for the live model via `runtime.saveConfig` (modelRoles → lmstudio / `qwen/qwen3-8b-m5max` /
        baseUrl `http://127.0.0.1:1234/v1`); (3) create a small registered dev-test project (`projects.add` with
        `registryId`, → `loadDevTestProjectScenario` in `projects-api.ts:508`); (4) start its seed/decompose card; (5)
        OBSERVE the cascade — `autoStartTaskIds` + `moveStartedQueuedTask` (`runtime-server.ts` ~306/382/609) auto-start
        ready cards as the decompose lands `rootTaskIds`/`readyTaskIds`; (6) assert every generated card reaches
        `awaiting_review` with a result branch, then the MERGE/apply applies them into the working tree. Watch via the WS
        stream + `runtime.getTaskDiagnostics`. **This is a long (~20–30 min) live run + a real harness → a focused arc,
        best on a fresh context** (the agent-capability pieces it integrates — decompose + single-card completion + delivery
        — are already PROVEN above). Then fold all `verify-*.mts` harnesses into a documented §5.V e2e runner.
        **APIs confirmed (2026-06-26):** `startTsBackend` (test/contract/helpers/backend.ts) spawns the REAL `src/cli.ts`
        server → full orchestration incl. the cascade; create the project via `projects.createDevTestProject({registryId})`
        (projects-api.ts:490, seeds the decompose card `startInPlanMode`); start the seed card via `runtime.startTaskSession`
        (app-router:715, input `RuntimeTaskSessionStartRequest`). **The crux/obstacle:** the auto-started CASCADE cards read
        the agent CONFIG (not per-call params like the in-memory harness used), so the harness must replicate the onboarding
        config flow — `saveNKleinProviderSettings` (lmstudio enabled + baseUrl `:1234/v1` + selected `qwen/qwen3-8b-m5max`) +
        `runtime.saveConfig({modelRoles})` via `buildFirstRunLocalModelRoles`, seeded into the temp HOME's config.json before
        `startTsBackend` (or via the APIs after start). That config replication + the long cascade run is the bulk of the work.
      - ✅ **MULTI-CARD PIPELINE WORKS — root-caused + FIXED + confirmed live (2026-06-26).**
        `scripts/verify-multi-card-pipeline.mts` drives the REAL `cli.ts` server end to end (`startTsBackend` gained additive
        `extraEnv` + `onLog` hooks; existing tests unaffected). HTTP chain: `runtime.saveConfig({modelRoles})` →
        `projects.createDevTestProject({preset:mid_task})` → `runtime.startTaskSession` (must pass the UI's fields — `agentId`
        + `nkleinSettings` — or it no-ops). **✅ Proven:** seed → `planning` → **DECOMPOSED into 5–7 cards → the cascade
        (`autoStartTaskIds`) tried to start each → seed `completed`.** **THE FIND (why the cards never ran):** the cascade's
        auto-start of each generated card FAILS — server warns `Could not auto-start linked task <id>: No native !Klein
        provider is configured` (`nklein-provider-service.ts:1167`, in `resolveLaunchConfig`). The generated cards'
        `nkleinSettings` carry no `providerId`, so they fall back to `getSelectedProviderSettings()` (the GLOBAL provider) —
        which the harness never set (it set `modelRoles` but not the provider). The SEED worked only because I passed its
        explicit `providerId`. **So the decompose→cascade→auto-start ORCHESTRATION is CORRECT — this is a HARNESS gap, not a
        product bug** (the product configures the provider in onboarding via `saveNKleinProviderSettings`). It was NOT a
        refinement stall — the generated cards never reach a session at all (0 WS task sessions for them, ever). **✅ FIX
        CONFIRMED LIVE:** added `runtime.saveNKleinProviderSettings({providerId:lmstudio, modelId, baseUrl})` to the harness
        (the onboarding step). Re-run trace (qwen3-8b): decompose → 5 cards → the cascade auto-starts a generated card →
        it goes **`planning` → `in_progress`** (the `begin_implementation` promotion fires) → **real implementation work**:
        `read_files → update_focus_chain → edit_file → write_files → run_commands`. **So the WHOLE north-star path runs end
        to end with a small model: decompose → cascade → refine → begin_implementation → implement.** The only limit is
        TIME — cards serialize 1-at-a-time on the single-request LM Studio endpoint (`queueOnEndpointBusy`), so all 5 → review
        takes ~25 min (a background run). Diagnosed via the new `onLog` server-log + WS `task_sessions_updated` capture.
        Valid `preset`s: `mid_task`/`complex_dag`/`audio_vst`/`daw_foundation`.
        `[Error: session_stop]` promise rejection (`session_stop` is a vendored-SDK signal); the runtime had NO global
        `unhandledRejection` handler. **Fix:** `installRuntimeUnhandledRejectionGuard` (`src/server/runtime-process-guards.ts`),
        installed in cli.ts's **serve branch only** (short-lived CLI commands keep Node's fail-fast default; tests don't
        accumulate a listener) — it logs the rejection LOUDLY + captures it to telemetry (visible, not silently swallowed)
        and keeps serving, so a stray rejection can't take a server hosting many sessions down. The pure handler
        `handleRuntimeUnhandledRejection` is DI'd + unit-tested (4 cases: Error capture+log, non-Error wrap, log-before-
        capture order, never-throws-even-if-deps-throw). NB the original crash was likely harness-specific (in-memory
        service vs the host-backed product service); this guard hardens the real long-lived server against ANY stray
        rejection regardless. *Deferred:* a source-level catch of `session_stop` in the SDK boundary (if it proves to be a
        real product path, not just the stripped harness).
      - **Full-delivery background run (2026-06-26, 30-min budget): mechanism RE-CONFIRMED, full 5-card sweep NOT
        reached — recorded honestly so the entry above is not read as an all-cards-delivered claim.** Trace: decompose →
        `planning:4 completed:1` in ~45s (5 cards, seed completed), then one generated card
        (`habit-insights-score-cap-impl`) auto-started and did ~8 min of real implementation (`update_focus_chain →
        edit_file → read_files → run_commands`, dozens of cycles). The run then died at ~9 min (of 30) on a transient
        `TypeError: fetch failed` — the harness's board poll lost the server under sustained LM Studio/Docker load. Only
        1 of 4 generated cards had run (they serialize on the single-request endpoint), so the sweep was never going to
        finish in 30 min anyway (~8 min/card × 4 ≈ 30+ min). **The PIECES are all proven (decompose ✓, cascade
        auto-start ✓, a card implements ✓, single-card → `awaiting_review` with a correct result branch ✓ via
        `verify-task-completion`), but a single unattended all-N-cards-to-review run is impractical/fragile in this dev
        env (serialized + long).** **Harness hardened (same change):** the poll loop now tolerates a sustained window of
        transient `fetch failed` (6 consecutive ≈ 30s before giving up) instead of letting one blip abort a 30-min
        proof, and the FATAL handler now logs `error.cause`. **Not chased further now** (low north-star leverage — the
        capability is demonstrated in pieces; the bound is local-endpoint throughput, not orchestration). A faster model
        or a segmented run would close the full-sweep proof if it's ever wanted.
- [~] **Chat e2e** — every chat function: sessions (create/select/delete/relabel), streaming, tools, knowledge fetch,
      memory, the (later) autonomous-work mode.
      **Contract-seam session-CRUD coverage DONE (2026-06-26, 23 tests, Suite 18 — `test/contract/chat-session-contract.test.ts`).**
      Procedures covered via HTTP + on-disk JSONL assertions:
        `chat.createSession` (default-field population; `chat_only` scope; all optional fields including `riskAcknowledged`/`browserEnabled`; title trimming);
        `chat.listSessions` (multiple sessions present; ordering by `updatedAt` descending);
        `chat.updateSession` (scope/role/riskAcknowledged/browserEnabled round-trip; `updatedAt` advances; `goal: null` clears; unknown id → null);
        `chat.deleteSession` (non-existent → `{ deleted: false }`; idempotent second delete);
        `chat.getTranscript` (limit param on empty session; no-limit on empty session);
        On-disk `$HOME/.nklein/nklein/chat-sessions/sessions.jsonl` (file exists; valid JSONL; upsert event contains correct fields; delete event appended).
      Seam proven: HTTP → session state read back via `getSession`/`listSessions` AND direct on-disk JSONL file read.
      Deferred to live e2e (require a live model): transcript content after sendMessage/streamMessage turns (covered by
        Suite 5C); knowledge-fetch tool calls within a turn; autonomous-work mode behavior.
- [ ] **Board/card lifecycle UI** — start/pause/resume/move, lane reconciles (incl. the backlog→running fix), review,
      trash, drag rules — Playwright, deep.
- [~] **Settings/config + isolation UI** — every setting persists + is wired (global + per-project override), the
      isolation status/pool UI, project-settings menu. Pair with §5.W.
      **Contract-seam coverage DONE (2026-06-26, 44 tests, Suite 16 — `test/contract/settings-config-contract.test.ts`).**
      Procedures covered via HTTP + on-disk file assertions:
        `runtime.getConfig` (shape: all required fields, swarmGuardrails, modelRoles, nkleinProviderSettings, globalConfigPath);
        `runtime.saveConfig` global round-trip (booleans, numbers, enums, nested modelRoles/swarmGuardrails) + on-disk `$HOME/.nklein/nklein/config.json` asserted;
        `runtime.saveConfig` per-project override (workspaceId scope): `maxConcurrentTasksOverride` and `modelRolesOverride` — override wins for that project, does NOT leak to a second project, project-override fields written to `$CWD/.nklein/nklein/config.json` not the global config;
        `runtime.saveConfig` invalid-field rejection (bad enums, non-positive ints) returns 400;
        `runtime.getNKleinMcpSettings` / `runtime.saveNKleinMcpSettings` round-trip (stdio + streamableHttp servers, empty-list clear, invalid type 400) + on-disk `nklein_mcp_settings.json` `mcpServers` block asserted;
        `runtime.saveNKleinModelContextWindowOverride` (set → `contextWindow.userOverride`, null → clears, non-local 400) + model-registry.json on-disk;
        `runtime.saveNKleinModelMaxConcurrentRequests` (set → `constraints.maxConcurrentRequests`, null → clears, non-local 400).
      Deferred (live UI/agent required): `runtime.saveNKleinProviderSettings` (OAuth/API-key, no observable config without live provider);
        isolation status/pool UI; project-settings menu wire-up.
- [ ] **Smoothness/perf assertions** folded into the UI e2e (no jank on board render, task start, chat streaming).
- [ ] **Upgrade verification from pass/fail GATES to DIAGNOSTIC ORACLES + reliability measurement (2026-06-27, small-LLM
      research pass).** Add to the dev-test fixtures (the §5.O/§5.AI rail exercises these): **hidden test splits**
      (`fail_to_pass` for the requested behavior + `pass_to_pass` for regressions, separate from the visible-acceptance
      developer-ergonomics split); **repeat-run reliability** (3–5 runs per selected small-model task → `pass_all` /
      `pass_any` / flake rate / terminal-state failures, NOT one-off pass/fail); **BFCL-style local tool probes** for BOTH
      chat + swarm paths (exact normalized args, no-call cases, irrelevant-tool avoidance, malformed-format recovery);
      **failure injection** (flaky command, missing dep, bad URL, Docker restart, model drop, final-answer-loop-after-
      success); **code-retrieval qrels** (precision@k/recall@k/MRR on expected files/snippets) + **grounded citation
      scoring** (every material claim → evidence spans); **WebArena-lite fixtures** (self-hosted pages with
      forms/search/login/state + Playwright validators); **long-memory evals** (update stale facts, preserve project
      constraints across restarts, **abstain** when evidence is missing); **property-based checks** on dev-test
      invariants where practical; and **evidence-constrained reviewer verdicts** (the reviewer must report checks-run,
      artifacts-inspected, unresolved risks, and which hidden/protected/property checks passed). **Mutation /
      differential / metamorphic** checks gate self-improvement (§5.AF M4) + any backend-level milestone.

> **Test-oracle design (2026-06-25, read-only design pass) — the concrete, parallelizable build plan.** Maps the
> port-resilient seams (tRPC/HTTP contract = ~88 procedures in [app-router.ts](src/trpc/app-router.ts); CLI; on-disk
> formats `board.json`/`board-crdt.json`/`task-graph.json`/sessions; Docker boundary; web-ui). **Current state:** of ~176
> backend test files only ~10–15 are seam-level (port-resilient); ~160 are TS-internal (would need rewriting for a Python
> backend) — keep them as fast TS regression guards but they do NOT count toward the port oracle. All 85 web-ui tests +
> the `verify-*.mts` live harnesses are port-resilient. **The biggest single unblock:** extract `startKanbanServer` +
> `requestJson` + `connectRuntimeStream` from [runtime-state-stream.integration.test.ts](test/integration/runtime-state-stream.integration.test.ts)
> into `test/contract/helpers/` — it's the template every new contract suite copies. **Backend-under-test abstraction:** a
> `BackendFactory` (`startTsBackend` now / `startPythonBackend` later) selected by env var, so the SAME suite validates
> either backend; contract tests import NOTHING from `src/` (drive HTTP/WS/CLI/on-disk only; validate against JSON-Schema
> fixtures, not imported Zod). **13 landable suites (each a disjoint file → a separate authoring agent):**
- [x] **§5.V infra: `test/contract/helpers/` (DONE 2026-06-25)** — `backend.ts` (BackendUnderTest/Factory + `startTsBackend` + `resolveBackendFactory`, TSX_TSCONFIG_PATH-pinned), `http.ts` (`requestJson`), `ws.ts` (`connectRuntimeStream`), `git.ts`, `fixtures/board.ts` (`createBoard`/`seedWorkspace`), barrel `index.ts`. Integration test rewired onto them (8/8 still green). The port-resilient base for every suite.
- [x] **Suite 1 — HTTP tRPC core CRUD (DONE 2026-06-25, 16 tests)** (`test/contract/trpc-core-contract.test.ts`) — projects.list/add/remove, workspace.getState/saveState (+ a 409 revision-conflict), runtime.getConfig/saveConfig, swarm stop/request/clear, listNKleinPlanArtifacts — all over real HTTP, asserting status + JSON shape + on-disk effects. *(Contract facts: it's `workspace.getState` not `loadState`; a no-input mutation needs `payload:{}` to avoid 415; stale `expectedRevision` → 409.)*
- [x] **Suite 2 — plan-artifact pipeline (DONE 2026-06-25, 12 tests)** (`test/contract/plan-artifact-pipeline-contract.test.ts`) — list→apply (cards land in Planning, deps wired)→reject over HTTP + on-disk plan format; re-apply is idempotent (0 new cards, deduped by plan-task-id). *(Agent hit an API error mid-run at 11/12; I fixed the one wrong assumption — re-apply does NOT duplicate cards — to 12/12.)*
- [x] **Suite 3 — CLI task mutation → WS board event (DONE 2026-06-25, 2 tests)** (`test/contract/task-lifecycle-contract.test.ts`)
      — the CLI task CRUD itself is covered exhaustively by **Suite 12**, and the `workspace_state_updated` WS push on a
      **tRPC** mutation (+ per-project isolation) by `runtime-state-stream.integration.test.ts`; this closes the one seam
      neither covers — the **CLI→WS chain**: subscribe to the runtime state stream, drive `nklein task create`/`done` as
      black-box subprocesses, and assert the board event reaches the socket (new card lands in Backlog; `done` moves it to
      Completed). Confirms a CLI persistence path can't silently skip the broadcast hook and leave the live UI stale.
- [x] **§5.V mock-LLM harness (DONE + self-verified 2026-06-25)** — `test/contract/helpers/mock-llm.ts`: a scriptable
      OpenAI-compatible `node:http` mock (`startMockLlm` → `{ baseUrl, enqueue, setDefault, requests, close }`) serving
      `GET /models` + `POST /chat/completions` (non-stream JSON + SSE stream + tool_calls). Smoke test `mock-llm.test.ts`
      (5 tests) drives the REAL `LocalLlmClient` (`complete`/`completeStream`/`completeWithTools`) + `discoverLoadedModelId`
      against it → all pass, proving the wire format matches exactly. Unblocks Suites 4 + 5. *(Originally designed below;
      built ahead of schedule while a server-spawning suite ran, since it's a disjoint helper file.)*
  - [-] *(original design notes — superseded: BUILT, see "§5.V mock-LLM harness (DONE + self-verified 2026-06-25)" above;
        kept for the design rationale)* New `test/contract/helpers/mock-llm.ts`:
      a tiny `node:http` OpenAI-compatible server: `GET /models` (so `discoverLoadedModelId` in
      [local-chat-model.ts](src/chat/local-chat-model.ts) finds a "loaded" model) + `POST /chat/completions`
      (non-streaming AND SSE streaming — match `LocalLlmClient` in
      [nklein-local-llm-client.ts](src/nklein-agent/nklein-local-llm-client.ts); read it for the exact request/response +
      stream-chunk shape). Make it **scriptable** (a per-test queue of canned responses: plain text for chat; tool-call
      JSON for the agent loop) so Suite 4 drives decompose_project→begin_implementation deterministically. Point the
      spawned server at it via the chat/provider `baseUrl` (saveNKleinProviderSettings/saveConfig over HTTP, or an env
      override if one exists). Build with fresh focus — it's the gateway to the chat/pipeline fast-gate e2e.
- [~] **Suite 4 — Planning lane + promotion + review pipeline** — **RESCOPED 2026-06-25.** The full pipeline
      (start→reconcile→`begin_implementation`→review→verify→merge→completed) needs a **real agent loop in Docker** to
      observe the lane transitions over HTTP/WS — a deterministic fast-gate would either duplicate the existing unit
      coverage (`task-board-lane-reconcile.test.ts` for the routing/reconcile + `nklein-promotion-tool.test.ts` for
      begin_implementation, both green) or have to stand up Docker+model. So: **the §5.B pipeline is covered by those
      units (DONE) + the LIVE Suite 10** (real LM Studio + Docker decompose→promote→review→merge), not a separate
      fast-gate. A thin HTTP slice that IS deterministic (apply plan artifact → cards in planning) is already **Suite 2**.
- [x] **Suite 5 — Chat HTTP + streaming (DONE 2026-06-25, 14 tests)** (`test/contract/chat-contract.test.ts`) — the 12
      CRUD (createSession/listSessions/getSession/getTranscript/updateSession/deleteSession) **+ `sendMessage`** against
      the mock-LLM (it registers a CUSTOM local provider pointing at the mock via `addNKleinProvider`, proving the
      chat-endpoint fix end-to-end — the chat hits the configured endpoint) **+ `streamMessage`** (the tRPC SSE
      subscription, driven by the REAL tRPC client — `createChatSubscriptionClient` mirrors the web-ui's `splitLink`
      with `httpSubscriptionLink` + the `eventsource` ponyfill since Node has no global `EventSource`). The streaming
      test asserts multiple incremental token deltas (the mock streams ~4 chunks), that their concatenation reconstructs
      the reply, and that the terminal `done` carries + persists both messages. The chat-endpoint fix is verified by this
      e2e (see below).
  - [x] **BUG FIXED (found via Suite 5) — the in-app chat now uses the configured local endpoint.** Was: the chat
        ignored the configured provider endpoint (always the hardcoded `DEFAULT_LOCAL_CHAT_BASE_URL` :1234). Fix: added
        `nkleinProviderService.getLocalChatBaseUrl()` (the selected LOCAL provider's saved baseUrl; cloud selections →
        null, since `getSelectedProviderSettings` already filters to local) and threaded it into
        `resolveLocalChatModelDeps({ baseUrl })` at the chat-service creation site. Safe (unchanged — falls back to the
        default endpoint — when no selected-local baseUrl is available). On-mission for the local-LLM north star.
  - [x] **VERIFIED 2026-06-25 — the chat-endpoint fix honors a configured local endpoint** (user: "honor it, complete
        the fix"). Root cause of the earlier send-test miss: the built-in `lmstudio` provider is **live-only**, so
        `saveProviderSettings` *requires* the endpoint reachable with the model loaded
        (`assertProviderModelMeetsContextRequirement`, provider-service.ts:668) — the mock didn't fully satisfy that, so
        the lmstudio save didn't take and the chat fell through to the default. The fix itself is correct: a unit test
        ([provider-local-chat-baseurl.test.ts](test/runtime/nklein-agent/provider-local-chat-baseurl.test.ts)) saves a
        **custom local provider** (no live-only validation) and confirms `getLocalChatBaseUrl` returns its baseUrl → the
        chat/agent get the configured endpoint. lmstudio is honored the SAME way (its saved baseUrl flows) **when LM
        Studio is actually running** (covered by the live Suite 10, not unit). **→ Suite 5 send/stream + Suite 4 will
        register a custom local provider pointing at the mock** (the agreed deterministic-mock approach).
- [x] **Suite 6 — On-disk format parity (DONE 2026-06-25, 10 tests)** (`test/contract/on-disk-formats.test.ts`) — board.json round-trip + raw-shape pin (6 fixed columns in order + card fields), Python-writer direction (hand-crafted JSON parses), board-crdt.json round-trip + schema-too-new refusal + v0→current migration, plan-artifact tasks.json shape + default-fill + required-field rejection. No server; the cross-language convergence point. *(Surprise: runtime-home `~/.nklein/nklein/workspaces/<id>/board.json` takes read priority over the repo mirror — fixtures must write both.)*
- [x] **Suite 7 — Playwright: plan-artifact review panel (DONE 2026-06-25, 5 tests)** (`web-ui/tests/plan-artifact-review.spec.ts`)
      — renders a pending artifact, Apply fires `applyNKleinPlanArtifact` + the panel clears, Reject fires
      `rejectNKleinPlanArtifact`, the Apply button disables while in-flight. **Backend = route-mocked tRPC** (vite dev
      server + `page.route('**/api/trpc/**')`), deterministic, no real runtime/model. Verified myself: 5 passed, no
      flakes; web typecheck + biome clean. *(Establishes the Playwright+route-mock pattern for Suites 8/9. Findings:
      mock must handle BATCHED tRPC paths via `pathname.includes(proc)` + substitute real `workspace.getState`; tRPC
      mutation body without a transformer is `{ "0": { field } }`.)*
- [x] **Suite 8 — Playwright: settings (DONE 2026-06-25, 6 tests)** (`web-ui/tests/settings.spec.ts`) — opens the dialog,
      reads config from mocked `runtime.getConfig` (maxConcurrentTasks, guardrail turns), changing + Save fires
      `runtime.saveConfig` with the updated value (incl. `swarmGuardrails.maxAutonomousTurnsPerTask`), revert keeps the
      field, Cancel doesn't save. Route-mocked. *(Findings: the catalog stub must return a real `providers` array or the
      controller sees phantom unsaved changes; `agentRulesets.capability.globalPreset` must be `"fully_open"`.)*
- [x] **Suite 9 — Playwright: second-opinion review + recovery (DONE 2026-06-25, 11 tests)** (`web-ui/tests/review-recovery.spec.ts`)
      — SecondOpinionReviewPanel renders verdict/round/summary/feedback/insight (absent when no `review`);
      TaskRecoveryActionsPanel fires `collectTaskEvidence` / `mergeTaskWorktrees` / `verifyTaskAcceptance` on the
      respective buttons, all disable while in-flight. Route-mocked. *(Evidence needs `grantPermissions(["clipboard-*"])`;
      Verify needs an "Acceptance check:" line in the prompt; assertions use `.first()` to dodge sonner-toast duplicates.)*
- [x] **Suite 10 — Live e2e: decompose→planning→begin_implementation→review** — BOTH halves LIVE-VERIFIED 2026-06-25
      via two focused harnesses (the chained single-script `verify-decompose-promote-review.mts` is an optional future
      nicety; the constituent halves below + the deterministic Suite 9 review panels already cover the pipeline, and
      chaining 3 live model stages into one script adds flakiness for marginal value).
  - [x] **DECOMPOSE half LIVE-VERIFIED 2026-06-25** — ran `scripts/verify-decompose-isolation.mts` with **qwen3-8b**
        (the north-star small model) + Docker: sandbox container observed, `decompose_project` called, **no host worktree,
        no host-path leaks, clean teardown — PASS**. Confirms the live env + the §5.B planning-lane entry (decompose →
        cards land in planning) work with the canonical small model.
  - [ ] **PROMOTE half** — extend into `verify-decompose-promote-review.mts`: after decompose, start a generated card →
        observe it refine + reach In Progress (via `begin_implementation` OR the Increment C auto-promote when the model
        skips it) → review. **Increment C code is now DONE** (auto-promote recovery, see §5.B above), so the lane advances
        even when a small model never calls the explicit tool — this live check is the deterministic confirmation.
        **MODEL SWEEP (2026-06-25, user):** run across every loaded LM Studio model — **qwen3-8b** (north-star small),
        **microsoft/phi-4-mini-reasoning**, **deepseek-r1-0528-qwen3-8b-mlx** (+ the heavier qwen2.5-coder-14b / qwen3.6-27b
        when time permits). **deepseek may crash/unload mid-sweep** — if it disappears from `/v1/models`, record that it was
        dropped (we *want* it; crash-resilience is a later task) and continue the sweep with the rest, don't block.
- [x] **Suite 11 — Core-py contract parity (DONE 2026-06-25, 25 tests)** (`core-py/tests/test_contract_parity.py`) — Python FastAPI `TestClient` vs the exported JSON Schema the TS `KleinCoreClient` validates against (catches TS↔Python contract drift). Directly supports §5.H + §5.X. *(Runs via `uv run pytest core-py/tests/test_contract_parity.py` — 25 passed; not in the JS fast-gate, run with the core-py suite.)*
- [x] **Suite 12 — CLI task subcommands (DONE 2026-06-25, 14 tests)** (`test/contract/cli-task-subcommands.test.ts`) —
      create/list/list --column/done/trash/delete (--task-id + --column) over the spawned CLI, swarm-stop/resume (pure
      disk), + 4 error-handling cases. *(Findings: mutating commands need a running server — `ensureRuntimeWorkspace` →
      `projects.add`; the server's `selfProject` guard means the test server's cwd must be a DIFFERENT git root from the
      project dir; `task list` JSON omits `title` — only `create` returns it; macOS `/var`→`/private/var` symlink needs
      `realpathSync`.)* Verified myself; registry unpolluted, no stray procs.
- [x] **Suite 13 — Smoothness/perf (DONE 2026-06-25, 4 tests)** (`test/contract/server-responsiveness.test.ts`) — server startup (~2s, ceiling 15s), `projects.list` warm P90 (~55ms, ceiling 500ms), `workspace.getState` warm on a 40-card board (~130ms, ceiling 500ms), WS snapshot delivery (~150ms, ceiling 5s). Generous bounds (6–35× headroom) → catches a gross regression, won't flake. Stable across 3 runs.
- [x] **Suite 14 — workspace git + search procedures (DONE 2026-06-26, 22 tests)** (`test/contract/workspace-git-contract.test.ts`) — `workspace.getGitSummary` (shape + zero-changed-files on clean copy), `workspace.getGitLog` (shape + 2-commit history + maxCount=1), `workspace.getCommitDiff` (shape + file count + added-file + additions count), `workspace.getGitRefs` (shape + exactly one HEAD), `workspace.getWorkspaceChanges` (empty on clean copy + untracked file detected), `workspace.searchFiles` (shape + finds main.ts/README + empty result + limit honored), `workspace.notifyStateUpdated` (ok=true + idempotent). Seeded via a 2-commit temp git repo (README.md → src/main.ts + README.md update). Excluded from this suite (need live infra or destructive side-effects): `runGitSyncAction` (needs remote), `checkoutGitBranch`/`discardGitChanges` (destructive), `deleteWorktree` (agent infra), `getChanges` (task-scoped diff). All 114 contract tests green.
- [x] **Suite 15 — board/card lifecycle mutations (DONE 2026-06-26, 28 tests)** (`test/contract/board-lifecycle-contract.test.ts`) — `workspace.saveState` driven across all board/card mutation cases: create card → appears in correct column (backlog/planning); move card between all 6 columns (backlog→in_progress, in_progress→review, review→completed, backlog→trash, trash→backlog restore); card reordering within a column (2-card order preserved + swap); card field edits (title, prompt, agentId, autoReviewEnabled all persist); dependency edge add (id/fromTaskId/toTaskId persist) + multiple edges + remove; 6-column shape (all 6 canonical columns always present, cards in all 6 columns round-trip); invalid inputs rejected at HTTP seam (unknown column id → 400, missing `board` field → 400, card missing `prompt` → 400, missing workspace header → 400, unknown workspaceId → 404); revision conflict detection (stale expectedRevision → 409, board unchanged after 409, omitting expectedRevision bypasses lock). Seam asserted: HTTP responses + `workspace.getState` read-back (on-disk `board.json` confirmed via `statePath`). Deferred to e2e: `runtime.startTaskSession`/`stopTaskSession`/`pauseTask`/`resumeTask`/`sendTaskSessionInput`/`reloadTaskChatSession` (require live agent loop), and lane-reconcile transitions (backlog→planning on start, review→in_progress on resume — agent-loop-driven). All 142 contract tests green.
- [x] **Suite 17 — project management procedures (DONE 2026-06-26, 21 tests)** (`test/contract/project-management-contract.test.ts`) — deep coverage of all project-management tRPC procedures beyond Suite 1's basic happy-path: `projects.list` shape (top-level fields + taskCounts for all 6 columns, zero on fresh project); `projects.add` (existing git folder → metadata + on-disk workspace-index at `$HOME/.nklein/nklein/workspaces/index.json` asserted; two projects → distinct IDs both in list + both in index; nonexistent path → ok=false; non-git folder → `requiresGitInitialization=true`; no path+no gitUrl → schema 400; file path → ok=false); `projects.remove` (gone from list + from on-disk index; unknown projectId → ok=false with error; re-add a removed path succeeds with fresh workspace id — workspace-index ownership round-trip); `projects.listDirectoryContents` (no path → filesystem root, shape valid, at least one entry; absolute cwd path → lists sub-git + sub-plain; entry shape: name/path/isGitRepository; isGitRepository detection: git=true, plain=false; absolute subdir path → valid empty-entries response; nonexistent absolute path → ok=false). Seam proven: `projects.list` read-back + `$HOME/.nklein/nklein/workspaces/index.json` on-disk. All 207 contract tests green. SAFETY: every project path is `mkdtempSync` under `tmpdir()` — never inside the repo tree; `git rev-parse --is-bare-repository` = false confirmed post-run.
- [x] **Suite 19 — runtime status/catalog/registry READ procedures (DONE 2026-06-26, 34 tests)** (`test/contract/runtime-status-reads-contract.test.ts`) — covers the previously-uncovered deterministic read branch of `runtime.*`:
      `runtime.getNKleinProviderCatalog` (providers array; each entry shape: id/name/oauthSupported/enabled/supportsBaseUrl; lmstudio is present);
      `runtime.getNKleinModelRegistry` (schemaVersion/updatedAt/models shape; empty on fresh backend; entry shape after seeding via contextWindowOverride: key/providerId/modelId/contextWindow/speed/capability/constraints/timestamps);
      `runtime.removeNKleinModelRegistryEntry` (known key → removed=true + gone from list; unknown key → removed=false);
      `runtime.pruneNKleinModelRegistry` (response shape: numeric removed field; no-input mutations need `payload:{}` to avoid 415);
      `runtime.getUpdateStatus` (currentVersion/latestVersion/updateAvailable/updateTiming/installCommand shape);
      `runtime.getMergeHistory` (records array; empty on fresh backend);
      `runtime.getKleinCorePyHealth` (enabled/reachable/sidecarUrl shape; NKLEIN_CORE_PY=0 → enabled=false, reachable=false);
      `runtime.getNKleinCodeIntelligenceStatus` (codeEmbeddingSettings.{globalDefaults,projectOverride,effective,source}; repoMap.{filesScanned,symbols,tokenCount,available,error}; codeIndex.{cacheExists,searchAvailable,progress.phase∈enum}; no-scope → non-200);
      `runtime.getTaskDiagnostics` (ok=true + empty events for unknown taskId; runSummaries is array; limit param honored; limit=0 → 400; no workspace scope → 400);
      `runtime.getModelPerformanceStats` (generatedAt/observations/aggregates; empty on fresh backend);
      `runtime.getKnowledgeToolUsageStats` (generatedAt/observations/aggregates/decompositionKnowledgeSignals/decompositionKnowledgeAggregates; all empty on fresh);
      `runtime.getNKleinSlashCommands` (commands array; each entry has name string; accessible without workspace scope).
      **Gap-analysis summary (as of this run):** ~88 procedures in app-router.ts across 4 namespaces. Contract-seam covered: all 15 workspace.* minus deleteWorktree/getChanges/runGitSyncAction/checkoutGitBranch/discardGitChanges (5 destructive/live-only); all 7 projects.* minus createSelfImprovementProject/cleanupDevTestProjects/migrateAccidentalProjectArtifacts/pickDirectory (4 dev/destructive); all 8 chat.* minus streamMessage (SSE, Suite 5); and now ~27 runtime.* (getConfig, saveConfig, getNKleinMcpSettings, saveNKleinMcpSettings, saveNKleinModelContextWindowOverride, saveNKleinModelMaxConcurrentRequests, addNKleinProvider, requestSwarmStop, getSwarmStop, clearSwarmStop, listNKleinPlanArtifacts, applyNKleinPlanArtifact, rejectNKleinPlanArtifact, expandNKleinPlanTask, recordNKleinPlanGap + 12 from Suite 19). **Remaining deterministic-uncovered:** buildNKleinModelFreshnessAdvisor/buildNKleinAdvisor (build prompt, no model call — borderline), writeNKleinDogfoodBacklog (needs dogfood path). **Live-only (deferred to e2e):** all task-session lifecycle (start/stop/pause/resume/sendInput/chatMessages/chatSend/abort/cancel/reload/grantApproval/importContext/verifyAcceptance/mergeWorktrees); NKlein cloud auth (accountProfile/balance/orgs/kanbanAccess/featurebaseToken/deviceAuth/oauthLogin/switchAccount); live provider (saveProviderSettings/providerModels/endpointDiscovery/addProvider); MCP OAuth; shell session; runCommand; runUpdateNow; resetAllState; runNKleinSmokeEval; collectTaskEvidence; sendNKleinAdvisor; openFile; updateNKleinProvider. **264 tests green, 17 test files, git is-bare=false, no stray procs.**
- *(sequencing/process note, not a discrete work item — the suites it orders are the counted items above)* **Build order:** helpers + Suite 6 → Suites 1 & 5 & 11 (parallel) → Suites 2/3/4/12 (parallel) → Suites 7/8/9/13 (parallel) → Suite 10. **The refactor (§5.X Phase 1) may start once Suites 1+5+6 (+11) are green** (a baseline contract oracle); each later suite gates the workflow it covers. **Standing rule: every new feature gets BOTH a TS-internal unit test AND an HTTP-level contract test** — the contract test is the one that survives the port.

### 5.W — Expose every feature + setting in the UI; global-vs-project config; regroup *(2026-06-25, user)*
- [x] **Feature-vs-UI audit (2026-06-25, subagent)** — cataloged all 29 runtime-config fields (26 exposed / 3 config-only),
      CLI commands, agent/plan actions, and global-vs-project scoping. Concrete gaps to close below.
  - [x] **expose/regroup config fields (2026-06-25, subagent + verified)** — `maxConcurrentTasks` now in its own
        "Swarm Parallelism" card under Tasks; `maxAgentWritableFileLines` ("Max writable file lines") + `replayCardsEnabled`
        ("Enable card replay", surfaced out of Developer Mode with a destructive note) now in a labelled "Advanced" card.
        All bound to the existing `useRuntimeConfig`/`save()` path (no new persistence). web typecheck + 694 vitest + biome
        green. *(These were scattered/semi-hidden, not truly config-only — net change is proper grouping + discoverability.)*
  - [x] **workspace base dir as a global setting — DONE end-to-end (user safety directive, 2026-06-25, solo).** The user
        asked that created workspaces use "a user configured path (global settings)" outside !Klein's parent folder. The
        safety confinement already existed (`resolveSafeCreatedWorkspaceParentDir`, env + home-default); now the user can
        configure the base dir from the UI. **DATA LAYER + CONTRACT:**
        a new global `workspaceBaseDir: string | null` threaded through `runtime-config.ts` (file shape / state /
        update-input / normalizer / change-registry / read+write + all merge/snapshot fns — tsc-driven, 0 misses),
        `runtimeConfigResponseSchema` + `runtimeConfigSaveRequestSchema`, and `buildRuntimeConfigResponse`; saveConfig
        passes it through generically. All fixtures updated; root+web tsc, fast 1728, web vitest 694, biome green.
        **THREADING DONE (solo):** the configured value is now sourced from the global config (`loadGlobalRuntimeConfig`)
        and passed to `scaffoldNKleinDevTestProject` at **all three** creation paths — the tRPC dev-test mutation
        (`projects-api.ts`), the runtime eval (`runtime-api.ts` `runNKleinSmokeEval`), and the CLI (`dev.ts`
        `runDevSmokeEvalCommand`) — via the eval-harness's new `workspaceBaseDir` option. A new scaffold test asserts a
        configured `workspaceBaseDir` is honored when no explicit `parentDir` is given. **UI DONE (solo):** a
        "Workspace Location" card with a **"Workspace base directory"** text field under Settings → Tasks
        (`runtime-settings-dialog.tsx`, mirroring `maxConcurrentTasks`'s state/id/init/change-detection/reset/save/JSX),
        with a component test asserting it renders + saves `workspaceBaseDir`. CHANGELOG entry added. Root+web tsc, fast,
        web vitest, biome all green. **Complete end-to-end** — the user's "user configured path (global settings)" ask is
        fully delivered.
  - [x] **ROOT-CAUSE FIX: created workspaces can't spawn inside any git repo (2026-06-25, after a pollution RECURRENCE).**
        A worktree subagent's dev-test scaffold flipped the shared `core.bare` again. Cause: the safety guard's "forbidden"
        zone was `dirname(import.meta.url → installRoot)`, which is **fragile from inside a worktree** (computes just
        `.claude/worktrees`, not the whole repo). **Fix:** `resolveSafeCreatedWorkspaceParentDir` is now **git-aware** — a
        new exported `isPathInsideGitWorkTree(path)` walks up for a `.git`, and any candidate inside a git work tree is
        rejected/redirected (location-independent: catches the !Klein repo + every `.claude/worktrees/*` no matter where the
        code runs). Plus a **hard backstop** in `initializeGitRepository` (`nklein-dev-test-project.ts`): it throws rather
        than `git init` inside an existing work tree. +2 tests (a git repo OUTSIDE the install parent is now caught).
        Root+web tsc, fast **1731**, biome green. AGENTS.md incident note + CHANGELOG updated. *(Confirms again: worktree
        write-subagents are risky here — but the env is now hardened so even a stray scaffold can't pollute the repo.)*
  - [x] **per-task NKlein settings — ALREADY EXPOSED (audit was stale, verified 2026-06-25).** `contextScope`
        (Full/Smart/Minimal/Custom) and the per-task `timeoutMode` (Normal/Long/Extended/Unlimited) are already rendered as
        `NativeSelect` controls in the card's NKlein agent chat panel ([nklein-agent-chat-panel.tsx](web-ui/src/components/detail-panels/nklein-agent-chat-panel.tsx)
        ~L1235–1262), wired to `persistNKleinModelSettings` → `onTaskNKleinSettingsChanged` → `applyTaskDetailNKleinSettingsChange`.
        The "5 explicit timeout values" are a **global** concept (Settings → Tasks); per-task uses the mode selector, which
        is present. No gap. *(Second stale §5.W audit item after swarm stop/resume — the feature-vs-UI audit over-reported.)*
  - [x] **swarm stop/resume in the UI — ALREADY DONE (stale duplicate, verified 2026-06-25).** The board header already
        has the Pause/Resume control (`kanban-board.tsx`, `board.swarm-pause`, driven by `swarmStopSignal`). Duplicate of
        the resolved item lower in this section; the audit listed it twice.
  - [~] **dependency link/unlink dialog** — CLI `task link`/`unlink` exist; board creation was **drag-only**. **COMPONENT
        DONE (solo):** `DependencyPickerDialog` ([dependency-picker-dialog.tsx](web-ui/src/components/dependency-picker-dialog.tsx))
        — pick a task from a candidate list (self + already-linked filtered out) → `onCreateDependency(card.id, picked.id)`
        (the pure `addTaskDependency` still validates + orients direction + toasts rejections), plus a "Current links" list
        (waits on / blocks) with per-link remove → `onDeleteDependency`. Self-contained, 4 unit tests, web tsc + biome green.
        **WIRED — DONE (2026-06-25).** A hover **"Manage dependencies"** ghost button (Link2 icon, non-trash cards only)
        on every board card AND the detail-panel card list opens the dialog; `App.tsx` holds the `manageDependenciesCardId`
        state + renders `DependencyPickerDialog` with the trash-filtered card list + `board.dependencies` +
        `handleCreateDependency`/`handleDeleteDependency`. Threaded App → `kanban-board` + `column-context-panel` → `board-card`
        (mirrors `onMoveToTrash`). board-card test extended. web tsc + **web vitest 701** + biome green. CHANGELOG entry added.
        *(Built by a worktree subagent; its worktree hit the dev-test `core.bare` pollution again, but the web-ui edits were
        clean + untracked-by-the-fixture, so I recovered the repo and salvaged the 7 files cleanly — see incident note below.)*
  - [x] **guided expand-plan-task + plan-gap** — surface `expand-plan-task` (JSON-only) + `plan-gap` reporting in the
        card detail panels. **plan-gap DONE (2026-06-25):** `recordNKleinPlanGap` tRPC mutation added to `runtime-api.ts`
        (calls `recordPlanGap` + `inferNKleinPlanSlugForTask` + `appendNKleinPlanRevision` + card-creating helpers for
        integration/decision/scope kinds), schema in `api-contract.ts`, proc wired in `app-router.ts`, client helper in
        `runtime-config-query.ts`, `PlanGapActionsPanel` detail panel rendered in `card-detail-view.tsx` after
        `PendingPlanArtifactsPanel` (planning + review lanes only), 6-test contract suite.
        **expand-plan-task DONE (2026-06-25, path 2b):** `expandNKleinPlanTask` tRPC mutation added to `runtime-api.ts`
        (infers planSlug + planTaskId from board taskId or accepts them explicitly, maps to
        `applyNKleinPlanTaskReplacementArtifacts`), schema in `api-contract.ts`, proc wired in `app-router.ts`, client
        helper in `runtime-config-query.ts`, `ExpandPlanTaskPanel` detail panel (collapsible, repeatable replacement
        editor with title/prompt/acceptanceCommand fields) rendered in `card-detail-view.tsx` after `PlanGapActionsPanel`
        (planning lane only), 5-test contract suite + component test. Path 2a (agent-proposed discovery) deferred to a
        later layer once the model writes proposed replacements as a dedicated artifact type.
  - [-] **settings regrouping (from the audit):** move swarm guardrails under a clearer "Autonomous run limits" home,
        de-confuse the code-embedding default-vs-override split, and give model-roles/agent-rulesets a dedicated sub-panel.
        *(dup of the fuller "Regroup the settings menus" item below — those 3 points are all covered by its ~9-section
        plan: Guardrails & Limits = guardrails home; the code-embedding "Riskiest" note = de-confuse the split; Agents &
        Roles section = model-roles/rulesets sub-panel. Tracked there.)*
- [~] **Global vs project config + per-project overrides** — most settings global (one place); a per-project **override**
      for *almost every* global setting (global default + project override layer; clear inherits/overridden state). Define
      the override model + storage; wire it through. **PLAN (research agent 2026-06-25):** the override mechanism already
      exists for exactly one field — `codeEmbeddingOverride` in `RuntimeProjectConfigFileShape` (`runtime-config.ts` ~L83),
      merged in `toRuntimeConfigState` as `effectiveCodeEmbeddingSettings = override ?? defaults` (~L855). **Extend that
      template:** add `<field>Override?: T | null` project-config fields + an `applyOverride(globalValue, projectOverride,
      normalize)` helper used per-field in `toRuntimeConfigState`, and expose per-field "Inherited / Overridden (× revert)"
      state to the UI (store the project overrides on `RuntimeConfigState` so the dialog can badge each control). **Do it
      in phases** — Phase 1 = the ~5 highest-value overrides (`selectedAgentId`, `maxConcurrentTasks`, `modelRoles`,
      `agentRulesets`, + refactor `codeEmbedding` into the new shape); Phase 2 = the rest. **Riskiest:** the dialog's
      inherited-vs-overridden state (derive `isOverridden()` rather than parallel booleans), back-compat (old project
      configs have no override fields → no-op), and NOT auto-syncing an override when its global default changes.
      **DIFF-LEVEL PLAN READY (research agent #2, 2026-06-25)** — 12 ordered steps with exact file:lines, all mirroring the
      `codeEmbeddingOverride` template: (1) add 4 `<field>Override?` to `RuntimeProjectConfigFileShape` (~L83); (2) add the
      override + `effective<Field>` fields to `RuntimeConfigState` (~L88); (3) add `applyOverride`/`applyScalarOverride`
      helpers + 4 `normalize<Field>Override` (each returns null when == default so the file stays clean) (~L560); (4) compute
      effective = override ?? global in `toRuntimeConfigState` (~L783); (5) register the 4 in `RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS`
      (~L642 — the completeness-guard test auto-fails until done); (6) thread through `writeRuntimeProjectConfigFile` (~L1222,
      incl. the empty-file cleanup), `updateRuntimeConfig` (~L1630 `keepNormalizedValue`), `saveRuntimeConfig` (~L1471);
      (7) contract `runtimeConfigResponse`/`SaveRequest` (~L1870/1921); (8) settings dialog `OverrideToggle` (Inherited /
      Overridden ×-revert) in the Project section (~L4049) + state/init/change-detection/reset/save-payload; (9) 3 tests
      (single-field override+reset, all-fields together+reload, old-config back-compat). Backend is the bulk + self-contained
      (steps 1-7,9) — implement + commit that first, then the UI (step 8). **SOLO** (worktree write-agents unsafe here).
      **PHASE 1 FIRST FIELD DONE (2026-06-25):** `maxConcurrentTasksOverride` wired end-to-end — project config storage,
      `RuntimeConfigState.maxConcurrentTasksOverride`/`effectiveMaxConcurrentTasks`, API contract, consumer switched to
      `effectiveMaxConcurrentTasks`, drift-guard + new override test.
      **PHASE 1 SECOND FIELD DONE (2026-06-25):** `selectedAgentIdOverride` wired end-to-end — project config storage,
      `RuntimeConfigState.selectedAgentIdOverride`/`effectiveSelectedAgentId`, API contract, core consumers
      (`resolveAgentCommand`, `getCuratedDefinitions`, model-registry discovery) switched to `effectiveSelectedAgentId`,
      new override test.
      Remaining Phase 1 fields: `modelRoles`, `agentRulesets`; then UI `OverrideToggle`.
      **PHASE 1 UI DONE (2026-06-25):** `maxConcurrentTasksOverride` + `selectedAgentIdOverride` controls in Settings → Project
      section — `OverrideRow` helper component, inherits-vs-overrides toggle pattern, wired into state/init/change-detection/reset/save.
      **PHASE 1 THIRD FIELD DONE (2026-06-25):** `agentRulesetsOverride` wired end-to-end (backend only, UI is separate follow-up).
      `normalizeAgentRulesetsOverride` (null-when-default), threaded through `RuntimeProjectConfigFileShape`,
      `RuntimeConfigState` (+ `effectiveAgentRulesets`), `RuntimeConfigUpdateInput`, `createRuntimeConfigStateFromValues`,
      `toRuntimeConfigState`, `toGlobalRuntimeConfigState`, `saveRuntimeConfig`, `updateRuntimeConfig`,
      `updateGlobalRuntimeConfig`, `writeRuntimeProjectConfigFile`. API contract (`runtimeConfigResponseSchema` +
      `runtimeConfigSaveRequestSchema`) + `buildRuntimeConfigResponse`. `runtime-server.ts` delivery-tier + sandbox-network
      consumers switched to `effectiveAgentRulesets`. `effectiveAgentRulesets` in `RUNTIME_CONFIG_DERIVED_FIELD_KEYS`;
      `agentRulesetsOverride` in `RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS`. New override test + all fixtures patched.
      **PHASE 1 FOURTH FIELD DONE (2026-06-25):** `modelRolesOverride` wired end-to-end (backend only, UI is separate follow-up).
      `normalizeModelRolesOverride` (null when absent/empty), threaded through `RuntimeProjectConfigFileShape`,
      `RuntimeConfigState` (+ `effectiveModelRoles`), `RuntimeConfigUpdateInput`, `createRuntimeConfigStateFromValues`,
      `toRuntimeConfigState`, `toGlobalRuntimeConfigState`, `saveRuntimeConfig`, `updateRuntimeConfig`,
      `updateGlobalRuntimeConfig`, `writeRuntimeProjectConfigFile`. API contract (`runtimeConfigResponseSchema` +
      `runtimeConfigSaveRequestSchema`) + `buildRuntimeConfigResponse`. All routing/role-assignment consumers
      (`runtime-api.ts` ×3, `task.ts` ×3, `projects-api.ts`, `second-opinion-review-runner.ts`,
      `nklein-acceptance-repair.ts`, `nklein-decomposition-tool.ts`) switched to `effectiveModelRoles`. Telemetry
      stays on `modelRoles` (retrospective classification — project overrides irrelevant). `effectiveModelRoles`
      in `RUNTIME_CONFIG_DERIVED_FIELD_KEYS` + `Omit<RuntimeConfigState,...>`; `modelRolesOverride` in
      `RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS`. New override test + all fixtures patched. **Phase 1 backend COMPLETE.**
      **PHASE 1b UI DONE (2026-06-25):** `modelRolesOverride` + `agentRulesetsOverride` controls added to Settings → Project
      "Per-project overrides" card — same `OverrideRow` pattern; `ModelRolesEditor` extracted as reusable component
      (replaces inline model-role JSX in the global NKlein section + the new override row); handlers updated to functional
      updates to avoid stale-closure batching. Saved to `modelRolesOverride`/`agentRulesetsOverride` in the payload.
      Remaining: UI for `codeEmbedding` override.
- [x] **Per-provider + per-model concurrency — global AND per-project configurable** *(2026-06-26, user)* — **COMPLETE END-TO-END (2026-06-27):** resolution core + schemas + runtime-config persistence + live scheduler gate + tRPC contract + Settings UI (global card AND per-project override row), all verified. The user wants
      the swarm's parallelism tunable at two grains and two scopes: **(a) per model PROVIDER** (e.g. lmstudio / ollama /
      a custom local endpoint) and **(b) per MODEL**, each settable as a **global default** AND a **per-project override**.
      **What exists to build on:** per-model concurrency is already a machine-local **registry constraint**
      (`maxConcurrentRequests`, §5.T) the **endpoint scheduler** ([nklein-endpoint-scheduler.ts](src/nklein-agent/nklein-endpoint-scheduler.ts),
      §6.5) reads to allow N concurrent sessions on a shared endpoint; `maxConcurrentTasks` (board cap) already has the
      global+project-override pattern (§5.W Phase 1). **What's NEW:** a per-PROVIDER cap, and expressing both as
      global-default + project-override **config** (not just a registry constraint). Build:
  - [x] **config shape — RESOLUTION CORE DONE (2026-06-26):** [src/core/concurrency-config.ts](src/core/concurrency-config.ts)
        — `ConcurrencyConfig` (`perProvider`/`perModel` maps) + `ConcurrencyOverride`, the `normalize*` writers
        (clamp [1,256], drop blanks, null-when-empty override like the other §5.W overrides), and the precedence
        resolvers: `resolveEffectiveProviderConcurrency` / `resolveEffectiveModelConcurrency` (override ?? global ??
        the per-model registry `maxConcurrentRequests` fallback) + `resolveSessionConcurrencyCaps` (both grains as
        independent gates). Pure, 14 unit tests, tsc + biome green. **WIRE SCHEMAS DONE (2026-06-27):**
        `concurrencyConfigSchema` / `concurrencyOverrideSchema` / `concurrencyMapSchema` added to
        [concurrency-config.ts](src/core/concurrency-config.ts) (lenient on values — the `normalize*` writers clamp on
        load — with compile-time `z.ZodType` drift guards + 3 schema tests), the prerequisite for both the runtime-config
        and the tRPC-contract threading. **RUNTIME-CONFIG THREADING DONE (2026-06-27):** `concurrencyDefaults`
        (global) + `concurrencyOverride` (per-project) are threaded through ALL ~25 sites of `runtime-config.ts` — the
        two file shapes, `RuntimeConfigState`, `RuntimeConfigUpdateInput`, the load-normalize + build assembly, the
        global+project save-payload writers (conditional-write + the null-when-empty delete), the change-detection
        registry (`areConcurrencyConfigsEqual`/`areConcurrencyOverridesEqual`), and both `createRuntimeConfigStateFromValues`
        / global-reset / `keepNormalizedValue` update paths. Additive (no "effective" field — concurrency resolves
        per-session); the existing 2358 fast tests + tsc stayed green throughout, and a new round-trip test proves a
        global default AND a per-project override **persist across save→reload** (and the global is preserved on the
        override save). **CALLER-WIRING DONE (2026-06-27) — THE GATE IS NOW LIVE:** `start-task-session.ts` resolves the
        effective caps via `resolveSessionConcurrencyCaps({ providerId, modelId: buildNKleinModelRegistryKey(...), global:
        scopedRuntimeConfig.concurrencyDefaults, override: scopedRuntimeConfig.concurrencyOverride })` and passes
        `providerConcurrencyCap`/`modelConcurrencyCap` into `scheduleNKleinEndpointStart`. So a concurrency cap set in the
        config file is now **resolved + enforced end-to-end** (registry `maxConcurrentRequests` fallback stays inside the
        scheduler, so a null cap = unchanged behavior). tsc + 186 trpc/scheduler tests green. **tRPC CONTRACT DONE
        (2026-06-27):** `concurrencyDefaults`/`concurrencyOverride` threaded through `runtimeConfigResponseSchema` (required)
        + `runtimeConfigSaveRequestSchema` (optional, in [config-api-contract.ts](src/core/config-api-contract.ts)) +
        `buildRuntimeConfigResponse` (agent-registry.ts); `saveConfig` already passes them generically. (Also dropped the
        `.default({})` on `concurrencyConfigSchema` so the response's required-grains type matches the threaded
        `ConcurrencyConfig` — fixed a web-ui `| undefined` mismatch.) 8 web + 6 backend `RuntimeConfigState`/response
        fixtures updated; root+web tsc, full fast suite, web vitest (738) all green. **So the config is now API-readable +
        API-writable + persisted + enforced — fully functional headless.** **SETTINGS UI DONE (2026-06-27) — §5.W
        CONCURRENCY COMPLETE END-TO-END:** `<ConcurrencyEditor>`
        ([web-ui/src/components/concurrency-editor.tsx](web-ui/src/components/concurrency-editor.tsx)) — a controlled
        two-map editor (Per provider + Per model), each with editable+removable cap rows (key read-only, number editable,
        1–256) + an add-row; threaded through the settings dialog's draft state + init + dirty (JSON compare) + save +
        the reset effect, in a "Per-provider / per-model concurrency" card by the Max-concurrent-tasks field. 4 component
        tests + the dialog's 40 tests; root+web tsc, full web vitest (742), web:build, AND a **live browser load** (the
        dialog opens + the card renders both sections, no console errors). **PER-PROJECT OVERRIDE EDITOR DONE
        (2026-06-27) — §5.W CONCURRENCY UI 100% COMPLETE (global + project):** a "Concurrency caps" `OverrideRow` in the
        Settings → Project "Per-project overrides" card (after Model roles / Agent rulesets), reusing the same
        `<ConcurrencyEditor>`. "Override for this project" seeds an editable copy from the live global maps;
        "Revert to global" clears it (→ `null` = inherit). Threaded `concurrencyOverride` through the dialog's
        state/init(`initialConcurrencyOverride`)/dirty(JSON compare)/dep-array/reset/save (the contract's save request
        already accepted `concurrencyOverride: …nullable().optional()`, and the backend persists+resolves it via
        `scopedRuntimeConfig.concurrencyOverride`). The §5.W Phase-1b dialog test now also enables + asserts
        `concurrencyOverride` non-null on save (and was hardened to click override rows by label, not fragile index).
        Root+web tsc, full web vitest (742, incl. the extended dialog test), web:build, and a live load (app renders,
        settings dialog opens, **no console errors** — the project-override section needs a selected project, which the
        jsdom dialog test covers faithfully with a `workspaceId` config).
  - [x] **scheduler enforcement — DONE + LIVE (2026-06-27):** `scheduleNKleinEndpointStart`
        ([nklein-endpoint-scheduler.ts](src/nklein-agent/nklein-endpoint-scheduler.ts)) now has an **independent
        per-PROVIDER gate** (`evaluateProviderConcurrencyGate`) — when the request carries `providerConcurrencyCap` it
        counts the provider's running sessions across ALL its endpoints/models and holds at the cap (reason +
        `sharedEndpointId: "provider:<id>"`); and the per-endpoint `limit` now takes an optional `modelConcurrencyCap`
        (the effective config cap) in place of the registry `maxConcurrentRequests`. **Additive + dormant by default:**
        both fields are optional, so with neither set the behavior + the existing 9 tests are unchanged; +3 new tests
        (provider-cap allows-under/blocks-at across distinct endpoints; model-cap override raises then blocks).
        **CALLER-WIRING DONE (2026-06-27) — gate live:** `start-task-session.ts` resolves + passes both caps from the
        effective `ConcurrencyConfig` (see the config bullet above), so the provider + model gates are enforced
        end-to-end (null cap = unchanged behavior).
  - [x] **contract + tRPC — DONE (2026-06-27)** — the two maps + overrides are threaded through `runtimeConfigResponseSchema` /
        `runtimeConfigSaveRequestSchema` + `buildRuntimeConfigResponse`; `saveConfig` passes them generically (detail in the config bullet above).
  - [x] **Settings UI — DONE (2026-06-27)** — a "Per-provider / per-model concurrency" card (global) with the two-map
        `<ConcurrencyEditor>`, + the per-project "Concurrency caps" `OverrideRow` (Inherited / Overridden ×-revert).
        Pairs with the §5.W settings regroup ("Guardrails & Limits" / Parallelism home).
  - *(cross-links)* §5.T (the per-model registry constraint this generalizes) · §6.5 (endpoint scheduler — the
        enforcement point) · §5.AB (parallel role→model balancing reads these caps) · §5.AF (resource governance +
        the durable scheduler honor them) · §5.W (the global-vs-project override mechanism + settings regroup).
- [x] **Project Settings discoverability (2026-06-25, subagent + verified)** — the active project row now shows a
      visible **gear** (`isCurrent`-gated, `stopPropagation`, `ElementTooltip id="project.settings-gear"`) opening the
      existing Project Settings dialog via `onOpenSettings`; the `⋯`-menu item is kept too.
      ([project-row.tsx](web-ui/src/components/project-nav/project-row.tsx)) *(A board-header entry point is still optional.)*
- [~] **Regroup the settings menus** — group by concern (Models/Providers, Agents & Roles, Isolation, Guardrails, Code
      Intelligence, Advanced, …) so nothing is scattered; consistent layout. Pair with the §5.U `runtime-settings-dialog`
      decomposition when that runs. **PLAN (research agent 2026-06-25):** today 7 flat `SettingsNavId` sections
      (`runtime-settings-dialog.tsx` ~L342–357) with mixed concerns — "General" is a dumping ground (dev mode + Docker +
      agent select + timeouts + code intel), "Tasks" conflates task defaults + parallelism + rulesets. Proposed ~9 sections:
      Workspace Essentials · Sandbox & Isolation · Agents & Roles · !Klein Provider & Models · Guardrails & Limits ·
      Automation & Templates · Notifications · Appearance · Project. **Mostly JSX moves (~500–800 lines, low logic risk).**
      **Riskiest:** the **code-embedding** block (derived `effectiveCodeEmbeddingSettings` + global-default-vs-project-override
      entanglement) — keep it reachable for non-!Klein users (don't bury it in the !Klein section). Do it as **low-risk
      pure-move increments first**; pairs with the §5.U dialog decomposition. *(Lower priority: cosmetic + touches the file I
      just edited for workspaceBaseDir — sequence after the higher-value feature gaps.)*
  - [x] **Increment 1 (2026-06-26): split the "General" dumping ground → lean General + a new "Agents" section.** Added an
        `"agents"` `SettingsNavId` + nav item (`Boxes` icon) and moved the agent-execution config out of General's first card
        into the new section: Agent isolation/Docker, the sandbox-isolation pool, lost-heartbeat, decomposition-auto-apply,
        second-opinion review, the swarm-guardrails panel, advanced-policy visibility, and agent rulesets (379 lines,
        extracted as a div-balance-verified clean range). General now = Developer Mode + Advanced. Verified: web:typecheck +
        36-test dialog oracle + web:build. *(Live Playwright pass of the new nav still owed.)*
  - [ ] remaining regroup sections per the ~9-section plan: !Klein Provider & Models, Guardrails vs Agents boundary, Code
        Intelligence (keep reachable for non-!Klein users), relabel "Git Prompts" → "Git", Workspace/Project polish
  - [x] **live-verified (2026-06-26, Playwright)** — booted `dev:full`, opened Settings (⌘⇧S), confirmed the **Agents**
        nav entry renders (Boxes icon) alongside a retained **General**, clicking Agents scrolls the moved content (Docker
        isolation + swarm guardrails + rulesets) into view, **zero console/page errors**. Reusable smoke at
        [scripts/verify-settings-agents-nav.mts](scripts/verify-settings-agents-nav.mts); screenshot confirmed the clean
        Agents section (isolation status, agent config + timeouts, isolation pool).
- [x] **swarm stop/resume in the UI — ALREADY DONE** *(audit 2026-06-25)* — the board header already exposes it:
      [kanban-board.tsx](web-ui/src/components/kanban-board.tsx) has the `board.swarm-pause` control (Pause/Resume button +
      a "Paused" status driven by `swarmStopSignal`/`RuntimeSwarmStopSignal`). The §5.W "CLI-only" note was stale.

### 5.X — Deep whole-codebase refactor (gated on §5.V) + possible backend→Python port *(2026-06-25, user)*
> **The big arc.** The user wants a **deep refactor of the whole codebase** for *clear structure, testability,
> maintainability, efficiency, and correctness* — the execution arm of the §5.U analysis, taken all the way (not just
> the safe-now dedups). **It may go hand-in-hand with porting the entire server/backend side to Python** (which aligns
> with the existing §5.H native-core / `core-py` direction — the ML/sidecar is already Python). **Hard precondition: §5.V
> full deep test coverage (incl. extensive e2e + UI) must land FIRST** as the behavior safety-net / regression oracle, and
> must be **port-resilient** (assert behavior through stable seams — tRPC/HTTP contract, CLI, web-ui, on-disk formats,
> Docker boundaries — see §5.V). Do **not** start the structural refactor or any port before that net is real and green.
> The whole arc is behavior-preserving: externally-observable behavior stays identical; only the internal structure
> (and possibly the implementation language of the backend) changes.
>
> **RESOLVED (2026-06-25 clarification pass): "plan now, build after §5.V".** Design the port (strangler-fig behind the
> §5.V contract oracle; web-ui stays TS; shared schemas generated from one source; agent-runtime port is the long pole,
> staged last or bridged) AND do the Phase 1 TS-internal refactor **now**; do **not** start the actual Python port until
> the §5.V net is green. So Phase 2 is no longer "decision required" on *whether* to plan — it's planned; the remaining
> user decision is the final port scope/shape once §5.V is green (options staged below).
- **Phase 0 — land §5.V** *(gating pointer, not separate work — the actual items are tracked in §5.V; this Phase 0
      blocks §5.X Phases 1–2 below)* — the port-resilient test oracle. **← the gating linchpin.**
- [~] **Phase 1 — TS-internal deep refactor** (no language change): execute §5.U findings end-to-end — kill the
      monoliths (`nklein-task-session-service` ~3800, `runtime-server`, `nklein-decomposition-tool`, `workspace-state`,
      - [x] **Phase 1 PILOT (2026-06-26): `nklein-decomposition-tool.ts` (~1440 → 391 lines)** decomposed into 8
            single-responsibility modules under `src/nklein-agent/decomposition/` behind the existing barrel (pure moves,
            zero behavior change, all 6 importers untouched, all gates green: typecheck + lint + test:fast 1735/1735 +
            contract suite 12/12 + workflow suite 1/1 + web:typecheck). See `src/nklein-agent/decomposition/`.
      - [x] **Phase 1 session-service guards (2026-06-26): 3 per-task guard collaborators extracted from
            `nklein-task-session-service.ts` (3907 → 3449, −458 / −12%).** M1 `DecompositionStallNudger`
            (decomposition stall/nudge timers, `85ffd63b`), M2 `RepeatedToolCallGuard` (repeated-identical-tool-call +
            repeated-failure-target, `56e641dc`), M3 `AutonomyBudgetWatchdog` (autonomous turn/wall-time budgets +
            repeated no-diff checkpoints, `f785d739`). Each = per-task state + decision in its own file, I/O injected via
            a callbacks interface (`resetTask`/`dispose` lifecycle preserved); behavior-preserving, all gates green
            (typecheck + biome + test:fast 1736 + the session-service + decomposition unit suites). Directly executes the
            anti-patterns audit finding #2 remediation ("move guardrails behind focused collaborators with tests"). The
            remaining ~3449 lines are the interwoven orchestration core (session lifecycle, turn execution, tool dispatch,
            event adaptation, message/summary recording) — not cleanly-separable guard seams.
      - **Audit input (2026-06-26): whole-repo anti-pattern findings captured at `.plan/docs/anti-patterns.md`** (the
            §5.U analysis arm — 7 findings + a cross-cutting cleanup order). **✅ DONE: #6 (constants DRY'd, `dbedf448`)
            + #4 (inline type imports removed, `9492905b`).** (Verified 2026-06-26: both are genuinely complete —
            `RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS`/`80_000` are single-sourced in api-contract and there are zero
            inline `import().Type` annotations left in `src/`; the earlier "remaining #6/#4" re-listing here was stale.)
            Remaining bigger items it hands us: **#2** settings-dialog (4430), runtime-api (2410), api-contract
            (2614), App.tsx (1359) extractions; **#5** validated JSON/JSONL persistence; **#3** ratchet the broad biome lint
            disables; **#7** shared web-ui test harness. **#1 (HIGH, security) — DECIDED (2026-06-27, user):** chat
            "sandboxed" scopes are host fs/shell access with a session-wide `riskAcknowledged` opt-in — by-design (§5.M
            host opt-in), but the naming misleads. **Decision: rename for clarity (→ make the host-access nature explicit)
            + KEEP the session-wide ack** (no move to per-action). Tracked as an actionable item in §5.M below.
      - **Reconciled progress (2026-06-26):** beyond #6/#4 above — **anti-patterns #5** first slice DONE (config
            corrupt-vs-missing: a parse failure now diagnoses + preserves a `.corrupt-*.bak` instead of silently
            resetting, `958b91d2`, +CHANGELOG + tests); **anti-patterns #5 second slice DONE** (validated JSONL
            persistence boundaries — shared `src/state/jsonl-store.ts` helper + zod schemas; all 6 stores repointed:
            `chat-memory-store`, `chat-host-action-audit-store`, `chat-transcript-store`, `chat-session-store`,
            `merge-history-store`, `task-run-summary-store`; schema-invalid records now skip+log instead of silently
            trusted; 7 new tests; 1806 tests green; `82e1c25f`); **architecture #3** (tRPC router
            composition) — slice 1 DONE (update-status + runtime-stats → `src/trpc/runtime-api/update-status.ts`,
            `178963d4`); **slice 2 DONE (2026-06-26): `getNKleinCodeIntelligenceStatus` (~112 lines, read-only)
            extracted to `src/trpc/runtime-api/code-intelligence-status.ts`** as a pure `handle…(workspaceScope, deps)`
            taking a one-method deps slice (`loadScopedRuntimeConfig`) — the factory handler is now a thin call;
            `runtime-api.ts` 2410 → 2296; runtime-api test 87/87 green. **Pattern for the runtime-api factory split
            (don't re-derive):** the bulk is the BIG stateful handlers (startTaskSession ~280, sendTaskChatMessage ~115,
            recordNKleinPlanGap ~140) which need a per-handler deps slice + the runtime-api test as the oracle; the thin
            1-line provider/account delegations are NOT worth extracting (thin-shell anti-pattern). **slice 3 DONE
            (2026-06-26): the model-registry group** (5 handlers `getNKleinModelRegistry` / `remove…` / `prune…` /
            `saveNKleinModelContextWindowOverride` / `saveNKleinModelMaxConcurrentRequests`) + the co-moved local
            `addConfiguredLocalModelRegistryEntries` helper → `src/trpc/runtime-api/model-registry.ts`, taking a
            `{ loadScopedRuntimeConfig, nkleinProviderService }` deps slice (service type =
            `ReturnType<typeof createNKleinProviderService>`); `runtime-api.ts` 2296 → 2135; test 87/87. (tsc caught a
            wrong parse-fns import source — they live in `core/api-validation`, not `api-contract` — fixed.) **slice 4
            DONE (2026-06-26): `collectTaskEvidence` (~108 lines) → `src/trpc/runtime-api/task-evidence.ts`** with its 2
            co-moved local helpers (`findTaskCard` + `resolveGitCommit`, each handler-only) and a
            `{ getScopedNKleinTaskSessionService, loadScopedRuntimeConfig, getEvidenceBundleRoot }` deps slice; clean
            first try (~14 imports pre-scoped). **slice 5 DONE (2026-06-26): `expandNKleinPlanTask` (~81 lines) →
            `src/trpc/runtime-api/expand-plan-task.ts`** — the cleanest yet: NO deps slice (a pure
            `(workspaceScope, input)` fn over module-level plan helpers); clean first try. **slice 6 DONE (2026-06-26):
            `recordNKleinPlanGap` (~149 lines) → `src/trpc/runtime-api/record-plan-gap.ts`** — also NO deps slice (pure
            `(workspaceScope, input)` over plan-gap helpers + `mutateWorkspaceState`); clean first try. **runtime-api.ts
            2410 → 1775 this turn (−635 over 6 slices; 11 helper modules in `src/trpc/runtime-api/`); test 87/87 each.**
            **slice 7 DONE (2026-06-26): `sendTaskChatMessage` (~116 lines) → `src/trpc/runtime-api/task-chat-send.ts`**
            with a `{ getScopedNKleinTaskSessionService, nkleinProviderService, broadcastTaskChatCleared? }` deps slice
            (the trivial local `reconcileRunningTaskBoardLane` adapter inlined to its `reconcileStartedTaskBoardLane`
            core call rather than co-moved, since it's shared by 3 handlers). **runtime-api.ts 2410 → 1665 this turn
            (−745, −31%, over 7 slices; 12 helper modules); test 87/87 each.** **slice 8 DONE (2026-06-26):
            `startTaskSession` (~283 lines, the session-start orchestrator — the biggest + most interwoven) →
            `src/trpc/runtime-api/start-task-session.ts`**, with the co-moved `applyCandidateEffectiveContextWindow`
            helper and a deps slice typed as `Pick<CreateRuntimeApiDependencies, …> & { nkleinProviderService }` (reusing
            the factory's exact dep types via a type-only import — circular is fine, erased at runtime). tsc caught one
            wrong import source (CreateRuntimeApiDependencies is in runtime-api.ts not app-router; 4 implicit-any errors
            cascaded from it) — fixed. **✅ ALL big runtime-api handlers now extracted: runtime-api.ts 2410 → 1353 this
            turn (−1057, −44%, over 8 slices; 13 handler/helper modules in `src/trpc/runtime-api/`); test 87/87 each.**
            What's left in `runtime-api.ts` is the factory wiring + many small/thin handlers (not worth extracting).
            **architecture #13** CI
            boundary-drift fixed (`fe4e0343`); **anti-patterns #3 (lint ratchet) — three slices DONE:** (a) re-enabled
            `noExplicitAny` globally (was `off` at `biome.json:16`, directly contradicting the repo's #1 TS principle)
            as a hard `error` gate — the only 3 violations were a deeply-navigated JSON-Schema probe in one fuzz test,
            consolidated behind one rationale'd `biome-ignore`; (b) re-enabled `noDangerouslySetInnerHtml` for web-ui —
            consolidated the 3 safe Prism-highlight sinks (markdown + diff renderers) behind a single `PrismHtml`
            component (`web-ui/src/components/shared/prism-html.tsx`, the one sanctioned exception + a render test), so
            new unsanitized HTML injection is now caught; (c) re-enabled `a11y/noNoninteractiveTabindex` — the 1
            violation was an intentional focusable scroll region (git-commit list, keyboard scroll), suppressed with a
            WCAG rationale. **Remaining lint counts (web-ui, by violations):** `useAriaPropsForRole` 4,
            `useFocusableInteractive` 5, `noUselessFragments` 6 (NB: 5 are not biome-auto-fixable + a blanket
            `--write --unsafe` scope-creeps other rules → fix targeted), `useKeyWithClickEvents` 8,
            `noStaticElementInteractions` 9, `noSvgWithoutTitle` 9, `useSemanticElements` 10, `noArrayIndexKey` 16,
            `useExhaustiveDependencies` 68, `noNonNullAssertion` 131 — each needs *manual* per-site a11y fix-or-suppress
            (real markup work, not auto-fixes), best done around the component extractions. Still open: #2 the big
            extractions, #3 these remaining lint rules, #7 shared test harness.
      web-ui `App.tsx`/`board-card`), make state ownership explicit (single board writer/owner per the §5.U state-flow
      map), extract the delivery orchestrator + unify the summary event bus (R1/R2), DRY the duplicated guards/lookups
      (S1–S3), remove dead/back-compat-only code, and tighten type-safety. Each step behavior-preserving + green under §5.V.
      - **#2 `api-contract.ts` split — STARTED (2026-06-26); method settled, don't re-derive.** The 2614-line contract
            monolith (269 const + 255 type exports) is being decomposed into sibling `*-api-contract.ts` domain modules
            behind the existing `src/core/api-contract.ts` barrel — the SAME pattern as the already-split
            `chat-api-contract.ts` (re-exported at the top of the barrel) and roadmap rec #2. **Method:** foundational /
            **leaf-first** — each domain module imports only `z` + already-extracted modules and **NEVER back-imports
            from the barrel** (that would make a zod-const **load-order cycle** → `undefined` schema at eval); the barrel
            re-exports each domain via `export * from "./<domain>-api-contract.js"`; verify green every step (root `tsc` +
            web `tsc` + `biome` + `test:fast` + contract suite). **✅ SPLIT ESSENTIALLY COMPLETE — 19 domains, barrel
            2614 → 138 (-95%):**
            (1) `workspace-files-api-contract.ts` (8 schemas — file status/change, working-copy/last-turn changes
            req+res, fuzzy search; a pure leaf nothing else referenced → plain `export *`); (2)
            `runtime-config-api-contract.ts` (~30 foundational symbols — core id/column/auto-review enums, NKlein
            reasoning/context-window/timeout/embedding settings, swarm guardrails, model-roles, agent rulesets);
            (3) `board-api-contract.ts` (task images, generated-from-plan, card review verdict/round/summary, focus
            chains, board card/column/dependency/data — imports its config primitives from module (2)); (4)
            `git-sync-api-contract.ts` (repo info, fetch/pull/push sync + summary/response, checkout, discard — a leaf;
            barrel keeps a local import of the 2 it reuses); (5) `task-session-api-contract.ts` (session
            state/mode/review-reason, hook activity, turn checkpoints, usage + context-budget, the model-perf-role enum,
            and the per-card session summary — depends only on `runtimeAgentIdSchema` from (2)); (6)
            `telemetry-stats-api-contract.ts` (model-performance + knowledge-tool-usage stats — imports its session
            telemetry primitives from (5); a pure `export *`, not used downstream); (7)
            `workspace-projects-api-contract.ts` (workspace-state response/save/conflict/notify, project
            task-counts/health/summary, task/workspace metadata — imports board-data/git/task-session from extracted
            modules); (8) `projects-api-contract.ts` (projects / dev-test / directory / remove / migration / worktree +
            the task-workspace-info **task-scope** + project shortcuts — imports board-card + project-summary); (9)
            `nklein-provider-api-contract.ts` (the big middle, ~293 lines — oauth / provider-settings / account /
            catalog / models / endpoint-discovery / model-registry / code-intel — imports code-embedding +
            reasoning-effort from (2)); (10) `nklein-provider-mutations-api-contract.ts` (provider capability,
            add/update provider, oauth-login, device-auth, provider-settings-save — imports oauth/provider-settings from
            (9) + reasoning-effort from (2); pure `export *`, not used downstream); (11) `nklein-ops-api-contract.ts`
            (misc backend-op leaves — core-py health, merge-history, advisor, dogfood, smoke-eval, task-evidence; a pure
            leaf); (12) `config-api-contract.ts` (agent definition + sandbox status + the full config response/save —
            imports config primitives from (2) + provider-settings from (9) + project-shortcut from (8)); (13)
            `plan-artifacts-api-contract.ts` (plan-artifact summary/list/apply/reject, record-plan-gap,
            expand-plan-task — imports planGapKind + workspace-state-response); (14) `task-lifecycle-api-contract.ts`
            (acceptance verify, worktree-merge, session start/stop, pause, swarm-stop, diagnostics, session-input —
            imports acceptance-categories + config + task-session + board); (15) `task-chat-api-contract.ts` (chat
            message/list/send/reload/abort/cancel + protected-test approval — imports reasoning-effort + task-image +
            task-session; the barrel keeps a local import of `runtimeTaskChatMessageSchema` for the state-stream
            `z.lazy`); (16) `stream-events-api-contract.ts` (mcp-auth-status + team-progress event + all WS
            state-stream messages + the union — imports chat-message (15) + workspace-projects + task-session; the
            barrel keeps a local import of `runtimeNKleinMcpServerAuthStatusSchema` for the MCP block); (17)
            `nklein-mcp-api-contract.ts` (MCP server config + settings response/save + auth-status + oauth — imports
            mcp-auth-status from (16)); (18) `terminal-api-contract.ts` (shell-session start + the terminal WS
            client/server message protocol — imports task-session-summary); (19) `git-history-api-contract.ts`
            (commit/ref shapes, git-log, commit-diff file/req/res, refs response — imports task-scope from (8)).
            Modules (2)/(3)/(5)/(7)/(8)/(9)/(15)/(16) are referenced widely downstream, so the barrel re-exports each AND keeps a local `import {…}` of the few
            symbols its remaining schemas still use (tsc-enumerated — the reliable way to find the local re-import set
            after any extraction; also drop now-unused barrel imports via `biome check --write --unsafe`). **sed-cut
            gotcha: use the grep'd start line, don't assume — a git-history cut started 2 lines early and orphaned a
            schema tail; root/web `tsc` caught it pre-commit, fixed by hand.**
            **✅ MILESTONE (2026-06-26): the api-contract.ts split is ESSENTIALLY COMPLETE — 19 domains extracted,
            barrel 2614 → 138 (-95%), holistically verified (contract suite 272/272 + web:build ✓ + root/web tsc + biome
            each step).** The barrel is now a clean re-export barrel + ~70 lines of small misc runtime endpoints
            (slash-commands, command-run, context-import, open-file, debug/status/run-update) that don't each warrant a
            module — left inline by design. The 524-export monolith is now 19 cohesive domain modules behind the barrel;
            all importers are unchanged (the `@runtime-contract` alias surface is identical).
- [x] **Phase 2 — DROPPED (owner decision, 2026-06-26): NO Python port — !Klein stays all-TS.** §5.X is now the
      TS-internal refactor only; the §5.V contract tests stay (good regardless). The original port open-questions (now
      moot) are kept below for history: Open questions to settle with the user before
      committing (prepare options now, decide later): **(a) scope** — the whole server/runtime (tRPC API, runtime-state
      hub, workspace/CRDT state, NKlein session orchestration, Docker sandbox mgmt, telemetry) or only some layers? **(b)
      boundary** — keep the web-ui (stays TypeScript/React) talking to a Python backend over the SAME contract (so the
      §5.V contract tests are the acceptance oracle on both sides); what about the CLI (port to Python, or keep a thin TS
      shell)? **(c) stack** — FastAPI/Pydantic + an async runtime; how the NKlein agent SDK (currently `@nkleinbot/*` TS)
      is replaced/bridged (this is the crux — the agent runtime is the largest TS surface; a Python agent runtime or a
      bridge is its own project). **(d) migration shape** — strangler-fig (stand up the Python backend behind the same
      contract, move endpoints over one at a time, contract tests gating each) vs big-bang. **(e) what stays TS** —
      web-ui certainly; shared schemas/contract (generate from one source so TS + Python agree). **(f) sequencing vs the
      north star** — the port must not stall "make small local LLMs deliver real products"; likely Phase 1 first, port
      only once value delivery is proven. *Recommendation to prepare: strangler-fig behind the §5.V contract oracle,
      web-ui stays TS, contract schemas generated from one source; the agent-runtime port is the long pole and may be
      staged last or kept as a bridged service.*
- *(cross-link note, not a work item)* **Cross-links:** §5.U (the analysis that feeds Phase 1), §5.V (the precondition
      oracle), §5.H (native-core / core-py — the Python beachhead already exists), §5.R (de-SDK boundary — a TS-side
      cleanup that also de-risks a port by shrinking the `@nkleinbot/*` coupling first).
- [ ] **Target-structure roadmap (2026-06-26): `.plan/docs/architecture-and-structure-suggestions.md`** — the *target
      shape* for this refactor (complements the anti-pattern audit's code-level findings). 13 recommendations: (1)
      formalize the monorepo (npm workspaces; `apps/{web,desktop}` + `packages/{contracts,runtime,runtime-core,nklein-
      integration,web-runtime-client,test-harness}`); (2) split `api-contract.ts` into contract-domain modules behind one
      barrel (model = `chat-api-contract.ts`); (3) tRPC root = router composition, each domain router backed by an
      application service; (4) execution backends as **ports + adapters** (a `TaskExecutionBackend` interface +
      capability flags, replacing scattered `agentId === "nklein"` checks); (5) first-class session types; (6) web-ui →
      **feature slices** (`features/{board,settings,chat,…}`); (7) extract a shared board-domain module (one source for
      column defs + normalize + mutations, today duplicated runtime↔UI); (8) typed persistence stores (`src/persistence/`
      — ties to anti-patterns/security #5); (9) runtime-state-hub → event-projection layer; (10) explicit + CI-enforced
      NKlein SDK boundary (ties §5.R); (11) settings draft-model + section registry (**pairs with §5.W settings
      regrouping**); (12) shared test-harness package; (13) align CI with the boundaries. **Migration order:** fix CI
      boundary drift → contract domains → shared board domain → modularize tRPC → execution-backend ports → web-ui
      feature slices → persistence → streaming projection. **✅ Immediate clear-cut (DONE 2026-06-26):** fixed the CI
      script-name mismatch (`check:cline-boundary` → `check:nklein-boundary` in `test.yml`), the boundary script's stale
      `src/cline-sdk` message → `src/nklein-sdk` (+ clarifying comment that the SDK is vendored at `vendor/nklein-sdk` and
      the import rule is biome-enforced; the legacy `@clinebot` node_modules guard stays — that's the real upstream
      package), and the issue-template links (Feature Requests `cline/kanban` → `nklein/kanban`; dropped the Cline
      Discord). The deeper boundary-policy redesign (rec #10) stays backlogged. **Guardrails (what-NOT-to-do):** don't split by line-count, no
      thin pass-through wrappers, don't move web-ui to a package boundary before contracts are stable, keep the contracts
      package dependency-free.

### 5.Y — Security hardening backlog ✅ COMPLETE (12/12) → moved to [done.md](done.md#5y--security-hardening-backlog-raised-2026-06-26-from-a-static-security-review--plandocssecurity-issuesmd)

### 5.Z — Cross-model verification: every LLM-interactive flow on every loaded model *(2026-06-26, user)*
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
> code-intel flows): `text-embedding-nomic-embed-text-v1.5@q8_0` (currently the only one loaded).
>
> **Crash-resilience caveat (user, settled):** **deepseek** has been seen **crashing/unloading** mid-run. If a model
> disappears from `/v1/models` during a sweep, **record it DROPPED and continue with the remaining models** — never
> block the sweep on one model. (We *want* deepseek covered; its crash-resilience is a separate task.)
>
> **Methodology:** reuse the existing `scripts/verify-*.mts` / `scripts/sweep-capture.mts` harnesses, pinning each
> model (most take a `--model` / model env, or the swarm reads it from the pinned provider settings). For each flow:
> iterate the roster → pin → run → record per model in the matrix [cross-model-verification.md](cross-model-verification.md):
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
- [ ] **Strict Docker isolation on a real task** (`verify-strict-isolation.mts`) + **restart/resume isolation**
      (`verify-restart-resume-isolation.mts`) — proven: qwen3-8b. Remaining 8.
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
  - [ ] `browse_url` (`verify-chat-browse`) across the roster — headless browser (self-serves a page + chromium).
- [ ] **Autonomous chat run** (`verify-chat-autonomous-live.mts`) — proven: qwen3-8b. Remaining 8.
- [ ] **Multi-card pipeline e2e** (`verify-multi-card-pipeline.mts`) — proven: qwen3-8b. SAMPLE a few representative
      models (it serializes on the single-request endpoint → ~25 min/run; not full-swept across all 9).
- [~] **Small-model output robustness** (`sweep-capture.mts`) — proven clean: gemma-4-e2b (mid+complex), gemma-4-e4b
      (complex), qwen3-8b (mid+complex, slow/non-terminal in window). Remaining: qwen2.5-coder-14b, qwen3.5-9b,
      phi-4-mini, phi-4-reasoning-plus, nemotron, deepseek + the unfinished presets. (Folds into §5.O — that section IS
      the output-robustness sweep; §5.Z just tracks its all-models coverage.)
- [ ] **Embedding / code-intelligence flows** — sweep the loaded embedder(s) (currently only
      `text-embedding-nomic-embed-text-v1.5@q8_0`); re-run when more are loaded.
- [x] **Temporal-awareness lighthouse (§5.AC) — ALL 9 PASS (2026-06-26)** (`verify-temporal-awareness-live.mts`) — a real
      chat turn with the host clock injected; asserts the model grounds in the injected "now" (places a current-year past
      month in the past, which its ~2024 training prior would call the future). **9/9 across the whole roster**: gemma-4-e2b
      (2B), gemma-4-e4b, qwen3-8b, qwen2.5-coder-14b, qwen3.5-9b, nemotron-3-nano-4b, phi-4-mini-reasoning,
      phi-4-reasoning-plus, **deepseek-r1** (no crash this run — replied *"According to the authoritative current date/time
      (groundtruth), today is 2026-06-26 … in the past, as it occurred earlier this year"*, quoting the block verbatim).
      The lighthouse is robust regardless of model.
> **Sweep-derived hardening candidates (record-as-found; promote to §5.O when worked):**
- [ ] **Final-answer-repeat finalization watchdog (from the qwen3.5-9b single-card sweep, 2026-06-26)** — a model that
      finishes the work (write+read) then **loops re-emitting an identical no-tool "Done!" final message** is not
      finalized promptly: the session stays `running` until the slow wall-time/no-diff guardrail eventually parks it, so
      the already-done work is never captured to a result branch (it sits stuck in the sandbox). Consider finalizing (or
      parking) a session when the agent emits N consecutive identical no-tool final messages — the work is done, stop
      waiting. Output-robustness, ties §5.O parse-and-recover. Repro: `NKLEIN_VERIFY_MODEL=qwen3.5-9b-mlx-m5max
      NKLEIN_VERIFY_DUMP_ACTIVITIES=1 tsx scripts/verify-task-completion.mts` (writes the file early, then never stops).
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
      model-robustness arc. Still owed there: extend `stripNarratedToolCallMarkup` to plain-prose `Tool call: name(args)`
      (gemma-e2b leaked exactly that into its final reply).
>
> **Open LLM-interactive tasks inherit this requirement automatically** — when §5.0.1 (autonomous agent), §5.S
> (auto-clarify), §5.V (pipeline / chat e2e), §5.H (native-core integration), §5.B (audio rubric scoring), etc. reach
> their live-verify step, that step means **all loaded models**, recorded in the matrix — not a single-model proof.

### 5.AA — Maximal model robustness: adaptive, self-learning, "try everything" *(2026-06-26, user — ACTIVE)*
> **Vision (user, 2026-06-26):** !Klein must extract the most from **any** connected model by trying *everything
> possible* to get it to deliver, then **learning per-model what works and persisting it globally** so it adapts and
> never runs in circles — even for stochastic issues. Concretely the user asked for: (1) **use LM Studio's full API
> potential** — there are multiple endpoints; iterate through them when a model fails an earlier attempt; (2) a **retry
> mechanism** that, whenever possible, **reduces the complexity / difficulty / size of the task** sent to the model;
> (3) **try different prompts** to get a model to work; (4) **detect response looping and react** (cut off + salvage
> what we got / retry / be creative); (5) **dynamic adaptation** to each model's behaviour, skills, capabilities,
> limitations; (6) **persisted global learning** of what worked well / less well → reduce failures + retries, learn
> reasonable retry rates. **Invariants unchanged:** LOCAL ONLY (every endpoint local, §1.1), ≥32k floor (§1.3), strict
> Docker isolation (§1.2). This EXTENDS the MCSR (§6.4) from capability/speed into a full behavioural profile.
> **Context is part of that profile too → see [§5.AD](#5ad)** (smart-zone arrangement, learned quality-effective
> budget, enforced reasoning loops) — the `ModelBehaviorProfile` here also records each model's quality-effective
> context budget + whether/which enforced reasoning helps.
>
> **Empirical grounding (the §5.Z cross-model sweep IS the evidence base + the regression oracle):**
> - **Task complexity is the dominant lever (phi).** Live diag: phi-4-mini given a SIMPLE 1-tool prompt emits a clean
>   STRUCTURED `tool_call`; given the 6-tool agent-loop harness it fails. So the fix is *reduce the ask* (fewer tools,
>   simpler prompt, single step), not "teach the model." (run_command/create_card ❌ for both phi models; auto-promote ✅
>   for phi-plus on the swarm path.)
> - **Response loops happen (qwen3.5-9b).** It finished the work then looped re-emitting an identical "Done!" final
>   message, never terminating → must detect + salvage/park.
> - **Tool-call formats vary** (Phi `[TOOL_REQUEST]`, DeepSeek special tokens, Hermes/Qwen `<tool_call>`, narration) and
>   **reasoning models hide the call in `reasoning_content`** → parse-and-recover across channels + endpoint iteration.
> - **The swarm path (with afterModel recovery) is more robust than the chat path was** → recovery + the levers below
>   must live at a shared seam both paths use.
>
> **LM Studio API surface to exploit (checked the dev docs):** OpenAI-compat `/v1/chat/completions` (what we use today;
> relies on the model emitting OpenAI `tool_calls`, conflates reasoning into `content`/`reasoning_content`); the
> **native `/api/v1/chat`** (stateful; emits STRUCTURED `tool_call.start/arguments/success/failure` + SEPARATE
> `reasoning.*` SSE events; MCP integrations; images) — **strictly more structured for tool-calling + reasoning models,
> so a strong fallback when the OpenAI path misses a call**; `/v1/completions` (legacy), Anthropic-compat `/v1/messages`,
> and **constrained decoding** (`response_format: json_schema` / grammar — we already use it in `generateStructured`;
> can *force* a valid tool-call shape). Plus model lifecycle (load/unload) + idle-TTL we can manage.
>
> **Architecture (the seam): a `ModelBehaviorProfile` registry (global, persisted, MCSR-adjacent) + an adaptive
> attempt loop.** Per model the profile records what worked/failed — preferred endpoint, tool-call format, **complexity
> ceiling** (how many tools / how complex a prompt it reliably handles), prompt-template family, observed failure modes
> (no-call / narrated / loop / timeout / malformed), success RATE per task-shape, and a learned **retry budget +
> backoff**. The runtime READS it to pick the best initial approach (skipping known-failing ones → no circles) and
> UPDATES it after every outcome (online learning). The attempt loop: try → on failure classify → pick the next
> strategy from a ladder informed by the profile → bounded by the learned budget → always terminate with the best
> partial result. **Build grounded-first; each increment re-verified by the §5.Z sweep across all 9 models.**
- [x] **Chat-path narrated recovery (content + `reasoning_content`, +Phi `[TOOL_REQUEST]`) — DONE (2026-06-26, §5.Z).**
- [~] **Loop detection + salvage/park (grounded: qwen3.5-9b).** **Pure core DONE (2026-06-26):**
      `detectResponseLoop` ([nklein-response-loop-detection.ts](src/nklein-agent/nklein-response-loop-detection.ts)) finds
      the smallest unit repeated `≥minRepeats` times at the tail of a model's output and returns the salvageable prefix
      (loop collapsed to one occurrence) — pure + deterministic so it guards BOTH the chat stream and the swarm session
      from one seam; 7 unit tests. **CHAT-PATH SALVAGE WIRED (2026-06-26):** `createChatModelDeps` + `createChatAgentModel`
      ([chat-local-llm-adapter.ts](src/chat/chat-local-llm-adapter.ts)) now finalize every reply through `cleanModelReply`
      = `detectResponseLoop(stripReasoning(content)).salvagedText`, so a looped chat/agent/summary reply is collapsed to its
      useful prefix before it's returned/persisted (covers streaming + non-streaming + the agent-loop text + summaries;
      no-op when there's no loop). +1 adapter test. **Still owed (wiring):** (a) cut the chat STREAM early mid-loop (needs
      stream-abort plumbing through `completeStream` — salvage-after is done, early-abort saves the wall-time); (b) the
      **swarm session runtime / `AutonomyBudgetWatchdog`** repeated-final-message finalization (when a finished session
      loops its final message → finalize/salvage instead of waiting out the wall-time guard — the exact §5.Z qwen3.5-9b
      repro; needs the session-runtime turn seam + a live re-verify). Extends the repeated-tool-call guard to
      repeated-final-message. (Folds in the §5.Z "final-answer-repeat watchdog".)
- [x] **Task-complexity ladder — tool-set reduction on retry — WIRED + LIVE-PROVEN (2026-06-26).** `selectToolsForAttempt`
      ([nklein-attempt-simplification.ts](src/nklein-agent/nklein-attempt-simplification.ts)) narrows the offered tool set
      for attempt `level` (level 1 = only the tools the instruction references — name / spaced / distinctive last word, so
      "make a card" anchors `create_card`; level 2 = the single first-referenced; no-op when nothing is anchored).
      **Wired into `createChatAgentModel`** (`b4fc2522`): when several tools were offered but the model returned no call
      AND the instruction names a tool it didn't call, it retries with the reduced set (1→2) — fires only on that
      complexity-failure signal, so a legit direct answer makes no extra calls. **LIVE-PROVEN: phi-4-mini flipped ❌→✅
      on BOTH `run_command` (34s) + `create_card` (14s)** with the real side effects (the §5.AA thesis: shrink the ask →
      the model delivers). The 7 already-passing models are unaffected (retry only on a no-call; unit-tested). 9 matcher
      tests + 2 adapter retry tests. **Still owed (next rungs, for phi-4-reasoning-plus which over-reasons even with 1
      tool):** single-step prompt + stripped-preamble rung; learn each model's complexity ceiling into the profile so a
      known-weak model starts simplified on attempt 0.
- [ ] **Endpoint-iteration adapter — native `/api/v1/chat` + Anthropic `/v1/messages` fallback.** A
      `LocalModelEndpointStrategy`: try OpenAI-compat `/v1/chat/completions` first; on a no-call/malformed outcome, retry
      via the **native `/api/v1/chat`** (parse its structured `tool_call.*` + separate `reasoning.*` SSE events — catches
      calls the OpenAI path misses for phi/deepseek) and/or the **Anthropic-compat `/v1/messages`** (which accepts
      **`tool_choice:{type:"any"}` to FORCE a tool call** — a strong rung when a model won't call on its own). Record the
      winning endpoint per model in the profile. **LM Studio docs findings (2026-06-26, checked thoroughly):** (a) for
      "default-support" models LM Studio injects a system prompt + parses a **`[TOOL_REQUEST]…[END_TOOL_REQUEST]`** default
      format — this is exactly phi's format, confirming our recovery addition; the docs warn small models "may output
      improperly formatted tool calls LM Studio cannot parse → no `tool_calls`", which IS the narrated-recovery /
      endpoint-iteration case. (b) **Stateful chat** (`/api/v1/chat` `previous_response_id` + `store`) avoids resending
      history → an efficiency + long-context lever (and conversation branching). (c) Structured output is grammar-based
      (GGUF→llama.cpp grammar sampling, MLX→Outlines) and **guarantees** schema-valid JSON, but the docs caution "not all
      models below 7B are capable of structured output" — so the constrained-decoding rung helps mid/large models most.
- [ ] **Prompt-variation retry.** Try different prompt PHRASINGS/templates (imperative vs descriptive, example-led,
      explicit-format) when a model won't act; learn which template family each model responds to. ("Try different
      prompts" — user.)
- [ ] **Constrained-decoding tool-call fallback.** When a model still won't emit a tool call, force it via
      `response_format: json_schema` / grammar (we already do constrained decoding in `generateStructured`) constrained
      to the tool-call shape — guarantees a parseable call. A last-resort rung on the ladder.
- [~] **`ModelBehaviorProfile` store (persisted, GLOBAL) + read/adapt/update.** **PURE LEARNING CORE DONE (2026-06-26):**
      [src/core/model-behavior-profile.ts](src/core/model-behavior-profile.ts) — `recordModelBehaviorOutcome(profile,
      outcome)` is the online update (EWMA success-rate + retries, per-kind failure counts, preferred tool-call format,
      complexity ceiling, and the §5.AD quality-knee bounds), with the derived signals the attempt loop reads:
      `learnedRetryBudget` (more retries for a flakier model, clamped), `learnedQualityEffectiveBudget` (§5.AD, never below
      the ≥32k floor), `preferredToolCallFormat`, `dominantFailureMode`. Pure (never mutates input) + 13 unit tests; tsc +
      biome green. **Still owed (wiring):** the thin JSON persistence layer in the runtime home (like MCSR) + read/update
      hooks from the attempt loop (choose the best first approach + skip known-failing ones, no circles) + Settings
      model-telemetry surface. Built core-first to avoid a speculative persisted schema ahead of its consumers.
- [~] **Retry policy engine — tie it together.** A bounded, learned per-model retry loop that classifies each failure
      (no-call/narrated/loop/timeout/malformed) and selects the next ladder strategy (different endpoint / fewer tools /
      simpler prompt / prompt variant / constrained decoding / salvage), capped by the learned budget, always
      terminating with the best partial result. Wire into BOTH the chat path and the swarm session runtime at the
      shared model-call seam. **DECISION CORE DONE (2026-06-27):** [src/core/retry-policy.ts](src/core/retry-policy.ts) —
      `decideNextRetryStrategy({lastOutcome, attemptsSoFar, retryBudget, triedStrategies}) → {strategy, reason}` is the
      pure "what to try next" brain: a typed `RetryStrategy` ladder + a per-failure-mode relevance table
      (`RELEVANT_STRATEGIES_BY_OUTCOME` — e.g. `no_tool_call` → reduced-tool-set → constrained-schema → alternate-endpoint
      → prompt-variant → cross-model-carry; `timeout` → context-shrink → reduced-tool-set → decompose) so a failure only
      tries rungs that plausibly help, **skips already-tried rungs (no circles)**, and **always parks** (budget spent /
      success / no untried rung) with an inspectable `reason` (feeds §5.AG + the §5.AF ledger). Pure, 8 unit tests; tsc +
      biome green. **Still owed (the WIRING):** fire the chosen strategy at the shared model-call seam (chat + swarm),
      feed `retryBudget` from the §5.AA `ModelBehaviorProfile` (now a ledger projection), and record each rung's outcome
      back to the ledger so the ladder learns.
- [x] **Extend `stripNarratedToolCallMarkup` to plain-prose `Tool call: name(args)` (DONE 2026-06-26)** — gemma-e2b
      leaked exactly that into its final reply (§5.Z). Added a deliberately-specific `PLAIN_PROSE_TOOL_CALL` pattern
      (`tool call:` immediately followed by an identifier + `(` — a function-call shape) checked independently of the
      structured-marker pre-check (its lead-in has a space, not the `tool_call` underscore), cutting from there to EOF.
      Conservative: ordinary prose that merely mentions "a tool call" (no name+paren) is untouched. +2 tests
      (strip the leak / don't strip a mention); the existing structured-marker strip + no-op cases stay green (28 total).
- [ ] **Re-verify across all 9 models after each increment** (the §5.Z sweep + matrix is the oracle): especially that
      phi-4-mini/-plus flip ❌→✅ on `create_card`/`run_command` once tool-set reduction + endpoint iteration land, with
      NO regression for the 7 models that already pass.
- [ ] **Finite-state CONTROLLER for the outer loop, not free-form ReAct (2026-06-27, small-LLM research pass).** Small
      models shouldn't own global process transitions — the harness should. **(a) An explicit run state machine**
      (`intake → plan → validate_plan → localize → execute_step → observe → evaluate → repair → retry_or_split → review →
      merge_or_escalate → done`). The controller, per state: selects the state-specific context + tool subset, sets that
      state's **max-tool-calls + max-wall-time budget**, decides **retry / split / refine-spec / replan / park / escalate
      FROM EVIDENCE** (not model self-report), **records every transition in the §5.AF ledger**, and **forbids skipping to
      repo mutation before localization/refinement** when that phase is required. ReAct stays a **bounded inner loop
      inside a single state**, never the global driver. **(b)** The retry ladder (above) becomes a **typed controller
      strategy table** — each rung a named strategy + a guard predicate — and every attempt writes a **failure capsule**
      (what was tried · the evidence · why it failed) so the next rung never re-asks a weak model to rediscover state.
      **(c)** **auto split/decompose** is a retry rung (local repair first; global re-decompose only when local repair
      can't restore coherence). Strengthens §5.AF/§5.AB, not a new track.

### 5.AB — Automatic role→model selection + a model-evaluation harness *(2026-06-26, user — ACTIVE)*
> **Vision (user, 2026-06-26):** !Klein should AUTOMATICALLY pick the best model per **role** and per **task** by
> EVALUATING each connected model against a prepared set of role-specific prompts spanning complexity / difficulty /
> size, learning a **quality × speed** fitness, then assigning each task to the best *available* model — **balancing
> parallel execution** (the hardest tasks may WAIT for a better model; easier ones can be attempted by lesser models),
> and on stubborn failure escalating through the **§5.AA ladder against potentially ALL connected models**, bounded by a
> **learned per-model retry budget** (enough retries to ride out stochastic issues) — escalating to the **user only when
> everything is exhausted**. This is the crown that unifies the MCSR (§6.4), §5.I#4 (multi-model-per-role, folded in
> here), §5.AA (the adaptive retry ladder + `ModelBehaviorProfile`), and the parallel swarm executor (§6.5). **Default
> mode = automatic best-fit**, with user pin/prefer/weight overrides. **Invariants:** LOCAL ONLY (#1 — cloud strictly
> out of scope; idea-only rung below), ≥32k floor (#3), strict Docker isolation (#2).
>
> **The fitness metric (a deliberately rich composite — "sufficient quality at the best speed"):** primary = **quality**
> (does the output clear the role/difficulty bar — a valid + coherent decompose graph / correct passing code / a review
> that catches a planted defect) **graded, not just pass/fail**; secondary = **speed** (tok/s, TTFT, wall-time); plus
> **reliability** (variance across repeats — stochastic stability) and **retry-count-needed** (from §5.AA). Policy: among
> models that CLEAR the quality bar for a task's difficulty, prefer the fastest (Pareto / weighted); reserve the
> most-capable models for the hardest tasks; let easy tasks take the fast/small model. Weights are user-tunable (a
> speed-vs-quality dial, §5.I#4).
- [ ] **Eval-prompt corpus (per role × difficulty × size).** A curated, versioned set of evaluation prompts for each
      role (architect/decompose, worker/implement, reviewer) at graded difficulty tiers (trivial → simple → moderate →
      hard → very-hard) and size/context footprints, **each with a deterministic-ish scorer** (valid structured tool
      call / valid decompose DAG that passes graph-quality / code that passes a known check / a review that catches a
      planted defect). Local, no network. The corpus is the measuring stick — invest in it; version it so re-evals compare.
- [ ] **Evaluation harness (run a model through the matrix → fitness).** For each connected model, run the corpus
      (repeated N× per cell for stochastic stability), score quality + measure speed + count retries-needed, and emit a
      per-(model, role, difficulty) **fitness record**. Reuse the §5.Z `scripts/verify-all-models.mts` sweep machinery +
      the `sweep-capture` harness; persist into the `ModelBehaviorProfile`/MCSR. Runnable on demand (Settings: "Evaluate
      connected models") and incrementally refreshed from REAL task outcomes (online learning — every real run is also a
      data point).
- [ ] **Persisted fitness table (extends MCSR §6.4 + the §5.AA `ModelBehaviorProfile`).** Global, per-model × per-role ×
      per-difficulty fitness + the learned **retry budget** + observed failure modes. The single source the scheduler reads.
- [~] **Task-difficulty estimate (ties §5.I#4).** Estimate a task's difficulty/size (objective text, expected file/
      context footprint, acceptance shape, bounce history) → the key into the fitness table. **CORE DONE (2026-06-27):**
      `estimateTaskDifficulty(input)` ([src/core/model-fitness.ts](src/core/model-fitness.ts)) → a **0..1** score (matching
      `ModelSelectionInput.difficulty`) from `promptLength` + `expectedFileCount` + `bounceCount` + `hasAcceptanceCheck`;
      conservative first-pass heuristic (the three caps sum to 1.0 so a maximally hard task reaches 1.0 — the SHAPE is
      durable, the constants are tunable; the §5.AB eval harness + learned outcomes refine the weighting). 5 tests,
      tsc+biome green. **Still owed:** populate the input from real task signals at the selection call site (prompt text,
      the decompose footprint estimate, the §5.K bounce count) and feed `selectModelForTask`.
- [~] **Automatic role→model assignment (DEFAULT mode) + parallel balancing (ties §6.5).** **Selection core DONE
      (2026-06-26):** `selectModelForTask` + `computeModelFitness` ([model-fitness.ts](src/core/model-fitness.ts)) — the
      pure quality-gated, speed-weighted pick + the wait-for-best vs attempt-with-available policy (reserving strong
      models for hard tasks falls out of the difficulty gate); 9 tests. **Still owed (wiring):** the swarm scheduler reads
      it per ready task by fitness × difficulty, keeping all loaded models busy in parallel — a hard task may **wait** for
      a better (busy) model, or be **attempted by a lesser** one (a per-task / per-project policy dial). Replaces the
      current one-model-per-role binding (→ manual override / pin). Needs the fitness table (eval harness) + the
      difficulty estimate populated first.
- [ ] **Stubborn-failure escalation — the AUTOMATIC ladder (approaches × ALL loaded models, no user) — LAYER 1**
      *(escalation order clarified 2026-06-27, user)*. On repeated failure, escalate **with NO user intervention**
      through (i) the §5.AA approaches (endpoint iteration, tool-set reduction, prompt variation, constrained-decoding
      force, loop detect+salvage), **tried AND retried**, then (ii) **across models — best-fit first, but try EVERYTHING
      possible**: every other available + loaded model, in fitness order. Each attempt is informed by the profile so
      known-bad approaches/models are SKIPPED (no circles); bounded by the learned per-model retry budgets. This entire
      layer is automatic — the user is involved **only after it is fully exhausted** (the user-escalation item below),
      never as an intermediate step. *(Be creative — add approaches beyond the ones listed as sweeps surface new failure
      modes.)*
- [~] **Learned retry budget per model.** How many retries to ride out stochastic flakiness before declaring a *real*
      failure — a learned per-model metric (part of the profile). Only when the budget is exhausted across approaches ×
      models does the task become a genuine failure. **CORE DONE (already shipped):** `learnedRetryBudget(profile)`
      ([src/core/model-behavior-profile.ts](src/core/model-behavior-profile.ts)) derives the budget from the profile's
      EWMA `avgRetries` + a reliability margin (`(1 - successRate) × maxBudget`), bounded [1, 6] — tested. **Still owed:**
      feed it into the §5.AB escalation's `retryBudgetExhausted` signal + the live retry loop (the runtime wiring).
- [~] **★ Hard-stuck detection → escalate to the user (the small-LLM limit trigger) — DETECTOR + MAPPER DONE**
      *(2026-06-27, user-guided)*. The pure trigger that decides when **Layer 1 (the automatic ladder above) is
      exhausted** and it is time to involve the **user** (Layer 2 below) — distinguishing a genuine *capability/
      complexity* limit from stochastic flakiness or a recoverable format slip, so !Klein neither gives up too early nor
      grinds a weak model into an unrecoverable hole. **Escalation-order correction (user 2026-06-27): there is NO
      automatic mid-pipeline "bigger-model consult" tier.** Trying every loaded model is part of Layer 1 (automatic, no
      user); making a *more capable* model available requires the user, so it lives in the Layer-2 user suggestions
      (next item) as only ONE option. **Detector — DONE:** `classifyAgentStuckness` + `isHardStuck`
      ([src/core/agent-stuckness.ts](src/core/agent-stuckness.ts)) — a pure verdict (`progressing` | `transient` |
      `hard_stuck`) distinguishing a real capability ceiling (`loop`/`other_failure`/`timeout` persisting across enough
      distinct approaches/models with the retry budget burned → escalate to the user) from recoverable **format slips**
      (`no_tool_call`/`narrated`/`malformed`, the AGENTS.md parse-and-recover class — never escalate on their own);
      mirrors `classifyOperatorTaskState`; 10 unit tests. **Mapper — DONE:** `buildStucknessSignalsFromLedger`
      ([src/core/agent-ledger-projections.ts](src/core/agent-ledger-projections.ts)) projects the §5.AF attempt stream
      for a task into the detector's signals — current stuck episode (trailing non-success run), distinct approaches
      (endpoint × prompt × tool-set × simplify), uncleared-loop + artifact-progress flags; 8 tests
      (`retryBudgetExhausted` caller-supplied — not in the ledger). So `ledger → signals → classifyAgentStuckness →
      isHardStuck` is the complete **pure trigger**. **Ladder-decision seam DONE (2026-06-27):** `decideEscalationAction`
      ([src/core/agent-stuckness.ts](src/core/agent-stuckness.ts)) is the pure ladder decision — `continue` while not
      hard-stuck; on hard-stuck, **`retry_other_model`** (the best untried loaded model, best-fit-first — Layer 1,
      automatic) while any remain, else **`escalate_to_user`** (Layer 2). 5 tests. **Still owed (runtime wiring):** the
      hot-path call site that (1) feeds `decideEscalationAction` the live ledger signals + tried/available models and acts
      on it (switch model automatically, or escalate), (2) on escalation builds the §5.AG report + the Layer-2
      suggestions, (3) records the escalation as a ledger event. Ties §5.AA (approaches) · §5.AF (attempt stream +
      escalation event) · §5.AG (report + suggestions) · §5.AK (symmetry).
- [~] **User escalation (LAST resort) — the "get through the wall" SUGGESTIONS surface — LAYER 2** *(user 2026-06-27)*.
      Only after Layer 1 (all approaches × all loaded models × learned retries — fully automatic) is exhausted does
      !Klein involve the user, and never as a silent dead end. It surfaces the §5.AG "what was tried" report (models ·
      approaches · scores · outcomes) **plus a set of ACTIONABLE SUGGESTIONS to get through the wall** — because **often
      a simple user decision is enough**, and *making a bigger model available is only ONE of them*. **Suggestions core
      DONE (2026-06-27):** pure `buildEscalationSuggestions(context)`
      ([src/core/escalation-suggestions.ts](src/core/escalation-suggestions.ts)) returns the ordered set (simple
      decisions first; context promotes the most-likely fix to the front — and the §5.AG→§5.AB context bridge
      `buildEscalationSuggestionContext(operatorSignals)` (same module) derives that promotion from the real operator
      signals: a pending clarifying question → clarify first, an awaiting host-action ack → approve first, a
      sandbox-unavailable block → fix-environment first): clarify an ambiguity / pick a direction ·
      provide missing context (files, examples, credentials) · adjust or relax a constraint / guardrail / acceptance bar ·
      approve a blocked host/unsafe action · fix an environment / setup / dependency issue · re-scope or split the task ·
      and last, **make a more capable model available** — optionally letting *that* bigger model **analyze the captured
      situation and return detailed rectification guidance** (the user's "let a bigger model analyze + guide" idea, now a
      user-chosen option — local-first; cloud only behind the `[-]` lockdown lift below). **CLI surface DONE
      (2026-06-27):** `nklein dev escalation --task-id <id>` ([src/commands/dev.ts](src/commands/dev.ts)) now composes the
      whole chain over the real ledger — the attempt chain + the **progress verdict** (`classifyAgentStuckness`) and,
      when `isHardStuck`, the ordered **suggestions** (`buildEscalationSuggestions`); also in `--json`. (8 suggestion
      tests: ordered set + context promotion + bigger-model-always-present-and-last.) **Bigger-model analysis-request
      builder DONE (2026-06-27):** `buildStuckTaskAnalysisRequest(report)`
      ([src/core/stuck-task-analysis.ts](src/core/stuck-task-analysis.ts)) turns the "what was tried" report into a
      compact, structured prompt asking a stronger analyst model for a **root-cause read + remediation plan** (steps to
      try · what to avoid · how to verify) — explicitly **NOT a patch**, chain capped at 16 for the ≥32k floor; surfaced
      by `nklein dev escalation --task-id <id> --analyze` (5 tests). This is the user's "let a bigger model analyze +
      guide" path, as the user-chosen option. **Web seam DONE (2026-06-27):** `buildStucknessSignalsFromReport(report)`
      (in [src/core/agent-stuckness.ts](src/core/agent-stuckness.ts) — web-clean: type-only report import, no node deps)
      derives the verdict signals from the §5.AG `TaskEscalationReport` the web panel already fetches, so the panel shows
      the verdict + suggestions client-side with **no contract change** (artifacts/retry-budget aren't in the report, so
      those signals default conservatively; the ledger-based mapper stays authoritative). 4 tests. **WEB PANEL DONE
      (2026-06-27):** the card-detail `<TaskEscalationPanel>` now renders the **progress verdict** (color-coded) and, when
      `hard_stuck`, the **Layer-2 suggestions** under the attempt chain (via the `@runtime-agent-stuckness` +
      `@runtime-escalation-suggestions` aliases). Verified: root+web tsc, web vitest (incl. a new hard-stuck panel test),
      web:build (the new modules bundle clean — web-clean confirmed). **Still owed (wiring):** the runtime hook that
      resumes the agent with the user's chosen input (incl. running the analysis request on the user-provided stronger
      model and feeding its guidance back) — and the upstream hot-path that *drives* the ladder (`decideEscalationAction`).
- [ ] **Settings UI.** Show the fitness table + the current automatic role assignments; let the user pin / prefer /
      weight per role (the speed-vs-quality dial) and set the wait-vs-attempt policy; a "Re-evaluate connected models"
      action. (Builds on the MCSR telemetry panel §6.4.)
- [-] **LATER / OUT OF SCOPE — cloud fallback rung (idea-collection only, per the user).** When !Klein has matured to
      where the real limitation is genuinely model quality, AND the user has connected cloud models AND explicitly opted
      in to escalate to them, the FINAL rung (after all local models × approaches fail) could try a connected cloud model.
      **Strictly out of scope now** (invariant #1 LOCAL ONLY — cloud cannot render/select/run today); collected here so
      the escalation design already has the seam. Gated behind an explicit per-escalation user allow **and** the
      deliberate cloud-lockdown lift (a reviewed code change, never a feature toggle). Related idea to collect: a
      per-task "max local spend/time before offering cloud escalation" budget the user sets.
- [ ] **Confidence- and RESOURCE-aware routing (2026-06-27, small-LLM research pass).** Refine the §5.AB fitness with:
      **(a) Calibrated confidence computed from EVIDENCE, never model self-report** — from tool-call validity,
      tests/acceptance evidence, no-diff/loop signals, semantic/sample disagreement (self-consistency, §5.AD), and the
      §5.K reviewer verdict, calibrated historically by **model × role × task-shape × tool-set-size × endpoint ×
      prompt-family**. **(b) Local resource cost is the real cost** — fold wall+queue time, RAM/VRAM pressure,
      model-load time, endpoint occupancy, and a thermal/energy proxy into the fitness, and **schedule GLOBALLY across
      ALL queued cards** so hard cards reserve strong models while easy cards drain through fast small models (the §5.AF
      unified admission controller is the seam). **(c) BFCL-style per-model tool probes** feed the fitness table (built
      in §5.V below). At runtime use cross-model debate/review (§5.AD) **selectively** for low-confidence/high-risk
      outputs, preferring a **different model family** for the reviewer/carry (reduces correlated errors); keep the §5.Z
      full matrix for release confidence. **Per routing decision, ledger (§5.AF):** predicted route · actual outcome ·
      verifier outcome · uncertainty score · selected rung · queue/resource state · accept/reject reason.

### 5.AC — Online knowledge retrieval + intrinsic temporal awareness (the "knows today" lighthouse) *(2026-06-26, user — ACTIVE)*
> **Vision (user, 2026-06-26):** two intertwined grounding features that make !Klein trustworthy where ChatGPT/other
> agents repeatedly fail. **(A) Automatic ONLINE knowledge retrieval** — today the knowledge-retrieval skills check only
> LOCAL knowledge (repo map / code index / embeddings); !Klein should ALSO automatically search + fetch from ONLINE
> sources (docs, new versions, release notes, research papers, user experiences, insights) as a first-class agent skill.
> **(B) Intrinsic TEMPORAL awareness — the lighthouse** — !Klein KNOWS the real current date/time (today / now / tomorrow)
> and injects it authoritatively into EVERY agent context, so a model never hallucinates that "today is in the future" or
> that a dated event "hasn't happened yet" (the classic training-cutoff confusion — e.g. believing Apple WWDC 2026 is
> years away). Being grounded in real *now* lets !Klein judge whether retrieved online info is up-to-date or whether it's
> worth searching FURTHER for newer versions/insights/papers. A genuine "leuchtturm" differentiator. Be creative.
> **Invariants (hard line):** **LOCAL LLM only (#1)** — online retrieval fetches web DATA; it must NEVER reach a cloud
> *model*. **Strict isolation (#2)** — the agent's online fetches go through a **network-enabled sandbox tier** (§5.L:
> bridge network + allowlist, fail-closed), never the host. **≥32k floor (#3).** The real clock is trusted host-side
> control-plane, injected into the agent context (the sandbox never provides "now").
>
> **Grounding finding (2026-06-26):** !Klein does NOT currently inject the current date into the agent/chat system prompt
> — the SDK `<env>` block carries only "Working Directory"; every `new Date()` is a log/artifact timestamp. So a local
> model reasons from its (past) training-cutoff prior with no authoritative "now" — exactly the user's failure mode. The
> temporal-awareness core is genuinely missing; build it first.
- [x] **Temporal-awareness context core (the lighthouse) — DONE.** `resolveTemporalAwareness(now)` +
      `buildTemporalAwarenessPrompt(now)` ([temporal-awareness.ts](src/core/temporal-awareness.ts)): an authoritative
      block — ISO + human date/time + weekday + relative anchors (today / tomorrow / yesterday / this year) + an explicit
      rail: "this is the authoritative current date/time; your training data has a cutoff in the PAST; do NOT assume
      events dated on/before this are still in the future or haven't happened; judge online info's freshness against this
      now." Pure + clock-injected → unit-tested.
- [~] **Inject the temporal block into EVERY agent + chat turn — WIRED across all four surfaces (2026-06-26).** The
      `<current_datetime>` block now leads every model context: (1) **board/swarm + decompose + review agents** — appended
      to the SDK system prompt at BOTH `InMemoryNKleinTaskSessionService` start sites (main start + restart-rebuild), right
      after the `<env>` seam, so every sandboxed task / planning-decompose / `::review` session gets the real now (the
      trusted host clock — the sandbox never provides "now", per invariant #2); (2) **chat agent turn** — `renderChatTurnPrompt`
      gained an injected `now` clock and prepends the block as the FIRST system note (before goal/summary/memory), threaded
      through `runChatTurn` + `runChatAgentTurn` (each via an injectable `deps.now`, default `new Date()`), so the chat +
      autonomous-chat loops re-anchor it **every turn**. Unit-tested (block-leads + back-compat) + the existing chat-runtime
      / session-service / chat-agent-turn suites stay green. **LIVE-PROVEN cross-model (2026-06-26,
      [scripts/verify-temporal-awareness-live.mts](scripts/verify-temporal-awareness-live.mts)):** a real chat turn with the
      host clock injected asks a model whether a current-year past month is past or future — the grounded answer needs the
      injected "now", and a model on its ~2024 training prior would call it "the future". **ALL 9 loaded models PASS**
      (gemma-4-e2b 2B / gemma-4-e4b / qwen3-8b / qwen2.5-coder-14b / qwen3.5-9b / nemotron-3-nano-4b / phi-4-mini-reasoning
      / phi-4-reasoning-plus / deepseek-r1), each replying e.g. *"The current year is 2026, and March 1st, 2026, is in the
      past relative to today's date of June 26th, 2026"* — the training prior is overridden (full matrix in §5.Z). **Still
      owed:** a board-agent **mid-session re-anchor** (the system prompt is static per session; a `beforeModel` hook like
      the §5.N focus-chain re-anchor would refresh "now" on a multi-day run — chat already re-anchors per turn, so this is a
      board-only long-run nicety).
- [x] **Freshness-judgment helper (DONE 2026-06-27).** [src/core/retrieval-freshness.ts](src/core/retrieval-freshness.ts):
      `judgeRetrievedFreshness({publishedAt}, now, {thresholds?})` bands a dated source by whole-day age vs the
      authoritative now → `current`/`recent`/`possibly_stale`/`stale`/`unknown` + an agent-facing `guidance` rail (rely on
      it, or prefer a newer source + search further) + `shouldSearchForFresher(verdict)` to drive the retrieval loop.
      Pure + clock-injected (deterministic), tolerant of string/number/Date/absent dates, future-dated clamps to current.
      7 unit tests; tsc+biome green. **Date-based only** — VERSION freshness ("is v3.1 the latest?") needs an external
      "known latest" the retrieval loop supplies, deferred to that. Feeds the §5.AC retrieval loop + the researcher role.
- [ ] **`web_search` tool (first-class, egress-gated).** A search tool (query → ranked results: title / url / snippet /
      published-date) governed by the §5.L network tier (network-enabled sandbox ONLY; allowlist; fail-closed; NEVER a
      cloud LLM). Backend = a USER-CONFIGURED local/permitted search endpoint (self-hosted SearxNG / a permitted search
      API / DuckDuckGo-HTML) — the search PROVIDER is user-configured + egress-gated, not hardcoded cloud. Pairs with the
      existing `browse_url` (§5.M G6) to fetch a chosen result.
- [ ] **Retrieval loop (query → search → fetch → extract → synthesize → CITE).** An agent skill: formulate queries from
      the task + `knowledgeDebt` (§5.B), search, fetch the top hits via `browse_url`, extract + synthesize, and cite
      sources WITH their dates (freshness-judged). Record into the knowledge/tool-usage telemetry (§6.7, §5.B signal).
- [ ] **Make the knowledge-retrieval TESTS cover ONLINE too (the user's observation).** The existing knowledge tests
      check only local retrieval; add a deterministic test (mocked search/fetch) + a live `verify-*.mts` harness that
      exercises the online path end-to-end (search → fetch → synthesize → cite a fresh source).
- [ ] **Wire temporal + freshness into the researcher/architect roles.** The decompose/research pass uses "now" +
      freshness to decide its knowledge is stale → trigger online retrieval (ties §5.B knowledge-acquisition mandate +
      §5.L researcher tier). Surfaces inspectable "is this current?" reasoning.
- *(cross-links)* §5.L (web/egress tiers + browser tool), §5.M G6 (`browse_url`), §5.B (knowledge-expansion loop +
      `knowledgeDebt` + the decomposition knowledge signal), §6.7 (codebase-intelligence / knowledge telemetry), §5.AA/§5.AB
      (a temporally-grounded model that can retrieve fresh knowledge is more capable — feeds the fitness picture).
- [ ] **First-class `RetrievedEvidence` objects + citation verification (2026-06-27, small-LLM research pass).**
      Give retrieval a concrete data model — `{ url/
      fileRef, title, sourceType, author/publisher?, published/updatedDate, fetchedAt, package/version?, contentHash,
      trustTier, freshnessVerdict, extractionSpans, citationIds, promptInjectionRiskFlags }` — and an **adaptive loop**
      (`knowledgeDebt/task → query plan → local-repo vs online → retrieve → relevance/sufficiency/freshness judgment →
      cite or search again`). **Citation verification:** every material claim maps to evidence spans; unsupported claims
      lower confidence or force another retrieval; freshness conflicts prefer newer release notes (keep older as
      historical). Record retrieval attempts / pruned distractors / citations / helped-or-hurt into the §5.AF ledger.
      Provenance/taint flags tie to §5.L (prompt-injection: web/MCP content is untrusted).

### 5.AD — Context as a capability lever: "smart-zone" arrangement, learned quality-effective budget, enforced reasoning loops *(2026-06-26, user — ACTIVE)*
> **Vision (user, 2026-06-26):** **context SIZE is part of a model's capability + reasoning quality, in BOTH
> directions** — too small a budget hurts hard, but **over-filling a large window also degrades output**. Not all
> positions in the context are used equally (the **"smart zone"** idea), and even the *earliest* tokens aren't the
> smartest because the model hasn't read the background yet — some models compensate by reasoning. So !Klein should
> **arrange context content as well as possible** for where each model actually attends, **learn each model's
> quality-effective budget by trying + observing**, and — for models that can't reason well alone — **ENFORCE reasoning
> loops** (bounce a model against itself with varied system prompts, OR bounce reasoning between *different* models with
> varied prompts). All of this feeds the **"!Klein learns to use each model to its best"** crown (§5.AA `ModelBehaviorProfile`
> + §5.AB fitness). **Invariants:** LOCAL ONLY (#1), **≥32k FLOOR is a minimum-capability GATE, never a fill target** (#3),
> strict Docker isolation (#2).
>
> **Grounded in research (full notes + citations: [.plan/docs/context-smart-zone-and-reasoning-research.md](.plan/docs/context-smart-zone-and-reasoning-research.md)):**
> - **"Lost in the middle" → a U-shaped attention curve** (Liu et al. 2023): models use the **start + end** of context
>   best, the **middle worst**, partly **architectural** (present at init in causal decoders — "Lost in the Middle at
>   Birth" 2026). The user's "early ≠ smartest" point is the *causal* complement: early tokens can't attend to
>   later-arriving background, so the model only has the full picture **near the end** → reasoning (tokens appended at
>   the strong end-zone) is how a model "brings background forward."
> - **Over-filling hurts even below the limit** ("context rot", Chroma 2025, 18 frontier models; "Context Length Alone
>   Hurts" EMNLP-2025): attention dilution + distractor interference degrade output as input grows.
> - **Effective ≪ advertised** (RULER, NoLiMa): effective length is routinely **½–¼ of advertised**; many 32K models
>   are really good to ~4–16K. ⇒ target a **learned quality-effective budget**, not the max; NIAH over-states it.
> - **Arrangement that helps** (Anthropic context-engineering): **long background FIRST, the task/instruction LAST**
>   (after the background, in the strong end-zone), delimit with tags, keep it "informative yet tight," prune distractors.
> - **Enforced reasoning:** multi-agent **debate / cross-model bounce** robustly lifts weak models (a stronger agent can
>   carry a weaker one in ~1 round), but **intrinsic self-correction often does NOT help and can hurt** (Huang et al.
>   2023) → prefer **external** signal (a different model / persona / a test result), gate on difficulty, bound the
>   rounds (reuse §5.K round-limit + stall/identical-loop detection; §5.S no-progress detector).
- [x] **Research + durable notes (DONE 2026-06-26)** — web-researched lost-in-the-middle / U-shape / context-rot /
      RULER+NoLiMa effective-context / Anthropic arrangement / debate-vs-self-correction; synthesized into
      [.plan/docs/context-smart-zone-and-reasoning-research.md](.plan/docs/context-smart-zone-and-reasoning-research.md)
      with a placement policy + a per-model-learnable field list + citations. (This section is its actionable backlog.)
- [~] **Smart-zone context-arrangement policy.** **PURE CORE DONE (2026-06-26):**
      [src/core/context-smart-zone.ts](src/core/context-smart-zone.ts) — `arrangeContextForSmartZone(parts, options?)`
      orders parts per the U-shape + causal findings: durable framing (role/invariants/tool contract) **FRONT** (highest
      priority nearest the very front); bulk/weak reference (repo map, long files, older history) **MIDDLE**, **edge-loaded**
      so the most-relevant items sit at the band edges and the lowest-priority/distractor material lands in the dead center
      (the genuinely-critical fact never gets buried mid-context); the **concrete task / acceptance / current step LAST**
      (strong end-zone, highest-priority task content at the very end). `renderSmartZoneContext` joins + optionally
      tag-delimits sections (Anthropic guidance). Pure (never mutates input, drops blanks) — it only **reorders + tags**,
      never adds, so it can't violate the never-overflow guard (§6.2). 9 unit tests; tsc + biome green. **Still owed
      (wiring):** thread per-model knobs from the §5.AA `ModelBehaviorProfile` (budget / end-anchor / edge-load defaults),
      and wire into the board-agent prompt assembly (`buildNKleinStartPromptParts` / §6.3 budget breakdown) +
      `renderChatTurnPrompt` (§5.M) to **end-anchor the task** (today only the new user message is last; extend to the
      board card's task/acceptance block) + aggressive distractor pruning — each behind a live §5.Z re-verify (no regression).
- [ ] **End-of-context task re-anchor on long runs.** Generalize the §5.N focus-chain / §5.AC date re-anchor: after big
      tool outputs, restate the goal + current step near the tail (the strong zone) so a small model doesn't lose the
      task to mid-context dilution. Reuse the `beforeModel` re-anchor seam.
- [ ] **Learned per-model "quality-effective" context budget (extends §6.4 MCSR + §5.AA `ModelBehaviorProfile`).** Track
      the budget past which *output quality* (not just overflow) degrades for each model — learned from real task
      outcomes (success/bounce vs. used-token-count) + optional eval-sweep probes (§5.AB harness, RULER/NoLiMa-style, NOT
      NIAH-only). Distinct from the advertised/observed/override window (§6.3) and the overflow/compaction threshold:
      it's the *quality knee*. The runtime targets THIS budget (compact/summarize down to it) instead of filling the
      window. Surface in the model-telemetry panel. **Respects #3:** the ≥32k floor is the minimum a model may be used
      at; the learned budget is an operating target *at or below* the effective window, never below the floor.
- [ ] **Distractor-aware retrieval pruning (per-model sensitivity).** Rank + prune repo-map / code-index / online
      results harder for models with high learned distractor sensitivity (similar-but-irrelevant context measurably
      hurts). Ties §6.7 retrieval + §5.AC online retrieval; feeds the arrangement policy's MIDDLE band.
- [ ] **Enforced reasoning loops (difficulty-gated, external-signal-first).** A bounded reason→critique→revise loop for
      models that reason poorly alone: (a) **cross-model bounce** — a stronger loaded model critiques/repairs a weaker
      model's draft (the robust technique — one round can carry the weak model); (b) **self-bounce with VARIED system
      prompts/personas** (varied prompt = real diversity, not "are you sure?" — the latter is the failure mode Huang
      2023 warns about); (c) **self-consistency** — sample N paths, majority-vote (cheap, ties the §5.AB reliability
      metric). Gate on difficulty + observed failure ("debate only when necessary"), bound rounds + detect stalls/loops
      (reuse §5.K reviewer round-limit + identical-loop detection; §5.S no-progress detector; the §5.AA loop-detector
      core). Compose the existing seams (§5.K reviewer, §5.S auto-clarify ping-pong, §5.AA prompt-variation, §5.AB
      multi-model scheduler) into one explicit, difficulty-gated, cross-model loop — don't build a parallel mechanism.
- [ ] **Learn "needs enforced reasoning?" + which kind (per model).** Record in the `ModelBehaviorProfile` (§5.AA):
      native-reasoning quality, whether enforced reasoning pays off for this model, which kind wins (self-consistency vs.
      cross-model debate vs. stronger-model carry), and a learned rounds budget — so §5.AB applies it only where it
      helps (a robust model on an easy card skips it; a weak reasoner on a hard card gets a cross-model carry).
- [ ] **Re-verify across the §5.Z roster + matrix.** After each increment, sweep all loaded models: arrangement +
      learned budget + enforced reasoning should LIFT the weak/small models (esp. phi-4-mini/-plus on the harder flows)
      with NO regression for the models that already pass — the §5.Z matrix is the oracle.
- *(cross-links)* §6.3 (context-budget breakdown — where arrangement plugs in) · §6.4 MCSR (effective-window tracking —
      extended with the quality knee) · §6.2 (never-overflow guard — arrangement reorders/trims, never adds) · §5.AA
      (`ModelBehaviorProfile` learning + loop-detector) · §5.AB (fitness/selection consumes the learned budget +
      reasoning-need) · §5.K (reviewer loop infra) · §5.S (no-progress detector) · §5.B/§5.AC (retrieval feeds the
      arrangement bands).

### 5.AE — Dynamic prompts: composable skill sets, JIT context, role-mode "dynamics levels" *(2026-06-26, user — ACTIVE)*
> **Vision (user, 2026-06-26, reacting to the §5.AC date being injected into EVERY prompt — token waste where it doesn't
> help):** !Klein's prompts must be **highly DYNAMIC**, adapting to the **task, context, agent role, and history** — only
> include what helps *this* agent on *this* turn. The date is irrelevant to a coding task but crucial to a **retriever**
> role (which we lack → **extend the role catalog**). Go further: **decompose roles into SKILL SETS**, and **dynamically
> assign an agent the skills + information it needs to excel**, varying by many factors — even **message-to-message** for
> the same agent. Varying the skill set is also a lever to **push through stubbornly failing tasks** (ties §5.AA/§5.AB).
> Expose **role-mode "dynamics levels"** so the user chooses how dynamic vs. strict the assignment is. Keep the control
> surface **BASIC for now**, grow later. **Invariants:** LOCAL ONLY (#1 — the "architect → cloud model" use-case is
> idea-only until cloud is revisited), ≥32k floor (#3), strict Docker isolation (#2).
>
> **Grounded in research (full notes + citations: [.plan/docs/dynamic-roles-skills-research.md](.plan/docs/dynamic-roles-skills-research.md)):**
> Skills are an emerging first-class, composable unit (a behavioral spec + applicable-scenario relevance + needed
> context/tools + output template — "Agent Skills for LLMs" survey 2602.12430; Claude Code exposes skills). **Skill
> routing** picks the right skills per task at runtime (SkillRouter 2603.22455); **dynamic skill-context construction**
> assembles only the context the active skills need (SkillsInjector 2605.29794) — exactly the JIT-prompt fix for the date
> waste. Skill-routing co-travels with **model routing** (§5.AB). **Autonomy is a spectrum** (taxonomy 2310.03659) → the
> dynamics levels; adaptive-vs-static routing measurably wins (+29% coverage / −74% revisions). Caveat ("skills are a
> transitional layer") → **start small + hand-authored, don't over-architect**.
>
> **Architecture (the seam):** a small `Skill` registry (`id` · `relevance(task/role/context/history)` ·
> **`contextFragments`** it needs · **`tools`** it needs · `preamble`). A **dynamic skill resolver** picks the active
> skill set per task/message from task shape + role + history + the §5.AA `ModelBehaviorProfile` + prior failures (vary to
> break stuck tasks) + the dynamics level. The active skills' **context fragments are assembled JUST-IN-TIME** (minimal,
> relevant) → this is the *producer* of the parts that **§5.AD's smart-zone arrangement orders** and **§6.2 caps**: §5.AE
> = *what's in* the prompt, §5.AD = *where it goes*, §6.2 = *never overflow*. Roles become default skill bundles; model
> selection (§5.AB) is coupled via the dynamics level.
- [x] **Research + durable notes (DONE 2026-06-26)** — web-researched agent skills / skill routing / dynamic skill-context
      construction / capability decomposition / autonomy-level taxonomy; synthesized into
      [.plan/docs/dynamic-roles-skills-research.md](.plan/docs/dynamic-roles-skills-research.md) with the skill-unit design,
      the dynamics-level mapping table, and the JIT-composition plan. (This section is its actionable backlog.)
- [x] **First concrete step — relevance-gate the temporal/date fragment (the JIT-composition seed) — DONE (2026-06-26).**
      The §5.AC date is no longer blanket-injected: `isTemporalContextRelevant({text, role})`
      ([temporal-awareness.ts](src/core/temporal-awareness.ts)) — a curated temporal/freshness marker set
      (today/now/latest/recent/version/release/deprecated/this-year/a 20xx year/… ; bare "current"/"now" excluded as too
      common in coding prose) OR a temporally-relevant role (retriever/researcher) — gates the injection at BOTH board
      start sites (on the card prompt) and the chat path (`runChatTurn` + `runChatAgentTurn`, on the user message; the pure
      `renderChatTurnPrompt` stays mechanical — injects iff a clock is passed). A plain coding task no longer pays the ~120
      tokens. Lean-inclusive by design. 8 predicate tests + a chat "skips the date for a non-temporal turn" test; **the
      §5.Z 9/9 live grounding proof still PASSES** (its prompt has "today"+"2026" → still injects). tsc + biome + 2031 fast
      tests green.
- [ ] **`Skill` registry + the context-fragment catalog.** A small hand-authored set: each existing prompt block becomes a
      named fragment (`temporal`, `repo_map`/orientation, `focus_chain`, `refinement_preamble`, `efficiency_rules`,
      `freshness_rail`, `online_retrieval`), and each skill declares the fragments + tools it needs + its relevance. Pure +
      tested; the fragments feed §5.AD arrangement + §6.3 budget.
- [ ] **Dynamic skill resolver.** `resolveActiveSkills({role, taskText, history, modelProfile, priorFailures, dynamicsLevel})`
      → the active skill set (and thus the fragments + tools) for this turn. Honors the dynamics level (below); on the
      fully-dynamic default it may vary message-to-message; on stubborn failure it **varies the skill set** as a §5.AA/§5.AB
      escalation rung. Pure + tested.
- [ ] **Extend the role catalog with `retriever`/`researcher`.** The §5.AC online-knowledge role the user flagged as
      missing — a default skill bundle that includes the `temporal` + `freshness_rail` + `online_retrieval` fragments + the
      `web_search`/`browse_url` tools (§5.AC/§5.M G6). Thread through the role enum (§5.M) + the resolver.
- [ ] **Dynamics-level setting (BASIC control set — DEFAULT = fully dynamic).** A role-mode enum:
      `fully_dynamic` (DEFAULT — skills auto + may vary per turn, model auto via §5.AB) · `static_skills_auto_model`
      (fixed per-role skills, model auto) · `assigned_skills` (user-assigned skills) · `fully_static` (skills + model
      pinned). Plus an **orthogonal per-role model-class cap** (small-only / any-local / +cloud-when-revisited — the
      user's "only architect may use the big/cloud models" compute-control use-case; cloud stays #1-locked, idea-only).
      Global + per-project (ties §5.W overrides). Keep it minimal now; grow the control surface as needed.
- [ ] **Wire the composed fragments into the board + chat prompt assembly** (replacing today's hard-coded always-on blocks)
      → §5.AD arrangement orders them, §6.2 caps them. Each behind a live §5.Z re-verify (no regression; weak models should
      get *leaner, more relevant* prompts).
- [ ] **Skill-variation as a stuck-task escalation rung (ties §5.AA/§5.AB).** When a task stubbornly fails, the resolver
      tries a different skill set / preamble / fragment mix (e.g. add a `reasoning` or `retriever` skill) as one rung of the
      §5.AA ladder, learned into the §5.AA profile (which skill mixes work for which model/task).
- *(cross-links)* §5.AD (arranges the fragments §5.AE produces) · §5.AB (model routing — coupled via the dynamics level) ·
      §5.AA (`ModelBehaviorProfile` — the shared learning substrate; skill-variation rung) · §5.AC (temporal + retriever
      role + online retrieval fragments) · §5.M (the role catalog this extends) · §5.L (a skill's tools still pass the
      capability-ruleset gate) · §6.3 (the fragments feed the context-budget breakdown) · §5.W (the dynamics-level + model-
      class settings + their per-project overrides).
- [ ] **Skills as VALIDATED PROCEDURAL MEMORY — a `ProceduralSkillBank`, not just prompt fragments (2026-06-27,
      small-LLM research pass).** Distil skills from
      the §5.AF ledger's successful + failed-then-repaired attempts: `{ id, version, status: candidate|quarantined|active|
      deprecated, sourceAttemptIds, producerModel, validatedConsumerModels, roleScope, taskFingerprint, applicability,
      activation/terminationConditions, representation: lesson|workflow|script|patch_template|program_function,
      requiredTools, capabilityManifest, validationSuite, effectiveness + false-activation stats }`. Pipeline: `ledger
      attempts → offline distillation → candidate → quarantine/eval → scoped activation → measure delta → promote/
      deprecate`. **Rules: NEVER auto-activate a generated skill** (promote only after deterministic replay/dev-test/
      protected-test validation + positive delta vs no-skill baseline); track **negative transfer** aggressively; prefer
      executable helpers over text playbooks (weak models ignore prose); store **cross-model transfer** (a strong model's
      procedure can lift a weaker one). This is the higher-leverage form of the skill-variation rung above + ties §5.AF M4 quarantine.

### 5.AF — Shared substrate: the Agent Attempt Ledger + durable scheduler + replay + tool-capability manifest *(2026-06-26, from the spec audit — the keystone; build BEFORE widening §5.AA–§5.AE)*
> **The consolidation the audit identified.** Every new ambition (§5.AA model-behavior learning, §5.AB fitness/selection,
> §5.AC retrieval, §5.AD context-quality, §5.Z cross-model matrix, retry budgets, loop salvage, deterministic
> debugging) consumes/produces the SAME thing — a **workflow event log + per-attempt outcome stream** — but today those
> outcomes evaporate into per-domain stores that share no grain/key. Build ONE durable evidence stream and make the rest
> projections of it. **2026-06-27 research refinement:** model attempts are only one event family; the ledger also needs
> scheduler/resource events, leases, idempotency keys, replayable tool-result refs, and controller transitions so !Klein
> can resume/replay long jobs without asking a small model to rediscover state.
> Full schema + the system component map + the milestone ladder live in
> **[.plan/docs/substrate-and-milestones.md](.plan/docs/substrate-and-milestones.md)**. **Invariants:** LOCAL ONLY (#1),
> strict isolation (#2), ≥32k floor (#3) — the ledger is host-side control-plane (it records agent attempts; it never
> runs on the agent's behalf). **My adaptation of the audit:** consolidate, don't proliferate — fold its "flight
> recorder / driving school / workload compiler / policy DSL / context profiler / freshness cache" framings into the
> sections they already belong to (noted inline), not new sections.
- [~] **★ Agent Attempt Ledger (pure core + persisted store) — PURE CORE + STORE DONE (2026-06-27).**
      [src/core/agent-attempt-ledger.ts](src/core/agent-attempt-ledger.ts): a **discriminated-union event stream** (a
      workflow event log, NOT just an attempt table — the small-LLM-research reframing) over a shared envelope
      (`schemaVersion`/`eventId`/`recordedAt`/`workflowId`/`taskId`/`workspacePathHash`/`role`) with three extensible
      event kinds — **`attempt`** (the rich per-model-invocation record: `attemptId`/`parentAttemptId`, canonical
      `modelId`+`endpoint`+`endpointStrategy`, `promptStrategy`+`toolSetOffered`+`simplificationLevel`,
      `contextTokens`+`contextBudgetTarget`, `difficulty`, started/completed+`ttftMs`+`tokensPerSec`,
      `toolCalls[{name,fingerprint,outcome}]`, `outcome` [the §5.AA `ModelOutcomeKind`], `qualityScore`/`qualityOk`,
      `retriesBefore`, `salvage`, `artifacts{resultBranch,patchRef,evidenceBundle}`); **`transition`** (controller
      finite-state moves: `from`/`to`/`reason`/`controllerDecision` — the §5.AA finite-state controller); **`scheduler`**
      (lease/lifecycle/admission events: `queued`/`dequeued`/`lease_acquired`/`heartbeat`/`lease_expired`/`reclaimed`/
      `retry_backoff`/`cancelled`/`dependency_unblocked` + `leaseId`/`workerId`/`idempotencyKey`). Pure builders fill
      defaults; **projections** (the keystone value — the §5.Z matrix + §5.AA profile + §5.AB fitness become QUERIES over
      this, not parallel stores): `selectAttempts` / `selectAttemptsForModel` / `selectEventsForWorkflow` /
      `latestRunState` (resume "exactly where it was" without re-asking a weak model) / `summarizeModelOutcomes`.
      [src/state/agent-attempt-ledger-store.ts](src/state/agent-attempt-ledger-store.ts): a thin append-only per-workspace
      JSONL wrapper (keyed by `workspacePathHash`, never the path — #2; best-effort; validated via `parseValidatedJsonl`
      so a schema-invalid line is skipped+diagnosed, never trusted). Host-side control-plane, append-only, local-only.
      14 unit tests; tsc+biome green. **FIRST LIVE WRITER wired (2026-06-27):** the terminal-run chokepoint
      (`captureTerminalRunSummary` in [nklein-task-session-service.ts](src/nklein-agent/nklein-task-session-service.ts),
      where `recordTaskRunSummary` fires) now ALSO appends one `attempt` event per terminal task run, via the pure mapper
      [nklein-ledger-attempt.ts](src/nklein-agent/nklein-ledger-attempt.ts) (`buildTerminalAttemptEvent` — terminal state →
      §5.AA outcome [awaiting_review=success · timed-out=timeout · else other_failure], canonical
      `provider:model:endpoint` id, computed tok/s, host-path-free workspace hash) + the best-effort
      `appendAgentLedgerEvent` (try/catch — the ledger is observational + must never break the session loop). 8 mapper
      tests; session-service suite (110) still green. **So the ledger is now LIVE** — `summarizeModelOutcomes` over it is
      a real per-model success-rate/outcome projection (the §5.Z matrix seed). **READ SURFACE (2026-06-27):** `nklein dev
      ledger` (+ `--json`) prints the per-model outcome rollup + success rates from real runs (`readAllAgentLedger` reads
      every workspace's log; `summarizeLedgerForDisplay` in [agent-ledger-projections.ts](src/core/agent-ledger-projections.ts)
      composes the outcome + profile projections) — proven end-to-end (it showed the attempts the session-service tests
      wrote). **TEST-ISOLATION GAP FIXED (2026-06-27):** the session-service tests fired `captureTerminalRunSummary`, so
      `recordTaskRunSummary` AND `appendAgentLedgerEvent` wrote to the **real `~/.nklein`** (no injected temp root). The
      service now takes an optional **`diagnosticStoreRoot`** option (both stores already accepted a `rootDir`; defaults
      to the real home in production), threaded to both write sites; the suite routes every construction through one
      `createDiagnosticIsolatedService` wrapper that injects a per-test `mkdtemp` root (removed in `afterEach`), so the
      112-test suite no longer pollutes the home dir. tsc+biome+`test:fast` (2435) green.
      **PER-TOOL-CALL DETAIL NOW WRITTEN (2026-06-27):** the terminal writer is no longer coarse — `extractTerminalToolCalls`
      ([nklein-ledger-tool-calls.ts](src/nklein-agent/nklein-ledger-tool-calls.ts)) walks the task's persisted transcript
      (`readPersistedTaskSession().messages`) and emits the ordered `attempt.toolCalls[{name, fingerprint, outcome}]` —
      each `tool_use` block's name + lossless full-input fingerprint (§5.O `computeNKleinToolInputFingerprint`), with the
      matching `tool_result` correlated by `tool_use_id` to fill the per-call outcome (`error`/`success`; `null` if the run
      ended before that call returned). Pure (computed at terminal time, no live accumulation); the capture site reads the
      snapshot + appends async best-effort. 5 extractor tests; `buildTerminalAttemptEvent` passes `toolCalls` through.
      So `summarizeModelOutcomes` + the §5.Z/§5.AA projections now have per-tool usage/outcome grain, not just per-run.
      **Still owed (the rest of this item):** the
      remaining workflow fields the durable scheduler needs (`jobId`/`runState`/`resumeCursor` + admission/resource-headroom
      + merge/review-join events — add as the scheduler lands); and fully **re-home the attempt-grain bits** scattered in
      `task-run-summary-store` / model-registry observations / knowledge-tool telemetry so they become projections/thin-
      writers over this ONE stream (the terminal writer now runs ALONGSIDE the run-summary store; convergence is next).
- [~] **Make `ModelBehaviorProfile`/MCSR/§5.Z/`ModelFitness` projections over the ledger.** Wire the §5.AA online update
      (`recordModelBehaviorOutcome`, core DONE) + the §5.AB fitness records + the §5.Z matrix to READ/WRITE the ledger
      stream — one evidence source, no parallel persistence. Unblocks M2. **`ModelBehaviorProfile` projection DONE
      (2026-06-27):** [agent-ledger-projections.ts](src/core/agent-ledger-projections.ts) `buildModelBehaviorProfilesFromLedger`
      folds each model's ledger attempts (chronologically) through `recordModelBehaviorOutcome` → one §5.AA profile per
      model, derived from the durable record (no second store). Pure; tsc+biome green. With the live writer
      above, the profile is now a real query over real data. **§5.AB `ModelFitness` projection ALSO DONE (2026-06-27):**
      `buildModelFitnessFromLedger` (same module) derives one coarse `ModelFitnessRecord` per (model, role) — success-rate
      as the quality + reliability proxy, real avg latency + retries, `maxDifficultyCleared` 0 until the §5.AB eval harness
      grades quality/difficulty — feeding `computeModelFitness`/`selectModelForTask`. So the ledger→profile→fitness chain
      is complete as projections (10 unit tests over the projection module). **§5.Z matrix as a ledger query — PARTIAL
      DONE (2026-06-27):** `summarizeModelOutcomesByRole` rolls attempts up per (model, role) — the board role (architect
      /worker/reviewer) ≈ the §5.Z board flow (decompose/single-card/review) — and it's surfaced in `nklein dev ledger`.
      The remaining §5.Z flows (chat / autonomous) need an explicit per-attempt FLOW field the terminal writer doesn't set
      yet. **PER-(MODEL, TOOL) USAGE PROJECTION DONE (2026-06-27):** `summarizeToolUsageByModel` (ledger core) folds the
      now-written `attempt.toolCalls` into per-(model, tool) call counts + outcome (success/error/incomplete) + a
      completed-calls success rate — the §5.AA small-model signal (a weak model reliably erroring on a *specific* tool is
      a parse-and-recover / tool-simplification target, not just "bad model"). Surfaced in `summarizeLedgerForDisplay` +
      a new "Per-model × tool" section of `nklein dev ledger` (and its `--json`); 3 unit tests. **Still owed:** the FLOW
      field for the non-board flows (premature until chat/autonomous get their own writers); reading these
      profiles/fitness from the LIVE runtime
      (the §5.AA retry engine / §5.AB scheduler consume them); folding MCSR speed observations into the same stream; and
      the graded-quality/difficulty a richer writer + the §5.AB eval harness supply (today quality is the coarse
      success-rate proxy).
- [ ] **Replay / simulation mode (ties §5.V).** A captured ledger attempt's model outputs become a deterministic
      fixture → replay the live orchestration without a model. Turns the currently "live-only, deferred to e2e" §5.V
      flows into deterministically-testable ones; debugs orchestration races without a GPU. `replayable` is a per-tool
      manifest facet (below). **Research addendum:** replay also needs per-tool idempotency keys + durable tool result
      hashes/refs and a replay mode (`reuse`/`simulate`/`skip`/`reconfirm`) so nondeterministic side effects are never
      silently repeated.
- [ ] **Durable long-run job scheduler.** A background job runner that **checkpoints to the ledger** and **resumes** —
      the cross-run, restart-survivable layer the fragile foreground `verify-*.mts` scripts lack (proven: the 30-min
      multi-card run died on one transient `fetch failed`). Seeds: the endpoint scheduler (§6.5) + per-model concurrency
      (§5.T). Unblocks M1's unattended pipeline run. **Research addendum:** make this lease-based (worker owns job until
      heartbeat expiry), with durable reclaim semantics for process death and side-effect-unknown states.
- [ ] **Tool-capability manifest (unify the 3 gating mechanisms).** Each tool (chat + NKlein + future) declares one
      manifest — `{ mutationLevel: read|sandbox_write|control_plane|host_write ; networkLevel: none|egress ; fsScope:
      workspace|host ; auditDetail ; approval: auto|confirm|risk_ack|typed_host ; replayable }` — and the gate becomes one
      function of `(manifest, mode, ruleset)`, replacing the drifted trio (chat `chat-execution-mode` action-kinds + §5.L
      rulesets + the NKlein tool-approval policy). The audit's **external-action policy** ("dark factory" network /
      accounts / purchases / publishing / money) is just higher `networkLevel`/`approval` tiers on this manifest —
      collect the seam, stay #1-locked. **Research addendum:** add state gating (`allowedRunStates`), source/sink
      provenance/taint labels, semantic error contracts, small-model tool-card metadata, and replay mode.
- [ ] **Resource governance (operational, NOT perf-benchmarking).** Model load/unload policy, VRAM/RAM/disk headroom
      check before a sweep, endpoint-saturation backpressure (the scheduler already serializes per endpoint),
      background-vs-interactive priority — so a local multi-model lab doesn't OOM/thrash/deadlock. **Distinct from** the
      §5.O-deferred perf/efficiency *comparison* sweeps; this is "don't melt the machine," which is in-scope.
- [ ] **Self-improvement quarantine (M4 safety).** !Klein-proposed patches to itself land only through stricter gates:
      protected-tests (#1.5) + a replay-eval pass + a security review (§5.Y posture) before merge. Ties the existing
      self-improvement project (§6.11) + the agent-write-guard.
- *(cross-links)* §5.AA/§5.AB (read the ledger) · §6.4 MCSR (its observations become a ledger projection) · §5.Z (the
      matrix becomes a ledger query) · §5.V (replay makes live-only flows testable) · §5.L + chat-execution-mode (unified
      by the tool manifest) · §6.5 + §5.T (scheduler seeds) · §5.Y (quarantine security gates).

### 5.AG — Operator UX milestones: healthy / stuck / risky / done *(2026-06-26, from the spec audit)*
> The audit's fair point: the engine is deep, but the **daily operator workflow** needs its own hard spec — "what does
> the user SEE when work is healthy, stuck, risky, or done?" The cockpit (§6.8) shows live per-card telemetry; this is
> the **at-a-glance board-health story** on top of it, and the home for the §5.AB "why this model for this task" +
> §5.AF "what was tried before escalating" surfaces. Keep it grounded — build the states that map to real signals we
> already emit.
- [~] **Board-health summary (healthy / stuck / risky / done).** One glanceable status derived from existing signals:
      healthy = cards progressing (focus-chain/diff advancing); stuck = parked/no-progress/loop-salvaged (§5.AA) or
      a §5.S clarifying question pending; risky = a host/unsafe action awaiting ack (§5.M G3b) or a delivery gate held
      (§5.L) or sandbox-unavailable (§5.A); done = merged/awaiting-review. Surface as a board-header rollup + per-lane.
      **CLASSIFIER CORE DONE (2026-06-27):** pure `classifyOperatorTaskState(signals)`
      ([operator-task-state.ts](src/core/operator-task-state.ts)) maps a normalized signal set (session state · column ·
      paused · lost-heartbeat · blockedKind · host-action-ack · delivery-gate-held · clarify-pending · no-progress/loop)
      to `healthy|stuck|risky|done` in PRIORITY order (risky → done → stuck → healthy), so the most operator-urgent
      signal wins; 7 unit tests lock the precedence (risky outranks done/stuck; done outranks stuck).
      **BOARD-HEADER ROLLUP UI WIRED + LIVE-VERIFIED (2026-06-27):** `summarizeBoardHealth(board, sessions, overrides?)`
      ([operator-board-health.ts](src/core/operator-board-health.ts)) bridges a board + sessions → the rollup (the CLI's
      `summarizeWorkspaceBoardHealth` now delegates to it), and the `<BoardHealthSummary>` web component
      ([web-ui/src/components/board-health-summary.tsx](web-ui/src/components/board-health-summary.tsx)) renders the
      compact healthy/stuck/risky/done chips + a risk-inbox count, **placed in the kanban-board header strip** (fed the
      live `data` board + `taskSessions`). Verified: root+web typecheck, 3 component tests + full web vitest (733),
      `web:build` (clean bundle), and a **live browser load** (no white screen, no console errors; correctly renders
      nothing on an empty board). **BLOCKED-KIND THREADED (2026-06-27):** the card's own `blockedKind`
      (`needs_decomposition` / `local_model_required` / `agent_sandbox_unavailable`) IS board state, so `summarizeBoardHealth`
      now folds it into each card's signals — a **sandbox-unavailable card reads `risky`**, a **needs-decomposition card
      reads `stuck`**, and both land in the inbox's `blockedOnSetup` — straight from the board (CLI + UI), no subsystem
      wait. (+1 unit test.) **Still owed:** the §5.L gate / §5.M ack / §5.S clarify per-task flags (those subsystems hold
      the state in chat/session scope, not as a readable per-board-task signal yet — confirmed by grep; that's a
      gate/clarify-subsystem task, not a board-health one) → thread via `resolveOverrides` once they expose it.
      **PER-LANE INDICATOR DONE (2026-06-27):** `<BoardLaneHealth>`
      ([web-ui/src/components/board-lane-health.tsx](web-ui/src/components/board-lane-health.tsx)) in each board-column
      header shows only the **attention-worthy** counts — risky (red) + stuck (orange) — for that lane's cards (healthy/
      done are implied by the lane + count, so omitted), reusing `summarizeBoardHealth({columns:[column]}, sessions)`;
      renders nothing for a calm/trash lane. Verified: web typecheck + 3 component tests + full web vitest (736) +
      web:build + a live browser load (no white screen / console errors). **§5.AG board-health is now complete across the
      whole-board header AND per-lane (CLI + UI).**
- [~] **Escalation / "what was tried" surface (reads the §5.AF ledger).** When a card escalates to the user (§5.AB last
      resort), show the attempt chain — models × approaches × scores tried — so the user sees an actionable report, not a
      silent dead end. Also the §5.AB "why this model for this task" inspectable reason.
      **REPORT PROJECTION DONE (2026-06-27):** pure `buildTaskEscalationReport(events, taskId)`
      ([agent-attempt-ledger.ts](src/core/agent-attempt-ledger.ts)) — a QUERY over the ledger that returns the task's
      chronological attempt chain (`rung × model × approach × outcome × qualityScore × salvage`, with `approach` a
      readable label of the levers applied) plus a rollup (distinct models tried, final outcome). 3 unit tests.
      **CLI SURFACE WIRED + VERIFIED (2026-06-27):** `nklein dev escalation --task-id <id>` (`runDevEscalationCommand` in
      [dev.ts](src/commands/dev.ts)) reads the real ledger (`readAllAgentLedger`) → `buildTaskEscalationReport` → prints
      the attempt chain (text + `--json`); verified by execution (empty-ledger → "No attempts recorded" / the empty
      report). **tRPC ENDPOINT WIRED (2026-06-27):** `runtime.getTaskEscalation` (`workspaceProcedure`, input `{taskId}`,
      output `taskEscalationReportSchema`) delegates to `ctx.runtimeApi.getTaskEscalation` → `readAllAgentLedger()` +
      `buildTaskEscalationReport`. Added the wire schemas (`taskAttemptRowSchema`/`taskEscalationReportSchema` +
      request, in [agent-attempt-ledger.ts](src/core/agent-attempt-ledger.ts), with a compile-time `z.ZodType` drift
      guard) + the `RuntimeTrpcContext` interface method + the runtime-api impl. Verified: root tsc (interface/procedure/
      impl align) + a unit test that round-trips a populated AND empty report through the output schema (so tRPC
      output-validation can't throw at runtime). **WEB PANEL DONE (2026-06-27):** `<TaskEscalationPanel>`
      ([web-ui/.../detail-panels/task-escalation-panel.tsx](web-ui/src/components/detail-panels/task-escalation-panel.tsx))
      — a collapsible card-detail panel (placed at both card-detail render sites) that lazily fetches via
      `fetchTaskEscalation` → `runtime.getTaskEscalation` and renders the attempt chain (`#rung · model · approach →
      outcome`, outcome color-coded) with a `N attempts · M models` summary, or "this card has not escalated" when empty;
      mirrors the diagnostics panel (lazy/refresh/loading/error). Verified: web typecheck + 2 component tests + full web
      vitest (738) + web:build + a live browser load (no white screen / console errors). **§5.AG escalation surface is
      now complete end-to-end: ledger → `buildTaskEscalationReport` → CLI (`dev escalation`) + tRPC endpoint + web panel.**
      **Still owed:** the §5.AB "why this model" reason (needs the §5.AB selection-reason data); and the **Layer-2
      user-escalation suggestions** surface (§5.AB) — when the automatic ladder (all approaches × all loaded models) is
      exhausted (`isHardStuck`), render `buildEscalationSuggestions(...)` alongside the attempt chain so the user gets a
      set of "get through the wall" options (clarify · provide context · adjust a constraint · approve a blocked action ·
      fix the environment · re-scope · or make a more capable model available — optionally to analyze + guide), with the
      most-likely fix promoted first.
- [~] **Risk + approval inbox.** A single place the operator answers the things that block autonomy: unsafe-command acks
      (§5.M G3b), clarifying questions (§5.S), held deliveries (§5.L), protected-write approvals (§6.11). Reduces "where
      do I unblock this?" hunting. **DATA CORE DONE (2026-06-27):** `collectOperatorInbox(tasks)` in
      `src/core/operator-task-state.ts` composes the same `OperatorTaskSignals` the classifier reads → groups task ids by
      blocker (`unsafeActionAcks` / `clarifyingQuestions` / `heldDeliveries` / `blockedOnSetup`) with a distinct `total`.
      3 unit tests. **SIGNAL MAP DONE (2026-06-27):** `mapSessionSummaryToOperatorSignals(summary, columnId, overrides)`
      (same module) is the shared bridge for BOTH the classifier and the inbox — session state + column pass through
      (structurally-identical enums), `paused`/`heartbeatLost` derive from the summary, and the off-summary signals
      (§5.L gate / §5.M ack / §5.S clarify / §5.A block / §5.AA loop) come from caller overrides defaulting to safe
      "not blocking" (so a summary-only call still classifies healthy/stuck/done; `risky` needs the overrides). The
      module stays dependency-free via a minimal structural `OperatorSessionSummaryView` so a runtime caller passes a
      full `RuntimeTaskSessionSummary` directly. 7 unit tests incl. classifier composition. **Still owed (the surface):**
      render the inbox/board-health panels consuming this map; thread the real gate/ack/clarify/block flags into
      `overrides` at the call site; add protected-write approvals (§6.11) once that signal exists. **BOARD ROLLUP DONE
      (2026-06-27):** `buildOperatorBoardSummary(tasks)` (same module) is the board-header query the classifier comment
      promised — per-state `counts` + `byState` task-id lists + the folded-in `inbox` + `total`, composing
      `classifyOperatorTaskState` and `collectOperatorInbox` (2 unit tests, empty-board + mixed-board). **§5.AG pure data
      layer is now COMPLETE end-to-end: signal map → classifier + board rollup + inbox + escalation report.**
      **FIRST CONSUMER WIRED + LIVE-VERIFIED (2026-06-27):** `summarizeWorkspaceBoardHealth(state, resolveOverrides?)`
      ([src/core/operator-board-health.ts](src/core/operator-board-health.ts), 3 unit tests) bridges a live
      `RuntimeWorkspaceStateResponse` → the rollup, and the new **`nklein task health`** CLI command (mirrors `task list`:
      `resolveRuntimeWorkspace` → `workspace.getState` → summarize → JSON) renders it. **Proven live** against a running
      runtime on this repo's board: `ok:true`, 4 cards classified (`done:4`), empty inbox — the §5.AG chain runs end-to-end
      through a real consumer. **Remaining surface:** the web-UI board-health header + risk-inbox panel (the same
      `summarizeWorkspaceBoardHealth` can power a tRPC endpoint for them); thread the real §5.L/§5.M/§5.S off-summary flags
      via `resolveOverrides` when wiring those.
- *(cross-links)* §6.8 cockpit (the live per-card layer this summarizes) · §5.AF ledger (the escalation/attempt data) ·
      §5.AB (selection reasoning) · §5.S (clarify inbox) · §5.M G3b (risk ack) · §5.L (delivery gate) · §5.A (isolation state).

### 5.AH — !Klein self-awareness: the chat agent knows its own implementation *(2026-06-27, user — ACTIVE for A; B collected for later)*
> **Vision (user, 2026-06-27):** the §5.M chat agent should be **aware of all of !Klein's own implementations** so a
> user can *discuss* !Klein with it — existing features, bugs, ideas for new features, architecture, "how does X work",
> "is Y a known issue", "would Z fit". **Awareness here means READ-ONLY** (the agent reads !Klein's code + planning
> docs; it never modifies itself in this mode). A **separate, later, clearly-PROTECTED** feature (B below) will let the
> agent load its own implementation as a *project* and actually work on it — parked now, ideas collected so we don't
> forget it. **Invariants:** LOCAL ONLY (#1), strict isolation (#2 — even self-reads go through the read-only tool
> boundary; no host-path leaks), ≥32k floor (#3).
- [ ] **A — Read-only self-awareness chat scope (ACTIVE).** A chat scope/mode whose workspace root is the **!Klein repo
      itself**, with **only read tools** (`read_file`/`list_dir`/`get_board` + the §6.7 repo-map/code-index over !Klein's
      own `src/`+`web-ui/`+`core-py/`) and the rich **planning corpus** as grounding: **[done.md](done.md)** (the
      shipped-feature catalog — exactly "what exists"), `todo.md` (what's left + why), `AGENTS.md` (tribal knowledge),
      `CHANGELOG.md`, and `.plan/docs/*`. So a user can ask "what features exist / how does the swarm scheduler work / is
      this a known bug / how would idea Z fit" and get answers grounded in the *actual* code + decisions. Build on §5.M's
      scope machinery (a new `klein_self` scope, or registering the !Klein repo as a read-only project) + the existing
      execution-mode gate forced to `isolated_readonly` (no `write_file`/`run_command`/board-mutation — discussion only).
  - [ ] scope/mode: a read-only `klein_self` chat scope → tools = read + `get_board` only; gate pinned read-only
  - [ ] grounding: index !Klein's own source (§6.7) + load the planning corpus (done.md/todo.md/AGENTS.md/CHANGELOG/.plan)
        as retrievable context; prefer done.md for "existing features" + todo.md for "planned/known"
  - [ ] cross-link to §5.AE (a `klein_self` skill bundle: the self-knowledge fragments) + §5.AC (a "search the docs" retrieval over the planning corpus)
  - [ ] live-verify (§5.Z): ask a small local model real questions about !Klein's features/bugs/ideas and check the answers cite real code/docs
- [-] **B — LATER (collected, NOT needed now): the agent loads its own implementation as a project and works on it
      (self-development).** *(deferred by the user 2026-06-27: "we dont really need the feature as-of-now, we just put it
      on the table to not forget + to collect ideas.")* **Clearly PROTECTED** — explicit user confirmation, **workspace
      separation** (a separate checkout/worktree of !Klein, NEVER the live runtime's own working tree — echoes the
      AGENTS.md created-workspace-never-inside-a-git-work-tree guard + the §6.11 self-improvement project), strict
      isolation, the protected-test + agent-write gates. Idea-collection bucket (extend over time):
  - [-] **Open question — "deliver back to runtime":** how do the agent's edits to !Klein get applied to the *running*
        !Klein? (candidate ideas to weigh later: produce a `nklein/tasks/<task>` result branch the user reviews + merges
        like any task; a PR against the !Klein repo; a staged "update bundle" the user applies + restarts into; never a
        live self-overwrite of the running process.) Decide when we actually build B.
  - [-] reuse/extend the existing §6.11 "Create !Klein self-improvement project" flow + the §5.AF **self-improvement
        quarantine** (M4: protected-tests + replay-eval + security review gate before anything lands) — B is essentially
        that, made first-class + user-drivable from chat.
  - *(cross-links)* §6.11 (self-improvement project — the beachhead) · §5.AF (M4 quarantine gates) · §5.X (the refactor it
        could help drive) · §5.M (chat scopes + host/confirm model) · §5.Y (security posture for self-modification).

### 5.AI — Continuous parallel dev-test evaluation rail *(2026-06-27, user — ACTIVE)*
> **Vision (user, 2026-06-27):** the lately-added dev-test-projects (the 45-folder registry, §5.O) should be **(1) fully
> integrated** and **(2) used extensively + EARLY while we build features** — a **"parallel evaluation" rail that's
> ALWAYS running** to challenge the current state of !Klein's implementation and surface *sleeping* issues. It runs in
> the background **whenever the loaded LLMs aren't needed for the actual targeted feature test**, can run **multiple
> projects in parallel** (the small models live on an **m5max / 128 GB** box — "a bit" of compute; a dedicated-LLM
> machine can be added if it's not enough), and **auto-collects ALL resulting evidence — success AND failure** — which
> **feeds directly back into these todos** (new bugs / shortcomings → items; and *ideas* that surface when the user or
> the agent analyses the collected run evidence). Parallel UI + LLM testing is fine; **just don't run too-tight timeout
> limits** (small local models need slack). Project selection on the idle rail = **user-chosen OR randomized OR
> agent-selected**. **Invariants:** LOCAL ONLY (#1), strict Docker isolation (#2 — every dev-test agent runs sandboxed,
> same as real tasks, §5.A), ≥32k floor (#3). **This is the operational, always-on instance of §5.V's e2e oracle +
> §5.Z's cross-model sweep, powered by the §5.AF durable scheduler — NOT a parallel mechanism; reuse those seams.**
- [x] **Fully integrate the lately-added dev-test-projects — AUDITED CLEAN (2026-06-27).** Ran
      `loadDevTestProjectRegistry()`/`listDevTestProjectIds()` ([dev-test-project-registry.ts](src/nklein-agent/dev-test-project-registry.ts)):
      **all 45 folders discovered + schema-valid + enabled (45/45 load, 0 skipped/malformed)**. **No `~/Desktop` path
      references** — the lone "Desktop" match is *spec content* ("desktop automation" as a domain capability in project
      36's `specification.md`), not a filesystem path. **Selectable** via both surfaces: the same loader feeds the UI
      `DevTestRegistryPicker` (through `projects.listDevTestProjects`) and the CLI (`nklein dev test-project`).
      **Scaffolds + runs through the sandboxed `startTaskSession` path** — exercised repeatedly + live this session by
      [dev-test-rail.mts](scripts/dev-test-rail.mts) (real projects created, agents started/ran, evidence collected). So
      the registry is fully integrated; the rail can lean on it. *(Open follow-ups elsewhere: the per-folder "runs to a
      clean terminal state on a small model" reliability is what the always-on rail + §5.O output-robustness sweep keep
      exercising — that's ongoing evaluation, not an integration gap.)*
- [~] **The always-on evaluation rail (background, idle-aware).** A long-running background runner (the §5.AF **durable
      lease scheduler** — checkpoints to the ledger, survives restart; do NOT build a fragile foreground `verify-*.mts`
      loop) that, when the loaded models are **idle** (no targeted feature test claiming them), picks dev-test project(s)
      and runs them sandboxed to terminal state. **Idle-aware admission:** it yields to interactive/targeted work
      (§5.AF unified resource admission — board cap + sandbox pool + endpoint capacity + model-load + RAM/VRAM/disk +
      **background-vs-interactive priority**), so it never starves a real run. **Generous timeouts** (the swarm guardrails
      are configurable, §5.T — the rail uses a long-wall-time profile; small models on the m5max are slow but capable).
      **Multiple projects in parallel** where endpoint capacity allows (§6.5 per-endpoint serialization + §5.W
      per-provider/per-model concurrency gate it safely).
      **ADMISSION-DECISION CORE DONE (2026-06-27):** [background-eval-admission.ts](src/core/background-eval-admission.ts) —
      pure `decideBackgroundEvalAdmission(input)` is the idle-aware gate, checked in PRIORITY order:
      **yield_to_interactive** first (the rail must NEVER compete with a real task), then `no_idle_loaded_model`, then
      `background_cap_reached`, then `no_resource_headroom` (the composed upstream ceiling passed in as one flag), else
      `idle_capacity_available` → admit. Typed hold `reason` for the §5.AG "what the scheduler did/why" surface; 7 unit
      tests lock the priority order. **RUNNER CORE DONE (2026-06-27):**
      [background-eval-runner.ts](src/core/background-eval-runner.ts) — `createBackgroundEvalRunner(deps)` is the durable
      scheduler brain with every effect INJECTED (so it's pure + fully testable, NOT the "fragile foreground loop" the
      spec warns against). Each `tick()`: reaps leases that completed naturally (drop) or overran their deadline
      (force-stop), reads live signals → the admission gate → starts one run if allowed, and **checkpoints the lease set**
      so `recover()` restores exactly what was in flight after a crash/restart. 6 unit tests (admit/yield/cap+free-slot/
      deadline-force-stop/no-project/recover). **CHECKPOINT STORE DONE (2026-06-27):**
      [background-eval-runner-store.ts](src/state/background-eval-runner-store.ts) — durable
      `save/loadBackgroundEvalRunnerLeases` (snapshot JSON at `~/.nklein/nklein/background-eval-runner/leases.json`,
      zod-validated, missing/corrupt → empty so the runner recovers rather than crashes; `rootDir` injectable for tests).
      That's the runner's `loadCheckpoint`/`saveCheckpoint` (file-backed snapshot is simpler + sufficient for a lease set;
      the ledger remains the *event* log). 5 unit tests. **SIGNAL-COMPUTE CORE DONE (2026-06-27):**
      [background-eval-runner-signals.ts](src/core/background-eval-runner-signals.ts) — pure
      `computeBackgroundEvalRunnerSignals(runtimeSnapshot)` turns raw `projects.list` counts + model-loaded + config into
      the admission signals, with the key interactive-detection rule (a session running in a workspace the runner does
      NOT own = real work → yield); 4 unit tests. So **every PURE piece of the daemon's logic is now built + tested**
      (admission gate · runner core tick/recover · checkpoint store · signal compute · selection · guardrails · structured
      evidence). **DAEMON BUILT + PROVEN LIVE IN DRY-RUN (2026-06-27): [dev-test-rail-daemon.mts](scripts/dev-test-rail-daemon.mts).**
      The thin effectful glue: a TRPC client + the runner core, deps wired as runtime calls (`getSignals` = projects.list
      + `/v1/models` + getConfig → the pure `computeBackgroundEvalRunnerSignals`; `startRun` = createDevTestProject +
      scoped-client startTaskSession; `stopRun` = projects.remove; `isRunActive` = session-state query) on
      `save/loadBackgroundEvalRunnerLeases`, plus a `setInterval` driver calling `tick()` + SIGINT shutdown. **Verified
      live (dry-run, started nothing):** against the live runtime it read real signals → admitted up to the cap (2) →
      held (`background_cap_reached`) → reaped expired leases (force-stop) → admitted new ones → rotated projects (random
      selection) → **checkpointed `leases.json` between ticks → recovered on start**. So the always-on rail's whole brain
      works end-to-end. **`--live` VERIFIED TOO (2026-06-27):** ran `--live --max-concurrent 1` against the live runtime
      — the daemon autonomously **created + started a REAL sandboxed dev-test run** (`nklein-daw-foundation`, running),
      then correctly **held at the cap** (`background_cap_reached`) instead of starting more. The live pass also caught +
      fixed a real bug: `stopRun`'s single `projects.remove` **failed silently when the project's agent was still
      running**, leaking the throwaway project — now it **retries + verifies removal** (matching the rail's cleanup), so a
      force-stopped/shutdown run cleans up. **So the always-on rail is functionally COMPLETE** (dry-run + `--live` both
      proven). Remaining polish for a sustained deployment (not blockers): yield-mid-run observation over a long window,
      and richer live signals (real RAM/VRAM/disk headroom beyond the board-cap proxy).
  - [~] **First usable version BUILT (2026-06-27): [scripts/dev-test-rail.mts](scripts/dev-test-rail.mts).** A one-shot
        parallel runner that composes the proven pieces — pins the model + raises its per-model concurrency (§5.T) so the
        one endpoint serves the projects concurrently, creates N dev-test projects, subscribes to each one's
        `/api/runtime/ws` activity stream, starts each sandboxed seed, renders a **watchable live task-flow view** (per
        project: cards · seed state · running/review counts · last tool · msg count), runs to terminal/deadline with
        **generous timeouts**, then writes a per-project **evidence report** (delivered/non-terminal/failed · decompose? ·
        tool tally · narration/repeat anomalies) and **restores the model + concurrency + removes the throwaway projects**.
        Run: `tsx scripts/dev-test-rail.mts --projects mid_task,complex_dag --model qwen/qwen3-8b-m5max`. **Proven live
        (2026-06-27):** 2 projects started + both fired `decompose_project` concurrently. This is the operator-runnable
        instance; the **always-on / idle-aware / restart-survivable + auto-into-todos** version above (on the §5.AF
        durable scheduler) is still owed.
  - [x] **EVIDENCE → FIXED (2026-06-27, user-surfaced via a live rail run): the web-ui went SLUGGISH / near-unresponsive
        with ≥2 agent sessions running in parallel.** Root cause confirmed: [use-runtime-state-stream.ts](web-ui/src/runtime/use-runtime-state-stream.ts)
        dispatched a reducer action — and thus re-rendered the whole tree — on EVERY WS frame; a running agent emits
        hundreds of `task_chat_message` frames/sec (the rail measured 14,722 on one project), and parallel sessions
        compound it → a render storm. **Fix:** the stream now **coalesces incoming frames into ONE batched dispatch every
        ~100 ms** (`STREAM_BATCH_FLUSH_MS`; a queue + flush-timer in the effect → a new `{type:"batch", actions}` reducer
        case that folds them in order). Project-switching stays immediate (the workspace-reset dispatch is not batched). No
        frame is dropped — order + final state are identical to per-frame dispatch (locked by 4 reducer tests:
        batch≡sequential, no-drop over 50 frames, empty-batch no-op, single-action unchanged). web:typecheck + web vitest
        (725) green; CHANGELOG'd.
  - [x] **DELIVERED (2026-06-27, user ask on leaving — "except for switching projects, I could not see too much anyway…
        maybe you can improve about that"): per-project LIVE activity in the sidebar.** The project rows showed only
        static per-column task counts, so to tell whether a project's agents were actually *working* you had to switch
        into each board one at a time. [project-row.tsx](web-ui/src/components/project-nav/project-row.tsx) now renders a
        live activity badge per project: a **pulsing green "N running"** (agents executing on a model right now) or a
        **steady gold "N queued"** (waiting for sandbox/model capacity — which also surfaces the §5.W per-model
        concurrency bottleneck at a glance); a running badge appends the queued count (`2 running +1`). Data: a pure
        `countActiveAgentSessions` ([task-session-api-contract.ts](src/core/task-session-api-contract.ts)) over the live
        session summaries, surfaced as **additive** `runningSessionCount`/`queuedSessionCount` on `RuntimeProjectSummary`,
        computed in `summarizeProjectActiveSessions`/`buildProjectsPayload`
        ([workspace-registry.ts](src/server/workspace-registry.ts)). **Live by construction:** it rides the existing
        per-session-flush `broadcastRuntimeProjectsUpdated` ([runtime-state-hub.ts:177](src/server/runtime-state-hub.ts#L177))
        — sessions flush on every state change — so the badge updates the instant an agent starts/queues/stops, with no
        new broadcast wiring. Verified: `countActiveAgentSessions` unit test + 4-case ProjectRow render test (running /
        running+queued / queued-only / none) + root & web typecheck + web:build (24 web tests green); CHANGELOG'd.
        **PROVEN LIVE (2026-06-27, 2-project rail + Playwright):** `projects.list` reported `running=1` for the active
        dev-test project and the screenshot showed the green "● 1 running" badge on it, idle projects showing only their
        column counts (`/tmp/nklein-sidebar-activity.png`, sent to the user). **The live run caught + fixed a real bug the
        unit/component tests missed** (this is exactly why live verification is mandatory): `summarizeProjectActiveSessions`
        counted `terminalManager.listSummaries()`, but **Docker-isolated NKlein agents live in the NKlein task-session
        service, NOT the terminal manager** — so the badge counted an empty source and always showed 0 for real agents.
        Fix: the registry takes a `setNKleinSessionSummariesProvider` ([workspace-registry.ts](src/server/workspace-registry.ts))
        that the **hub** wires from its live `nkleinPreviousSummaryByWorkspaceId` cache
        ([runtime-state-hub.ts](src/server/runtime-state-hub.ts)); the registry unions those NKlein summaries with the
        terminal manager's (dedup by taskId) before counting. Regression-guarded by a hub test asserting the provider
        returns the tracked NKlein summaries. Capture tool: [scripts/shot-sidebar.mts](scripts/shot-sidebar.mts).
  - [x] **EVIDENCE → fix (2026-06-27, user, watching a live rail run): parallel projects don't actually parallelize LLM
        work.** Two gates: **(a) LM Studio defaults to SERIAL request handling** — even when !Klein sends concurrent
        requests, the GPU processes them one at a time unless the user raises LM Studio's server concurrency; !Klein can't
        force the GPU to parallelize. **(b) !Klein's per-model `maxConcurrentRequests` defaults to 1** (`getMaxConcurrentRequests`
        → 1 in [nklein-endpoint-scheduler.ts](src/nklein-agent/nklein-endpoint-scheduler.ts)), so the endpoint scheduler
        serializes session *starts* until it's raised. Actionable: (i) **detect + surface LM Studio's concurrent-request
        setting** and advise raising it for parallel work (with a clear "your endpoint is serial → parallelism is capped"
        signal in the UI); (ii) make the §5.T/§5.W per-model/per-provider concurrency **discoverable + sensibly defaulted**
        for a single-user local box; (iii) **confirm !Klein genuinely overlaps the in-session request streams** — the
        scheduler allows N concurrent *sessions*, but verify the per-request model calls actually hit the endpoint
        concurrently rather than the agent loops effectively taking turns. Ties §6.5 · §5.T/§5.W · §5.AB (resource-aware
        scheduling).
        **INVESTIGATED (2026-06-27, live):** confirmed !Klein's side is NOT the hard gate — the rail raises per-model
        concurrency to N and the badge showed **running=2** (two sessions concurrently admitted on the one endpoint), so
        (b) is already *raisable* (the constraint lives in the model-registry `constraints.maxConcurrentRequests`, default
        1). The real gate is **(a) LM Studio serial GPU processing**, which !Klein can't change via the OpenAI-compat API.
        **Important reframe:** a big part of what *looked* like "no parallel work" was actually the §5.AI event-loop hang
        (a stuck/slow agent froze the whole runtime) — now FIXED; re-verified that with one agent stuck, `projects.list`
        is **2.4 ms** (runtime fully responsive regardless of agent state), so a slow/serial endpoint no longer *also*
        freezes the UI. So the only remaining !Klein-side work was **(i): a UI advisory**. **DONE (2026-06-27):** rather
        than a global banner needing a UX-design call, the advisory rides the **queued activity badge's tooltip**
        ([project-row.tsx](web-ui/src/components/project-nav/project-row.tsx)) — which appears *exactly* when agents are
        queuing (the serialization symptom), so it's contextual + non-nagging. When `queuedSessionCount > 0` the tooltip
        appends: "local model endpoints often run requests serially; raise the endpoint's concurrency (and !Klein's
        per-model concurrency in Settings) for true parallel work." A running-only badge (no queue) shows NO advisory.
        Verified: web:typecheck + 2 new project-row component tests (advisory present when queued, absent when only
        running) + web:build. The default-bump idea (ii) is moot for LM Studio (it serializes regardless) and risky to
        change blind; leave the registry constraint as the lever. Ties §6.5 · §5.T/§5.W · §5.AB (resource-aware scheduling).
  - [x] **FOUND + FIXED (2026-06-27): the SERVER-tier root of "sluggish with 2 projects" — `projects.list` HUNG 41–60 s
        under heavy parallel agent load; now 0.09–0.22 s (~270×).** Pinpointed by `--cpu-prof` + granular timing across
        7 live A/B cycles. **Root cause:** `buildProjectsPayload` ran `detectProjectHealthIssuesByWorkspaceId`
        ([project-health.ts](src/workspace/project-health.ts)) **synchronously on the hot path** — on every `projects.list`
        AND every per-session-flush WS rebuild — and that health scan (per-project git/fs: `loadWorkspaceState`,
        `readdir`/`readFile` of plan artifacts) **contends with the agent's frequent workspace writes**, ballooning from
        ~ms (idle) to **30–55 s under load** (timing instrumentation isolated it: `listWorkspaceIndexEntries` +
        `summarizeProjectTaskCounts` stayed <500 ms; `detectProjectHealthIssues` was the whole stall). **Diagnosis trail
        (what it was NOT — each ruled out by a live A/B, kept so we don't re-chase):** NOT the projects rebuild itself
        (hang persisted with NO client connected, where the rebuild early-returns); NOT thread-pool (`UV_THREADPOOL_SIZE=24`
        no help); NOT CPU (the `--cpu-prof` was ~100% idle — an async HANG, not CPU-burn, so "offload to worker threads"
        was the WRONG framing); it correlated with the agent being **stuck** (msgs frozen) not stream throughput.
        **Fix:** health issues change rarely (project structure), so cache them with a 30 s TTL + refresh in the
        **background** — `buildProjectsPayload` serves the cached value and **never blocks on detection** (via the reusable
        [stale-while-revalidate-cache.ts](src/core/stale-while-revalidate-cache.ts) `createStaleWhileRevalidateCache`,
        7 unit tests; wired in [workspace-registry.ts](src/server/workspace-registry.ts) as `projectHealthCache`; a cold
        cache briefly awaits, capped at 2 s, so the first idle payload still carries health). **Verified live:**
        same 2-agent load (`complex_dag` at msgs=1004), `projects.list` max **0.22 s** vs **41–60 s** before; 137
        server/projects tests green. **DEEPER ROOT MECHANISM (confirmed, now precisely understood — the source the
        health-cache sidesteps):** the slow op inside `loadWorkspaceState` is `loadWorkspaceContext → resolveWorkspacePath
        → detectGitRoot → runGitCapture(["rev-parse","--show-toplevel"])`, which is a **SYNCHRONOUS git subprocess**
        (`detectGitRoot` returns `string|null`, not a Promise — `runGitCapture` is `execFileSync`-style). A sync subprocess
        **blocks the event loop** while git runs; under the agent's subprocess flood (its own git + `docker exec`) that
        spawn waits tens of seconds — which is *exactly* the idle-CPU-but-hung profile (the thread sleeps in the kernel on
        the child process). **SOURCE FIX DONE (2026-06-27):** made the hot-path git-root lookup **async** —
        `resolveWorkspacePath` (already an async fn, on every `loadWorkspaceState`/`saveWorkspaceState`) now calls
        `detectGitRootAsync` → `runGitCaptureAsync` (`execFile` via `promisify`) instead of the loop-blocking `spawnSync`
        ([workspace-state.ts](src/state/workspace-state.ts)). Targeted so there's **no ripple** — `resolveWorkspacePath`'s
        signature is unchanged, so no caller had to change; no caching, so **zero staleness risk**; the sync `detectGitRoot`
        stays for the (separate, colder) git-info path. **Why it's high-leverage:** `saveWorkspaceState` — which the agent
        calls on **every** board write — routed through this, so the agent itself repeatedly blocked the event loop on its
        own saves; this unblocks the loop for the agent's saves, the board view (`buildWorkspaceStateSnapshot`), and every
        other `loadWorkspaceState`/`saveWorkspaceState` caller in one change. **Verified:** 2106 tests green (the heavily-used
        `resolveWorkspacePath` is the guard) + a live smoke. **FOLLOW-UP DONE (2026-06-27) — and it was NOT "far colder", it
        was a second hole on the SAME hot path:** `loadWorkspaceContext` *also* calls `detectGitRepositoryInfo`, which did
        **4 more sync git spawns** (`detectGitRoot` + `detectGitCurrentBranch` + `detectGitBranches` +
        `detectGitDefaultBranch`) — so every load/save was actually blocking on **5** sync git calls, of which the first
        fix only converted 1. Now the **whole git cluster is async** (`runGitCaptureAsync` for all; `detectGitRepositoryInfo`
        is async + runs the two independent branch lookups concurrently via `Promise.all`); the dead sync `runGitCapture` +
        `detectGitRoot` + the `spawnSync` import were removed. So `loadWorkspaceContext` now has **zero** sync git on the
        hot path. tsc-guided (every caller awaits) + test/runtime fully green + a live smoke (boot + create dev-test project
        → exercises the async `detectGitRepositoryInfo`; project lists with correct git info). **`proper-lockfile` is NOT
        a remaining knob (earlier speculation CORRECTED 2026-06-27):** its retry config is `factor:1, minTimeout:25,
        maxTimeout:50` (CONSTANT backoff, not exponential), so 200 retries cap at only **~5–10 s MAX**, not "tens of
        seconds" — it was never the dominant cause (that was the sync git, now fixed), and with async git its bounded wait
        is async (a contended save takes ≤~10 s without freezing the runtime). No change needed.
        **DONE (secondary, still worthwhile — 2026-06-27):** coalesced the per-flush projects rebuild to ≤1/window
        ([coalescing-scheduler.ts](src/core/coalescing-scheduler.ts) wired in
        [runtime-state-hub.ts](src/server/runtime-state-hub.ts) `PROJECTS_BROADCAST_COALESCE_MS`) — reduces real rebuild
        waste when a client is connected, but does NOT move the headline number. Also still worth doing later: batch the
        server-side `task_chat_message` WS sends (one `socket.send` per agent message; client already coalesces receipt).
        High-value: this is the real "parallel work feels broken" tax. Ties §5.AI (client fix) · §6.5 · §5.A (sandbox
        isolation) · §5.AF (admission/sched) · §5.W (concurrency).
  - [~] **selection policy** — `user | random | agent`-chosen next project (default: random/agent rotation across the
        registry, weighted toward tiers/domains we've touched least or that stress a just-changed area). **PARTIAL DONE
        (2026-06-27):** the one-shot rail ([dev-test-rail.mts](scripts/dev-test-rail.mts) `selectPresets`) now supports
        `--select first|random` — `random` does an unbiased Fisher–Yates pick of `--count` projects from the proven
        built-in presets (verified: distinct picks + full coverage). **Still owed:** registry-WIDE random (pick from the
        full §5.O 45-folder registry via `projects.listDevTestProjects`, not just the 4 presets); least-touched/just-changed
        **weighting**; and the **agent-chosen** policy (let an agent pick what to stress) — all of which land naturally on
        the always-on rail (the durable §5.AF scheduler) rather than the one-shot script.
  - [x] **generous-timeout run profile (2026-06-27).** Defined `BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS`
        ([runtime-config-api-contract.ts](src/core/runtime-config-api-contract.ts)) — lenient on the slow-progress guards
        (turns 12→80, wall-time 2h→6h, no-diff checkpoints 4→20) so a slow-but-progressing small model isn't parked
        prematurely, while keeping the LOOP guard near-default (repeated-tool-calls 3→6) so a genuinely stuck agent still
        parks. All values stay inside `RUNTIME_SWARM_GUARDRAIL_BOUNDS` (a profile can't disable a guardrail) — 3 unit
        tests guard that. Wired into the rail ([dev-test-rail.mts](scripts/dev-test-rail.mts)): applied by default (opt
        out with `--guardrails default`), restored on cleanup alongside the model/concurrency pin. The always-on rail
        (§5.AF scheduler) will reuse the same profile.
  - [x] **(optional) dedicated-LLM-machine endpoint (2026-06-27).** The rail's model endpoint is now configurable —
        `--endpoint <url>` or `NKLEIN_MODEL_ENDPOINT` ([dev-test-rail.mts](scripts/dev-test-rail.mts), default the local
        LM Studio); the daemon already honors `NKLEIN_MODELS_URL`. So the rail can pin against a dedicated-LLM machine.
        (config already supports multiple endpoints; §5.W concurrency + §6.5 scheduler already multi-endpoint-aware).
- [~] **Auto-collect + auto-analyse ALL evidence (success AND failure) → feed the todos.** Every rail run captures its
      evidence bundle (the existing `collect evidence` path + the §5.AF ledger projection) — **both** successes (proof
      it still works on model M / project P) **and** failures (a sleeping bug / shortcoming). An analysis pass over the
      collected evidence (agent-driven, user-reviewable) turns findings into **todo items** — bugs/shortcomings as
      `[ ]`/§5.O-style hardening items, and *ideas* (from either the user or the agent reading the evidence) as new
      spec bullets in the fitting §5 section. Ties §5.O (output-robustness findings → `local-llm-tests.md` + code
      fixes), §5.Z (the cross-model matrix as a ledger query), and §5.AG (the operator "what happened" surface).
      **STRUCTURED COLLECTION DONE (2026-06-27):** the rail's evidence is now built ONCE as a typed `RailEvidenceReport`
      (`buildLaneEvidence` — per-project verdict `delivered|failed_to_start|failed|non_terminal`, tool tally, decomposed?,
      WS frames, narration-leak + hot-repeat anomaly counts, session states) — the single source of truth for both the
      printed report AND a **persisted JSON** at `~/.nklein/dev-test-rail-evidence/rail-<ts>.json`
      ([dev-test-rail.mts](scripts/dev-test-rail.mts)). So the harvest is now **machine-readable + durable** (not just
      stdout), which is the substrate the analysis pass reads. **AGGREGATION + REVIEW SURFACE DONE (2026-06-27):** pure
      `aggregateRailEvidence` ([rail-evidence.ts](src/core/rail-evidence.ts)) rolls the accumulated harvest into a
      per-project scorecard **worst-delivery-first** (delivery rate + failed/non-terminal/anomaly counts), a validated
      reader `readRailEvidenceReports` ([rail-evidence-store.ts](src/state/rail-evidence-store.ts), skips malformed
      reports), and a CLI surface **`nklein dev rail-evidence [--json]`** ([dev.ts](src/commands/dev.ts)) that prints the
      rollup for review — `--json` is exactly what the LLM pass will consume. 11 unit tests; the shared types now live in
      `src/core/rail-evidence.ts` (rail imports them, DRY). **ANALYSIS PROMPT DONE (2026-06-27):** pure
      `buildRailEvidenceAnalysisPrompt(aggregate)` (rail-evidence.ts) + **`nklein dev rail-evidence --advisor`** print the
      prompt that asks a model to surface real shortcomings from the harvest and propose concrete todo bullets — `[ ]`
      hardening items, **parse-and-recover** fixes for output anomalies (the weak-model principle, not re-prompting), and
      idea bullets — following the existing `buildNKleinAdvisorRequest` advisor pattern. 6 unit tests. **So the whole
      auto-collect CHAIN is built:** harvest (`rail-*.json`) → aggregate (worst-first scorecard) → review surface
      (`dev rail-evidence`) → analysis prompt (`--advisor`). **Remaining = only the human/agent action** the advisor
      pattern leaves to the user: run a model on the prompt + review the proposed bullets (optionally fold §5.AF ledger
      stats in too). The fixed pipeline is complete.
- [x] **"Collect evidence" buttons reference the specific card — VERIFIED (2026-06-27), no fix needed.** Traced the
      per-**card** "Evidence" button end-to-end: [board-card.tsx](web-ui/src/components/board-card.tsx) `onCopyEvidence(card.id)`
      → `collectTaskEvidence({ taskId })` ([runtime-config-query.ts](web-ui/src/runtime/runtime-config-query.ts)) →
      `handleCollectTaskEvidence` ([task-evidence.ts](src/trpc/runtime-api/task-evidence.ts)). The bundle is **thoroughly
      card-scoped** — the card id (and title) appear in the bundle `scenario` (`task-<id>-<title>`), the `summary.md`
      (`Task: <title> (<id>)` + the card's prompt), the `transcript` (keyed by `taskId`), and the full card object in
      `config-snapshot.json` (`configSnapshot.task`). Critically, the **copied prompt block** the user pastes to point the
      agent (`buildTaskEvidencePromptBlock`) names the exact card: `Task: <title> (<id>)` + the bundle path. So the user's
      concern ("today's bundle is workspace-scoped — may need to add the card ref") is **already resolved**: the card ref
      is present + unambiguous in every artifact a diagnosing agent reads, and in the copyable prompt. *(Deferred, minor:
      the per-**project** evidence path at [project-navigation-panel.tsx:605](web-ui/src/components/project-navigation-panel.tsx#L605)
      is project-scoped by design; no card-ref concern there. Not re-audited in depth — the user's ask was the card ref.)*
- [~] **Live-run it + prove it surfaces real issues — PROVEN (2026-06-27).** The one-shot rail was run live many times
      this session and **directly surfaced real issues that the targeted tests missed, each then fixed**: (1) the
      **server-tier sluggishness/freeze under parallel load** — root-caused via the rail to inline health detection +
      synchronous git on the hot path (fixed: 41–60 s → 0.2 s, plus the deeper async-git fix); (2) the **activity badge
      counting the wrong session source** (terminal vs the Docker-isolated NKlein agents — caught only by a live run, then
      fixed); (3) the **parallel-LLM reality** (LM Studio serial-gated, much of the perception was the now-fixed hang). So
      the rail demonstrably uncovers dormant issues. **Still owed:** the *sustained, unattended* window on the always-on
      runner + a regular together-review of the accumulated `rail-*.json` harvest (depends on the durable runner above).
- *(cross-links)* §5.O (dev-test registry + output-robustness sweep — the rail's content) · §5.V (the e2e oracle the
      rail operationalizes; hidden-split/repeat-run/failure-injection harnesses it should exercise) · §5.Z (cross-model
      coverage — the rail naturally rotates models) · §5.AF (durable lease scheduler + unified admission + the ledger
      that stores the evidence) · §5.AG (operator board-health + "what was tried" surface reads the rail's evidence) ·
      §5.T (configurable generous guardrail timeouts) · §5.W + §6.5 (concurrency + endpoint scheduling) · §6.11
      (`collect evidence` infra this builds on).

### 5.AJ — Product UX overhaul: the two-layer interface + a first-class Mission *(2026-06-27, user — PARKED INPUT for the later UI overhaul; NOT active. Details integrated inline.)*
> **The user provided a UI/UX audit and asked to capture the convincing parts as INPUT for a later overhaul — NOT as
> active tasks** (everything here is `[-]`, so it doesn't inflate the ready count; promote when the overhaul starts).
> **My take (verified against the code):** the audit is strong + accurate — !Klein has the hard power surfaces (board,
> chat sidebar, card detail, watch panel, diff/files, focus chain, second-opinion review, merge history, planning DAG,
> sandbox/queue status) but exposes them as **machinery** ("configure tasks/models/refs/agents/logs/panels") instead of
> the product promise: **"drop a huge goal → I plan it, split it, run agents, verify, review, merge, show you the movie,
> and hand you a delivery report."** Nothing below is rejected outright; my adaptations + cautions are noted inline.
- [-] **Two-layer interface (the core fix).** A SIMPLE layer + a POWER layer via progressive disclosure. **Simple:** one
      obvious goal intake — empty board reads "What do you want !Klein to build?", primary action **Plan and run**,
      secondary **Plan only**, with files / issue-import / branch-ref / model / delivery-mode tucked under **Advanced**. A
      novice should NOT need to understand cards, refs, agents, models, review lanes, focus chains, or Docker. **Power:**
      everything deep stays, behind inspector tabs / a command palette / advanced sections / a "Raw" logs toggle;
      settings, dev-test, and model telemetry hidden unless needed. *(My caution: progressive **disclosure**, not removal
      — the user base is power-leaning; keep the board visible as the swarm map, just put the simple intake above it.)*
- [-] **First-class MISSION abstraction (above cards) — the audit's "missing big idea".** A Mission = the user's big
      idea; cards are the implementation details generated underneath it. **!Klein ALREADY has the substrate** (a
      decompose seed → a DAG of generated cards via `generatedFromPlan`), so *formalize that decompose-root + its DAG as
      a first-class Mission* the UI tracks: goal · plan graph · active agents · blockers · produced artifacts · final
      delivery report. Gives novices ONE thing to understand while power users still drill into every card / model /
      tool-call / diff / review. *(My adaptation: do NOT add a parallel data model — promote the existing decompose-root
      card + its DAG into the Mission view; the data is already there.)*
- [-] **Narrated agent-story timeline (the "movie") as the DEFAULT card/mission detail.** Replace the equal-weight
      specialist-panel debug dashboard ([card-detail-view.tsx](web-ui/src/components/card-detail-view.tsx)) *default* with
      a clean narrated timeline — e.g. "Architect read the repo + drafted a 7-card plan → Worker 2 edited tempo-map.ts →
      tests failed: 3 timing edge cases → Worker fixed them → Reviewer requested one change → Worker patched → Reviewer
      approved → Merged." Compose the EXISTING pieces — AgentWatchPanel (§6.8), focus chain (§5.N), activity surface, diff
      viewer, second-opinion review (§5.K), merge history (§5.G) — into ONE story view; raw details one click away. This
      is the "impressive to watch" win.
- [-] **Delivery report at goal/mission completion.** Package the result like a senior engineer's handoff: what was
      built · files changed · tests/checks run · screenshots/demo evidence when relevant · reviewer verdict · known
      limitations · suggested next improvements; action buttons **Open result · Run app · Continue · Create follow-up
      cards**. Today the board shows work HAPPENED; it should also package the OUTPUT. Ties §5.L (delivery) + §5.AG.
- [-] **Specific UI reframes (machinery → mission language).** "New task" → **"New goal" / "What should !Klein build?"**;
      "Start in plan mode" → **removed from normal UI** (planning is already the default — §5.B routes every started card
      through Planning/Refinement); "Worktree base ref" → **"Start from branch/ref" under Advanced**; model picker →
      **Advanced**, default **"Auto-select best local model"** (ties §5.AB); concurrency cap → **"Parallel agents"**, not
      front-and-center; dev-test project card → **Developer-mode only** (ties §5.W left-sidebar mode-gating).
- [-] **One unified goal-intake — kill the "two brains".** The audit's sharpest structural point: the "crazy idea" entry
      is split between the board create-task dialog ([task-create-dialog.tsx](web-ui/src/components/task-create-dialog.tsx))
      and the chat autonomous-run bar ([chat-sidebar.tsx](web-ui/src/components/chat/chat-sidebar.tsx)) — two ways to start
      a mission, so the product "feels like it has two brains." Converge on ONE goal intake (the simple-layer "What should
      !Klein build?") that drives BOTH decompose-to-board AND the §5.0.1 autonomous driver underneath.
- [-] **Recommended layout.** Left: projects only + subtle project health. Center-top: a big **goal/mission bar +
      current mission status** (replacing the telemetry-reading board header, [kanban-board.tsx](web-ui/src/components/kanban-board.tsx)).
      Center: the board as the **swarm map**. Right: the §5.M sidebar becomes **mission control** (chat + watch stream),
      not just chat. Detail drawer tabs: **Summary · Watch · Output · Plan · Diff · Logs**. Settings / dev / test /
      model-internals: advanced/hidden.
- *(cross-links)* §5.J (the visual restyle — same future overhaul, deferred) · §5.M (chat sidebar → mission control) ·
      §5.0.1 (the autonomous goal driver → the simple intake) · §5.AG (operator-UX surfaces) · §6.8 (cockpit) · §5.K
      (review) · §5.N (focus chain) · §5.B (planning-as-default) · §5.AB (auto model selection) · §5.L (delivery report) ·
      §5.W (settings + dev-mode gating). **When the overhaul starts, promote these `[-]` items to active `[ ]` work.**

### 5.AK — Parallel-dispatchable architecture + the work-package discipline (contributor ⇄ product) *(2026-06-27, user — distilled & integrated from a parallel-backlog architecture audit; reason-deep, accept/reject with judgment)*
> **Thesis.** Implementation throughput here is gated by **merge friction and module ownership**, not by a lack of agents
> or a queue library. The lever is to make !Klein's repo **dispatchable** — explicit bounded work packages behind stable
> ownership boundaries, with executable verification gates and sequential trunk integration — so substantial pieces can
> be fanned out to subagents safely and land cleanly. **The same structure is the blueprint for !Klein's OWN multi-agent
> mode over user projects** (direction 2): a central manager builds a dependency graph, delegates to isolated workspaces,
> and integrates through branch/merge + tests ("centralized asynchronous isolated delegation"). **Small local models
> need this structure even MORE than I do** — they cannot improvise out of an under-specified or tangled task, so the
> bounds, gates, and the bigger-model rescue path (§5.AB) are what keep them from grinding into an unrecoverable hole.
>
> **What I accepted / rejected (judgment, not blind adoption).** ACCEPTED: work-package contracts, the module-ownership
> classes, path-owned verification, merge-readiness packs, the low-risk structure refactors, a first-party workflow
> kernel, and ledger-as-event-log (already §5.AF). REJECTED / ADAPTED: (a) aggressive 8–10-writer parallelism as a
> default — this env's worktree hazards make **solo-sequential the safe default**; delegate only **Green** packages;
> (b) adopting an external engine (Temporal / Hatchet / Ray / DBOS) now — use as **design references only** (local-only +
> Docker-isolated needs first-party policy regardless); (c) a multi-week "pause-the-world refactor" front-load — instead
> **fold the refactors into the normal incremental loop**; (d) the multi-person org roles — I am the **solo lead-coder**.
>
> **The contributor ⇄ product symmetry (the integrating insight — build the contributor seams so they later BECOME product surfaces):**
> - Work Package Contract (how I scope a subagent)        ⇄  the richer **decompose card/task schema** (write-scope · interfaces · acceptance) !Klein hands its agents
> - Merge-Readiness Pack (what a subagent returns)        ⇄  the **result-branch + evidence bundle** an !Klein agent returns
> - Lead-coder = sole trunk integrator                    ⇄  the trusted-runtime **MergeBroker** that applies result branches
> - Verifier subagent (read-only checks)                  ⇄  the §5.K **reviewer** role
> - I exhaust my options, then ask my user (with options) ⇄  Layer-1 **automatic** ladder (all approaches × all loaded models) → Layer-2 **user escalation + suggestions** (§5.AB; a bigger model is one option)
> - Agent Attempt Ledger = my evidence trail              ⇄  the §5.AF ledger = !Klein's durable **workflow event log**
>
> **References (inlined for self-containment):** CAID / effective async SWE-agent coordination (arxiv 2603.21489) · SASE /
> agentic SE merge-readiness + consultation packs (arxiv 2509.06216) · durable-workflow *design references only* —
> Temporal (durable event history / replay), Inngest + DBOS (step memoization / resume), Restate (idempotent keys),
> Hatchet (Postgres tasks/workers), BullMQ flows (dependency trees), Ray (distributed eval later). Do **not** adopt an
> engine before the first-party `WorkflowCommand`/`Phase`/`Effect` kernel + durable-queue interface exist (§5.AF).

#### Direction 1 — make !Klein dispatchable (so I can fan out substantial work to subagents)

> **Reference maps + templates (inlined — this is the operating discipline for any fan-out).**

- **Module ownership map — parallel-write safety classes (classify every change site BEFORE assigning):**
  - **GREEN — safe to fan out in parallel** (disjoint, pure/helper/test-only, or one self-contained leaf): `src/core/*`
    pure helpers, `test/**`, `web-ui/src/**` leaf components/hooks with no shared-shell edit, new `*-*.ts` collaborators,
    `scripts/verify-*.mts`.
  - **YELLOW — parallel only with lead-pre-assigned insertion points** (touches a shared barrel / contract / config /
    query client): `src/core/*-api-contract.ts`, `src/config/runtime-config.ts` field additions, `src/trpc/app-router.ts`,
    `web-ui/src/runtime/runtime-config-query.ts`, the design-token / shared-UI primitives.
  - **RED — serial write, ONE owner at a time** (runtime lifecycle, the monoliths, the source-of-truth docs):
    `src/nklein-agent/nklein-task-session-service.ts`, `src/server/runtime-server.ts`, `src/server/runtime-state-hub.ts`,
    `src/nklein-agent/nklein-session-runtime.ts`, `web-ui/src/components/runtime-settings-dialog.tsx`,
    `web-ui/src/App.tsx`, and `todo.md` / `done.md` / `CHANGELOG.md`. Use parallel **explorers/verifiers** around these,
    **never** parallel writers.
- **Work Package Contract** (hand one to every delegated subagent — this is what turns a vague todo into parallel-safe work):
  `Intent` (one paragraph: the backlog outcome that should exist after it lands) · `Backlog link` (todo §; prereq /
  blocked packages) · `Write scope` (allowed path globs) · `Forbidden` (globs it must NOT touch — esp. the Red files +
  docs) · `Interfaces` (inputs it may call; outputs it exports; public APIs it must NOT change) · `Acceptance` (the exact
  gates from the manifest below) · `Evidence` (what its final message must report) · `Docs` (default **NO** — propose
  exact bullets for the lead to apply).
- **Verification path→gate manifest** (each worker runs the **minimal correct set**; the lead runs the **union once** at
  integration — for 8–10 packages this cuts verification wall-time ~60–80% vs everyone rerunning everything):
  ```
  src/core/**                          → typecheck · biome · test:fast (focused core)
  src/core/*-api-contract.ts           → + test:contract · web:typecheck
  src/config/**                        → + runtime-config tests · test:contract (config) · web:typecheck if schema changed
  src/trpc/**                          → + test:contract (relevant) · web:typecheck
  src/server/**                        → + runtime/server + responsiveness tests · test:contract
  src/nklein-agent/**                  → + test:fast · protected · targeted session/runtime tests · live Docker smoke if sandbox/model path changed
  src/state/**                         → + persistence / on-disk-format contract tests
  web-ui/src/components/runtime-settings* → web:typecheck · settings-dialog oracle · web:build · focused Settings Playwright
  web-ui/src/components/kanban*         → web:typecheck · board tests · web:build · focused board Playwright
  web-ui/src/App.tsx                   → web:typecheck · web tests · web:build · smoke e2e
  test/protected/**                    → HUMAN approval required (prime directive #5)
  ```
- **Merge-Readiness Pack** (each subagent returns this so the lead can integrate in dependency order without re-deriving):
  `Package` · `Branch/patch` · `Changed files` · `Behavior changed` (user / internal / none) · `Tests` (command → result)
  · `Invariants checked` (local-only · Docker isolation · no host-path leak · ≥32k floor · protected untouched) ·
  `Integration risk` (likely conflicts · migration / back-compat · live-verification debt) · `Proposed todo.md bullet(s)`
  · `Proposed CHANGELOG entry` (only if release-note-worthy).

> **Dispatch-enabler infra (landable now — low-risk, each makes future fan-out safer/faster):**
- [x] **First-class `test:contract` gate — DONE (2026-06-27).** Added `"test:contract": "vitest run test/contract"` to
      `package.json` (it's the best merge-safety layer — spawned backend, isolated home, free ports, raw HTTP/WS, mock
      LLM, on-disk seams; was hidden inside the broad `test`). Named in the path→gate manifest above for every tRPC /
      config-schema / persistence / task-lifecycle / settings change. Verified: runs green — 18 files / 272 tests.
- [ ] **`web:e2e:smoke` canary — bigger than it looks; needs a hermetic mock foundation first (2026-06-27 investigation).**
      Goal: a seconds-long Playwright smoke that **never reuses a stale dev server** (the stale-`4173`-reuse cascade burned
      a 200s false failure), checking app boot / no Vite overlay / board render / Settings open. **What the investigation
      found (so the next attempt doesn't re-walk it):** (1) `npm run dev` is **vite-only** and proxies `/api/*` to the
      runtime on `:3484` — a frontend-only boot renders nothing; (2) a *fresh* runtime (isolated HOME) boots into
      **onboarding**, not a board, so even a real backend won't render the board without **seeded** state; (3) that's why
      the existing specs (`settings.spec.ts`, `chat-*.spec.ts`) **mock** the backend via `page.routeWebSocket` (inject a
      board snapshot) + `page.route('/api/trpc/*')` — but **there is no shared helper**, each spec re-inlines a huge
      `WS_SNAPSHOT` + `MOCK_CONFIG`, and **`MOCK_CONFIG` has already drifted stale** (e.g. missing `concurrencyDefaults`/
      `concurrencyOverride`), so the unmocked `smoke.spec.ts` is backend-dependent and the mocked specs rot. **So the real
      work, in order:** (a) **a shared hermetic e2e-mock helper** — one schema-synced `buildMockRuntimeConfig()` +
      `buildBoardSnapshot()` (kept current with `runtimeConfigResponseSchema`) that every spec consumes (de-stales them
      all + is the foundation); (b) a **mocked boot-smoke** spec on top of it (board columns + no `vite-error-overlay` +
      settings opens); (c) a **`playwright.smoke.config.ts`** with `reuseExistingServer:false` + `--strictPort` on a
      dedicated port. **Config gotcha (hit + confirmed):** the port must be a **stable module constant** — Playwright
      re-imports the config in worker processes, so a `Math.random()` port desyncs the webServer's port from the workers'
      `baseURL` → every test gets `ERR_CONNECTION_REFUSED`. Keep the full Playwright suite for targeted/nightly/live.
      *(Also fix `test:protected` + `test:integration` alias/port flakiness as infra, not features.)*

> **Structure-refactor ladder (ordered by fan-out ROI; each independently shippable + test-backed; folds into §5.U's
> no-monolith goal — do them in the normal incremental loop, not as a pause-the-world front-load):**
- [x] **Web runtime query-client split (barrel-preserving) — DONE (2026-06-27, the first dispatch enabler).** Split
      `web-ui/src/runtime/runtime-config-query.ts` (532 lines / 56 tRPC-wrapper fns) into 7 domain modules under
      `web-ui/src/runtime/queries/{config,provider,model-registry,mcp,plan-artifacts,task-control,dev-test}.ts`; the
      original path is now a 7-line **barrel** (`export *`) so **zero callers changed**. Verified: biome + web typecheck
      (the barrel resolves for every importer) + full web vitest (742) + `web:build` (clean bundle). Creates independent
      UI lanes immediately — a settings/provider/task-control change no longer competes in one 530-line file.
- [~] **Runtime-config facade split (Yellow → unblocks config-heavy work).** Split `src/config/runtime-config.ts` (2306
      lines) into `runtime-config-{types,defaults,normalize,change-fields,store}.ts` behind the existing public facade.
      Preserve every import + all corrupt-vs-missing / defaulting / migration behavior; lock with the round-trip +
      old-config-load tests. Pairs with the settings draft boundary. **Types slice DONE (2026-06-27):** the public type
      surface (`RuntimeConfigState` + `RuntimeConfigUpdateInput`) **and** the two on-disk file-shapes
      (`RuntimeGlobalConfigFileShape` / `RuntimeProjectConfigFileShape`) are extracted into
      [src/config/runtime-config-types.ts](src/config/runtime-config-types.ts); the public pair is **re-exported** from
      `runtime-config.ts` so every existing importer of `./runtime-config` is unchanged (root tsc + biome clean; the 64
      config-suite tests green). **Prompt-templates slice DONE (2026-06-27):** the 4 big git-delivery prompt-template
      strings (~78 lines: the LEGACY_HOST_WORKTREE_* pair + the DEFAULT_COMMIT/OPEN_PR pair) moved verbatim into
      [src/config/runtime-config-prompt-templates.ts](src/config/runtime-config-prompt-templates.ts) and imported back —
      byte-identity confirmed (the removal Edit matched the originals exactly) and the on-disk-format contract test
      (asserts the template defaults) + the 64 config tests stay green. **Remaining slices:** the small DEFAULT_* value
      consts → `runtime-config-defaults.ts`; the ~800-line normalize/build-assembly block → `runtime-config-normalize.ts`;
      the change-field registry → `runtime-config-change-fields.ts`; load/save/update → `runtime-config-store.ts` (each a
      careful slice — config defaulting can regress quietly, so verify round-trip + corrupt-vs-missing each time).
- [ ] **Settings draft boundary (highest-churn win).** Extract a behavior-owning Settings **draft model** from
      `runtime-settings-dialog.tsx` (a Red monolith every new setting competes inside): typed draft state · init/reset ·
      dirty detection · validation · save-payload construction, as `web-ui/src/features/settings/{settings-draft,
      use-runtime-settings-draft,settings-validation}.ts`. Keep the dialog as composition; verify against the existing
      settings-dialog oracle BEFORE extracting visual sections. After this, independent settings sections (and the §5.W
      regroup) can be assigned separately. *(Extract behavior, not thin JSX wrappers — per AGENTS.md.)*
- [x] **tRPC router composition — DONE (2026-06-27).** All four sub-routers extracted from `app-router.ts` into
      `src/trpc/routers/{runtime,chat,workspace,projects}-router.ts`, each a `build<X>Router(t[, workspaceProcedure])`
      factory built on the shared `t` (exported as `RuntimeTrpcBuilder` + `RuntimeWorkspaceProcedure`; the factories'
      back-imports are **type-only** → no runtime cycle). app-router went **1252 → 546 lines** (now the t-setup + the
      `RuntimeApi` context interface + a 4-line composition). The big `runtime` slice (104 procedures / 104 schemas) was
      a **byte-exact move** (extract the block bytes → wrap in the factory → line-replace → prune the moved schema
      imports) so nothing was retyped. Procedure names + contract surface unchanged — verified at every slice by
      `test:contract` (272, real tRPC endpoints) + **web tsc** (the inferred `RuntimeAppRouter` type is identical, so the
      web client is unaffected). Endpoint additions now land in the relevant sub-router file instead of colliding in the
      monolith. **First slice DONE (2026-06-27):**
      the **`projects`** sub-router (10 procedures) extracted to
      [src/trpc/routers/projects-router.ts](src/trpc/routers/projects-router.ts) via a `buildProjectsRouter(t)` factory
      that takes the shared `t` (exported from app-router as `RuntimeTrpcBuilder`); the back-import is **type-only**
      (erased — no runtime cycle), the procedures are byte-identical, and the moved schema imports were pruned from
      app-router. Verified the contract surface is unchanged: root tsc + biome, **`test:contract` (272, real tRPC endpoints
      incl. projects)**, and **web tsc** (the inferred `RuntimeAppRouter` type is identical, so the web client is
      unaffected). **`chat` sub-router ALSO DONE (2026-06-27):** the 10 chat procedures (incl. the SSE `streamMessage`
      subscription) → [src/trpc/routers/chat-router.ts](src/trpc/routers/chat-router.ts) via `buildChatRouter(t)`, same
      pattern + same verification (root tsc + biome + test:contract 272 + web tsc), pruning the chat schemas / stream type
      / `createAsyncQueue` from app-router. **`workspace` sub-router ALSO DONE (2026-06-27):** the 14 git/workspace
      procedures → [src/trpc/routers/workspace-router.ts](src/trpc/routers/workspace-router.ts) via
      `buildWorkspaceRouter(t, workspaceProcedure)` (app-router now also exports `RuntimeWorkspaceProcedure`); the two
      local schemas (`optionalTaskWorkspaceInfoRequestSchema` / `gitSyncActionInputSchema`) moved with it, and the
      git/workspace schemas + now-unused `z` were pruned from app-router; same verification (test:contract 272 + web tsc).
      **Remaining:** the big `runtime` sub-router (the bulk — most of the procedures) the same way; gate with
      `test:contract` + web tsc.
- [~] **Workflow kernel seed + durable-queue interface (enriches §5.AF — the bridge to the product control plane).**
      **KERNEL SEED DONE (2026-06-27):** pure `WorkflowCommand` / `WorkflowPhase` / `WorkflowEffect` + a **total** reducer
      `applyWorkflowCommand(phase, command) → { phase, effects }` ([src/core/workflow-kernel.ts](src/core/workflow-kernel.ts))
      over the task lifecycle (admission → the 3-stage queue ladder [board-capacity / endpoint / sandbox] → planning →
      implementing → acceptance → review → ready-for-delivery → delivering → completed, with `failed`/`cancel` honored
      from any active phase and unhandled commands a safe no-op hold so events can replay). **No behavior change + NOT
      wired** — the board mutation helpers stay the single source for lane changes; the kernel is the orthogonal durable-
      scheduler view (finer-grained than a board column). 10 unit tests; tsc+biome green. **PHASE→BOARD BRIDGE DONE
      (2026-06-27):** `workflowPhaseToBoardColumn(phase)` ([src/core/workflow-board-bridge.ts](src/core/workflow-board-bridge.ts))
      — the canonical (non-lossy) direction mapping each phase to the board column it surfaces as (queue ladder + planning
      → Planning; implementing/acceptance → In Progress; review→delivery → Review; completed/cancelled → their lanes;
      failed parks in In Progress), so the scheduler can keep the board in sync from a phase; 4 tests. **Still owed:** put an
      durable queued-start store with restart replay, and move the queue-drain / auto-start cascades out of
      `runtime-server.ts` into a `TaskWorkflowService` driven by this reducer (with characterization tests). *(NOTE: the
      **interface already exists** — `RuntimeTaskStartQueue` in
      [src/trpc/runtime-task-start-queue.ts](src/trpc/runtime-task-start-queue.ts), an in-memory `enqueue`/`takeReady`/
      `remove`/`size` queue whose `QueuedRuntimeTaskStart` already carries `attempts`/`nextAttemptAt`/`lastError` for
      backoff, and its **durable persistence format is now DONE (2026-06-27):** `queuedRuntimeTaskStartSchema` (drift-
      guarded against `QueuedRuntimeTaskStart`) + `serializeQueuedTaskStarts` / `parseQueuedTaskStarts` (JSONL,
      skip-invalid via `parseValidatedJsonl`) in the same module — 3 round-trip/skip tests; **and the file-I/O wrapper is
      now DONE (2026-06-27):** `loadQueuedTaskStartsFromDisk` / `saveQueuedTaskStartsToDisk`
      ([src/trpc/runtime-task-start-queue-store.ts](src/trpc/runtime-task-start-queue-store.ts)) — a best-effort
      single-JSONL snapshot store (creates parent dirs, overwrites on save, empty on missing — mirrors the ledger store),
      4 temp-dir round-trip/overwrite tests. **And the queue accessors are now DONE (2026-06-27):** `snapshot()` (every
      queued start across all workspaces, for persisting) + `hydrate(entries)` (replace the in-memory queue from a
      snapshot, **preserving** each entry's `queuedAt`/`nextAttemptAt`/`attempts` so a restored delayed start stays held
      until its original due time, not reset to ready-now) on `RuntimeTaskStartQueue`, with the `scheduledTaskStartQueue`
      wrapper delegating both; 2 added queue tests. **AND THE RUNTIME-SERVER WIRING IS NOW DONE (2026-06-27) — the
      durable queued-start store is functionally complete:** `runtime-server.ts` computes one global snapshot path
      (`resolveNkleinRuntimeHomePath(homedir())/task-start-queue.jsonl`), passes the queue an **`onChange`** callback that
      `saveQueuedTaskStartsToDisk(snapshot)` on every mutation (the change-emitting is centralized in the queue itself —
      enqueue/remove-that-removed/takeReady-that-took/clearWorkspace-that-cleared — so even the direct base-queue
      `clearWorkspace` call persists, no missed site), and at boot **awaits** `loadQueuedTaskStartsFromDisk` →
      `replayPersistedQueuedTaskStarts` (a pure helper: hydrate + re-arm a drain per restored start at its original due
      time, scheduler keeps the earliest per workspace). The replay is awaited **after** `runtimeApi` is built and
      **before** the function returns, so a 0ms drain timer can never fire before `runtimeApi` exists and the read
      completes before the server serves any enqueue (no snapshot clobber). +3 queue tests (onChange-only-on-real-change;
      replay arms a drain per start at the right delay; empty-snapshot no-op). tsc+biome+`test:fast` (2435) green.)* This
      was also exactly the §5.AF "durable long-run job scheduler" item — one arc, now landed.
- *(already tracked in §5.U — not duplicated here: the `runtime-settings-dialog.tsx` JSX decomposition, the
  `nklein-task-session-service.ts` collaborator extraction, and the monolith inventory.)*

#### Direction 2 — guide !Klein's OWN agents with the same discipline (small models need it MORE)
> The product mirror of direction 1: !Klein is the lead-coder over a swarm of small-model workers on user projects. The
> bounds + gates that make MY fan-out safe are what keep a 7B worker from wandering off-scope or into an unrecoverable
> tangle. The escalation path (the automatic across-all-loaded-models ladder → user escalation with "get through the
> wall" suggestions) is specced in §5.AB; the rest:
- [ ] **Decompose emits work-package-shaped cards.** !Klein's decomposition should produce cards carrying the
      contract's bounds — **write-scope / forbidden paths / interfaces / acceptance shape** — not just a prose prompt, so
      a small worker stays in-bounds by construction (and overlapping cards are conflict-classified Green/Yellow/Red like
      direction 1). Ties §5.B (decomposition) + §5.N (focus chains as the worker's checklist).
- [ ] **Path-owned acceptance gates per card.** The product mirror of the verification manifest: each card declares the
      executable checks that prove it (build/test/typecheck/acceptance), the trusted runtime runs them on the result
      branch before the §5.K review, and a failing gate is a structured outcome the worker (or, once the automatic
      ladder is exhausted, the user escalation) acts on — not a silent pass. Ties §5.L (delivery gate) + §5.AF (gate
      events in the ledger).
- [ ] **Trouble-awareness — agents must recognize approaching-unrecoverable states and escalate BEFORE grinding in.**
      Generalize the guards we already proved we need (the `core.bare` fixture-flip, the read/tool-call loops, host-path
      confusion in the sandbox) into a first-class **stuck/at-risk signal** the worker and the runtime both watch; when it
      fires, **drive the §5.AB escalation path** (finish the automatic across-models ladder, then escalate to the user
      with suggestions) rather than burning the retry budget. The whole point: a
      small model must **not** be left to thrash its way out of a hole it cannot climb — !Klein detects the hard limit and
      escalates to the user with options (one of which is making a stronger model available to analyze + guide). Ties
      §5.AA (detection) · §5.AB (the escalation path) · §5.AG (the surface).

### 5.J — LATER (deferred by decision)
> Everything here is intentionally `[-]` (deferred / parked by decision) — kept for traceability, not counted as ready work.
- [-] **DEFERRED INDEFINITELY** *(2026-06-25 clarification pass — user: "defer indefinitely")*: **Distinct look & feel from
  the Cline-Kanban origin** *(raised 2026-06-24)* — give !Klein a visual identity a bit different from the fork's
  inherited look. The current look is great; revisit the distinct-identity restyle much later. **Do NOT produce restyle
  mockups now.** (When revisited: refined/modern/professional dark, Linear/Raycast restraint; I mock 2-3 directions, user
  picks; keep the dark-theme + Tailwind-token system; clarify palette/density/typography scope before touching
  `globals.css @theme`.)
- [-] **LATER: In-sandbox command operator** — a small in-image command runner with structured stdout/stderr/exit/error
  + typed next-step guidance + clearer UI status than the generic SDK `bash` bridge.
- [-] **LATER: Linux & Windows first-class runtime** — keep Docker mandatory for every agent shell/FS action; verify
  per-OS Docker availability, sandbox build/run, endpoint discovery, browser/runtime launch, path/PTY/Git/mount
  semantics, file-picker fallback. Must not weaken strict isolation. (A dev-only `start.bat` exists.)
- [-] **PARKED** (cloud-dependent; re-enable when cloud is revisited or a strong local model is proven): `nklein-advisor.ts`,
  `nklein-model-research.ts`, `nklein-team-delegation.ts`/`-team-progress.ts`, `nklein-web-research-tool.ts` (also
  incompatible with `--network none`). They compile as parked helpers + render no local-only UI.
  (`nklein-trusted-auto-merge.ts` self-merge is NOT parked — allowed + configurable; §5.L.)

### 5.P — LAST: full Python backend port *(raised 2026-06-23; bottom of the list)*
> **SUPERSEDED / deferred indefinitely (owner decision 2026-06-26, via §5.X Phase 2): NO Python port — !Klein stays
> all-TS.** This section is kept for history (the original rationale + open questions below mirror §5.X Phase 2's
> now-moot list). No work items here.
>
> **Goal (tentative):** port the backend to Python so practically no TS remains (web-ui stays TS; some
> boundaries/SDKs may be cheaper to keep — not locked to "zero TS"). **The very last task** — don't start until
> nearly everything else is done; expect a lot of clarifying questions first. Rationale: a battle-proven, well-tested
> tool ports near-mechanically (the test suite is the spec), plausibly a largely autonomous overnight effort once
> reached. Open questions then: exact TS/Python boundary (SDK boundary, Docker sandbox manager, tRPC contract,
> runtime server — what moves? what does web-ui talk to?); reuse `core-py` as seed vs fresh; test-suite mapping;
> migration strategy (strangler vs big-bang); perf/packaging/Docker implications.

---

## 6. SHIPPED — already implemented (do not rebuild) → moved to [done.md](done.md)

> The full shipped archive (§6.1–§6.13, "what exists so you don't rebuild it") now lives in **[done.md](done.md)**,
> alongside the completed `§5` sections. Section ids are unchanged, so every "§6.x" reference in this file resolves
> there. This pointer stays so the numbering reads continuously (§5 → §6 → §7).

---

## 7. Success criteria (the bar for "done")
1. Cloud is unreachable; a cloud-pinned card hard-stops; re-enabling is one reviewed code change.
2. No oversized prompt ever leaves; over-budget turns compact or stop.
3. The loop is stable: no 1s timeouts, no restart-config failures, no retry storms.
4. ≥32k enforced everywhere; budgets/compression scale to the local window with no hardcoded constants.
5. A multi-card DAG auto-starts unblocked cards under the cap, serializes per endpoint, parallelizes across
   endpoints, never thrashes the machine.
6. **A single high-level prompt yields a Planning-lane DAG of local-feasible cards that get created and flow
   into execution — with strict isolation ON.** *(DAG-under-isolation + a started card verified; fully-automatic
   unblocked-card swarm start is the remaining end-to-end target.)*
7. Context is a segmented green→red bar against the real effective window.
8. Parallel cards never collide on shared files; result-branches merge in dependency order; runs are budgeted,
   one-click stoppable, stalled tasks auto-park.
9. The board is a live cockpit (per-agent status, MCSR, DAG + fit badges, diagnostics, first-run wizard) — all
   cloud-free.
10. A loose idea triggers clarifying questions, yields a reviewable plain-language plan, adapts on
    execution-discovered gaps.
11. Nothing built since branching from `main` is invisible in the UI (coverage matrix has no unmapped entry).
12. **Every agent shell/FS action runs in Docker; no host fallback; Docker-down fails closed.**
13. Upstream-clean: re-pulling the SDK contracts needs no reverts.

---

## 8. Superseded decisions & direction changes (history — so nothing is lost or re-litigated)

- **Cloud went from "normal option" → banned.** The original `plan.md` targeted 8–16k small models and treated
  cloud as always-available. One day of telemetry showed cloud defaulting to `anthropic/claude-sonnet-4.6` and
  causing 678× "Insufficient balance", 227× "1.1M-token prompt exceeds 1M limit", 227× "1s timeout", 453×
  "No previous session config". Result: **LOCAL ONLY + ≥32k minimum** invariants (§1). All cloud paths are
  hidden/parked, not deleted, so a future single-file re-enable is possible.
- **Host worktrees → Docker clone-in/patch-out.** The early model ran agent tools on host task worktrees; replaced
  by **strict Docker isolation** with `nklein/tasks/<task>` result branches applied host-side. The worktree
  **creation** machinery is now retired (§5.A, 2026-06-23) — no live nklein path creates or reads a worktree; only
  legacy on-disk *cleanup* + the dead terminal-CLI-agent scaffolding remain (C7d/C7e/C8 + verification left).
- **Decomposition under isolation was briefly dark, then restored.** For a period, sandboxed planning omitted
  `decompose_project`/`expand_task`. Decision reversed 2026-06-19: they are *trusted control-plane* and stay
  host-side (they touch only plan artifacts + the board). The earlier "produce a plan in chat instead of
  /kanban-decompose" guidance is superseded.
- **Portable-state conflict model = CRDT** (not last-writer-wins-with-manual-rebase). Chosen 2026-06-21; merge
  is automatic, so no manual rebase UI is needed.
- **New direction (postdates the planning chain): grow !Klein's own core.** A local-only Python core sidecar
  (`core-py/`) and a TS native agent core (`src/agent-core/`) now provide ML + native-agent capabilities the
  vendored SDK can't (constrained/grammar decoding, own embeddings/compression/repomap, native ReAct loop). The
  vendored SDK remains one supported runtime, no longer the only one (§5.H, §6.10).
- **SDK is now vendored & de-packaged in-repo** (§6.12) — the `@nkleinbot/*` "never patch node_modules" framing
  from the predecessor docs is updated: the SDK lives under `vendor/nklein-sdk/` and is ours to edit; the
  boundary discipline (`check:nklein-boundary`, `src/nklein-agent/` plug-ins) still holds for *integration*.
- **Archival sources (folded in, then deleted):** `follow-up-1..4.md` + `findings-from-follow-up-work-4.md` were
  already declared archival by the iteration playbook — their open items live on as §5.A (isolation/worktree)
  and §5.A (UI verification); their shipped items are in §6. `follow-up-5.md`/`follow-up-6.md` open threads are
  §5.A–§5.F. `specsheet.md`/`plan.md` status is reconciled into §6 (shipped) and §5 (open). All are superseded
  by **this file**.

---

## 9. Changelog discipline
`CHANGELOG.md` is **release notes**, not a work log (pre-version: branched off `main`, no released version yet, no
back-compat burden). Record only **features / user-facing behavior changes** since the last version, plus **fixes for
bugs that already existed on `main`** — derived from the real diff, within the same change. Do **NOT** log bugs we
introduce *and* fix during this pre-version phase (they never shipped); fix them with a test only. Resume normal
"every fix" discipline once a version is released. Only open a PR / cut a release when the user asks.
