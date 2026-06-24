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
> - **§5.O:** **CLI orchestrator** extending `nklein dev test-project` (+ collect-evidence/cleanup-report);
>   build the orchestrator **and** the parallel-fan-out dev-test projects **now**, sweep when the user makes the
>   quant / K-V-cache configs available.
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
  - [ ] still TODO: a dedicated isolation **empty state**, paused-card polish, and the session-service
        sandbox-lifecycle extraction (overlaps the §5.U decompose finding).
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
- [ ] **Main-board role/agent visibility** — board-header strip grouping active work by role (Architect/Worker/
      Reviewer) with click-to-focus; persist the resolved launch role on session summaries (don't rely on
      `startInPlanMode` inference).
- [ ] **Board-level merge-status history surface** (today CLI/integration-card only).
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
  - [~] Settings health line (running, model loaded, port) — safe additive piece, can land first
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
  - [ ] remaining tail: settings section headers/fields, model-registry row actions, project sidebar, §5.M chat surface

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
- [ ] **Chat session model & store** — board-independent sessions, persisted transcripts, stable ids, multiple
      concurrent; separate from board/task state (not kanban cards).
- [ ] **Chat agent runtime** — interactive multi-turn loop on the NKlein core + full tool suite; new entry point + streaming.
- [ ] **Multimodal I/O, capability-gated** — image (and audio/PDF) in/out driven off model capabilities
      (MCSR/provider metadata); degrade to text; expose modalities in UI + over the bridge.
- [ ] **Execution-access modes (default = most isolated)**
  - [ ] (a) Docker-isolated, read-only (opt-in write) to explicitly user-mounted folders only
  - [ ] (b) sandbox-by-default + double-confirmed per-action host escape hatch (each host command/edit, audit-logged)
  - [ ] (c) host-mode toggle (whole session on host) behind a typed confirmation phrase
- [ ] **Memory — human-like short/long-term** (reuse the in-process embedder)
  - [ ] short-term = lean live window via rolling summarization/consolidation (small models sustain long sessions)
  - [ ] long-term = persisted memories semantically recalled ("woken up") on associated topics; consolidate short→long
  - [ ] scope: per-session isolated by default; opt-in shared-across-sessions; opt-in access-all-loaded-projects;
        stay within ≥32k; degrade when the embedder is the lexical fallback
- [ ] **Private messenger bridge** — Signal linked-device via `signal-cli` (QR pair); ONLY the paired user (reject
      others); inbound → session, replies → Signal; local, no cloud broker; transport-agnostic (WhatsApp later).
- [ ] **Chat UI (web-ui, separate surface)** — session list, transcript, streaming, execution-mode selector,
      memory-scope toggles, Signal pairing/status; tooltips per §5.I #5.
- [ ] **Safety, permissions & audit** — per-action + typed host confirmations, audit log of every host action,
      messenger access-control; first-class + tested; the autonomous swarm can never reach these.
- [ ] **Settable session goal** (Codex-style) — explicit per-session objective kept in focus across turns
      (persisted, editable, shown in UI + bridge; the §5.N focus-chain north star).
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
  - [~] user view/edit/reorder/add steps from the UI
    - [x] **edit / add / delete / toggle (2026-06-24)** — `FocusChainPanel` in card detail is now editable: click a
          step's status marker to cycle pending→in_progress→done→skipped, delete a step (hover ×), and add a step via
          an inline input. Edits persist through the board's normal save flow via a new `updateTaskFocusChain`
          board-state helper + `handleUpdateTaskFocusChain` (use-task-editor) threaded App → CardDetailView →
          FocusChainPanel. board-state unit-tested; web suite (699) green.
    - [ ] drag-reorder steps (heavier; the order is otherwise edit-by-delete/add for now)
  - [~] per-step timing/telemetry; carry the chain into the run summary; link a step to the files/cards it touched
    - [x] **carry the chain into the run summary (2026-06-24)** — the session service tracks each task's latest
          focus chain (`focusChainByTaskId`) and stamps a `FocusChainSummary` (total/done/in-progress/pending/
          skipped/complete) onto the terminal `TaskRunSummaryRecord`; absent when no chain was drafted. Unit-tested
          (store round-trip).
    - [ ] per-step timing/telemetry
    - [ ] link a step to the files/cards it touched
- [x] **Reference & parity** *(DONE 2026-06-24)* — the board focus-chain now matches Cline/Claude-Code/Cursor
      ergonomics: a visible live checklist with ✓/▸/○/– markers + an N/total progress count (visible work-through),
      re-anchored into context after compaction, reviewer-checked, **and now user-editable** (toggle/add/delete from
      the card). Remaining nicety (drag-reorder) tracked above; the chat-surface variant is §5.M.

### 5.O — Robustness sweeps: harden across model sizes/families/quants + parallelism *(raised 2026-06-23)*
> Make !Klein robust on as many small local LLMs as possible (≤4-bit weight quant + low K/V-cache quant) AND
> efficient on large models — evidence-driven: user supplies models, we sweep the dev-test presets, collect
> evidence, harden the common failure modes. Heavy sweep automation is designed when we start sweeping (discuss then).
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
- [ ] **Model-matrix robustness (small → large)** — sweep size × family × weight-quant × K/V-quant × context; run the
      presets; catalog the failure taxonomy per config (tool-call malformation, no-tool-call stalls, structured-output
      misses, context-overflow, host crash/unload under memory pressure, reasoning runaways); feed back into
      guardrails/prompts/budgets; ensure large models aren't needlessly small-model-hedged (capability-tier off the live model).
- [~] **Parallel multi-agent dev-test coverage** — DAGs that fan out widely to exercise the swarm/pool/merge/review/delivery under concurrency
  - [x] presets ship (`wide_fanout`/`deep_chain`/`mixed_dag`/`many_small`) for `nklein dev test-project`
        ([src/nklein-sdk/nklein-dev-test-project.ts](src/nklein-sdk/nklein-dev-test-project.ts)); unit-tested
  - [ ] run under concurrency + harden from observed failures (gated on the user's quant/K-V configs)
- [ ] **Autonomous sweep tooling** (designed when we start) — iterate the model/quant/config matrix unattended on top
      of `dev test-project` + `collect evidence` + `cleanup-report`; capture evidence per run + summarize. Discuss shape then.
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
- [ ] **Wire into the flow** — run after decomposition (+ wherever questions are raised), reusing the reviewer
      role/model; persist resolved/remaining state onto the card/plan; settings (global + per-project) for
      auto-vs-manual + the hard limit.
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

### 5.U — Deep architecture & code-quality review → populate the backlog *(raised 2026-06-24)*
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
      alongside the 2 earlier seed findings. The full whole-codebase pass is still owed.)*
- [ ] **Then work through them** by the normal §2 loop / §5.0 priority, smallest-safe-step first, each a green commit.

> **Seed findings (2026-06-24, from the §5.A isolation work)** — concrete items surfaced incidentally; promoted here
> per the §5.U convention rather than lost. The full deliberate pass (above) is still owed.
- [ ] **Establish + enforce a sandbox-cwd vs host-path naming convention in the agent runtime.** This session fixed a
      *class* of bug where the agent-perceived working directory (the in-container sandbox path) was conflated with the
      host-side control-plane read path, because both flowed through a single `request.cwd`: `config.cwd`, the SDK
      system-prompt `<env>` "Working Directory", and the repo-map/`getWorkspaceChanges` orientation reads all used it,
      so two leaked the host mount to the agent and one (repo map) silently read a nonexistent path. Now centralized via
      `resolveNKleinAgentPerceivedCwd` (sandbox) vs `orientationWorkspacePath`/`artifactWorkspacePath` (host). **Finding:**
      audit *every* `request.cwd`/`workspacePath` use across `nklein-session-runtime.ts` + `nklein-task-session-service.ts`
      and rename to make the sandbox-vs-host intent explicit + greppable (e.g. `agentPerceivedCwd` vs `hostWorkspaceRoot`),
      so a future surface can't silently pick the wrong one. Touches invariant #2 (strict isolation) — high value.
- [ ] **Decompose the oversized `nklein-task-session-service.ts` (~3900 lines).** It conflates: session lifecycle,
      Docker sandbox prep/dispose, timeout scheduling, the swarm guardrail watchdogs (turn/wall-time/no-diff/repeated-
      tool limits), prompt assembly, the message repository, second-opinion review orchestration, and decompose-apply
      wiring. Extract focused modules (sandbox-lifecycle, timeout-scheduler, guardrail-watchdogs, prompt-assembly) behind
      the existing service. Overlaps §5.A "Isolation polish" (extract sandbox-lifecycle/pause) — do together. Pure
      refactor, no behavior change; lock with the existing suite. (Respects invariants; navigability win per §5.U.)

- [ ] **DRY the repetitive `runtime-config.ts` per-field plumbing** *(finding 2026-06-24, from adding `swarmGuardrails`)*.
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
- [x] **Persist the resolved launch role on the session summary** *(DONE 2026-06-24)* — added an optional `role`
      (`RuntimeModelPerformanceRole`) to `runtimeTaskSessionSummarySchema`, stamped at task start (the `entry.summary`
      chokepoint, persisting through `updateSummary`'s spread) via a shared `resolveNKleinTaskRole(taskId,
      isDecomposition)` — reviewer for `::review`, architect for an explicit decomposition, worker otherwise. The
      terminal run-summary capture now reuses the same helper so the live + run summaries agree. Unit-tested
      (worker + reviewer stamp). **Unblocks §5.G #425** — the board role strip can now read `summary.role` instead of
      inferring from `startInPlanMode`.

### 5.J — LATER (deferred by decision)
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
