# Follow-up 4 — Local-only settings UX: model telemetry, cloud lockdown, developer mode & embedding discovery

> Authored by Opus 4.8 (ultracode audit pass) on **2026-06-19**, branch `feat/kanban-reliability-context-upgrade`.
> Scope: finish and clean up the four issues the user reported (LM Studio model-telemetry noise, real loaded
> context window, "NO CLOUD" default + lockdown, persistent Developer Mode toggle) **plus** the fifth requirement
> added mid-pass (embedding model selector must auto-list local LM Studio models). This doc audits the
> **in-progress agent work already on the worktree** (uncommitted) and specifies exactly what to change.
>
> Status legend: `- [ ]` open work · `- [x]` already done & verified on the worktree.
> Every decision is **locked** (§0.3). There is nothing to "consider" — implement what is written.

## 0. How to use this doc

- Every `### ` heading is a self-contained task card. File references are `path:line` against the current worktree.
  **Line numbers drift — re-grep the quoted symbol/string if a number looks off.**
- Work **top-to-bottom**. §A is a hard blocker (the branch does not typecheck right now); do it first.
- After each section, run the matching verification in §H. Do not mark a box `[x]` until its check passes.

### 0.1 What the user asked for (verbatim intent)

1. **Model telemetry noise.** Settings still lists junk LM Studio models — `lmstudio/small-local-model`,
   `lmstudio/local-model`, `lmstudio/huge-advertised-model`. Drop them completely **and** hide un-loaded ones.
2. **Real loaded context window.** "Model context windows" must show the *actually selected and really
   available/loaded* LM Studio model and its real context window.
3. **NO CLOUD.** Claude was selected by default — unacceptable. Disable all cloud code paths and UI.
4. **Developer mode toggle.** A persistent global "developer mode" setting. When **off**, the left sidebar must not
   show dev-test scenarios etc.; show them **only when developer mode is on**.
5. **Embedding model selector** must **automatically show models from the local LM Studio provider** (no manual
   "Discover models" click).
6. **🔒 Strict agent isolation (MANDATORY).** No agent filesystem or shell activity may ever touch the host. Every
   agent action runs inside a Docker container. Docker is a hard prerequisite — if it is unavailable, agents cannot
   start any command or file activity. There is **no host fallback, ever**, and **no toggle to disable** isolation —
   only a configurable **container pool** (default: one container for all agents; global settings for max containers,
   agents-per-container, per-container CPU/RAM, and idle timeout, with a wait queue when full). See the
   ★ MANDATORY WORKSTREAM section.
7. **Board pause must actually pause the agent.** Pausing the board currently leaves the running card's agent issuing
   LLM request after request. Pause = no new LLM requests; in-flight responses may be received but their processing
   queues until resume. **§K1.**
8. **Per-card pause/resume + replay.** Toggle the card's start button → Pause (after start) → Resume (after pause).
   After a card finishes, the button is disabled, or becomes Replay — and Replay is **disabled by default** in global
   settings, available only if the user enables it. **§K2.**
9. **Timestamp every chat message** — top-right, within existing space, no layout impact; click to collapse to a tiny
   clock icon; hover shows the timestamp **and** the duration the activity/LLM response took. Make it nice. **§K3.**
10. **Context-usage bars** get their own dedicated full-width line (placement/size feel off today). **§K4.**

### 0.2 State of the in-progress work

The agent made a real start (worktree diff touches `src/config/runtime-config.ts`, `src/terminal/agent-registry.ts`,
`src/core/api-contract.ts`, `web-ui/src/components/runtime-settings-dialog.tsx`,
`web-ui/src/components/project-navigation-panel.tsx`, the home-agent hooks, and several tests). It is **incomplete and
un-shippable**: the branch does not typecheck (§A); Issue 1 is filtered in Settings only and has no delete path (§B);
Issue 3 leaks cloud agents through the onboarding carousel and a non-clamping `normalizeAgentId` (§D); Issue 4 has a
naming tangle plus an env-var override bug (§E); Issue 5 is not started (§F).

### 0.3 Locked decisions (already made — do not re-open)

1. **Naming:** the persistent setting is named **`developerModeEnabled`** end-to-end (config field, API-contract
   request **and** response field, every web boolean that gates a developer surface). The env-var switch keeps its
   own name `isRuntimeDebugModeEnabled()` / `NKLEIN_DEBUG` / `KANBAN_DEBUG` and is a separate **debug override**.
   File/component names that say "debug" (`use-debug-tools.ts`, `DebugDialog`, the "Developer Tools" panel) keep their
   names; only the boolean they read is renamed. A one-line legacy read-fallback for `debugModeEnabled` is added so
   the dev's already-saved config is not lost. **§E.**
2. **Model telemetry:** do **both** — hide un-loaded local-provider rows **and** ship a real prune/Clear that deletes
   stale rows from `model-registry.json`. Apply the filter in **both** the Settings panel and the task chat panel via
   one shared helper. **§B.**
3. **Dev-build coupling:** `import.meta.env.DEV &&` stays **only** on the Dev Test Scenarios / self-improvement card
   (those need the running dev source tree). Every other developer surface (debug dialog, data-dir shortcut, reset
   state, command-palette "Developer Tools", settings "Developer Tools") gates on the **toggle alone** so it works in
   packaged builds. Each gate gets a one-line comment stating which rule applies. **§E4.**
4. **Cloud lockdown:** when `CLOUD_ENABLED` is false the agent picker is **not rendered at all** (replaced by a single
   "Local Cline agent (cloud disabled)" line); `normalizeAgentId` clamps cloud ids to `cline` at load; the onboarding
   carousel lists `cline` only. **§D.**
5. **🔒 Strict Docker agent isolation is mandatory and unconditional.** All agent shell + filesystem activity runs
   inside Docker (each task in its own named-volume workspace; **no host worktree folders**); the host runtime never
   executes shell/FS operations on the LLM's behalf. Docker is a hard prerequisite — **fail closed** (no host fallback,
   no degraded mode, **no toggle to disable isolation**, ever). *How* to isolate is a configurable **container pool**
   (J8): max containers, agents-per-container, per-container CPU/RAM, and idle timeout, plus the existing
   max-parallel-agents cap and a **wait queue** when capacity is full — default is **one container for all agents**
   (lowest footprint, best for limited hardware). Isolation is always on; the pool always reuses + idles (never
   spawn/kill per task). This is the single largest workstream and **gates shippability**: until it lands, !Klein must
   refuse to start agent tasks.
   Full spec: **★ MANDATORY WORKSTREAM** section below. The reference implementation is CAKE2
   (`/Users/david/GIT/CAKE2/src/cake/services/sandbox/isolation.py` + `docs/specs/03-isolation-security.md`).

---

## ★ MANDATORY WORKSTREAM — Strict Docker agent isolation (filesystem + shell)

> **This is the headline requirement and gates shippability.** Clear §A's 4-line typecheck blocker first so the tree
> builds, then this is the primary workstream. Implement it exactly as written — there are no options here.
>
> **Policy (locked, non-negotiable):** every agent shell command and every agent filesystem read/write runs **inside a
> Docker container**. The host !Klein runtime must **never** spawn a shell or read/write files on the LLM's behalf.
> Docker is a hard prerequisite: if it is missing/unreachable or the sandbox image is absent, agent tasks **must not
> start** and running tasks **must abort** with a clear message. **No host fallback. No degraded mode. No toggle. Ever.**

### J-arch. Architecture at a glance (locked)
- **Configurable container pool (default = one container for all agents).** Global settings (J8) control: **max
  parallel agents** (the existing `maxConcurrentTasks`), **max containers** (default **1**), **agents per container**
  (default **unlimited** → all agents share the one container = the default "shared" behavior), **memory/cpus per
  container**, and **idle timeout**. "Shared" and "Dedicated" are just presets over these numbers (J3c). Isolation is
  mandatory regardless of the numbers.
- **Placement + queue (J3c):** an agent is placed into a container with free capacity (reuse), else a new container is
  started if the pool is below **max containers**, else the agent **waits in a queue** until a slot frees. Effective
  parallelism = `min(maxConcurrentTasks, maxContainers × agentsPerContainer)`. Containers are reused and idle for the
  **configurable** timeout before shutdown — never spawn/kill per task (J4).
- Each agent gets an isolated workspace at `/workspaces/<taskId>` on a Docker **named volume** (one volume **per
  container**, `nklein-agent-ws-<slot>`), owned by a per-task unprivileged uid (J3b). **No agent files ever live on the
  host.** The user's project repo is mounted **read-only** only as a clone source.
- Results flow back as a **git patch** that !Klein applies to the user's host repo (J3b). There are **no host worktree
  folders** anymore — that is what removes the host-filesystem pollution.
- Removing the container = an instant killswitch for all agent activity. The only exposed controls are the board
  Start/Pause/Resume (§K); pause halts the loops but keeps the container warm so resume is instant.

### J0. Scope boundary — what is "agent activity" (read first, do not over- or under-scope)
- **In scope (must be containerized):** every tool the LLM can invoke that touches shell or filesystem — the SDK
  executors `bash`, `readFile`, `search`, `editor`, `applyPatch` (and `webFetch`, handled by disabling — J6); the
  acceptance gate command; any !Klein-implemented agent tool that reads/writes/execs; locally-executing MCP tools.
- **Out of scope (trusted runtime, stays on host):** !Klein's own git integration (preparing each task's workspace by
  cloning in, and applying the agent's **result patch** to the user's host repo + commit/branch — J3b), code indexing /
  embeddings / repo-map prebuild, config/state file I/O, the runtime HTTP server, and **user-opened terminals** (a
  human explicitly opening a shell is the user's action, not the agent's — but see J6 note). These are !Klein's trusted
  code, not the model's actions. The host-side replacement for worktrees is the workspace manager in J3/J3b
  (clone-in / patch-out) — read it before touching `src/workspace/`.
- Each agent's writable world is exactly its own directory **inside the shared container**: `/workspaces/<taskId>` on a
  Docker named volume (**never** the host filesystem), owned by a per-task uid. It cannot see another task's workspace
  or anything on the host (path confinement is also why reads/search are containerized, not just writes).

### J1. The injection mechanism (how isolation attaches — this is the whole trick)
The SDK already supports client-owned tool execution. Use it; do **not** patch `node_modules`.
- The contract is `RuntimeCapabilities.toolExecutors?: Partial<ToolExecutors>`
  (`node_modules/@clinebot/core/dist/runtime/capabilities/runtime-capabilities.d.ts`,
  `.../extensions/tools/types.d.ts`). `ToolExecutors` members and signatures:
  - `bash?: (command: string | StructuredCommandInput, cwd: string, ctx) => Promise<string>` — **shell**
  - `readFile?: (request: ReadFileRequest, ctx) => Promise<string | (Text|Image)[]>` — **fs read**
  - `search?: (query: string, cwd: string, ctx) => Promise<string>` — **fs search**
  - `editor?: (input: EditFileInput, cwd: string, ctx) => Promise<string>` — **fs write**
  - `applyPatch?: (input: ApplyPatchInput, cwd: string, ctx) => Promise<string>` — **fs write**
  - `webFetch?`, `skills?`, `askQuestion?`, `submit?` — not fs/shell (see J6 for `webFetch`).
- **Injection point:** [cline-session-runtime.ts:784](src/cline-sdk/cline-session-runtime.ts#L784) — the
  `sessionHost.start({ ... localRuntime: {...}, ...(requestToolApproval ? { capabilities: { requestToolApproval } } : {}) })`
  call. Change the `capabilities` object to **always** include `toolExecutors: <Docker-backed executors bound to this
  task's workspace>` alongside `requestToolApproval`. Bind them to the task by `taskId` (→ `/workspaces/<taskId>` in the
  shared container); the SDK still passes a `cwd`, but the executors ignore it and always target the task workspace.
- **In-container tool runner (reuse SDK semantics, relocated).** Bake a small compiled script into the image at
  `/opt/nklein/tool-runner.mjs` that imports the SDK's real executors (`createDefaultExecutors` from
  `@clinebot/core`, `.../extensions/tools/executors`) with `cwd` = the per-task workdir it runs in
  (`/workspaces/<taskId>`), and dispatches `{tool, input}` → the matching executor, printing a JSON `{ok,result,error}`
  to stdout. The host-side `toolExecutors` overrides are thin shims that call
  `manager.exec(taskId, ["node","/opt/nklein/tool-runner.mjs", tool, JSON.stringify(input)])` (which runs
  `-u <taskUid> -w /workspaces/<taskId>`) and parse the JSON. Identical tool behavior to upstream, just executed inside
  the shared container. (Rationale: never re-implement `apply_patch`/`editor` semantics by hand.)

### J2. The sandbox image (new) — `docker/agent-sandbox/`
- [x] Add `docker/agent-sandbox/Dockerfile`:
  - Base `FROM node:22-bookworm-slim` **pinned by digest** (`node:22-bookworm-slim@sha256:…`); **never `:latest`**.
  - `RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates python3 && rm -rf /var/lib/apt/lists/*`.
  - `RUN mkdir -m 1777 /workspaces` (a fresh named volume inherits this mode, so per-task uids can create their own
    mode-700 dirs without `CAP_CHOWN` — J3/J3b). `WORKDIR /workspaces`. Do **not** bake a fixed app user; tool execs
    pass `-u <taskUid>` at runtime.
  - `COPY` the bundled `tool-runner.mjs` (+ its node_modules or a bundled single file) to `/opt/nklein/`.
  - No secrets, no `ENV` credentials.
- [x] Build script `scripts/build-agent-sandbox.mjs` + npm script `"sandbox:build"` that builds and tags
  `nklein/agent-sandbox:<package.json version>`. Resolve the image name from env `NKLEIN_AGENT_SANDBOX_IMAGE`,
  defaulting to that pinned tag.
- [x] The `tool-runner` is built from a new `src/cline-sdk/agent-sandbox/tool-runner.ts` via esbuild into a single
  `.mjs` during `sandbox:build` (and on `npm run build`).

### J3. The sandbox boundary module (new) — `src/cline-sdk/cline-agent-sandbox.ts`
A single `AgentSandboxManager` owns **all** Docker interaction (mirrors the `src/cline-sdk/` boundary; **`docker` CLI**
via `node:child_process` `execFile`, proven in CAKE2 — do **not** add `dockerode` in v1) and manages a **configurable
pool** of containers per the J8 settings. The default settings (1 container, unlimited agents per container) give
"one container for all agents." The flag block below is **one** pool container; per-task `exec` / `disposeWorkspace` /
idle / killswitch / fail-closed logic is identical no matter how many containers/agents you configure.
- [x] `class AgentSandboxManager` (singleton) with:
  - `assertAvailable(): Promise<void>` — `docker version` + `docker image inspect <image>`; throws
    `AgentSandboxUnavailableError` (CAKE2 detection of missing daemon/exe: exit 125/126/127 + stderr markers "cannot
    connect to the docker daemon", "is the docker daemon running", "executable file not found", …).
  - `acquireSlot(taskId): Promise<ContainerHandle>` — the placement + queue core (J3c): reuse a container with free
    capacity (cancel its idle timer), else start a new container if the pool is below `sandboxMaxContainers`, else
    **enqueue** until `releaseSlot` frees capacity. Tracks per-container occupancy.
  - `prepareWorkspace({ taskId, projectRepoPath, baseRef }): Promise<{ workdir; uid }>` — clone-in (J3b) into the
    acquired container.
  - `exec(taskId, argv, opts?): Promise<{ exitCode; stdout; stderr }>` —
    `docker exec -u <taskUid> -w /workspaces/<taskId> <containerId> <argv...>` on that task's container.
  - `disposeWorkspace(taskId): Promise<void>` — clean the task's workspace dir + uid registration, then `releaseSlot`
    (decrement occupancy, dequeue the next waiter; if the container is now empty, arm its idle timer — J4).
  - `stopNow(): Promise<void>` — `docker rm -f` **all** pool containers + their volumes (implicit killswitch; on dispose).
  - private `startContainer(slot)` (single-flight per slot), `releaseSlot(taskId)`, per-container idle timers, FIFO queue.
- [x] **Exact `docker run` flags for the single shared container** (limits are now **container-wide**, sized for
  concurrency; copy the lockdown set from CAKE2 `_restricted_docker_command`,
  `/Users/david/GIT/CAKE2/src/cake/services/sandbox/isolation.py:385`):
  ```
  docker run -d
    --name nklein-agent-sandbox-<slot>
    --label nklein.kind=agent-sandbox --label nklein.slot=<slot>
    --network none                         # J6: no egress
    --cap-drop ALL
    --security-opt no-new-privileges
    --pids-limit <256 × agentsPerContainer, or 1024 when unlimited>
    --memory <sandboxMemoryPerContainerMb>m   # per container, shared by its agents (J8 setting)
    --cpus <sandboxCpusPerContainer>          # per container (J8 setting)
    --read-only                            # root fs read-only…
    --tmpfs /tmp:noexec,nosuid,size=512m
    --mount type=volume,src=nklein-agent-ws-<slot>,dst=/workspaces   # …per-container volume; only it + tmpfs writable
    --mount type=bind,src=<projectRepoPath>,dst=/repos/<projectKey>,readonly   # clone source (the user's repo, ro)
    --user 0:0                             # MAIN pid only; see rationale — agent tools NEVER run as root
    <image>
    sleep infinity
  ```
  Each container gets its **own** named volume `nklein-agent-ws-<slot>` (never a single shared volume — that would
  leak workspaces across containers); remove the volume on container teardown.
  **Rationale for `--user 0:0` on the main process:** the manager must create per-task dirs in the volume. With
  `/workspaces` made mode **1777** in the image (a fresh named volume inherits the image dir's perms), each task can
  `mkdir` its **own** dir as its **own uid**, so no `CAP_CHOWN` is needed and `--cap-drop ALL` stays fully intact.
  Every actual agent tool runs via `docker exec -u <taskUid>` — **never as root**. (Root main + all caps dropped +
  no-new-privileges + read-only root fs + no network is a well-contained posture.)
- [x] **Project ro-mounts:** every pool container mounts each registered project's repo read-only at
  `/repos/<projectKey>` as the clone source (containers are created with the current project set; if it changes, new
  containers pick it up and stale ones reap on idle). The project repo is the user's own repo (not pollution) and
  read-only guarantees the agent cannot mutate it directly.
- [x] **All sizing comes from J8 settings:** per-container `--memory`/`--cpus` from `sandboxMemoryPerContainerMb` /
  `sandboxCpusPerContainer`; pool shape from `sandboxMaxContainers` / `sandboxAgentsPerContainer`; idle from
  `sandboxIdleTimeoutMinutes`; total parallelism from the existing `maxConcurrentTasks`. On container teardown also
  `docker volume rm nklein-agent-ws-<slot>` so nothing lingers.

### J3b. Per-task workspace lifecycle inside its pool container (this removes the host worktree folders)
**There are no host worktree directories anymore.** Each task's working copy lives **only** in the container volume,
isolated from other tasks. This is the larger implementation effort and it is worth it.
- [x] **Per-task uid:** assign a stable unprivileged uid per task (e.g. `70000 + (hash(taskId) % 20000)`, tracked in a
  `Map<taskId,uid>`). All of that task's execs use `-u <uid>`. Distinct uids ⇒ **OS-enforced** filesystem isolation
  between task workspaces inside the one container.
- [x] **Prepare (clone in):** `docker exec -u <uid> mkdir -m 700 /workspaces/<taskId>`, then
  `docker exec -u <uid> git clone --no-hardlinks /repos/<projectKey> /workspaces/<taskId>` and check out `baseRef`.
  Because `/workspaces` is mode 1777, the uid owns its dir at mode 700 and sibling task uids cannot read it. This
  **replaces** today's host `git worktree add` (the worktree-creation code around
  [src/workspace/task-worktree-path.ts](src/workspace/task-worktree-path.ts) and `src/workspace/`).
- [x] **Run:** the J1 executors and the J5 acceptance gate exec with `-u <uid> -w /workspaces/<taskId>` via
  `manager.exec(taskId, …)`. The in-container tool-runner uses `cwd = /workspaces/<taskId>`.
- [ ] **Extract results (patch out):** at review/completion, read the diff with
  `manager.exec(taskId, ["git","-C","/workspaces/<taskId>","add","-A"])` then
  `git -C /workspaces/<taskId> diff --staged --binary` (or `format-patch` vs `baseRef`); stream stdout to the host.
  !Klein (trusted runtime) applies that patch to the **user's host project repo** (`git apply` + commit on a task
  branch) — the only place results touch host git, and it is !Klein's code, not the agent's. Repoint the existing
  diff/merge UI + flow to read the diff from the container instead of a host worktree.
- [ ] **Cleanup:** `manager.exec(taskId, ["rm","-rf","/workspaces/<taskId>"])` + drop the uid mapping on task
  end/trash; discard any saved patch on delete. Removing the container (J4 idle stop / `stopNow`) wipes the volume —
  **zero residue on the host filesystem**.
- [ ] **Reconcile the existing worktree subsystem:** host-worktree assumptions in `src/workspace/` (worktree path,
  health checks for "accidental worktree projects", saved task patches, cleanup, and the related notes in AGENTS.md)
  must be updated to the container-workspace model or retired. Keep the diff/merge UX identical from the user's point
  of view (they still review diffs and merge from the board). This is the bulk of the effort — do it deliberately.

### J3c. The container pool, agents-per-container, and the wait queue
Driven entirely by the J8 settings; the default (1 container, unlimited agents per container) reproduces "one container
for all agents." Per-agent isolation is always the J3b model (own uid + own `/workspaces/<taskId>`), so co-tenant
agents in one container still cannot read each other's files.
- [x] **Capacity model.** A container hosts up to `sandboxAgentsPerContainer` agents (`0` = unlimited). The pool grows
  to `sandboxMaxContainers` containers. Effective parallel agents =
  `min(maxConcurrentTasks, sandboxMaxContainers × agentsPerContainer)` (treat unlimited as +∞); `maxConcurrentTasks`
  stays the outer cap.
- [ ] **Placement (`acquireSlot`).** (1) reuse any running container whose occupancy < agentsPerContainer (cancel its
  idle timer); (2) else `startContainer` if pool size < `sandboxMaxContainers`; (3) else **enqueue** the task and
  resolve when `releaseSlot` frees capacity. FIFO by board/start order. A queued task shows a "Queued — waiting for
  sandbox capacity" state on its card (reuse the existing concurrency-cap waiting state if one already exists).
  - [x] Pool slot reservation now happens before async Docker startup waits, so queue draining cannot over-assign a
    freed slot or arm idle teardown while queued work takes that slot.
  - [ ] Surface sandbox-capacity queueing on the card/session state.
- [x] **Per-container resource caps come from settings** (you chose explicit budgets): `--memory
  <sandboxMemoryPerContainerMb>m`, `--cpus <sandboxCpusPerContainer>` — shared by all agents in that container;
  `--pids-limit` scales with agents-per-container. **Total footprint = (#containers) × (per-container budget)** —
  predictable for limited hardware.
- [x] **Release + reuse.** On task end `releaseSlot` frees the slot; the container is **reused** by the next queued/new
  agent; an empty container idles for `sandboxIdleTimeoutMinutes` then is destroyed (J4). Never spawn/kill per task.
- [x] **Presets (UX sugar over the numbers):** "Shared" = `sandboxMaxContainers` 1 + `sandboxAgentsPerContainer`
  unlimited (the default); "Dedicated" = `sandboxAgentsPerContainer` 1 (one agent per container, pool grows to
  `sandboxMaxContainers`). The numbers are the source of truth; presets just set them. Setting changes apply to **new**
  placements; running agents keep their container; now-excess idle containers reap on their timer.

### J4. Lifecycle: lazy start, pool reuse, configurable idle teardown
- [x] **Single manager instance** owned by the task-session service
  ([cline-task-session-service.ts](src/cline-sdk/cline-task-session-service.ts)). Never create a container per task.
- [x] **On task start** (`startTaskSession` [L1313](src/cline-sdk/cline-task-session-service.ts#L1313) /
  `startRuntimeTaskSessionFromLaunchConfig` [L592](src/cline-sdk/cline-task-session-service.ts#L592)): before
  `sessionHost.start`, `await manager.assertAvailable()` → `await manager.acquireSlot(taskId)` (may **queue** — J3c) →
  `await manager.prepareWorkspace({ taskId, projectRepoPath, baseRef })`. Pass the manager + `taskId` into the session
  runtime so the J1 executor shims exec into this task's workspace (thread through the
  `StartClineTaskSessionRequest` / `request.cwd` carrier at
  [cline-session-runtime.ts:580](src/cline-sdk/cline-session-runtime.ts#L580)).
- [ ] **On task end** (`stopTaskSession` [L1545](src/cline-sdk/cline-task-session-service.ts#L1545), `abortTaskSession`
  [L1591](src/cline-sdk/cline-task-session-service.ts#L1591), error/park, completion): extract the patch (J3b), then
  `await manager.disposeWorkspace(taskId)` (releases the slot, dequeues the next queued task, and arms the container's
  idle timer only if it is now empty). **Never** stop a container because a single task ended — it may host others and
  the pool serves the queue.
- [x] **Idle teardown + reuse (configurable):** each container with **zero** agents arms an idle timer set by
  `sandboxIdleTimeoutMinutes` (J8, default **10**). A new agent before it fires cancels the timer and **reuses** the
  container; if it fires with still no demand, `docker rm -f` that container and `docker volume rm` its volume. Applies
  to every container in the pool. Reuse-before-recreate is mandatory — the "no constant spawn/kill" requirement.
- [x] **Killswitch (implicit, not a separate control):** removing the containers kills all agent activity at once. Wire
  `stopNow()` (removes **all** pool containers + their volumes) into `dispose`
  ([L2197](src/cline-sdk/cline-task-session-service.ts#L2197)) and runtime shutdown. Do
  **not** add a user-facing "kill agents" button — the board Start/Pause/Resume (§K) plus this idle teardown are the
  only exposed controls. Note: **board pause halts the agent loops (§K1) but keeps the container up**, so resume is
  instant.
- [x] **Orphan reaping:** on runtime startup, `docker ps -aq --filter label=nklein.kind=agent-sandbox` → `docker rm -f`
  any container left by a previous crash before starting a fresh one. The volume is recreated clean; nothing persists.

### J5. Route the remaining host-touching agent surfaces through the container
- [x] **Acceptance gate.** [cline-acceptance-gate.ts](src/cline-sdk/cline-acceptance-gate.ts) `defaultRunCommand`
  (L63) execs `/bin/sh -c` on the host via `execFileAsync`. The gate already accepts an injectable
  `options.runCommand` ([L32](src/cline-sdk/cline-acceptance-gate.ts#L32)). Every caller that runs the gate for a
  task **must** pass `runCommand` = a shim over `manager.exec(taskId, ["/bin/sh","-c",command])` (runs
  `-u <taskUid> -w /workspaces/<taskId>`). The host `defaultRunCommand` must never run for an agent task — make it
  throw if used without a bound sandbox/`taskId` in strict mode.
- [ ] **!Klein-implemented agent tools.** Audit and route through the container any of these that execute on the
  LLM's behalf: [cline-write-files-tool.ts](src/cline-sdk/cline-write-files-tool.ts),
  [cline-file-discovery-tools.ts](src/cline-sdk/cline-file-discovery-tools.ts),
  [cline-retrieval-tools.ts](src/cline-sdk/cline-retrieval-tools.ts),
  [cline-code-search.ts](src/cline-sdk/cline-code-search.ts),
  [cline-large-file-workflow.ts](src/cline-sdk/cline-large-file-workflow.ts). For each: if it is registered as an
  agent tool and reads/writes/execs, replace its host fs/child_process calls with `manager.exec(taskId, …)` (read via
  `docker exec cat/sed`, search via `docker exec rg`, large-file read via the in-container runner). If it is only used
  by trusted prebuild (indexing/embeddings), leave it (J0 out-of-scope) and add a comment saying so.
- [x] **MCP.** [cline-mcp-runtime-service.ts](src/cline-sdk/cline-mcp-runtime-service.ts): locally-executing MCP
  servers run subprocesses on the host. In strict mode, **disable local-exec MCP servers by default** (do not spawn
  them) and surface a one-line "MCP local execution is disabled under strict isolation" note. (Containerizing MCP is
  out of scope for v1; default-deny is the safe behavior.)

### J6. Network policy — default no egress; disable agent web fetch
- [x] Containers run with `--network none`. The LLM provider HTTP calls are made by the **host** !Klein process
  (the SDK runs in-process, `backendMode` local), so the agent loop works with zero container networking. Do not add
  container networking in v1.
- [x] **`webFetch`:** with no egress it cannot work. Register a `webFetch` executor that returns a clear
  "Web fetch is disabled under strict local isolation." message (or omit the tool). Do **not** fall back to host
  fetch. (!Klein is local-only anyway.)
- [x] The existing opt-in agent egress guard (commit `bd182a06`, `src/security/*`) targeted host PTY agents; it is
  superseded for agent tools by `--network none`. Leave it for user terminals; note the reconciliation in a comment.

### J7. Fail-closed enforcement (no path may ever run a tool on the host)
- [x] Add the preflight to [cline-task-start-guard.ts](src/cline-sdk/cline-task-start-guard.ts): before any task
  starts, `await AgentSandbox.assertAvailable(image)`; on failure, block the start and return the
  `AgentSandboxUnavailableError` message ("Docker is required for strict agent isolation and is unavailable: <reason>.
  Install/start Docker and run `npm run sandbox:build`.") so it surfaces in the UI start flow.
  - Done for the Cline runtime start path: `startTaskSession` refreshes the sandbox status before Cline launch and
    returns `agent_sandbox_unavailable` without creating a Cline session when Docker/image preflight fails.
- [x] Run the same preflight once at runtime startup and expose the result for J8.
- [ ] **Forbid host fallback structurally:** the host-side executor shims (J1) and the acceptance gate (J5) must throw
  if no sandbox manager + bound `taskId` is present. There is no env var, setting, or code branch that runs an agent
  tool on the host.
  Grep after implementing: no agent tool path calls `child_process`/`fs` write/`/bin/sh` directly.
  - [x] `runClineAcceptanceGate` no longer defaults to host execution for acceptance commands; callers must supply an
    explicit runner or opt into trusted host execution, while agent-task acceptance uses `runClineAcceptanceGateInSandbox`.
  - [x] Add the no-host execution guard test across SDK default executors and acceptance.

### J8. Settings/UI — isolation status (read-only) + the sandbox pool settings
- [x] Read-only **"Agent isolation" status** row in the General settings section: Docker daemon ✓/✗, sandbox image
  present ✓/✗, plus remediation text when missing ("Install Docker, start the daemon, run `npm run sandbox:build`").
  There is **no control to disable isolation** — it is mandatory.
- [x] **Sandbox pool settings (global).** Add these fields, each implemented like §E `developerModeEnabled` (config
  file shape + `RuntimeConfigState` + update inputs + read/write/save in
  [src/config/runtime-config.ts](src/config/runtime-config.ts); request **and** response schema in
  [api-contract.ts](src/core/api-contract.ts); inputs in the General section of
  [runtime-settings-dialog.tsx](web-ui/src/components/runtime-settings-dialog.tsx)):
  - `sandboxMaxContainers` (int ≥ 1, **default 1**) — pool size.
  - `sandboxAgentsPerContainer` (int ≥ 0, **default 0 = unlimited**) — agents allowed to share one container.
  - `sandboxMemoryPerContainerMb` (int > 0, **default 4096**) — RAM cap per container (show in GB in the UI).
  - `sandboxCpusPerContainer` (number > 0, **default 2**) — CPU cap per container.
  - `sandboxIdleTimeoutMinutes` (int ≥ 1, **default 10**) — idle time before an empty container shuts down.
  - **Max parallel agents** is the **existing** `maxConcurrentTasks` setting (the user's "allowed parallel agents") —
    reuse it; do **not** duplicate. Show it beside these for context.
  - Optional **presets** ("Shared" / "Dedicated") are buttons that set the numbers (J3c); the numbers are authoritative.
  - Helper text shows the **effective** parallelism `min(maxConcurrentTasks, sandboxMaxContainers ×
    sandboxAgentsPerContainer)` so the user sees when containers bound concurrency and agents will **queue**.
  - Validate ranges (maxContainers ≥ 1; agentsPerContainer ≥ 0; memory/cpus > 0; idle ≥ 1). Changes apply to **new**
    placements; running agents keep their container; now-excess idle containers reap on their timer.
  - Persisted config, API schemas, General settings controls, effective-parallelism summary, and task-session manager
    wiring are done. Preset buttons remain optional and are not required for the numeric settings source of truth.
- [x] When the preflight fails, the task create / start affordances must show the blocked reason prominently (reuse the
  start-guard message). Tasks cannot be created/started until Docker is ready.

### J9. Tests (mandatory; this is a safety feature)
- [x] **Unit, no Docker needed:** the `docker run` argv builder includes every lockdown flag, the named-volume mount,
  and a pinned image (assert no `:latest`); per-task uid assignment is stable and distinct per `taskId`;
  `assertAvailable` throws `AgentSandboxUnavailableError` when `execFile` reports docker missing/daemon down (mock
  `execFile`); `startContainer` is single-flight per slot and `acquireSlot` reuses a free container before starting a
  new one; the per-container idle timer arms when a container empties and is cancelled by a new agent; the executor
  shims serialize input and parse the runner's JSON; the acceptance gate throws if no sandbox/`taskId` is bound.
- [x] **No-host-execution guard:** with the sandbox active, spy on `node:child_process` and `node:fs` write APIs and
  assert the `bash`/`editor`/`applyPatch`/`readFile`/`search` executors and the acceptance gate **never** call them on
  the host (only `docker exec` is invoked).
- [ ] **Integration, gated on Docker available** (skip when `docker version` fails): `acquireSlot` + `prepareWorkspace`
  for **two** taskIds (default settings → same container) from a temp repo; assert task A cannot read `/workspaces/<B>`
  (uid isolation); run `bash` (`pwd`→`/workspaces/<A>`), `readFile`, `editor`, `applyPatch` in A; extract the patch and
  assert it applies cleanly to a throwaway clone of the host repo; assert **no** host worktree dir was created under
  `~/.cline/nklein/`; `disposeWorkspace` removes the dir; the idle teardown removes the container + its volume
  (`docker ps -a` / `docker volume ls` clean by label).
- [ ] **Pool + queue:** maxContainers=1 / agentsPerContainer=2 with 3 ready tasks → 2 run in the one container
  (uid-isolated), the 3rd **queues** and starts when one frees; maxContainers=2 / agentsPerContainer=1 → 2 containers,
  1 agent each, with `--memory`/`--cpus` matching the settings; a finished container is **reused** (not destroyed) by
  the next task within the idle window; lowering `sandboxMaxContainers` reaps now-excess idle containers;
  `sandboxIdleTimeoutMinutes` drives teardown (fake timers); setting changes affect only newly-started tasks.
- [x] **Fail-closed:** simulate docker-missing (point `NKLEIN_AGENT_SANDBOX_IMAGE` at a bogus image / stub
  `assertAvailable` to throw) and assert `startTaskSession` rejects with the guard message and starts **no** session.

### J10. Docs, changelog, AGENTS.md reconciliation
- [x] New spec `.plan/docs/agent-isolation.md` mirroring CAKE2's `docs/specs/03-isolation-security.md` (policy, flags,
  lifecycle, fail-closed, network, secrets-never-in-env, kill-switch via container removal).
- [x] Update [DEVELOPMENT.md](DEVELOPMENT.md): Docker is now a prerequisite; document `npm run sandbox:build`.
- [x] Update [AGENTS.md](AGENTS.md): the existing note ("!Klein is launched from the user's shell … prefer direct
  process launches") was about cloud-CLI **agent detection/startup** (now disabled). Add a note that **agent tool
  execution is containerized and host execution is forbidden**, so that guidance no longer applies to agent runs.
- [x] Update `## [Upcoming]` in [CHANGELOG.md](CHANGELOG.md) with the strict-isolation feature.

### J11. Order of work within this section
1. J2 image + J1 tool-runner (the in-container half).  2. J3 `AgentSandboxManager` + J3b per-task workspace
lifecycle (clone-in / patch-out, per-task uid) + J3c container pool + queue.  3. J1 host shims + J4 lazy-start/idle
wiring + reconcile
`src/workspace/` (retire host worktrees).  4. J5 acceptance gate + tool audit + MCP disable.  5. J6 network/webFetch.
6. J7 fail-closed + J8 status UI.  7. J9 tests.  8. J10 docs. Do not consider agent tasks runnable until J7's preflight
blocks start when Docker is absent, J9's no-host-execution guard passes, and no host worktree folder is created.

---

## A. 🔴 BLOCKER — make the branch compile and pass checks

`npm run typecheck` (root) fails with 4 errors. The agent added a **required** field `debugModeEnabled: boolean` to
`RuntimeConfigState` ([src/config/runtime-config.ts:57](src/config/runtime-config.ts#L57)) but did not update every
test fixture that builds a full `RuntimeConfigState`.

Apply the §E rename (`debugModeEnabled` → `developerModeEnabled`) **first**, then do these fixture fixes using the new
field name. (If you sequence §E after §A instead, use `debugModeEnabled` here and let §E's global rename sweep these
files too — the §E grep will catch them.)

- [x] **A1. Add the field to every `createRuntimeConfigState` test fixture** — add `developerModeEnabled: false,`
  (next to `selectedShortcutLabel`) to each returned object literal:
  - [x] [test/runtime/cline-sdk/cline-acceptance-auto-repair.test.ts:66](test/runtime/cline-sdk/cline-acceptance-auto-repair.test.ts#L66) — `function createRuntimeConfigState(): RuntimeConfigState`.
  - [x] [test/runtime/commands/task-verify.test.ts:60](test/runtime/commands/task-verify.test.ts#L60) — `function createRuntimeConfigState(modelRoles)`.
  - [x] [test/runtime/trpc/runtime-api.test.ts:330](test/runtime/trpc/runtime-api.test.ts#L330) — `function createRuntimeConfigState(): RuntimeConfigState`. Also change its `selectedAgentId: "claude"` to `"cline"`.
  - [x] [test/runtime/terminal/agent-registry.test.ts:18-19](test/runtime/terminal/agent-registry.test.ts#L18) — `function createRuntimeConfigState(overrides: Partial<RuntimeConfigState> = {})`. Add `developerModeEnabled: false,` to the **base literal before** the `...overrides` spread (this clears the TS2322 `boolean | undefined`).
- [x] **A2.** Re-run `npm run typecheck` until clean (0 errors), then `npm run web:typecheck` (keep it clean).
- [x] **A3.** Run `npm run lint`; fix any Biome findings from the edits.
- [ ] **A4. Leave the pre-existing failures alone.** `test/integration/runtime-state-stream.integration.test.ts` has
  9 failing tests (empty `workspaceId`) that fail identically on the base branch — environmental, not this work. Do
  not touch them; just confirm the count is unchanged at the end.

---

## B. Issue 1 — kill the LM Studio model-telemetry noise (drop **and** hide)

### B0. Root cause (read first)
The "Model context windows" list is the **model registry**. Entries persist to
`~/.cline/nklein/model-registry.json` and are created by *any* observation (`recordRequest` / `recordContextWindow` /
`recordCapability` / `setContextWindowOverride` → `getOrCreateEntry`) in
[src/cline-sdk/cline-model-registry.ts](src/cline-sdk/cline-model-registry.ts). tRPC `getClineModelRegistry`
([src/trpc/runtime-api.ts:1568](src/trpc/runtime-api.ts#L1568)) returns the persisted snapshot **plus** synthesized
entries from currently-configured models (`addConfiguredLocalModelRegistryEntries`,
[src/trpc/runtime-api.ts:688](src/trpc/runtime-api.ts#L688)), filtered to `isLocalProvider`. So
`lmstudio/small-local-model` etc. are **stale rows in `model-registry.json`** from past runs; they are local, pass
every filter, and never expire. There is **no prune path** today.

> The names `small-local-model` / `huge-advertised-model` also appear in test fixtures
> (`cline-task-session-service.test.ts`) and `cline-model-tool-routing.ts` (a *tool* name) — those are not the source
> and must stay.

### B1. What the agent already did (keep)
- [x] Added a loaded-model filter in the **Settings** panel `ClineModelContextWindowSettingsPanel`
  ([runtime-settings-dialog.tsx](web-ui/src/components/runtime-settings-dialog.tsx)): `loadedLmStudioModelIds`,
  `visibleRegistryEntries`, a new `selectedProviderModels` prop fed from `clineSettings.providerModels`.

### B2. Add one shared filter and use it in both panels
- [x] Add an exported pure function in
  [cline-model-registry-panel.tsx](web-ui/src/components/detail-panels/cline-model-registry-panel.tsx):
  ```ts
  export function filterRegistryEntriesToLoadedModels(
    entries: readonly RuntimeClineModelRegistryEntry[],
    selectedProviderId: string,
    loadedProviderModels: readonly RuntimeClineProviderModel[],
  ): RuntimeClineModelRegistryEntry[]
  ```
  Behavior: when `selectedProviderId` is an **on-device local provider** (`lmstudio` / `lm-studio` / `ollama`), keep
  only entries whose `providerId` matches the selected provider **and** whose `modelId` is in the loaded set; if the
  loaded set is empty (endpoint unreachable), return `[]` for that provider; for any other provider return `entries`
  unchanged. Add a small `isOnDeviceLocalProviderId(id)` helper (reuse `isLmStudioProviderId` from
  [cline-context-window-policy.ts](web-ui/src/runtime/cline-context-window-policy.ts) and add the Ollama case).
- [x] Replace the inline `visibleRegistryEntries` memo in `ClineModelContextWindowSettingsPanel` with a call to this
  helper.
- [x] **Fix the chat panel.** [cline-agent-chat-panel.tsx:744](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L744)
  `modelRegistryEntries` is passed **raw** to `ClineModelRegistryPanel` at
  [~L1210](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L1210). Wrap it with the same helper using
  `clineSettings.providerId` and `clineSettings.providerModels`.

### B3. Add a real prune/delete path (the "drop completely" half)
- [x] **Registry.** In [cline-model-registry.ts](src/cline-sdk/cline-model-registry.ts) add
  `async removeEntry(key: string): Promise<boolean>` and
  `async removeEntries(keys: readonly string[]): Promise<number>`. Each mutates `snapshot.models`, bumps
  `updatedAt`, and calls `schedulePersist` (mirror `setContextWindowOverride`).
- [x] **tRPC.** Add `removeClineModelRegistryEntry` (single key) and `pruneClineModelRegistry` (remove every row that
  is not currently loaded or configured):
  - schema in [src/core/api-contract.ts](src/core/api-contract.ts) near
    `runtimeClineModelContextWindowOverrideRequestSchema`;
  - parser in [src/core/api-validation.ts](src/core/api-validation.ts);
  - router wiring in [src/trpc/app-router.ts](src/trpc/app-router.ts) near `saveClineModelContextWindowOverride`;
  - handler in [src/trpc/runtime-api.ts](src/trpc/runtime-api.ts) near
    [saveClineModelContextWindowOverride (~L1595)](src/trpc/runtime-api.ts#L1595), guarded by
    `assertLocalProviderAllowed`. `pruneClineModelRegistry` computes the keep-set from
    `addConfiguredLocalModelRegistryEntries` inputs (launch/provider/role configs) ∪ currently-loaded provider
    models, then removes the rest.
- [x] **UI.** In [cline-model-registry-panel.tsx](web-ui/src/components/detail-panels/cline-model-registry-panel.tsx):
  add an optional `onRemoveEntry?(entry)` per-row button (`lucide-react` `Trash2`) and a header **"Clear stale
  models"** button wired to a `onPruneStale?()` callback. Plumb both from the Settings panel and the chat panel;
  refetch after success (like `handleSaveModelContextWindowOverride`, chat-panel L734-742); toast via `showAppToast`
  ("Removed N stale models"). The Clear action must work even when the local server is down so the junk can be
  dropped offline.
- [x] Configured/loaded rows that get removed will be re-synthesized by `addConfiguredLocalModelRegistryEntries` —
  that is correct (real models reappear). The junk rows are neither configured nor loaded, so they stay gone.

### B4. Verify there is no third consumer
- [x] `grep -rn "ClineModelRegistryPanel\|getClineModelRegistry" web-ui/src | grep -v test` returns the
  API query wrapper plus the Settings panel and chat panel UI consumers; both UI consumers now use the shared loaded
  model filter.

---

## C. Issue 2 — show the actually-selected, actually-loaded LM Studio model + real context window

### C0. The data already exists
`getClineProviderModels` → `loadProviderModelsWithMeasuredWindows` → `toLmStudioModel` / `toLmStudioModels`
([cline-provider-service.ts:409-493](src/cline-sdk/cline-provider-service.ts#L409)) reads the **real loaded** context
length from LM Studio (`loaded_context_length`, `loaded_instances[].config`, `max_context_length`, …). It surfaces as
`RuntimeClineProviderModel.contextWindow` in `clineSettings.providerModels`. This is a presentation task.

### C1. What the agent already did (keep)
- [x] Added a **"Selected loaded model: <name> (<n> ctx)"** line in `ClineModelContextWindowSettingsPanel` using
  `selectedLoadedProviderModel = findClineProviderModel(selectedProviderModels, selectedModelId)` and
  `formatClineModelContextWindowLabel` ([cline-context-window-policy.ts:33](web-ui/src/runtime/cline-context-window-policy.ts#L33)).

### C2. Make it consistent and unambiguous
- [x] Label the live value vs telemetry so they can't be confused: the C1 line reads **"Selected loaded model (live):
  …"**; the registry section header reads **"Past telemetry"**.
- [x] Render the same **"Selected loaded model (live)"** line in the chat panel near the telemetry header
  ([cline-agent-chat-panel.tsx:744-751,1208-1217](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L744)),
  from `clineSettings.providerModels` + `clineSettings.modelId`, reusing `formatClineModelContextWindowLabel`.
- [x] When `selectedLoadedProviderModel` is null, render a muted line: **"Selected model is not currently loaded in LM
  Studio."** in both places. Never render nothing.
- [x] The Settings panel refresh button must also re-pull `providerModels` (not just the registry) so swapping the
  loaded model in LM Studio is reflected without reopening Settings. Wire the provider-model query refetch into the
  same refresh handler.

---

## D. Issue 3 — NO CLOUD: local default + remove every cloud path/affordance

Single source of truth: `CLOUD_ENABLED = false`
([src/cline-sdk/cline-local-only-policy.ts:12](src/cline-sdk/cline-local-only-policy.ts#L12)); the response exposes it
as `cloudProviderSupportEnabled` ([agent-registry.ts:128](src/terminal/agent-registry.ts#L128)). Everything derives
from that flag.

### D1. What the agent already did (keep)
- [x] `AUTO_SELECT_AGENT_PRIORITY = []`, `DEFAULT_AGENT_ID = "cline"`
  ([runtime-config.ts:54,113](src/config/runtime-config.ts#L113)).
- [x] `resolveSelectedAgentIdForLocalOnly()` clamps non-`cline` → `cline` in `getCuratedDefinitions`,
  `resolveAgentCommand`, `buildRuntimeConfigResponse` ([agent-registry.ts:53,75,128](src/terminal/agent-registry.ts#L53));
  supported catalog filtered to `cline`.
- [x] Settings default `"cline"`; `displayedAgents` filtered to `cline` when cloud off
  ([runtime-settings-dialog.tsx:1648,1663](web-ui/src/components/runtime-settings-dialog.tsx#L1648)).
- [x] Home agent session refuses terminal CLI agents when `cloudProviderSupportEnabled !== true`
  ([use-home-agent-session.ts:144](web-ui/src/hooks/use-home-agent-session.ts#L144)); sidebar shows a local-only
  message ([use-home-sidebar-agent-panel.tsx:196-204](web-ui/src/hooks/use-home-sidebar-agent-panel.tsx#L196)).
- [x] Provider catalog local-only via `isLocalProvider` ([cline-provider-service.ts:1431](src/cline-sdk/cline-provider-service.ts#L1431));
  web `filterVisibleClineProviderCatalog` ([native-agent.ts:37](web-ui/src/runtime/native-agent.ts#L37)).

### D2. Clamp cloud agents at the source (`normalizeAgentId`)
- [x] In [runtime-config.ts:194](src/config/runtime-config.ts#L194), make `normalizeAgentId` return `DEFAULT_AGENT_ID`
  whenever `!CLOUD_ENABLED` and the id is a cloud agent (everything except `cline`). Import `CLOUD_ENABLED` from
  `../cline-sdk/cline-local-only-policy`. A persisted `selectedAgentId:"claude"` now loads as `"cline"` and self-heals.
- [x] Keep the three `resolveSelectedAgentIdForLocalOnly` clamps in `agent-registry.ts` as defense in depth.
- [x] Add a unit test in [test/runtime/config/runtime-config.test.ts](test/runtime/config/runtime-config.test.ts): a
  config file with `selectedAgentId:"claude"` loads with `selectedAgentId === "cline"`.

### D3. Stop the onboarding carousel from listing cloud agents
[task-start-agent-onboarding-carousel.tsx:545-558](web-ui/src/components/task-start-agent-onboarding-carousel.tsx#L545)
builds `onboardingAgents` from **all** of `ONBOARDING_AGENT_IDS = ["cline","claude","codex","droid","kiro"]`
([L95](web-ui/src/components/task-start-agent-onboarding-carousel.tsx#L95)) and renders them at
[L711](web-ui/src/components/task-start-agent-onboarding-carousel.tsx#L711). `cloudProviderSupportEnabled` is already
in scope (L540).
- [x] Restrict `onboardingAgents` to `cline` only when `!cloudProviderSupportEnabled` (filter the id list before the
  map). The Claude-specific copy at [L467,483](web-ui/src/components/task-start-agent-onboarding-carousel.tsx#L467)
  becomes unreachable then — leave it (dead but harmless) or delete it; deleting is cleaner.

### D4. Hide the agent picker entirely when only `cline` is selectable
- [x] In [runtime-settings-dialog.tsx:2561-2572](web-ui/src/components/runtime-settings-dialog.tsx#L2561), when
  `!cloudProviderSupportEnabled` do not render the `displayedAgents.map(...)` rows or the "Checking which CLIs are
  installed…" line; render a single static line **"Local Cline agent (cloud disabled)."** instead. Keep the bypass /
  developer-mode controls below it.
- [x] Add a code comment on both the backend `MANAGED_CLOUD_PROVIDER_IDS`/`LOCAL_PROVIDER_IDS`
  ([cline-local-only-policy.ts:15-18](src/cline-sdk/cline-local-only-policy.ts#L15)) and the web
  `KNOWN_CLOUD_PROVIDER_IDS` ([native-agent.ts:15](web-ui/src/runtime/native-agent.ts#L15)) cross-referencing each
  other, so a future provider addition updates both. (Backend catalog is default-deny and authoritative; the web list
  is a secondary screen.)

### D5. Regression test
- [x] Extend coverage so that with `cloudProviderSupportEnabled = false`: settings renders no agent rows (just the
  static line), onboarding agents resolve to `["cline"]`, and the provider catalog excludes
  anthropic/openai/etc. Build on the existing home-session test
  ([use-home-agent-session.test.tsx:335](web-ui/src/hooks/use-home-agent-session.test.tsx#L335)).

---

## E. Issue 4 — persistent "Developer Mode" toggle (rename, fix, unify)

### E0. The four tangled concepts (read first)
1. `debugModeEnabled` — the new **persistent** global config field
   ([runtime-config.ts:57](src/config/runtime-config.ts#L57); api-contract L1433/L1453).
2. `isRuntimeDebugModeEnabled()` — an **env-var** switch ([agent-registry.ts:49](src/terminal/agent-registry.ts#L49)).
3. `developerModeEnabled` — the **prop** the agent renamed on `ProjectNavigationPanel`
   ([project-navigation-panel.tsx:91](web-ui/src/components/project-navigation-panel.tsx#L91)).
4. `import.meta.env.DEV` — Vite **dev-build** flag, AND-ed with the toggle for the sidebar dev-test card
   ([project-navigation-panel.tsx:501](web-ui/src/components/project-navigation-panel.tsx#L501)).

The response field is `debugModeEnabled = runtimeConfig.debugModeEnabled || isRuntimeDebugModeEnabled()`
([agent-registry.ts:280](src/terminal/agent-registry.ts#L280)). Because of the `||`, a set env var forces developer
surfaces on **and** the Settings switch (seeded from the merged value) saves `true` even when the user never opted in;
toggling **off** cannot win against the env var. Per §0.3 decision 1, the persistent setting becomes
`developerModeEnabled`; the env var becomes a fallback that only applies when the setting is unset.

### E1. What the agent already did (keep, then rename)
- [x] Threaded `debugModeEnabled` through the config lifecycle (file shape, state, update inputs, read/write,
  `updateRuntimeConfig`/`updateGlobalRuntimeConfig`, `toGlobalRuntimeConfigState`, `saveRuntimeConfig`), the save
  schema ([api-contract.ts:1453](src/core/api-contract.ts#L1453)), and a Radix switch in Settings
  ([runtime-settings-dialog.tsx:2594-2611](web-ui/src/components/runtime-settings-dialog.tsx#L2594)).
- [x] Gated the sidebar dev-test card and the Settings "Developer Tools" block behind the toggle.

### E2. Rename the persistent setting to `developerModeEnabled` everywhere
Rename the field/booleans (leave the env-var function `isRuntimeDebugModeEnabled` and `NKLEIN_DEBUG`/`KANBAN_DEBUG`):
- [x] [src/config/runtime-config.ts](src/config/runtime-config.ts) — `RuntimeGlobalConfigFileShape`,
  `RuntimeConfigState`, `RuntimeConfigUpdateInput`, `DEFAULT_DEBUG_MODE_ENABLED` → `DEFAULT_DEVELOPER_MODE_ENABLED`,
  and every read/write/update/save site (`grep -n debugModeEnabled src/config/runtime-config.ts`). In
  `toRuntimeConfigState`, read it as: if `globalConfig?.developerModeEnabled` **or** legacy
  `globalConfig?.debugModeEnabled` is present use that (normalized); else fall back to the debug-override env (see E3).
- [x] [src/core/api-contract.ts](src/core/api-contract.ts) — rename the field in **both**
  `runtimeConfigResponseSchema` (L1433) and `runtimeConfigSaveRequestSchema` (L1453).
- [x] [src/terminal/agent-registry.ts:280-293](src/terminal/agent-registry.ts#L280) — see E3.
- [x] Web: [use-debug-tools.ts:46-47,96](web-ui/src/hooks/use-debug-tools.ts#L46) (the returned boolean →
  `developerModeEnabled`), [App.tsx:182,912,966-967,1240,1246](web-ui/src/App.tsx#L182),
  [project-navigation-panel.tsx](web-ui/src/components/project-navigation-panel.tsx) (prop is already
  `developerModeEnabled`), and in [runtime-settings-dialog.tsx](web-ui/src/components/runtime-settings-dialog.tsx)
  the state `debugModeEnabled`/`initialDebugModeEnabled`/`setDebugModeEnabled`, the `config?.debugModeEnabled` reads,
  and the save payload (L2468).
- [x] Tests: [project-navigation-panel.test.tsx](web-ui/src/components/project-navigation-panel.test.tsx),
  [use-home-agent-session.test.tsx](web-ui/src/hooks/use-home-agent-session.test.tsx),
  [runtime-settings-dialog.test.tsx](web-ui/src/components/runtime-settings-dialog.test.tsx), plus the §A fixtures.
- [x] Final sweep: `rg -n "debugModeEnabled" src web-ui/src` returns no production source matches; the legacy
  read-fallback in `toRuntimeConfigState` uses a dynamic key so future direct references do not reappear unnoticed.

### E3. Fix the env-var override semantics (setting wins)
- [x] Move the env-var fallback to **load time** so the response carries an authoritative value. Add a tiny
  `isDebugOverrideEnvEnabled()` (read `NKLEIN_DEBUG`/`KANBAN_DEBUG`) — put it in `src/config/runtime-config.ts` (or a
  new `src/config/debug-override.ts`) to avoid the `agent-registry → config` import cycle, and have
  `agent-registry.ts` import it from there. In `toRuntimeConfigState`: `developerModeEnabled = (storedValue is present
  ? storedValue : isDebugOverrideEnvEnabled())`.
- [x] In `buildRuntimeConfigResponse` ([agent-registry.ts:280](src/terminal/agent-registry.ts#L280)) return
  `runtimeConfig.developerModeEnabled` **directly** — remove the `|| isRuntimeDebugModeEnabled()` merge.
- [x] Stop seeding the Settings switch from any env-polluted value (it now reads the clean config field).
- [x] Test: env var set + persisted `false` ⇒ response `developerModeEnabled === false`; env var set + unset config ⇒
  `true`.

### E4. Make the dev-build gating uniform and commented (per §0.3 decision 3)
- [x] Sidebar **Dev Test Scenarios** / **self-improvement** card: keep `import.meta.env.DEV && developerModeEnabled`
  ([project-navigation-panel.tsx:501](web-ui/src/components/project-navigation-panel.tsx#L501)). Add comment:
  `// dev source tree required → DEV build AND developer mode`.
- [x] **Debug dialog/button** ([App.tsx:966-967,1250](web-ui/src/App.tsx#L966)), **command-palette "Developer
  Tools"** ([App.tsx:1240](web-ui/src/App.tsx#L1240); [command-palette.tsx:80](web-ui/src/components/command-palette.tsx#L80)),
  **settings "Developer Tools"** ([runtime-settings-dialog.tsx:2934](web-ui/src/components/runtime-settings-dialog.tsx#L2934)),
  **data-dir / reset** actions: gate on `developerModeEnabled` **only**. Add comment:
  `// informational dev surface → developer mode only (works in packaged builds)`.

### E5. Move the toggle to General and confirm global scope
- [x] The switch is under "Enable bypass permissions" in the agent section
  ([runtime-settings-dialog.tsx:2594](web-ui/src/components/runtime-settings-dialog.tsx#L2594)). Move it into the
  **General** settings section with help text: "Shows developer-only surfaces: sidebar dev-test scenarios, debug
  tools, data-dir shortcut, reset state."
- [x] Confirm `save()` writes it to the **global** config (the field lives in `RuntimeGlobalConfigFileShape`); it must
  not be project-scoped.
- [x] Keep the dirty-state comparison working (`hasUnsavedChanges` vs `initialDeveloperModeEnabled`,
  [runtime-settings-dialog.tsx:1845](web-ui/src/components/runtime-settings-dialog.tsx#L1845)).

### E6. Verify every gated surface after the rename
- [x] `grep -rn "developerModeEnabled" web-ui/src` shows one consistent name driving: sidebar dev-test, debug dialog,
  command-palette Developer Tools, settings Developer Tools, data-dir/reset. Toggle off hides all; on shows all;
  persists across reload.

---

## F. Issue 5 — embedding model selector auto-lists local LM Studio models

### F0. Current behavior
Embedding fields live in `CodeEmbeddingProviderFields`
([runtime-settings-dialog.tsx:268-440](web-ui/src/components/runtime-settings-dialog.tsx#L268)), rendered twice:
**Default/global** (`labelPrefix="Default"`, [~L2980](web-ui/src/components/runtime-settings-dialog.tsx#L2980)) and
**Project override** (`labelPrefix="Project"`, [~L3034](web-ui/src/components/runtime-settings-dialog.tsx#L3034)).
Providers: `local_lexical` and `openai_compatible` ([L462](web-ui/src/components/runtime-settings-dialog.tsx#L462)).
Discovery exists (`handleDiscoverModels` → `discoverClineEndpointModels` → backend `discoverEndpointModels` →
`discoverModelsFromEndpoint`, [cline-provider-service.ts:624,1523](src/cline-sdk/cline-provider-service.ts#L624)) and
renders a `<NativeSelect>` of `discoveredModels` — but only after a manual button click and a manually-typed endpoint.

### F1. Auto-discover when the provider is openai_compatible and the endpoint is a reachable local URL
- [x] In `CodeEmbeddingProviderFields`, add a debounced `useEffect` (use `useDebounce` from
  `@/kanban/utils/react-use`, ~500ms) that runs the discovery logic automatically when
  `provider === "openai_compatible"` **and** `baseUrl.trim()` is a non-empty local URL **and** the baseUrl changed (or
  `discoveredModels` is empty). Keep the manual "Discover models" / "Test endpoint" buttons as explicit refresh.
- [x] Auto attempts fail **quietly**: on error set the muted `discoveryMessage`, do **not** call `onError` (no red
  toast). Track the in-flight baseUrl and ignore stale responses if it changed mid-flight.

### F2. Prefill the endpoint from the configured LM Studio provider
- [x] When the embedding provider is `openai_compatible` and the endpoint is blank, prefill it from the selected local
  chat provider's base URL (available via `clineSettings` provider id/baseUrl / `clineSettings.providerCatalog`).
  Derive the embeddings path (e.g. `http://127.0.0.1:1234/v1` → `http://127.0.0.1:1234/v1/embeddings`). Pass it as a
  new `suggestedBaseUrl` prop to both `CodeEmbeddingProviderFields` instances; initialize
  `codeEmbeddingDefaultsBaseUrl` ([L1576](web-ui/src/components/runtime-settings-dialog.tsx#L1576)) from it when the
  stored value is empty. If LM Studio is not the selected provider, fall back to the existing placeholder.
- [x] `local_lexical` stays the zero-config default provider; auto-fill/auto-discover apply only to
  `openai_compatible`.

### F3. Prefer embedding-type models for LM Studio
- [x] When discovering for embeddings, prefer the `/api/v0/models` candidate in `discoverModelsFromEndpoint`
  ([cline-provider-service.ts:600-621,656](src/cline-sdk/cline-provider-service.ts#L600)) and, when LM Studio reports
  a `type` field, sort `type === "embeddings"` models first. Do not hard-filter (a user may run an embedding model LM
  Studio mislabels) — sort/flag only. Carry the `type` through `toLmStudioModel` /
  `extractDiscoveredModelsFromPayload` if it is not already present.

### F4. Tests
- [x] Mock `discoverClineEndpointModels`: selecting `openai_compatible` with a local baseUrl populates the
  `<NativeSelect>` with no click; a blank/non-local baseUrl does not fire; a failed auto-attempt raises no error toast.
- [x] Test the endpoint derivation (LM Studio base → `/v1/embeddings`).
- [x] Test that embedding-type models sort first when a `type` field is present.

---

## G. Cross-cutting cleanups (do alongside the above)

- [ ] **CHANGELOG.** Update the two `## [Upcoming]` bullets the agent added ([CHANGELOG.md](CHANGELOG.md)) to describe
  the final behavior (prune action, chat-panel filtering, live loaded-model line, cloud-picker hidden, developer-mode
  rename, embedding auto-discovery). Keep `## [Upcoming]` current in this same change (repo rule).
- [x] **State typing.** `RuntimeConfigState.developerModeEnabled` stays required `boolean`; inputs/file-shape stay
  optional. Every full-state object literal supplies a concrete boolean (this is what broke §A).
- [x] **Repo rules:** no new `any`, no inline imports, `react-use` hooks for the F1 debounce, Tailwind over inline
  styles. New helpers (B2 filter, F1 effect) follow them.
- [x] **Brand-regression guard.** The agent added two allowed patterns
  ([brand-regression.test.ts:32-33](test/runtime/brand-regression.test.ts#L32)). Keep the allowlist in sync with any
  new user-visible strings (B3 toast, C2 hints, D4 line).

---

## K. Runtime control & chat UI (round-2 requests)

### K1. Board pause must actually halt the running agent loop (not just block new starts)
**K1.0 Root cause.** "Pause" on the board calls `requestSwarmStop`
([kanban-board.tsx:294](web-ui/src/components/kanban-board.tsx#L294)), which writes `swarm-stop.json`
([src/core/swarm-guardrails.ts](src/core/swarm-guardrails.ts)). That signal is **only read at task start**
([runtime-api.ts:1017-1022](src/trpc/runtime-api.ts#L1017)) to refuse new starts. A task that is **already running**
never re-checks it, so its autonomous loop keeps issuing turn after turn (LLM request after request). That is the bug.
> Also fix the latent rename miss: `getSwarmStopSignalPath` uses `.cline/kanban/`
> ([swarm-guardrails.ts:16](src/core/swarm-guardrails.ts#L16)) — change to `.cline/nklein/` (the runtime-home
> constant), with a one-release read-fallback to the old path so an in-flight pause survives the rename. **Done.**

**K1.1 Add a shared pause primitive.** Create `src/cline-sdk/cline-pause-controller.ts` exporting a `PauseController`
with: `isPaused(taskId): boolean` (true if the **board** is paused OR **this card** is paused — K2),
`waitUntilResumed(taskId, signal?): Promise<void>` (resolves when unpaused; rejects on task stop/abort), and
`setBoardPaused(bool)` / `setCardPaused(taskId, bool)` that notify waiters. Back the board flag with the existing
swarm-stop file and the card flags with K2's store so state survives a runtime restart.

**K1.2 Gate the loop continuation (no new LLM request while paused).** The autonomous loop is halted today at the
per-turn checkpoint: `applyTurnCheckpoint` → `enforceAutonomyBudgets`
([cline-task-session-service.ts:2007-2017](src/cline-sdk/cline-task-session-service.ts#L2007)), which parks the task
via `parkTaskForAutonomyBudget` ([L2156](src/cline-sdk/cline-task-session-service.ts#L2156)) — and that helper stops
the SDK by calling `this.sessionRuntime.abortTaskSession(taskId)` ([L2165](src/cline-sdk/cline-task-session-service.ts#L2165)).
- [x] In `enforceAutonomyBudgets`, **before** the existing budget checks, add: `if (pauseController.isPaused(taskId)) return this.parkTaskForPause({ taskId, entry });`. Because this runs **after** the in-flight turn's checkpoint, the in-flight response is fully received and processed first, then the loop halts before the next turn — exactly the user's accepted semantics ("ok to receive responses for already-sent requests; no new requests").

**K1.3 New "paused" park state (distinct from the guardrail "attention" park).**
- [x] Add `parkTaskForPause(...)` mirroring `parkTaskForAutonomyBudget` but: set `state: "paused"` (add this state to
  the session-summary state union / schema in [src/core/api-contract.ts](src/core/api-contract.ts) and the web type),
  **do not** set `reviewReason: "attention"`, inject a quieter system note ("Paused — will resume when the board/card
  is resumed."), and record that the task is *resumable* (so K1.4 knows to auto-continue it). Still call
  `abortTaskSession` to stop the SDK from issuing the next turn.

**K1.4 Auto-resume on unpause (drain the queue).**
- [x] When the board is resumed (`clearSwarmStop`, [runtime-api.ts:825](src/trpc/runtime-api.ts#L825)) **or** a card
  is resumed (K2), the session service must re-drive every task currently parked as `"paused"`. Re-continue via the
  existing continuation path `sendTaskSessionInput` ([cline-task-session-service.ts:1651](src/cline-sdk/cline-task-session-service.ts#L1651))
  with an empty/continue instruction (the same way a parked task is continued today), so the agent picks up from the
  last checkpoint. Resume only tasks that were paused by this controller — never silently restart guardrail-parked or
  failed tasks. **Done for board and per-card resume; queued tool-executor gating remains K1.5.**
- [x] `clearSwarmStop`/`requestSwarmStop` handlers must call `pauseController.setBoardPaused(...)` so the in-memory
  gate flips immediately (not only on next poll).

**K1.5 Queue in-flight side effects too (precise "processing goes into a queue").** Because every agent tool now runs
through !Klein's injected executors (★ MANDATORY WORKSTREAM, J1) and the acceptance gate (J5), make those executors
**await the pause gate before executing**: at the top of each Docker-backed executor and the acceptance-gate
`runCommand`, `await pauseController.waitUntilResumed(taskId, abortSignal)`. Effect: if a response arrives mid-turn
with pending tool calls while paused, the tool calls **block (queue) until resume** instead of running — no host/agent
side effects occur while paused. On task stop/abort the gate rejects so the executor unwinds cleanly.
**Done for Docker-backed SDK default tool executors and sandbox acceptance-gate commands.**

**K1.6 Tests.** Pause while a task is running ⇒ no further `start`/turn requests are issued (spy on the SDK
start/continue); the `"paused"` state is emitted; a queued tool executor does not run until resume; on resume the task
re-continues exactly once; board-resume drains all paused tasks; card stop while paused rejects the gate. **Checkpoint
park/resume, board API drain, queued sandbox tool gating, sandbox acceptance gating, and stop/abort waiter rejection are
covered.**

### K2. Per-card pause / resume, and a replay control for finished cards
**K2.1 Card pause store + API.**
- [x] Persist per-task pause in `.cline/nklein/paused-tasks.json` (a `string[]` of taskIds) via `lockedFileSystem`,
  mirroring `swarm-guardrails.ts`. Add `src/core/card-pause.ts` with `readPausedTasks`, `setCardPaused(taskId,bool)`.
- [x] tRPC: `pauseTask` / `resumeTask` mutations (schema in [api-contract.ts](src/core/api-contract.ts), parsers in
  [api-validation.ts](src/core/api-validation.ts), wiring in [app-router.ts](src/trpc/app-router.ts) near
  `requestSwarmStop`, handlers in [runtime-api.ts](src/trpc/runtime-api.ts)). Both call
  `pauseController.setCardPaused(...)` and persist. Include `paused: boolean` on the task session summary
  (`RuntimeTaskSessionSummary`) so the UI can render state.

**K2.2 Toggle the card's start button → Pause → Resume (per user's exact ask).** Today the action button is
column-scoped in [board-card.tsx:808-819](web-ui/src/components/board-card.tsx#L808): `backlog`/`planning` show
"Start task" (`Play`, `onStart`), `review` shows "Move to completed". Extend:
- [x] **Not started** (`backlog`/`planning`): keep "Start task" (`Play`).
- [x] **Running** (in-progress, `summary.state === "running"` and not paused): show **Pause** (`Pause` icon,
  `aria-label="Pause task"`, `onPauseTask?.(card.id)`).
- [x] **Paused** (`summary.state === "paused"` or in `paused-tasks`): show **Resume** (`Play` icon,
  `aria-label="Resume task"`, `onResumeTask?.(card.id)`).
- [x] Thread `onPauseTask` / `onResumeTask` props through `BoardCard` (next to `onStart`,
  [board-card.tsx:384,411](web-ui/src/components/board-card.tsx#L384)) and wire them in the board/column parent to the
  K2.1 mutations. Mutation responses update the parent session store immediately, while `pausedTaskIds` overlays keep
  the card control in sync before the next session event/poll.

**K2.3 Finished cards: disabled by default, optional Replay (off by default in global settings).**
- [x] Add a global setting `replayCardsEnabled: boolean` (default **false**) — implement it exactly like the §E
  `developerModeEnabled` field: config file shape + `RuntimeConfigState` + update inputs + read/write/save in
  [src/config/runtime-config.ts](src/config/runtime-config.ts), the request **and** response schema in
  [api-contract.ts](src/core/api-contract.ts), and a Settings toggle in
  [runtime-settings-dialog.tsx](web-ui/src/components/runtime-settings-dialog.tsx) (General section) with help text
  "Show a Replay button on finished cards to re-run them from scratch."
- [x] **Finished** cards (`review` / completed / `done`): when `replayCardsEnabled` is false (default), the action
  button is **disabled** (or absent). When true, show **Replay** (`RotateCcw` icon, `aria-label="Replay task"`,
  `onReplayTask?.(card.id)`).
- [x] Replay = re-run the card from scratch: reset/recreate the task worktree and start a fresh session (reuse the
  start path used by `onStart`/`startTaskSession`, plus worktree reset). Confirm with the user (`window.confirm`)
  before discarding the previous result. Pass `replayCardsEnabled` down to `BoardCard` so the button only renders when
  enabled.

**K2.4 Tests.** Running card renders Pause; clicking pauses (state → paused) and the button becomes Resume; finished
card shows no actionable button when `replayCardsEnabled` is false and a Replay button when true; Replay re-starts the
session. **Done with card, board, settings, persistence/config, runtime API, and interaction-hook tests.**

### K3. Timestamp every chat-log message (top-right, collapsible, with duration on hover)
**K3.0 Data.** Each message already carries `createdAt` (`RuntimeTaskChatMessage`,
[api-contract.ts:1720](src/core/api-contract.ts#L1720)); `meta` has **no** duration field. Messages render in
`ClineChatMessageItem` ([cline-chat-message-item.tsx:181](web-ui/src/components/detail-panels/cline-chat-message-item.tsx#L181)),
whose role-specific wrappers are at [L192](web-ui/src/components/detail-panels/cline-chat-message-item.tsx#L192) (user
bubble), [L203](web-ui/src/components/detail-panels/cline-chat-message-item.tsx#L203), and
[L209](web-ui/src/components/detail-panels/cline-chat-message-item.tsx#L209).

**K3.1 Compute duration in the list (no backend change).** In the message-list render
([cline-agent-chat-panel.tsx:1125](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L1125)) pass each
item a `durationMs` = `nextMessage.createdAt − message.createdAt` (for the last/in-flight message, `nowMs −
createdAt`, using the existing `nowMs` ticker). This represents "how long the underlying activity / LLM response took
before the next event." (Optional accuracy later: record a real `meta.durationMs` at the source.)

**K3.2 Render the timestamp — top-right, inside existing space, zero layout shift.**
- [x] Make each message wrapper `relative` and add an **absolutely-positioned** timestamp at `top-0 right-0`
  (`absolute top-0.5 right-1`), `text-[10px] text-text-tertiary`, non-selectable, `pointer-events-auto`. Because it is
  absolutely positioned it does **not** change the existing layout/line height. Format as local `HH:MM:SS`
  (use `Intl.DateTimeFormat` / `date-fns` `format`, already-available deps).
- [x] Add right padding to the message content (`pr-12` or similar) **only** so long content doesn't run under the
  timestamp — keep it minimal so the layout is visually unchanged when there is no overlap.

**K3.3 Collapsible to a tiny icon (click to toggle), hover shows full info.**
- [x] One panel-level state `timestampsCollapsed` (persist in `localStorage` via a new `LocalStorageKey`), toggled by
  clicking **any** timestamp or the collapsed icon. Expanded = the `HH:MM:SS` text; collapsed = a tiny `Clock`
  (`lucide-react`, size 11) sitting in the same top-right corner — still large enough to click to expand again.
- [x] In **both** states, a `Tooltip` (`@/components/ui/tooltip`) on hover shows the full absolute date-time **and**
  the duration (e.g. "2026-06-19 14:03:11 · took 4.2s"). Use the existing `Tooltip` primitive; format duration with a
  small helper (`<1s` → "Nms", else "N.Ns", minutes as "Nm Ns").
- [x] Keep it subtle and NICE: tertiary color, no border, no background; the clock icon only appears on the corner and
  brightens on hover (`hover:text-text-secondary`). It must never cover tool-block chevrons or the spinner — verify
  against the running-tool layout ([cline-chat-message-item.tsx:43](web-ui/src/components/detail-panels/cline-chat-message-item.tsx#L43)).

**K3.4 Tests.** Timestamp shows local time from `createdAt`; clicking collapses all to the clock icon and persists;
hover tooltip contains both timestamp and formatted duration; the collapsed icon stays clickable.

### K4. Context-usage bar — dedicated full-width line
The bar (`ClineContextBudgetBar`,
[cline-agent-chat-panel.tsx:194](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L194)) is currently
crammed into a `flex flex-wrap items-center gap-2` row at
[L1136-1143](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L1136) alongside `cardContentText`,
`modelActivityText`, `modelRegistryText`, and (via `ml-auto`) the context-scope `<NativeSelect>` — so it is squeezed
to `min-w-[220px]` and wraps awkwardly.
- [x] Move `ClineContextBudgetBar` **out** of that flex row into its **own row** directly above (or below) it, spanning
  the full panel width: wrap it in `<div className="px-2 pt-2 w-full">`. Leave the meta text + scope select in their
  own row.
- [x] In `ClineContextBudgetBar` change the root from `flex min-w-[220px] max-w-full flex-col gap-1`
  ([L215](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L215)) to `flex w-full flex-col gap-1`, so
  the segmented bar (already `w-full` at [L223](web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx#L223))
  uses all available width. Keep the summary text line; it can sit left-aligned above the bar.
- [x] Apply the same dedicated-line treatment anywhere else the bar renders for a card — check
  [card-detail-view.tsx](web-ui/src/components/card-detail-view.tsx) and
  [board-card.tsx](web-ui/src/components/board-card.tsx) (both import context-budget formatting); give the bar its own
  full-width row there too. Do not change the bar's colors/segments — only its placement/width.
- [ ] Verify no horizontal overflow at the narrowest supported panel width and that the segments still sum correctly.

---

## H. Verification checklist (run before declaring done)

- [x] `npm run typecheck` — **0 errors** (§A gate).
- [x] `npm run web:typecheck` — 0 errors.
- [x] `npm run lint` — clean.
- [x] `npm run test:fast` — green (includes §A fixtures + §D config tests).
- [x] `npm --prefix web-ui run test` — green (project-navigation, settings dialog, home-agent-session, model picker).
- [x] `npx vitest run test/runtime/config/runtime-config.test.ts test/runtime/terminal/agent-registry.test.ts test/runtime/trpc/runtime-api.test.ts` — green.
- [ ] **Manual (dev build: `npm run web:dev` + runtime):**
  - [ ] Fresh config: nothing defaults to Claude; only the local Cline agent appears anywhere (settings shows the
    static "Local Cline agent (cloud disabled)" line, onboarding lists `cline` only).
  - [ ] Settings → model context windows: junk LM Studio rows are hidden; "Clear stale models" / per-row remove
    actually deletes them from `~/.cline/nklein/model-registry.json`; the chat panel telemetry shows the same filtered
    list.
  - [ ] "Selected loaded model (live)" matches the model actually loaded in LM Studio, in both Settings and chat panel.
  - [ ] Developer Mode off ⇒ sidebar Dev Test Scenarios, command-palette "Developer Tools", and settings "Developer
    Tools" are gone; on ⇒ all reappear; persists across reload; with the env var set, an explicit off still hides them.
  - [ ] Embedding settings: choosing "OpenAI-compatible endpoint" prefills the LM Studio endpoint and populates the
    model dropdown with no "Discover models" click.
- [ ] **🔒 Strict isolation (★ MANDATORY WORKSTREAM):**
  - [ ] `npm run sandbox:build` builds the pinned sandbox image; `docker image inspect` shows it.
  - [ ] Isolation unit tests + the **no-host-execution guard** test pass; Docker-gated integration tests pass when a
    daemon is present (and skip cleanly when not).
  - [ ] **Fail-closed:** stop the Docker daemon (or point `NKLEIN_AGENT_SANDBOX_IMAGE` at a bogus image) → creating /
    starting a task is blocked with the remediation message, and **no** session or host shell starts.
  - [ ] With Docker running, start real tasks: `docker ps` shows **one** shared `nklein.kind=agent-sandbox` container
    for all of them; each agent's edits stay in its `/workspaces/<taskId>` volume dir (nothing written under
    `~/.cline/nklein/` worktrees or anywhere on the host); the result patch applies to your repo on review; the
    container stays up between tasks and is removed only after the generous idle grace (~10 min) (or on exit). No host
    shell is spawned for the agent.
  - [ ] Settings shows the read-only "Agent isolation" status (Docker ✓, image ✓) **and** the sandbox pool settings
    (max containers, agents-per-container, per-container CPU/RAM, idle timeout) — but **no** control to *disable*
    isolation. Default = one container for all agents. Set maxContainers=2 / agentsPerContainer=1 → two single-agent
    containers; set total capacity below max parallel agents → extra agents **queue** until a slot frees; idle
    containers shut down after the configured timeout and are reused before that.
- [ ] **Runtime control & chat UI (§K):**
  - [ ] Pause the board while a card is actively running → the running agent stops issuing new LLM requests within one
    turn (watch the transcript / model activity stop advancing); the card shows a "paused" state. Resume → it
    continues on its own without a new instruction.
  - [ ] Per-card: a running card's button toggles Start→**Pause**→**Resume**; pausing one card does not pause others.
  - [ ] Finished card shows **no** actionable run button by default; enabling "Replay" in Settings reveals a Replay
    button that re-runs the card from scratch (after confirm).
  - [ ] Every chat message shows a top-right timestamp with no layout shift; clicking collapses all to a small clock
    icon (persists across reload); hovering shows full date-time **and** duration. It never covers tool chevrons/spinner.
  - [ ] The context-usage bar sits on its own full-width line (chat panel and card detail), no longer squeezed beside
    the meta text / scope select; no horizontal overflow at the narrowest panel width.
- [ ] `test/integration/runtime-state-stream.integration.test.ts` still fails exactly 9 (pre-existing, not a
  regression).
