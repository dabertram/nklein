# Follow-up 5 — Consolidation audit, strict-isolation reconciliation & remaining-work roadmap

> Authored by Opus 4.8 (deep consolidation pass) on **2026-06-19**, branch
> `feat/kanban-reliability-context-upgrade`.
>
> This document is the successor to `plan.md`, `follow-up-1.md`, `follow-up-2.md`, `follow-up-3.md`,
> `follow-up-4.md`, and `findings-from-follow-up-work-4.md`. It (1) reconciles which intentions from those
> documents are actually shipped against the current codebase, (2) records every still-open item, and
> (3) adds **new findings** from an independent code + UX + agentic-workflow audit. It is written as nested
> checklists so another session can pick up any item without re-deriving context.
>
> Status legend: `- [x]` verified done in this pass · `- [ ]` open work · `- [~]` partially done /
> needs deliberate finishing · `- [!]` **new finding** raised in this pass.

---

## 0. How to use this document

- Each `###` heading is a self-contained work item. File references are `path:line` against this branch;
  **line numbers drift — re-grep the quoted symbol if a number looks off.**
- The intent chain is: `plan.md` (L0–L4 master plan) → `follow-up-1` (200k-clamp + robustness review) →
  `follow-up-2` (workspace-identity / persistence hardening) → `follow-up-3` (rename + roadmap) →
  `follow-up-4` (local-only settings UX **+ the mandatory strict Docker isolation workstream** + runtime
  control/chat UI) → `findings-from-follow-up-work-4` (isolation residue) → **this doc**.
- **Locked decisions carried forward (do not re-litigate):** LOCAL MODELS ONLY (`CLOUD_ENABLED = false`);
  ≥32k context minimum; strict Docker agent isolation is **mandatory, unconditional, fail-closed, no host
  fallback, no disable toggle**; naming `!Klein` / `nKlein` / `nklein`; protected test suite is curated,
  separate, documented, and **requires explicit human approval to change**.

---

## 1. Health snapshot (verified this pass, 2026-06-19)

- [x] `npm run typecheck` (server) — **0 errors**.
- [x] `npm run web:typecheck` — **0 errors**.
- [x] `npm run lint` (biome, 537 files) — clean, no fixes applied.
- [x] `npm run check:cline-boundary` — passes (no `node_modules/@clinebot/*` patching; SDK boundary intact).
- [x] `npx vitest run test/runtime/cline-sdk test/runtime/telemetry` — **405 tests / 44 files pass** (~11s, no hang).
- [x] `npm run test:protected` — **46 tests / 6 files pass** (~1s).
- [x] Working tree effectively clean (only `AGENTS.md` modified + an untracked `nKlein.code-workspace`);
      `CHANGELOG.md` `## [Upcoming !Klein 0.0.1]` present and diff-grounded.

**Verdict:** The branch is healthy and broadly faithful to the six predecessor documents. The vast majority
of L0–L4, the four reliability follow-ups, the rename, and the strict-isolation workstream are implemented
and tested. The remaining work clusters around **three threads** (§2) plus a set of **new findings** (§3),
and a **manual-verification debt** that is environmental, not code (§4).

---

## 2. The three open threads (the real remaining work)

### 2.A — ✅ RESOLVED (2026-06-19): strict isolation had silently disabled the autonomous decomposition→cards flow

> **Resolution shipped.** Re-classified `decompose_project`/`expand_task` as trusted control-plane tools that
> stay available host-side under isolation (they mutate only `~/.cline/nklein/` plan artifacts + the board via
> `mutateWorkspaceState`, never the user's working tree). `cline-session-runtime.ts` always includes them now;
> `cline-task-session-service.ts` restores the planning-workflow instruction and always forwards the host
> `workspaceRoot` so artifacts/board resolve to the owning workspace, not the container workdir. Tests updated
> (session-runtime asserts decomposition tools present under sandbox proxy tools; task-session-service asserts
> the host root is forwarded distinctly from the container cwd). Full cline-sdk suite green (396/42). The
> remaining bullets below are kept for historical context; the recommended option was taken.


- [!] **Under mandatory strict Docker isolation, a planning agent can no longer create cards on the board.**
  This is the single most important finding in this pass and it directly undermines the user's headline
  goal ("!Klein decomposes a 1-shot high-level input into as-many-as-needed cards and its agents work the
  plan"). Evidence:
  - [cline-task-session-service.ts:494-506](src/cline-sdk/cline-task-session-service.ts#L494) gates the
    decomposition instruction on `decompositionToolsAvailable`, and
    [:1582](src/cline-sdk/cline-task-session-service.ts#L1582) sets it to `!sandboxWorkspace` — i.e. **false
    whenever a sandbox workspace exists, which is always** (isolation is mandatory).
  - When false the agent is told: *"Strict Docker isolation is active, so the host-side !Klein decomposition
    tool is unavailable in this agent session. Produce a clear implementation plan in chat and do not edit
    !Klein board, workspace, plan, or task state directly."*
  - `findings-from-follow-up-work-4.md` confirms this was intentional: "Sandboxed Cline starts now omit
    `decompose_project` and `expand_task`" and "planning prompts now tell the agent to produce a plan in chat
    instead of using `/kanban-decompose`."
  - **Net effect:** the rich L3 decomposition machinery (recursive expand, sizing contract, fit guard,
    Planning-lane DAG, clarifying questions, `revisions.md`, plain-language summary, model-fit badges) is
    **unreachable from a normal sandboxed agent run.** A plan produced "in chat" is just text — no cards, no
    links, no artifacts, no auto-start.
- [!] **Root cause is a scope-boundary misclassification.** `follow-up-4 J0` correctly says board/plan/state
  mutation is **trusted-runtime control-plane work, not agent filesystem/shell activity on the user's repo**:
  > *Out of scope (trusted runtime, stays on host): !Klein's own git integration … config/state file I/O …
  > These are !Klein's trusted code, not the model's actions.*
  Writing plan artifacts to `~/.cline/nklein/plans/<slug>/` and creating cards/links on the board is exactly
  that — it never touches the user's working tree. The implementation over-applied the isolation rule and
  removed a **control-plane** tool as if it were a **data-plane** (file/shell) tool.
- [ ] **Resolution to design and implement (pick one; first is recommended):**
  - [ ] **(Recommended) Re-classify decomposition/board/plan mutation as trusted control-plane tools that
        remain available host-side even under strict isolation.** They mutate only !Klein-owned state
        (`~/.cline/nklein/...` + the board), never the sandboxed working tree, so they don't violate the
        isolation invariant. Keep file/shell/edit/patch/search strictly sandboxed; allow the agent to call
        `decompose_project` / `expand_task` as orchestration. Add a guard test asserting these tools touch
        **only** `~/.cline/nklein/` and board state, never the user repo path, so the classification can't
        regress into a host-FS escape.
  - [ ] **(Alternative) Add a trusted host-side "apply chat plan" bridge.** Let the sandboxed planning agent
        emit a structured plan (JSON in a fenced block / a sandbox file written to its workspace and patched
        out), then a trusted runtime step validates it through the existing
        `validateTaskSizingContract` + router fit guard and calls `applyClinePlanTaskGraphToBoard` host-side.
        More moving parts; only choose this if keeping the agent 100% tool-free during planning is a hard
        requirement.
  - [ ] Either way: **the Planning lane → DAG → auto-start pipeline must work end-to-end from a single
        high-level prompt with isolation ON.** Add an integration test that starts a planning task, runs
        decomposition, and asserts cards + dependency links + plan artifacts appear on the parent board.
- [ ] **Until resolved, document the regression honestly** in `specsheet.md` and `plan.md` (don't leave L3
      marked "done" without this caveat) — today the decomposition feature is effectively dark in the default
      (isolated) configuration.

### 2.B — 🟠 Reconcile / retire the host worktree subsystem under strict isolation

> `follow-up-4 J3b` last bullet and `findings-from-follow-up-work-4` item 1 are the only large open
> *implementation* threads. The sandbox now does clone-in / patch-out via deterministic
> `nklein/tasks/<task>` result branches ([src/workspace/task-result-branches.ts](src/workspace/task-result-branches.ts)),
> but the **legacy host-worktree subsystem still exists in parallel** and the two paths are interleaved
> behind a "legacy non-Cline agent" boundary. This dual-path state is correct but is a maintainability and
> correctness liability that must be deliberately finished.

> **Update 2026-06-19:** direction decided — **retire** (terminal/CLI agents stay permanently disabled under
> local-only). Start-path retirement is confirmed and locked: `usesLegacyHostTaskWorkspace(agentId)`
> ([agent-catalog.ts:97](src/core/agent-catalog.ts#L97)) is the single boundary predicate (now documented),
> covered by [test/runtime/agent-catalog.test.ts](test/runtime/agent-catalog.test.ts) proving Cline/default/null
> never create a host worktree. Remaining work is **dead-code deletion** (deletion-risk; schedule a focused
> session): remove unreachable non-Cline `ensureWorktree` start branches + unused `task-worktree*.ts` creation
> modules, retire saved-host-patch semantics, update AGENTS.md + project-health. The bullets below remain the
> detailed checklist for that deletion pass.
>
> **Reachability audit (2026-06-19) — deletion is blocked, not just deferred.** A full caller map proved the
> worktree modules are NOT dead: `ensureWorktree` is live web-ui/CLI contract (gated, dead-at-runtime for
> Cline but compile-coupled), and `ensureTaskWorktreeIfDoesntExist` + the saved-patch sync are reachable via
> user shell-terminals-on-a-task (`startShellSession` → `resolveTaskCwd({ ensure: true })`) and legacy
> diff/merge reads — every helper has live external callers. So blind deletion would break the build/flows.
> True deletion requires two larger, **UI-verifiable** changes first: (1) remove terminal/CLI agents from
> `RUNTIME_AGENT_CATALOG` + the web-ui legacy path; (2) decide the shell-terminal-on-task story. AGENTS.md is
> reconciled to the container-primary model. Done safely this session: invariant lock + predicate docs +
> AGENTS.md note. The remaining deletion is correctly deferred to an environment with review/diff/merge + shell
> UI verification.

- [~] **Host worktree code is still load-bearing.** `resolveTaskCwd` / `ensureWorktree` are still called from
  `src/trpc/runtime-api.ts`, `src/trpc/workspace-api.ts`, `src/trpc/app-router.ts`,
  `src/commands/task.ts`, `src/cline-sdk/cline-acceptance-auto-repair.ts`, and the whole
  `src/workspace/task-worktree*.ts` family (`task-worktree.ts`, `task-worktree-sync.ts`,
  `task-worktree-auto-merge.ts`, `task-worktree-path.ts`, `task-worktree-turbopack.ts`). Confirm which of
  these are reachable for **default/Cline** tasks vs **only** explicit non-Cline legacy terminal agents.
- [ ] **Decide the terminal-agent story.** Strict isolation covers Cline/default agents. Terminal CLI agents
  (Codex/Claude/etc.) are cloud and already disabled by L0/G5. So: are host worktrees needed at all anymore,
  or are they dead code kept "just in case"? Options:
  - [ ] If terminal agents stay disabled under local-only: **retire** the host-worktree creation paths,
        keeping only read-only legacy compatibility for any pre-existing worktree-backed tasks, and delete
        the now-unreachable `ensureWorktree` start branches.
  - [ ] If terminal agents may return: keep the subsystem but **quarantine** it behind one explicit
        `isLegacyTerminalAgentTask()` predicate used everywhere (today the boundary is re-derived ad hoc in
        ~10 sites — centralize it).
- [ ] **Retire saved-host-worktree-patch semantics** where they no longer apply (the sandbox uses result
  branches, not saved patches). Audit `task-worktree-sync.ts` saved-patch logic against the result-branch
  model and remove/quarantine the parts that only made sense for host worktrees.
- [ ] **Update AGENTS.md tribal-knowledge** worktree notes to describe the container-workspace + result-branch
  model as the primary path, with host worktrees explicitly marked legacy. (The current AGENTS.md note still
  reads as if host task worktrees are the norm.)
- [ ] **Project-health diagnostics** ("accidental worktree projects", "missing parent workspace") were written
  for the host-worktree world. Re-validate they still make sense (and don't false-positive) once the primary
  path is container workspaces.
- [ ] **Tests:** add coverage proving a default/Cline task start creates **no** host worktree directory under
  `~/.cline/nklein/worktrees` (the integration test asserts this for the sandbox; add a unit-level guard on
  the start path too), and that diff/merge/evidence read from the result branch.

### 2.C — ✅ MOSTLY VERIFIED (2026-06-19): strict isolation observed working on a real Cline task

> **Headless verification done** against real Docker (29.4.3) + real LM Studio
> (`qwen3.5-9b-mlx-8bit-m4-32kctx`, loaded, tool_use). New scripted runbook
> [scripts/verify-strict-isolation.mts](scripts/verify-strict-isolation.mts) drives the **real**
> `AgentSandboxManager` + `InMemoryClineTaskSessionService` against the local model in an isolated HOME and
> asserts the invariants. Results:
> - **Real Cline task in Docker:** the SDK booted against LM Studio, a shared `nklein-agent-sandbox-1`
>   container appeared during the run, the session advanced to `running`, **no host worktree** was created
>   under `<HOME>/.cline/nklein/worktrees`, and the container **tore down cleanly** on dispose (zero leftover
>   containers/volumes). ✓
> - **Docker-gated integration test** (`test/integration/agent-sandbox.integration.test.ts`) passes against
>   the real image (uid isolation, exec, patch capture/apply, no host worktree, idle teardown). ✓
> - **Fail-closed:** `NKLEIN_AGENT_SANDBOX_IMAGE=...bogus` → `AgentSandboxUnavailableError` with the
>   `npm run sandbox:build` remediation and **zero** containers created. ✓
> - **Telemetry diff (isolated HOME):** zero `Insufficient balance`, zero `1s timeout`, zero `>1M overflow`,
>   zero `context_overflow`, zero `provider_error`. ✓
> - **Minor polish surfaced:** abruptly disposing a still-empty running sandbox task logs a `runtime_error`
>   "Could not stage sandbox workspace changes" instead of a benign "no changes to capture" no-op. Cosmetic
>   telemetry noise on interrupt-before-any-edit; not a functional break (patch capture works on real
>   changes — proven by the integration test). Track as a small robustness fix (§3.x).
>
> **Still owed — needs the in-app browser (only blocker left):** Settings "Agent isolation" status + pool
> controls inspection (no disable toggle; effective-parallelism helper; maxContainers=2/agentsPerContainer=1
> → two single-agent containers; over-capacity → queued), and the dev-build UX checks (no Claude default;
> registry prune deletes from `model-registry.json`; live loaded-model line; Developer Mode persistence beats
> the env var; embedding OpenAI-compatible endpoint prefill + auto-discovery). The original bullets below
> remain the checklist for that browser pass.



> These are blocked by **environment**, not code: prior Codex/agent sessions could not get Docker socket
> permission or attach the in-app browser. They must be run from an interactive shell + a real LM Studio /
> Ollama endpoint before strict isolation and the follow-up-4 UX can be called shippable.

- [ ] **Strict isolation, real Cline task, observed in Docker.** Start ≥2 real tasks with Docker running and
  confirm: one shared `nklein.kind=agent-sandbox` container by default; each agent's edits stay in its
  `/workspaces/<taskId>` volume dir; **nothing** written under `~/.cline/nklein/worktrees` or elsewhere on the
  host; the result patch applies on review; the container stays warm between tasks and is removed only after
  the idle grace (~10 min); no host shell spawned for the agent. (`follow-up-4 §H` lines 1016–1024.)
- [ ] **Settings isolation UI inspection.** Confirm the read-only "Agent isolation" status (Docker ✓ / image ✓)
  and the sandbox pool controls (max containers, agents-per-container, per-container CPU/RAM, idle timeout)
  render, that there is **no disable-isolation control**, and that the effective-parallelism helper text is
  correct. Exercise maxContainers=2 / agentsPerContainer=1 → two single-agent containers; over-capacity →
  queued cards. (`follow-up-4 §H` lines 1025–1029.)
- [ ] **Dev-build UX verification** (`follow-up-4 §H` lines 982–998): fresh config never defaults to Claude
  and shows only the local Cline agent; junk LM Studio registry rows hidden + "Clear stale models" actually
  deletes them from `model-registry.json`; "Selected loaded model (live)" matches LM Studio; Developer Mode
  off hides all dev surfaces and persists across reload (and an explicit off beats the env var); embedding
  "OpenAI-compatible endpoint" prefills the LM Studio endpoint and auto-populates the model dropdown with no
  click.
- [ ] **Telemetry diff (local dogfood).** Re-run a day of dogfood on the in-use local model; assert the
  `~/.cline/nklein/telemetry/*.jsonl` shows **zero** `"Insufficient balance"`, **zero** `>1M-token`
  overflows, **zero** `"timeout after 1 seconds"` (the original three failure classes from `plan.md` §Context).
- [ ] Provide a **scripted verification harness** (a `scripts/verify-strict-isolation.mjs` or documented
  runbook) so this manual debt becomes a repeatable check rather than ad-hoc shell archaeology each session.

---

## 3. New findings from the independent audit (this pass)

### 3.1 — ✅ RESOLVED (2026-06-19): protected test set now covers the strict-isolation guards

> **Done, human-approved.** Added `cline-agent-sandbox-host-guard` (no-host-execution), `cline-agent-sandbox`
> (lockdown/fail-closed/uid-isolation/pool), and `cline-task-start-guard` (fail-closed preflight) to
> `test/protected/protected-tests.json` + README. Protected suite now 9 files / 79 tests. Adding the
> `agent-write-guard` secret/protected-path tests remains an optional future strengthening.

- [x] The protected manifest ([test/protected/protected-tests.json](test/protected/protected-tests.json)) has
  6 groups (local-only policy, context-window policy, timeout scaling, swarm guardrails, workspace registry,
  decomposition tool). **It does not protect the strict-isolation "no host execution" guard** — which is the
  single most safety-critical invariant in the codebase (the headline mandatory feature). A small model
  editing !Klein could weaken `assertAvailable` / the no-host-fallback executor guard / the fail-closed
  start preflight without tripping the protected suite.
  - [ ] Add the agent-sandbox no-host-execution guard test and the fail-closed start-guard test to the
        protected manifest (with rationale lines), and document them in `test/protected/README.md`.
  - [ ] Consider also protecting the `agent-write-guard` secret-scan + protected-path tests, since those are
        what keep a self-improving small model from exfiltrating secrets or unprotecting itself.
  - [ ] **Per the user's explicit instruction:** any change to the protected manifest/suite must require
        explicit human approval — confirm the write-guard already blocks edits to
        `test/protected/**` and `vitest.protected.config.ts` (it does:
        [agent-write-guard.ts:28-29](src/core/agent-write-guard.ts#L28)), and that adding these entries is the
        only manifest change in scope.

### 3.2 — ✅ RESOLVED (2026-06-19): parked cloud-dependent features are documented and hidden

- [x] `cline-advisor.ts`, `cline-model-research.ts`, `cline-team-delegation.ts`, `cline-team-progress.ts`,
  `cline-trusted-auto-merge.ts`, and `cline-web-research-tool.ts` remain in the tree as compile-only parked
  helpers and are listed in `specsheet.md` with their re-enable trigger. Local-only UI/runtime affordances are
  now gated: Settings advisor actions render only when cloud provider support is enabled, host web research is
  not registered while `CLOUD_ENABLED=false`, and native SDK team delegation stays disabled even if the legacy
  env flag is set. Covered by runtime + web-ui regression tests.

### 3.3 — Agentic workflow consistency under isolation (beyond 2.A)

- [x] **Acceptance gate / repair / plan-gap under isolation.** Acceptance now runs in the sandbox
  (`runClineAcceptanceGateInSandbox`). The automatic repair loop uses the scoped service
  `verifyTaskAcceptanceInSandbox` path for normal runtime repair checks and no longer depends on a legacy host
  task worktree; a regression test now passes a `resolveTaskCwd` spy and asserts it is not called on that path.
- [x] **`nklein task plan-gap` / `expand-plan-task` / `task merge` are host-side CLI mutations.** These are
  control-plane (board/plan) operations and resolve the owning workspace repo path, not a task worktree:
  `recordTaskPlanGapCommand` and `expandSavedPlanTaskCommand` derive `workspaceRepoPath` with
  `resolveWorkspaceRepoPath`, and the merge path already has result-branch coverage asserting
  `resolveTaskCwd` is not called when a task result branch exists.
- [ ] **Auto-start / swarm executor vs sandbox queue.** L2 concurrency cap and the sandbox pool queue are two
  separate admission gates. Confirm they compose sanely: a card admitted by `maxConcurrentTasks` but blocked
  by sandbox capacity should show the "Queued — waiting for sandbox capacity" state (it does per findings),
  and the swarm header counts should reflect sandbox-queued cards distinctly from dependency-blocked cards.

### 3.4 — UI exposure & UX polish (independent sweep)

- [~] **Sandbox pool settings discoverability.** The pool controls live in General settings. Confirm (during
  §2.C manual pass) they're grouped under a clear "Agent isolation" heading with plain-language help and an
  "advanced" reveal for raw container/uid mechanics — consistent with the L4 progressive-disclosure rule.
- [ ] **Decomposition DAG dry-run preview** (`follow-up-1 F3`, marked done) — re-verify it still renders given
  §2.A: if decomposition can't produce cards under isolation, the preview has nothing to show. Tie its
  re-verification to the 2.A fix.
- [ ] **Park-reason plain language** — `follow-up-1 F3` "plain-language park reasons" is marked done; ensure
  the **new** `"paused"` and `"queued (sandbox capacity)"` and `agent_sandbox_unavailable` states also render
  a human one-liner + suggested action on the card, not a raw code.
- [ ] **"Agent isolation unavailable" empty state.** When Docker is down, task create/start is blocked
  fail-closed. Confirm the board/empty-state surfaces the remediation prominently (install/start Docker, run
  `npm run sandbox:build`) rather than only erroring on click — this is the first thing a new user hits if
  they don't have Docker.

### 3.7 — ✅ RESOLVED (2026-06-19): robustness polish surfaced during §2.C live verification

- [x] **Patch capture on interrupt-before-any-edit logs a `runtime_error`.** Result-patch finalization now
  treats teardown/no-workspace staging races as benign "no changes to capture" observations (`custom`/`info`)
  and disposes any still-registered placement, while preserving the warning/error path for real capture
  failures. Covered by task-session-service regression tests.

### 3.5 — Code quality / maintainability observations

- [~] **Dual-path branching ("is this a legacy non-Cline agent?") is duplicated** across runtime-api,
  workspace-api, shutdown, metadata polling, trashed-card path reconstruction, and review-action visibility
  (documented across `findings-from-follow-up-work-4`). Centralize into one predicate + one helper module so
  the eventual host-worktree retirement (§2.B) is a single-file change, not a scattered hunt.
- [x] **No `node_modules/@clinebot/*` patching** — boundary check passes; SDK plug-in discipline held.
- [ ] **`cline-task-session-service.ts` size.** It is the largest, most central file (sandbox lifecycle +
  pause + budgets + decomposition gating + start/stop/abort + result-branch capture). It's coherent but
  approaching a maintainability ceiling; consider extracting the sandbox-lifecycle orchestration and the
  autonomy-budget/pause enforcement into companion modules once §2.A/§2.B settle (don't churn it before).

### 3.6 — Documentation consistency

- [ ] **plan.md still presents L3 decomposition as fully done** without the §2.A isolation caveat, and the
  plan2.md status table marks several rows resolved that the strict-isolation work has since complicated.
  Consolidation (next deliverable) must reconcile this so the master plan doesn't overstate readiness.
- [ ] **The six predecessor docs overlap heavily.** After this consolidation, `follow-up-1..4` +
  `findings-from-follow-up-work-4` should be treated as **historical/archival**; `plan.md` + `specsheet.md` +
  `iteration-instructions.md` + this `follow-up-5.md` become the live set. State that explicitly at the top
  of plan.md so future agents don't re-mine the archive.

---

## 4. Reconciliation table — predecessor intentions → current status

| Source | Item | Status |
|---|---|---|
| plan.md L0 | Cloud hard-lockdown (policy module, gates, defaults, UI filter, router/role, resume) | ✅ done + tested |
| plan.md L1 | Never-overflow guard, effective window, real-window (no 200k clamp), timeouts, back-off, acceptance shell, context bar | ✅ done |
| plan.md L2 | Concurrency enforcement, auto-start, endpoint serialization, tool routing, roles, swarm guardrails | ✅ done |
| plan.md L3 | Decomposition, recursive expand, clarifying questions, summary, adaptive re-plan, revisions | ⚠️ built but **dark under isolation** — see §2.A |
| plan.md L4 | Cockpit, swarm header+Stop, MCSR panel, DAG review+approve, diagnostics drawer, first-run wizard, code-intel, activity surface, settings coverage, coverage matrix | ✅ done (verify live in §2.C) |
| follow-up-1 | 200k clamp relaxed; oversized-prompt graceful; cold-start floor; route_up reason; cloud-resume regression; tree-sitter map; real embeddings; MCSR decay; no-diff self-review; dogfood clamp; null-delta merge block | ✅ done |
| follow-up-2 | Workspace identity, artifact ownership, lost-session recovery, persistence split, advisor send, code-intel settings, dev-tools gating, diagnostics | ✅ done |
| follow-up-3 | Full rename (!Klein/nKlein/nklein) + migration; evidence one-click; self-improvement project; protected suite; guidance skills; security hardening; cloud-UI hidden | ✅ done |
| follow-up-4 §A–G,K | Typecheck blocker; model-telemetry prune+filter; live loaded model; NO CLOUD clamp; Developer Mode; embedding auto-discovery; board pause halts loop; per-card pause/resume; chat timestamps; full-width context bar | ✅ done |
| follow-up-4 ★J | Strict Docker isolation: image, runner, manager, pool, queue, clone-in/patch-out, fail-closed, acceptance, tool audit, MCP disable, network, tests, docs | ✅ mostly done; **§2.B reconciliation + §2.C live verification open** |
| findings-4 | Host worktree/diff/merge lifecycle reconciliation | ⏳ §2.B |
| findings-4 | Real-task isolation manual verify; dev-build UI manual verify | ⏳ §2.C (env-blocked) |
| **NEW (this pass)** | Decomposition→cards dark under isolation | 🔴 §2.A |
| **NEW** | Protected suite missing isolation guard | 🟠 §3.1 |

---

## 5. Suggested order for the next implementing session

1. **§2.A** — restore the autonomous decomposition→cards flow under isolation (recommended: re-classify
   board/plan mutation as trusted control-plane). This unblocks the user's headline goal. **Highest value.**
2. **§3.1** — add the strict-isolation + write-guard tests to the protected manifest (small, safety-critical).
3. **§2.C** — run the real-task isolation + dev-build UX manual verification from a proper shell/endpoint;
   convert into a scripted runbook.
4. **§2.B** — deliberately reconcile/retire the host worktree subsystem; centralize the legacy predicate.
5. **§3.3 / §3.5** — agentic-workflow-under-isolation consistency (acceptance repair worktree source,
   plan-gap/merge workspace resolution) and the maintainability extractions.
6. Sweep **§3.2 / §3.4 / §3.6** documentation + UX polish.

Then continue from the perpetual loop in `iteration-instructions.md`: deep-analyze, extend `plan.md` +
`specsheet.md`, implement, and only stop when nothing reasonable remains — at which point ask the user for
new feature ideas to extend `specsheet.md`.
