# !Klein — Feature Specification Sheet

> **Canonical source of truth for what !Klein is and will be.** Derived from the codebase and the planning
> chain (`plan.md`, `follow-up-1.md` … `follow-up-5.md`) on **2026-06-19**. This is the main guiding
> document: every existing capability is described here, and every *future* capability is added here first,
> then tracked to completion in `plan.md`.
>
> **How to maintain:** when you build or change a user-relevant feature, update its entry here in the same
> change. Keep the high-level status checkboxes and the section timestamps current. Detailed
> sub-implementation tracking lives in `plan.md`; this sheet is the durable "what & why."
>
> Status: `- [x]` shipped · `- [ ]` planned/open · `- [~]` shipped-but-degraded/partial · `LATER:` deferred
> by decision.

---

## 0. Product identity & non-negotiable invariants

- **What it is:** !Klein is a local-autonomous, multi-LLM **kanban swarm** for software work. A user drops a
  high-level idea into the board; !Klein decomposes it into a dependency-linked DAG of right-sized cards and
  runs them with local LLM agents — in parallel where safe — entirely on the user's own hardware.
- **Naming:** in-app brand `!Klein`; OS/packaging `nKlein`; technical identifiers `nklein`; the upstream
  engine stays `Cline` (`@clinebot/core` / `@clinebot/llms`). Repo name and `kanban.repositoryCreatedByKanban`
  git marker are intentional keeps.
- **Invariant — LOCAL MODELS ONLY.** `CLOUD_ENABLED = false`
  ([src/cline-sdk/cline-local-only-policy.ts](src/cline-sdk/cline-local-only-policy.ts)). No request can reach
  a paid/cloud LLM; cloud providers don't render, can't be selected, and cloud-pinned cards hard-stop.
  Re-enabling is a single reviewed code change, never a setting.
- **Invariant — ≥32k context minimum.** `CLINE_MIN_CONTEXT_WINDOW_TOKENS = 32_000`, enforced at every entry.
- **Invariant — STRICT DOCKER AGENT ISOLATION (mandatory, unconditional, fail-closed).** Every agent shell
  command and filesystem read/write runs inside a Docker container; the host runtime never executes
  shell/FS on the LLM's behalf. Docker is a hard prerequisite — no host fallback, no degraded mode, **no
  toggle to disable**. If Docker/image is unavailable, agent tasks refuse to start.
- **Invariant — upstream-clean.** Every feature is a `src/cline-sdk/` plug-in on an official SDK socket;
  `node_modules/@clinebot/*` is never patched (CI-guarded by `check:cline-boundary`).
- **Invariant — never an oversized prompt.** No request exceeds the model's effective window; over-budget
  turns are compacted or the task stops — never sent.

---

## 1. Local-only model platform & cloud lockdown  *(shipped — 2026-06)*

- [x] Single default-deny policy module: `LOCAL_PROVIDER_IDS = {ollama, lmstudio, lm-studio}`,
  `isLocalProvider`/`isLocalBaseUrl` (localhost/RFC-1918/CGNAT/`*.local`), managed-OAuth always denied,
  typed `CloudProviderDisabledError`.
- [x] Gated at the request chokepoint (`resolveLaunchConfig`), re-asserted at task start, and at
  router/role resolution. Cloud-pinned cards hard-stop with a clear message on (re)start and resume.
- [x] Provider catalog, model picker, role pickers, onboarding carousel, and settings all filter cloud out;
  `normalizeAgentId` clamps any persisted cloud agent id → `cline` at load.
- [x] Boundary scan test fails if a concrete cloud-provider literal escapes the documented boundary file.

## 2. Reliability core  *(shipped — 2026-06)*

- [x] **Never-overflow pre-send guard** computed from the same source as the context bar; compacts history,
  and if a single prompt still overflows, surfaces a specific "your message is larger than the working
  budget" message instead of a generic throw.
- [x] **Real effective context window** = `min(advertised, user override, !Klein sanity ceiling)`; the old
  200k throttle is removed so large local models (256k/512k/1M) keep their full window; guard, SDK
  compaction, and the UI bar all read the same unclamped window.
- [x] **Local-appropriate timeouts** — the 1-second-timeout bug is gone; defaults are generous local floors
  (request 1h, stream/tool/agent 24h, conversation 7d), `unlimited` honored, and positive timeouts scale up
  from measured MCSR speed without lowering configured values. Cold-start floor seeds from a pessimistic
  tok/s prior before EWMA accrues.
- [x] **Error back-off** — repeated identical failures respect `maxConsecutiveMistakes` and park instead of
  storming telemetry.
- [x] **Session restart/resume** works via persisted launch config (`kanban.launchConfig` SDK metadata +
  service-level fallback start), no host session-map casting.
- [x] **Acceptance gate** uses a non-login shell / direct exec with streamed buffer (no conda/nvm freeze, no
  `ENOBUFS`).

## 3. Context budget visualization  *(shipped)*

- [x] Backend `ContextBudgetBreakdown` per task (system prompt · tool schemas · task/user prompt · included
  file content · other history · reserved working · reserved output) against the real effective window.
- [x] Segmented, health-colored (green→gold→orange→red, overflow=red) full-width bar in the chat panel and a
  compact form on running board cards; graceful degrade folds unknowns into an "other" segment.

## 4. Model Capability & Speed Registry (MCSR)  *(shipped)*

- [x] Per-model capability + measured prefill/decode/TTFT speed (EWMA, fractional, debounced persistence),
  capability prior weighted `1/(1+samples)` and decayed toward prior on a 30-day half-life.
- [x] Effective context-window resolution for local providers (advertised from LM Studio/Ollama, observed
  from real requests, user override precedence); ≥32k enforced.
- [x] Surfaced in a chat-panel Model Telemetry panel and promoted into Settings with per-model
  context-window Save/Clear; zero-sample local rows shown with a "Set context window" prompt; stale-row
  prune ("Clear stale models") + per-row delete; loaded-model filter shared by Settings and chat.

## 5. Parallel local swarm executor  *(shipped)*

- [x] `maxConcurrentTasks` actively enforced across single/batch/dependency/runtime starts (counts
  running/review sessions without cold-starting Cline).
- [x] Auto-start newly-unblocked cards on completion/commit, under the cap.
- [x] Per-local-endpoint serialization (same endpoint serialized, distinct endpoints parallel) with a typed
  `endpoint_busy` response + `retryAfterMs` from MCSR wall-time, opt-in queued admission with dedupe + retry.
- [x] File-overlap-aware scheduling (`filesLikelyTouched`) for single starts, manual start-all, dependency
  auto-starts, and CLI.
- [x] Dependency-ordered auto-merge of reviewed worktrees; conflicts spawn a Planning integration card and
  block dependents from an unmerged base.
- [x] Shared decision blackboard (`decisions.md`) injected compactly into dependent card prompts.
- [x] Per-model tool routing (trim fragile tools for small model families via typed SDK `ToolRoutingRule`).
- [x] Swarm guardrails: per-task autonomous turn budget, wall-time budget, no-diff watchdog, repeated-tool
  watchdog, 12-card batch budget, and a workspace stop signal (Pause/Resume) — all surfaced in Settings.

## 6. Autonomous decomposition & planning  *(shipped; restored under isolation 2026-06-19)*

- [x] `decompose_project` / `expand_task` tools with sizing-contract validation (complexity ≤75, ≤3 likely
  files, acceptance command required) and graph/reference validation.
- [x] Recursive expand loop (bounded depth) with dependency rewriting to terminal leaves; final leaves pass
  the connected-local-model fit guard before artifacts are accepted.
- [x] Plan artifacts under `<project>/.cline/nklein/plans/<slug>/`: `spec.md`, `plan.md`, `tasks.json`,
  `questions.md` (clarifying Q&A / assumptions), `summary.md` (plain-language), `decisions.md`,
  `revisions.md` (audit trail). Workspace-owned artifacts with id/provenance; idempotent apply.
- [x] Cards land in the **Planning** lane; runnable Planning cards flow into execution. Overridable
  `nklein-decompose` workflow rule (not a hardcoded prompt). Successful auto-apply consumes the source
  decomposition card into Completed so it is not re-run alongside the generated DAG. Generated leaf cards
  prefer the workspace default acceptance command over brittle output-shape probes. Decomposition roots are
  requested for automatic start through the runtime queue; linked dependents remain in Planning until their
  prerequisites complete. Live complex-dev verification on 2026-06-19 confirmed generated Planning cards can
  be started into execution.
- [x] Naive-idea intake → clarifying questions (option chips in chat) → reviewable plan with plain-language
  summary.
- [x] Adaptive re-planning: `plan-gap` events (missing decision, contradiction, missing dependency, oversized
  scope, integration gap) → recursive split / integration card / decision-pause card / re-ask, bounded by
  swarm guardrails; `expand-plan-task` applies approved replacement graphs.
- [x] **Works under strict isolation** *(restored 2026-06-19)* — the `decompose_project`/`expand_task` tools
  are trusted control-plane (they mutate only `~/.cline/nklein/` plan artifacts + the board, never the user's
  working tree) and stay available host-side during sandboxed planning. The host workspace root is forwarded
  to the runtime so board/plan mutations resolve to the owning workspace, not the container workdir, so a
  1-shot prompt → Planning DAG → cards works with isolation ON.

## 7. Codebase intelligence  *(shipped)*

- [x] TypeScript-AST + PageRank repo map (lexical fallback for non-JS/TS), conversation/seed personalization
  boosts, bounded cost, invalidated after mutating tools.
- [x] Code index with provider/model-separated dense vectors; `local_lexical` honest fallback;
  OpenAI-compatible local embedding endpoints (LM Studio/Ollama) supported; hybrid lexical+semantic+repo-map
  ranked search; cache GC keyed to current chunks.
- [x] Settings Code-intelligence panel (repo-map availability, index coverage, embedding provider/model,
  staleness, live indexing progress) + a board status chip; global + per-project embedding overrides.

## 8. Operator UI & observability — the swarm cockpit  *(shipped; live-verify open)*

- [x] Running cards show role/model, compact token bar, tok/s, elapsed, current tool, turn count.
- [x] Global swarm header strip: running/waiting/blocked counts, per-endpoint grouping, concurrency-cap
  slider, Pause/Resume, code-intel chip.
- [x] Model & endpoint telemetry panel (MCSR), Planning-lane DAG review with fit badges + "Approve for
  execution" + revised-plan flags, per-card diagnostics drawer (telemetry, no LLM), "what !Klein is doing
  right now" activity surface (planning → routing → budget → retrieval → tools → acceptance → merge).
- [x] First-run local-model setup wizard (detect Ollama/LM Studio, list loaded models, set windows, assign
  roles, endpoint start guidance).
- [x] Progressive disclosure (plain summary for non-technical, raw detail one expand away) and a
  feature-visibility coverage matrix; settings cover every pillar.
- [ ] **Live verification of the cockpit + isolation status/pool UI is still owed** (env-blocked) — see
  `follow-up-5.md` §2.C.

## 9. Strict Docker agent isolation  *(shipped core; reconciliation + live-verify open)*

- [x] Pinned `nklein/agent-sandbox` image (`docker/agent-sandbox/`), in-container SDK tool-runner
  (`/opt/nklein/tool-runner.cjs`), `AgentSandboxManager` boundary (docker CLI, no dockerode).
- [x] Configurable container **pool** (default 1 container for all agents): max containers, agents-per-
  container, per-container CPU/RAM, idle timeout, FIFO wait queue; Shared/Dedicated presets; lockdown
  `docker run` flags (`--network none`, `--cap-drop ALL`, `no-new-privileges`, `--read-only`, tmpfs,
  per-container named volume, ro project mount).
- [x] Per-task uid + `/workspaces/<taskId>` isolation; clone-in / patch-out via deterministic
  `nklein/tasks/<task>` result branches applied host-side with a temp index (`commit-tree`, no host checkout
  mutation).
- [x] Host-touching agent surfaces routed through the container (SDK default executors, acceptance gate,
  `repo_map`/`search_code`/file-discovery/`read_large_file`/`write_file(s)` proxies); local-exec MCP
  default-denied; `webFetch` disabled under no-egress.
- [x] Fail-closed preflight at start + runtime startup; no-host-execution guard tests; Docker-gated
  lifecycle/queue integration tests; orphan reaping; killswitch via container removal; Settings isolation
  status + pool controls.
- [x] **Live-verified end-to-end (2026-06-19):** a real Cline task against LM Studio ran with a shared Docker
  sandbox container, no host worktree, clean teardown, fail-closed when the image is missing, and clean
  telemetry — via `scripts/verify-strict-isolation.mts`. **Still owed:** browser-only Settings isolation
  status/pool UI inspection.
- [x] Sandbox result-patch finalization treats early teardown/no-workspace staging races as benign "no changes
  to capture" observations, while preserving warnings for real capture failures.
- [ ] **LATER:** Add a purpose-built in-sandbox operator for "real" command execution. Because !Klein owns
  the Docker image, the image can ship a small command operator that runs shell commands directly with
  structured stdout/stderr/exit-code/error metadata, typed next-step guidance, and clearer UI status than the
  current generic SDK `bash` bridge.
- [ ] **Open:** §2.B retire the parallel host worktree subsystem (code deletion, UI-gated).

## 10. Runtime control & chat UX  *(shipped)*

- [x] Board pause actually halts the running agent loop at the per-turn checkpoint (no new LLM request while
  paused; in-flight turn finishes); new `"paused"` park state; auto-resume drains paused tasks; pause gates
  the sandbox executors + acceptance gate (queue side effects).
- [x] Per-card pause/resume (persisted `paused-tasks.json`, tRPC `pauseTask`/`resumeTask`, board controls);
  the card button toggles Start → Pause → Resume.
- [x] Finished-card Replay (global `replayCardsEnabled`, default off; destructive reset, confirm-gated).
- [x] Per-message chat timestamps (top-right, zero layout shift, click-collapse to a clock icon, hover shows
  absolute time + duration); context-usage bar on its own full-width line.

## 11. Self-improvement, evidence & developer tools  *(shipped; gated)*

- [x] Local self-observation telemetry sink (errors/overflows/retries/inefficiencies/plan-gaps) with path
  redaction, broadened secret patterns, and retention rotation.
- [x] Evidence bundle + one-click "Create evidence" for agent handoff (prompt block + bundle path); gated
  "Create !Klein self-improvement project" (dev checkout, evidence-pinned base commit, protected-guard on).
- [x] Dogfood improvement-backlog engine (clamped to the sizing contract); smoke-eval harness (local roster
  only); evidence/diff viewer drawer; command palette (⌘K); developer surfaces gated behind a persistent
  global **Developer Mode** toggle (env var is a separate override that the setting can beat).
- [x] **Protected test suite** — curated, separate (`test/protected/`), documented, run via
  `npm run test:protected` (9 files / 79 tests); `agent-write-guard` blocks edits to protected paths +
  secret-bearing writes and demands a structured `{intent,diff,reason,expectedEffects}` approval surfaced in
  the chat panel; approvals audited to telemetry. Applies automatically inside the self-improvement project.
- [x] **Strict-isolation guards protected** *(2026-06-19, human-approved)* — the no-host-execution guard,
  Docker sandbox lockdown/fail-closed/uid-isolation, and the fail-closed task-start preflight are in the
  protected manifest, so weakening agent isolation requires explicit human approval.

## 12. Security & workspace safety  *(shipped)*

- [x] Electron hardening (contextIsolation, no nodeIntegration, sandbox, webSecurity, deny-by-default popup,
  same-origin nav, CSP fallback, packaged devtools off); runtime bound to `127.0.0.1`; hardened
  Set-Cookie/session token; secret scanning in the agent-write path; opt-in PTY egress restriction (legacy).
- [x] Workspace-identity hardening: explicit-only project registration, self-project (!Klein repo) load
  requires confirmation and survives removal, task-worktree → owning-workspace resolution, accidental-project
  detection/repair, persistence-ownership split (board vs runtime session state), board-save conflict
  rebase/retry.
- [~] **Project portability baseline** *(started 2026-06-19)*: runtime-home remains the fast local index/cache,
  but board state, session summaries, revision metadata, and workspace identity are mirrored into
  `<project>/.cline/nklein/workspace/`; project loads can recover from that workspace-local mirror if the
  runtime-home workspace cache is missing. Running sessions, model telemetry/speed, endpoint config,
  sandbox containers, task result branches, and local telemetry remain machine-local.
- [x] Guidance skills (`security`/`ui`/`ts`) seeded as on-demand `/nklein-*` workflows, routed by card topic.

## 13. Known degradations / parked features  *(tracked)*

- [x] ~~Decomposition→cards dark under isolation~~ — **resolved 2026-06-19** (see §6); decomposition is
  trusted control-plane and stays host-side under isolation.
- **PARKED (cloud-dependent; re-enable only when cloud is revisited or a strong local model is proven):**
  - `cline-advisor.ts` (config explainer / log analysis / MCP discovery advisor buttons).
  - `cline-model-research.ts` (model-freshness research — needs web + a strong model).
  - `cline-team-delegation.ts` / `cline-team-progress.ts` (native Cline team delegation UI).
  - `cline-trusted-auto-merge.ts` (self-merge safety policy — stays off; `null` regression delta blocks).
  - `cline-web-research-tool.ts` (host web research — also incompatible with `--network none` sandbox).
  - These compile as parked helpers but render no local-only UI affordance: Settings advisor actions are
    hidden while cloud support is disabled, host web research is not registered while `CLOUD_ENABLED=false`,
    and native SDK team delegation stays disabled even if the legacy env flag is set.

---

## 14. Future / planned features (add new specs here first, then track in plan.md)

### 14.1 — Finish the strict-isolation reconciliation *(active; see plan.md §2.A–§2.C)*
- [ ] Restore the autonomous decomposition→cards flow under isolation (control-plane re-classification).
- [ ] Retire/quarantine the host worktree subsystem; single legacy predicate; result-branch-only diff/merge.
- [ ] Scripted strict-isolation + dev-build verification runbook.

### 14.2 — Portable "project state in the repository" (cross-machine continuation) *(active baseline)*
- [~] **Started 2026-06-19:** !Klein now mirrors core workspace state into
  `<project>/.cline/nklein/workspace/` and can recover board/session/meta from that mirror when the
  runtime-home cache is missing. This is the base for portability, not the full collaborative sync story.
- [ ] !Klein shall store **all durable, non-machine-local** information about a project's tasks, task cards, task graph (DAG),
  progress, spec, plans, decisions, and revision history **inside the repository itself** (e.g. a committed
  `.nklein/` project-state directory), so the full "project state" can be:
  1. pushed to the repository server,
  2. fetched onto another machine, and
  3. loaded there into a fresh !Klein install, and
  4. **work continued** with whatever local LLM models are available on that machine.
- **Why:** today part of project state still lives in `~/.cline/nklein/` (per-machine, outside the repo). Moving the durable
  project state into the repo makes a !Klein project portable and collaboratable, and decouples "the plan and
  its progress" from the machine that produced it.
- **Open clarification topics to resolve WITH THE USER before building (non-exhaustive):**
  - [ ] Exactly which state is repo-committed vs machine-local (machine-local must stay: model registry /
        measured speeds, endpoint URLs, container/sandbox runtime state, telemetry, secrets).
  - [ ] On-disk schema + versioning/migration for the committed `.nklein/` state; human-readability vs compact.
  - [ ] Merge/conflict semantics when two machines advance the same DAG (CRDT? last-writer-wins per card?
        explicit rebase UI?), and how it interacts with the existing board-save revision/conflict handling.
  - [ ] How worktree/result-branch artifacts and in-flight sandbox work map across machines (they don't move —
        only the plan/graph/progress does; running sessions are machine-bound).
  - [ ] Identity: how a card's provenance/links survive a fetch onto a different checkout; collision handling.
  - [ ] Security/privacy: ensure no secrets, absolute host paths, or telemetry leak into committed state.
  - [ ] Interaction with the local-only invariant (the target machine may have entirely different local models;
        re-resolve roles/fit on load rather than trusting the source machine's assignments).
- [ ] Only after the above are signed off: design the committed schema, the export/import, the load-time
      re-resolution against local models, and the conflict UX; add to `plan.md` as a phased workstream.

### 14.3 — LATER: Linux and Windows runtime support
- [ ] !Klein should run as a first-class local runtime on Linux desktops/servers, while keeping Docker
      mandatory for every agent shell/filesystem action. Linux support must verify Docker availability,
      sandbox image build/run behavior, local model endpoint discovery, browser/runtime launch, file-picker
      fallback behavior on headless systems, and path handling.
- [ ] !Klein should run as a first-class local runtime on Windows, still requiring Docker Desktop/WSL-backed
      Docker for agent isolation. Windows support must explicitly verify path translation, shell/PTY behavior,
      Git availability, Docker volume/mount semantics, local model endpoint discovery, browser/runtime launch,
      and packaged app behavior before it is marked shipped.
  - [x] Added a repository-root `start.bat` development launcher for Windows test machines. It checks Node.js
        22+, npm, Git, and Docker Desktop reachability, installs missing dependencies, and starts the existing
        full dev runtime without duplicating launch orchestration.
- [ ] Cross-platform support must not weaken the strict-isolation invariant: no host shell/FS fallback, no
      Docker-disabled mode, and the same fail-closed task-start behavior when Docker or the sandbox image is
      unavailable.

### 14.4 — Backlog of smaller enhancements (promote to plan.md when picked up)
- [ ] Scripted/automated end-to-end smoke that exercises a full 1-shot → decomposition → parallel execution →
      merge cycle on a tiny local model, as a CI-able dogfood gate.
- [ ] Explicit in-UI sandbox queue list (currently only a per-card "queued" state).
- [ ] Board-level merge-status history surface (currently CLI/integration-card only).
- [ ] Richer acceptance-failure classification taxonomy in the diagnostics drawer.

---

## 15. Success criteria (the bar for "done")

1. Cloud is unreachable; a cloud-pinned card hard-stops; re-enabling is one reviewed code change.
2. No oversized prompt ever leaves; over-budget turns compact or stop.
3. The loop is stable: no 1s timeouts, no restart-config failures, no retry storms.
4. ≥32k enforced everywhere; budgets/compression scale to the local window with no hardcoded window/speed
   constants in routing/budget decisions.
5. A multi-card DAG auto-starts unblocked cards under the cap, serializes per endpoint, parallelizes across
   endpoints, and never thrashes the machine.
6. **A single high-level prompt yields a Planning-lane DAG of local-feasible cards that actually get created
   and flow into execution — with strict isolation ON.** *(Partially re-verified 2026-06-19: complex dev-test
   decomposition created the DAG under Docker isolation and a generated Planning card started into execution;
   automatic unblocked-card swarm start remains the remaining end-to-end target.)*
7. Context is visible as a segmented green→red bar against the real effective window.
8. Parallel cards never collide on shared files; worktrees/result-branches merge in dependency order;
   autonomous runs are budgeted, stoppable in one click, and stalled tasks auto-park.
9. The board is a live cockpit (per-agent status, MCSR stats, DAG with fit badges, diagnostics drawer,
   first-run wizard) — all cloud-free.
10. A loose idea triggers clarifying questions, yields a reviewable plain-language plan, and adapts on
    execution-discovered gaps.
11. Nothing built since branching from `main` is invisible in the UI (coverage matrix has no unmapped entry).
12. **Every agent shell/FS action runs in Docker; no host fallback exists; Docker-down fails closed.**
13. Upstream-clean: re-pulling Cline-Kanban needs no reverts (no `node_modules/@clinebot/*` diffs).
