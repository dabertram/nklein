# !Klein — todo.md (single source of truth for development)

> **This is the one durable dev artifact.** It replaces `specsheet.md`, `plan.md`,
> `iteration-instructions.md`, `follow-up-1.md … follow-up-6.md`, and
> `findings-from-follow-up-work-4.md` (all consolidated here and deleted).
>
> **An agent is told only one of two things:** *"work on `todo.md`"* or *"add to `todo.md`"* — and must
> get everything it needs from this file. So: the rules of engagement, what already exists, what's left,
> and why the project is shaped the way it is all live here.
>
> **Status legend:** `[x]` shipped & verified · `[~]` partial / shipped-but-degraded · `[ ]` open ·
> `LATER:` deferred by decision · `BLOCKED:` needs the user (env is **not** a blocker — the working session has
> Docker + the `nklein/agent-sandbox` image, a live LM Studio with loaded models, and a Playwright browser, so
> Docker/browser/live-model verification is actionable here, not blocked).
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

---

## 1. Prime directives — never violate

1. **LOCAL MODELS ONLY.** `CLOUD_ENABLED = false`
   ([src/nklein-sdk/nklein-local-only-policy.ts](src/nklein-sdk/nklein-local-only-policy.ts)). No path, default,
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
4. **UPSTREAM-CLEAN SDK BOUNDARY.** Every feature is a `src/nklein-sdk/` plug-in on an official SDK socket.
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
   `## [Upcoming]` bullet. If you're adding a genuinely new capability, write its spec in §5 **first**.
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

> Everything in §6 is already shipped — listed there so an agent knows what exists and doesn't rebuild it.
> The items below are what's left. Each is independently landable.
>
> **Tracking convention (2026-06-23): use nested checkbox lists, up to ~6 levels deep, so progress is visible at a
> glance** — a multi-commit effort becomes a tree of `[x]`/`[~]`/`[ ]` sub-items, NOT prose under one checkbox. As
> work lands, **flip the nested boxes** (and tag each with its short commit hash) rather than appending DONE-notes;
> the verbose per-commit detail belongs in CHANGELOG `## [Upcoming]` + git, not here. §5.A is the worked example.

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
> - **§5.B:** Planning→In-Progress promotion = an **explicit tool the agent calls** when the plan still holds (else it
>   replans/decomposes). **Always refine, no skip-guard.** Every started card routes through Planning/Refinement first.
> - **Defaults:** **hard-flip both now** — native NKlein agent core = default runtime (SDK host = fallback path only),
>   core-py = on by default. No silent fallback; clear error if genuinely unavailable.
> - **Testing:** two layers — fast deterministic gate + real live-model/Docker punch-through e2e (new dev-test
>   projects covering all use cases + all chat functions + deep UI/UX path coverage). No CI infra yet → run the full
>   suite incl. slow e2e periodically and keep green. (New §5.V below.)
> - **§5.J look & feel:** I mock up 2–3 restyle directions as screenshots; the user picks.
- [ ] **Chat sidebar polish (2026-06-25, user)** — (a) the right chat sidebar's **inner elements must resize properly**
      when the sidebar width is dragged (currently they don't reflow). (b) **Session list relabel:** every session shows
      "New chat" — instead show a **started timestamp + message count + token count + last-message timestamp** (later: a
      generated title via embedding/LLM). Single source of truth for the label.
- [ ] **Autonomous chat agent (follow-up, later)** *(2026-06-25, user)* — the right-sidebar chat agent should do **real
      autonomous work**: focus chain, memory, tools, knowledge fetching, browser, etc. — like Cline but stronger, and
      able to use the project/card/task structure in the background (work an existing project or create a new one). Big
      follow-up; not now.
- [ ] **Review the autonomous-decisions log with the user** *(2026-06-25)* — after the autonomous run, walk through
      [.plan/autonomous-decisions.md](.plan/autonomous-decisions.md) together to confirm/adjust the below-the-bar calls.

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
    - [ ] **C8b — schema/catalog/predicate shrink (DEFERRED — coupled to plan.md §2.B)** *(investigated 2026-06-23:
          NOT safe-to-do yet)*. `usesLegacyHostTaskWorkspace(agentId)` returns true for any non-nklein id and still
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
  - [ ] **HARDEN — agents must never see host paths** *(raised 2026-06-23; from a real decompose evidence bundle)*.
        A dev-test **decompose** run leaked the host workspace path to the agent: its first reasoning + `read_files`
        input used `/private/var/folders/.../T/nklein-…/specification.md` (the host mount), not the sandbox path.
        Root: the agent's cwd/working-directory context is the host path, and surfaces (the `read_files` block error,
        evidence `summary.md`/`config-snapshot.json`) echo it. (`read_large_file`'s own result already returns the
        relative path.) Per the new AGENTS.md "agents must never see host details" rule:
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
          `resolveNKleinAgentPerceivedCwd(taskId, hostCwd)` ([src/nklein-sdk/nklein-agent-sandbox.ts](src/nklein-sdk/nklein-agent-sandbox.ts))
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
          workspace path. ([src/nklein-sdk/nklein-decomposition-tool.ts](src/nklein-sdk/nklein-decomposition-tool.ts))
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
    - [ ] only exception: user intentionally opted out of Docker isolation (future full-privileged host-agent mode).
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
      [src/nklein-sdk/nklein-task-session-service.ts](src/nklein-sdk/nklein-task-session-service.ts); reconcile
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
      ([nklein-decomposition-graph-quality.test.ts](test/runtime/nklein-sdk/nklein-decomposition-graph-quality.test.ts)).
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
- [ ] **Planning/refinement lane for *every* card before In Progress** *(raised 2026-06-24, from the start-lane fix)* —
      the user's workflow idea: **all** started cards should pass through **Planning** first (rename the lane in spirit
      to "**Planning / Refinement**"), not just decompose/plan-mode cards. In that phase the agent **re-validates the
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
- [x] **`decompose_project` malformed/empty-call recovery** — relax the boundary `inputSchema` (drop `required`,
      allow extra props) so `execute` always runs; in-handler validation returns a compact directive (names missing
      fields, "don't resend empty"); `repairJsonStringValue` recovers stringified/typo'd payloads; fuzz-tested.
      ([src/nklein-sdk/nklein-decomposition-tool.ts](src/nklein-sdk/nklein-decomposition-tool.ts))
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
- [ ] **Audio dev-test rubric** — score the audio-VST fixture against a domain rubric (preset + harness shipped;
      this is the *scoring*):
  - [ ] DSP correctness + measured phase alignment
  - [ ] groove invariants + effect-guardrail sweeps
  - [ ] full UI control coverage
  - [ ] prototype-vs-real-VST docs

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

### 5.E — Cache-key hygiene & fuzz coverage
- [x] **Telemetry/session caches keyed beyond task-id** — model-performance + knowledge-tool caches include
      `workspacePathHash`; locked by regression tests (same task id across two workspaces → two observations).
- [x] **Near-valid tool-payload fuzz suite** — extended beyond `decompose_project` to
      `expand_task`/`write_file(s)`/discovery tools; fixed `expand_task` raw-`taskGraph` parse (now uses
      `repairJsonStringValue`). ([test/runtime/nklein-sdk/nklein-tool-payload-fuzz.test.ts](test/runtime/nklein-sdk/nklein-tool-payload-fuzz.test.ts))

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
- [ ] **Plug-and-play, batteries-included Docker delivery** — ship a self-contained image + a provided
      `docker-compose.yml`: copy compose → `docker compose up` → working !Klein, bundling runtime + built web-ui +
      Python core + ALL internal models (offline for everything !Klein-internal):
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
- [x] **Embedding story decided + shipped** — `local_gguf` (nomic-embed-text-v1.5) in-process via the Python core,
      default in `runtimeCodeEmbeddingProviderSchema`, degrading to `local_lexical` when the core is off. (→ §5.I #1)
- [ ] **Promote the native agent core to DEFAULT runtime** (SDK host = automatic fallback) *(decided 2026-06-22)*:
  - [ ] build the native-core → task-execution integration (sandboxed tools, session lifecycle) — the missing prereq
  - [ ] switch default selection; keep the SDK reachable on failure
  - [ ] assert strict isolation still holds for native-core data-plane tools (thorough tests + clean fallback)
- [ ] **Python core default-ON + Settings health** *(decided 2026-06-22)*:
  - [ ] bundle/package the `core-py` sidecar so auto-start is reliable
  - [ ] auto-start on launch; keep auto-fallback when unreachable
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
      ([src/nklein-sdk/nklein-code-embeddings.ts](src/nklein-sdk/nklein-code-embeddings.ts),
      [src/nklein-sdk/nklein-embedding-model-manager.ts](src/nklein-sdk/nklein-embedding-model-manager.ts))
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
- [ ] **#4 — Multiple models per role + per-task best-fit selection** *(deep design; not a quick win)*. Today each
      role binds one model. *Decided 2026-06-22:* estimate task difficulty → match to MCSR capability/speed,
      capability-weighted (most-capable free model that fits the ≥32k budget; speed tiebreaker; easy cards take the
      fast/small model); user can pin/prefer/weight per role.
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
        ([nklein-local-llm-client.ts](src/nklein-sdk/nklein-local-llm-client.ts)) parses OpenAI SSE deltas; the chat
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
          ([nklein-local-llm-client.ts](src/nklein-sdk/nklein-local-llm-client.ts)) offers OpenAI function `tools`
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
  - LATER: the **Signal bridge** — **deferred by the user (2026-06-24): "defer signal credential based testing, we'll
        do later."** It needs a live Signal account/linking + credentials to integrate & test against, so it's not
        actionable autonomously right now. When resumed, the open spec question is the transport approach (e.g.
        `signal-cli` linked-device vs. a bridge service) — that choice shapes the bridge abstraction, so we build it
        together with the credentials rather than scaffolding speculatively now.
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
  - [ ] still owed (runtime enforcement, per mode): (a) read-only sandbox + opt-in user-mounted write paths;
        (b) the double-confirmed per-action host escape hatch UI + execution; (c) the typed host-mode phrase + audit log.
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
  - [ ] the ≥32k-floor budget integration + opt-in access-all-loaded-projects scope.
- [ ] **Private messenger bridge** — Signal linked-device via `signal-cli` (QR pair); ONLY the paired user (reject
      others); inbound → session, replies → Signal; local, no cloud broker; transport-agnostic (WhatsApp later).
- [~] **Chat UI (web-ui, separate surface)** — session list, transcript, streaming, execution-mode selector,
      memory-scope toggles, Signal pairing/status; tooltips per §5.I #5.
  - [x] **core dialog (2026-06-24)** — navbar Chat button → [chat-dialog.tsx](web-ui/src/components/chat/chat-dialog.tsx):
        session list (create/select/delete), editable session header (title/role/scope/goal), transcript with
        user/assistant/system bubbles, composer, and **token streaming** over SSE. Live-verified (Playwright).
  - [ ] still owed: an **execution-mode selector** (the modes + gate exist; the UI only sets scope/role today),
        **memory-scope toggles**, and **Signal pairing/status** (with the bridge, LATER).
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
      fingerprint** ([src/nklein-sdk/nklein-tool-call-fingerprint.ts](src/nklein-sdk/nklein-tool-call-fingerprint.ts),
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
        to the user. Added [`stripNarratedToolCallMarkup`](src/nklein-sdk/nklein-narrated-tool-call.ts) (reuses the
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
  - [ ] **OUT OF SCOPE until release-able maturity (see the section callout):** the size × family × **weight-quant ×
        K/V-quant × context** matrix, any **performance/efficiency** comparison, and large-model efficiency tuning.
        HARD, resource-heavy, premature — explicitly NOT started now; reconsidered only after the user calls a version
        release-able.
- [~] **Parallel multi-agent dev-test coverage** — DAGs that fan out widely to exercise the swarm/pool/merge/review/delivery under concurrency
  - [x] presets ship (`wide_fanout`/`deep_chain`/`mixed_dag`/`many_small`) for `nklein dev test-project`
        ([src/nklein-sdk/nklein-dev-test-project.ts](src/nklein-sdk/nklein-dev-test-project.ts)); unit-tested
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

### 5.R — Dissolve the "internal SDK" separation; one unified codebase *(raised + clarified 2026-06-23)*
> **Goal:** stop framing any runtime part as a separate "SDK" — nKlein is one product (no reusable core today).
> Remove the `src/nklein-sdk/` boundary framing so it reads as one integrated whole. **Principle:** simple, working,
> comprehensible — no fancy internals re-engineering now (the §5.P Python port supersedes the deep internals); target
> the npm dev build only. **Priority: after §5.A, before §5.H/§5.M/§5.O.** **Decided:** Layer 1 (our readable TS
> boundary) — fully inline; Layer 2 (vendored minified `@nklein/*` runtime) — keep working as an internal
> dependency, do NOT de-package the minified bundles now (deferred to §5.P).
- [ ] **Inventory + inline the layer-1 boundary** — catalog `src/nklein-sdk/`'s re-exports of `@nklein/*`, inline the
      pass-through shims (`sdk-runtime-boundary.ts`, `sdk-provider-boundary.ts`) into callers, reframe the `NKlein*`
      services/tools/event-adapter/session-runtime as plain runtime code (keep an `agent-runtime/` area), drop the
      `check:nklein-boundary` discipline. No behavior change; tests green.
- [ ] **Reframe the docs/mental model** — AGENTS.md + comments: no "SDK boundary / plug-in / reusable core" framing;
      it's the internal agent runtime. Don't churn substantive code beyond removing the separation.

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
  - [ ] still owed (needs live model + flow plumbing): connect `propose` to the architect turn + `review` to the
        §5.K reviewer model + `similarity` to the embedder; invoke after `decompose_project` applies; persist onto the
        plan `questions.md`/card; settings (global + per-project) for auto-vs-manual + the hard limit.
- [ ] **Manual-mode UI** — board-header badge + per-card indicators → clarifying dialog (≥4 options + free-text,
      multi-choice/radio per question, tooltips per §5.I #5); persist answers back through the question state.

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
        parse helper. `scheduleNKleinEndpointStart` ([nklein-endpoint-scheduler.ts](src/nklein-sdk/nklein-endpoint-scheduler.ts))
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

### 5.U — Deep architecture & code-quality review → populate the backlog *(raised 2026-06-24; re-affirmed by the user 2026-06-24 — emphasis: **no large monolith files**, SOTA architecture/structure, efficiency in **both development and runtime**)*
> **Goal (meta-task):** do a deliberate, whole-codebase reasoning pass over !Klein's architecture and structure and
> surface **every** worthwhile improvement — simplification, maintainability, performance, extensibility,
> architecture, and code quality — then **write each finding into this todo.md as its own concrete, landable item**
> so we can work through them. The deliverable of the pass itself is the populated backlog (the sub-items below get
> replaced by the real findings as they're produced). **Constraints:** every proposal must respect the §1 invariants
> (local-only, strict Docker isolation, ≥32k floor, upstream-clean SDK boundary, protected tests) — flag, don't
> violate. Don't churn for its own sake (§3): prefer changes that measurably improve navigability/clarity/perf, each
> independently shippable + test-backed. Coordinate with the already-planned structural work so we don't duplicate:
> §5.R (dissolve the `src/nklein-sdk/` boundary / one unified codebase), §5.P (eventual Python backend port), and the
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
      vendored SDK boundary (`src/nklein-sdk/` + `vendor/`), the Python core (`core-py/`), state/telemetry, and the
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
- [ ] **Then work through them** by the normal §2 loop / §5.0 priority, smallest-safe-step first, each a green commit.

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
  - [x] **first slice (2026-06-24):** extracted the 4 self-contained pure prompt parsers + `WORD_NUMBER_BY_TEXT` into
        [nklein-task-prompt-parsing.ts](src/nklein-sdk/nklein-task-prompt-parsing.ts) (`parseRequestedMinimumTaskCount`,
        `parseAcceptanceCommand`, `isDecompositionPlanningPrompt`, `isExplicitDecompositionPrompt`) + a dedicated test.
        Behaviour identical (service suite 119 green). Chosen as the lowest-risk slice (zero in-file deps, compiler-
        verified). The bigger stateful extractions (sandbox-lifecycle, timeout-scheduler, guardrail-watchdogs) remain.
  - [x] **second slice (2026-06-24):** extracted the 3 pure SDK-event readers (`readSdkAgentEvent`,
        `readSdkSessionEvent`, `readAgentResultText`) into
        [nklein-sdk-event-readers.ts](src/nklein-sdk/nklein-sdk-event-readers.ts) (importing the shared `asRecord`),
        with a dedicated test; this also made the service's local `asRecord` import dead (removed). Behaviour
        identical (service suite 109 + readers 6 green).
  - [ ] **remaining clusters are coupled (need the careful pass):** the context-budget/message-classification
        helpers share local types (`NKleinSdkContentBlock`/`NKleinSdkToolResultBlock`/`ContextHistoryTokenSegments`)
        with the service class and `stringifyToolResultContent` has an external consumer; the guardrail/repeated-tool
        helpers share `NKleinTaskRepeatedToolState` with the class. Extracting these needs the shared types moved/shared
        first (to avoid circular imports) — do in the focused decomposition pass with the stateful modules.
- [x] **Consolidate the duplicated `asRecord` helper** *(DONE 2026-06-24)* — `asRecord` was re-defined locally in 5
      `src/nklein-sdk/*` files (event-adapter, model-registry, session-runtime, task-session-service, team-progress).
      Extracted the canonical strict version (non-null, non-array object) to
      [nklein-value-guards.ts](src/nklein-sdk/nklein-value-guards.ts); all 5 now import it; removed the copies + the
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
- [ ] **Monolith-file inventory → decompose the rest** *(review-pass finding 2026-06-24; the user re-emphasized "no
      large monolith files")*. A line-count sweep surfaced the oversized files beyond the two already tracked above
      (`nklein-task-session-service.ts` ~3850, `runtime-settings-dialog.tsx` ~4095). Each below is its own landable
      decomposition item — extract cohesive sub-modules, no behavior change, locked by the existing suites:
  - [ ] **`src/commands/task.ts` (~2870 → 2751)** — the `nklein task` CLI conflates many concerns: acceptance-failure +
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
        - [ ] still TODO: the per-subcommand registration split (`registerTaskCommand` is ~470 lines) + lifting the command
              implementations (createTask/updateTaskCommand/startTask/finishTask/decomposeTaskGraph…) into per-concern
              modules. These call each other + the now-extracted infra, so they're the larger, more-entangled follow-up.
  - [ ] **`src/trpc/runtime-api.ts` (~2449 → 2314)** — `createRuntimeApi` is one giant object literal of every method
        (config, providers, MCP, tasks, chat, debug, update, …). Group methods into focused factory modules
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
  - [ ] **`src/nklein-sdk/nklein-provider-service.ts` (~1989 → 1744)** — provider selection + OAuth (nklein/oca/codex) +
        MCP settings + local-provider discovery in one. Split per provider-family / concern. (Coordinate with §5.R.)
        - [x] **slice 1 (2026-06-24):** extracted the pure discovered-model parsing/normalization (LM Studio `/api/v0|v1`
              + generic OpenAI-style payloads → `RuntimeNKleinProviderModel[]`, context-window normalization, dedupe,
              registry/fallback merges) into `nklein-sdk/nklein-provider-model-parsing.ts`. Pathnames passed as `string`
              so the module stays decoupled from the service's pathname unions. provider-service 1989→1744 (−245/−12%).
        - [x] **slice 2 (2026-06-24):** consolidated the remaining pure model helpers (`toRuntimeProviderModel`,
              `sortDiscoveredProviderModels` + private `getDiscoveredModelSortRank`) into the same parsing module.
              provider-service 1744→1723 (cumulative 1989→1723, −266/−13%).
        - [ ] still TODO: the OAuth/account token helpers (pure but *pervasively* used — extracting them is high-churn /
              low navigability gain, so likely leave in place), the model-list *fetchers* (LiteLLM/LM Studio/generic endpoint
              discovery — I/O + const/schema deps, ~340 lines, a cohesive next module but deserves fresh context), the MCP
              settings, and the launch-config resolution.
  - [ ] **`web-ui/src/components/card-detail-view.tsx` (~2384 → 2330)** — already composes `detail-panels/*`, but still holds
        many local skeleton/loading/empty/section components + resize + keyboard orchestration. Extract the
        skeleton/loading/empty panels + the bottom-terminal/workspace-changes sections into `detail-panels/`.
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
  - [ ] **`web-ui/src/components/project-navigation-panel.tsx` (~1346 → 1276)** — the Projects sidebar. Split the project
        list, the dev-scenario/self-improvement block, and the per-project actions menu.
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
        hooks), `board-card.tsx` (~1198), `use-board-interactions.ts` (~1142), `nklein-decomposition-tool.ts` (~1440),
        `nklein-session-runtime.ts` (~1421), `state/workspace-state.ts` (~1124).* Assess during the full §5.U pass.
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
- [ ] **Pipeline e2e** — decompose → plan-graph → planning/refinement lane → parallel run → review → merge, on new
      dev-test fixtures (small + large/complex), live model + Docker. Assert the tiny-piece decomposition + iteration path.
- [ ] **Chat e2e** — every chat function: sessions (create/select/delete/relabel), streaming, tools, knowledge fetch,
      memory, the (later) autonomous-work mode.
- [ ] **Board/card lifecycle UI** — start/pause/resume/move, lane reconciles (incl. the backlog→running fix), review,
      trash, drag rules — Playwright, deep.
- [ ] **Settings/config + isolation UI** — every setting persists + is wired (global + per-project override), the
      isolation status/pool UI, project-settings menu. Pair with §5.W.
- [ ] **Smoothness/perf assertions** folded into the UI e2e (no jank on board render, task start, chat streaming).

### 5.W — Expose every feature + setting in the UI; global-vs-project config; regroup *(2026-06-25, user)*
- [ ] **Feature-vs-UI audit** — systematically catalog every capability (CLI/config/runtime) and confirm it's reachable
      in the UI; surface anything that's CLI-only but should be user-facing.
- [ ] **Global vs project config + per-project overrides** — most settings global (one place); a per-project **override**
      for *almost every* global setting (global default + project override layer; clear inherits/overridden state). Define
      the override model + storage; wire it through.
- [ ] **Project Settings discoverability** — add a **visible gear on the active project** (and/or board header) for
      one-click access to the existing Project Settings dialog; keep the `⋯`-menu item too. (Dialog exists; was hidden.)
- [ ] **Regroup the settings menus** — group by concern (Models/Providers, Agents & Roles, Isolation, Guardrails, Code
      Intelligence, Advanced, …) so nothing is scattered; consistent layout. Pair with the §5.U `runtime-settings-dialog`
      decomposition when that runs.

### 5.J — LATER (deferred by decision)
- LATER follow-up: **Distinct look & feel from the Cline-Kanban origin** *(raised 2026-06-24)* — give !Klein a visual
  identity a bit different from the fork's inherited look. **Nothing fancy** — the current look is great; the user just
  wants it to read as at least slightly its own (not a re-skin project). **Details TBD with the user** (palette accents?
  density? typography? iconography? empty-states?) — clarify scope before touching the design tokens
  (`globals.css @theme`) / component styling. Keep the dark-theme + Tailwind-token system.
- LATER: **In-sandbox command operator** — a small in-image command runner with structured stdout/stderr/exit/error
  + typed next-step guidance + clearer UI status than the generic SDK `bash` bridge.
- LATER: **Linux & Windows first-class runtime** — keep Docker mandatory for every agent shell/FS action; verify
  per-OS Docker availability, sandbox build/run, endpoint discovery, browser/runtime launch, path/PTY/Git/mount
  semantics, file-picker fallback. Must not weaken strict isolation. (A dev-only `start.bat` exists.)
- PARKED (cloud-dependent; re-enable when cloud is revisited or a strong local model is proven): `nklein-advisor.ts`,
  `nklein-model-research.ts`, `nklein-team-delegation.ts`/`-team-progress.ts`, `nklein-web-research-tool.ts` (also
  incompatible with `--network none`). They compile as parked helpers + render no local-only UI.
  (`nklein-trusted-auto-merge.ts` self-merge is NOT parked — allowed + configurable; §5.L.)

### 5.P — LAST: full Python backend port *(raised 2026-06-23; bottom of the list)*
> **Goal (tentative):** port the backend to Python so practically no TS remains (web-ui stays TS; some
> boundaries/SDKs may be cheaper to keep — not locked to "zero TS"). **The very last task** — don't start until
> nearly everything else is done; expect a lot of clarifying questions first. Rationale: a battle-proven, well-tested
> tool ports near-mechanically (the test suite is the spec), plausibly a largely autonomous overnight effort once
> reached. Open questions then: exact TS/Python boundary (SDK boundary, Docker sandbox manager, tRPC contract,
> runtime server — what moves? what does web-ui talk to?); reuse `core-py` as seed vs fresh; test-suite mapping;
> migration strategy (strangler vs big-bang); perf/packaging/Docker implications.

---

## 6. SHIPPED — already implemented (do not rebuild)

> Crossed off. Grouped by area; file pointers in §1.4 / §5 / `AGENTS.md`.

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
      "under-decomposed by 10x/100x?" scope-pressure pass. ([src/nklein-sdk/nklein-decomposition-graph-quality.ts](src/nklein-sdk/nklein-decomposition-graph-quality.ts))
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
- [~] Knowledge-expansion loop *(started 2026-06-21)*: decomposition mandates knowledge-acquisition +
      scope-pressure and cards record `knowledgeDebt`. **Open:** correlate actual knowledge-tool use into a
      decomposition-quality signal — see §5.B.

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
- [ ] **Open:** browser-only live verification of the cockpit + isolation status/pool UI — see §5.A.

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
- [~] **In progress:** host-worktree retirement — creation machinery retired (no live path creates/reads a
      worktree); only legacy cleanup + dead terminal-CLI scaffolding remain (C7d/C7e/C8 + verify). See §5.A.

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
      still open — §5.B.)*
- [x] **Modern DAW Foundation dev-test preset** *(2026-06-22)* — the maximal stress fixture: a `daw_foundation`
      preset that scaffolds a project from a comprehensive, full-modern-DAW-parity spec
      ([scripts/dev-fixtures/daw-foundation-spec.md](scripts/dev-fixtures/daw-foundation-spec.md) — Ableton/FL/
      Bitwig/Logic/Cubase/Studio One/Reason/Reaper signature workflows, modular environment, MCP control, linked
      multi-window/web, SOTA quality bar) plus a real tested `timebase` seed
      ([scripts/dev-fixtures/daw-foundation/](scripts/dev-fixtures/daw-foundation/)). Scenario uses a new
      `specificationPath` so the full spec is a real file (not crammed into the prompt); the seed prompt is
      realistic ambitious-user voice demanding deep decomposition, explicit knowledge debt, heavy external-
      knowledge fetching, real DSP + golden tests, and a release-quality SOTA bar. Intended to push 9B local
      models to their limits and showcase 120B+ models. *(Domain rubric scoring still open — §5.B.)*
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
- [~] **Project portability baseline:** runtime-home stays the fast local index/cache, but board state, session
      summaries, revision metadata, and workspace identity mirror into `<project>/.nklein/nklein/workspace/` and
      can recover from that mirror. **Full portable CRDT state** (per-field LWW board CRDT
      [src/state/portable-board-crdt.ts](src/state/portable-board-crdt.ts), committed store
      [src/state/portable-board-store.ts](src/state/portable-board-store.ts), export/import with machine-local
      `nkleinSettings` stripped on import, live wiring into save/load, card-trash tombstones, per-machine
      `replica-id`, cross-machine-recovery integration test) is shipped. **Open:** schema migration + browser
      verify — see §5.F.

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
  boundary discipline (`check:nklein-boundary`, `src/nklein-sdk/` plug-ins) still holds for *integration*.
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
