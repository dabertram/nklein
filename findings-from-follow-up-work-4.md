# Findings From Follow-up Work 4

## Strict Docker isolation still has open host-touching surfaces

- [x] Route the listed !Klein custom workspace tools through the Docker sandbox.
  - The first isolation chunk wires SDK-owned default executors (`bash`, `readFile`, `search`, `editor`, `applyPatch`) through `RuntimeCapabilities.toolExecutors`.
  - Acceptance-gate host execution is now explicit opt-in: `runClineAcceptanceGate` requires an injected runner or `allowHostExecution=true`, and agent-task acceptance uses `runClineAcceptanceGateInSandbox`.
  - A no-host-execution guard test now mocks `node:child_process` and `node:fs/promises` write APIs for the SDK default tool executors, sandbox acceptance path, and the custom workspace tool proxies.
  - Sandboxed Cline starts now register proxy `AgentTool`s for `repo_map`, `search_code`, `list_files`, `find_files`, `get_file_size`, `read_large_file`, `write_file`, and `write_files`. Their host-side `execute` functions call `manager.runTool(taskId, "kanbanExtraTool", ...)`, and the bundled `/opt/nklein/tool-runner.cjs` runs the real implementations inside `/workspaces/<taskId>`.
  - The runner-side large-file workflow stores its state under `/tmp/nklein-large-file-workflows` inside the container because the runner is per-tool-call and the container root filesystem is read-only.

- [x] Finish the strict-isolation extra-tool audit for sandboxed Cline starts.
  - Sandboxed Cline starts now omit `decompose_project` and `expand_task` instead of exposing host-side plan artifact and board mutation tools to the LLM.
  - Strict-isolation planning prompts now tell the agent to produce a plan in chat instead of using `/kanban-decompose`, so the prompt does not advertise an unavailable host mutation workflow.
  - Web research is disabled by default, and sandboxed Cline starts now also omit it when `KANBAN_ENABLE_WEB_RESEARCH=1`, so that env var cannot create a host-network escape hatch for sandboxed Cline tasks.

- [x] Remove or quarantine the remaining no-sandbox Cline service construction path.
  - `createInMemoryClineTaskSessionService` now requires either an `AgentSandboxManager` or the explicit
    `allowUnisolatedTestRuntime: true` test-only option. The constructor also throws at runtime if JavaScript callers
    omit both.
  - Production runtime-server construction passes a real `AgentSandboxManager`; unit suites that stub the SDK runtime
    opt into the unisolated path by name so host execution cannot be reintroduced accidentally as a silent default.

- [ ] Replace the remaining host worktree/diff/merge lifecycle with container clone-in / patch-out.
  - Cline starts no longer call `resolveTaskCwd` and no longer create host task worktrees in `runtime-api.ts`.
  - The Cline task-session service now prepares the Docker workspace before SDK start, passes the sandbox workdir and Docker-backed default tool executors into the SDK runtime, releases workspaces on start failure/stop/abort/clear, and calls `stopNow()` when the service is disposed.
  - Completion/awaiting-review now captures `git add -A` + `git diff --staged --binary` through `AgentSandboxManager.captureWorkspacePatch()`, applies the patch into a deterministic `nklein/tasks/<task>` branch with a temporary Git index + `commit-tree`, and disposes the sandbox workspace only after the trusted host branch update succeeds.
  - Review diff loading, task evidence, and task merge now prefer the result branch (`baseRef..resultCommit`) before falling back to legacy host worktrees. This preserves the existing UI shape while removing the host task-worktree dependency for sandboxed Cline completions.
  - The result branch helper intentionally does not check out the branch or use a host worktree; tests prove the user's checked-out files remain clean/unchanged while the branch contains the sandbox patch, including newly added files.
  - Permanent discard paths now pass `preserveChanges=false` through the typed workspace delete API. That deletes task result branches for individual task deletes, Clear Trash, project removal, dev-test cleanup, and Replay, and keeps ordinary move-to-trash cleanup on the preserving path.
  - Trash restore now checks out the preserved task result branch commit into the new sandbox workspace when one exists, so a restored sandbox task resumes from its saved changes instead of from the original base branch.
  - User-facing prompts, CLI help/errors, merge observations, evidence summaries, auto-review notices, project-health
    diagnostics, project registration errors, and cleanup confirmations now say task workspace/task result instead of
    promising host task worktrees. Compatibility API names and low-level legacy worktree modules remain unchanged.
  - Web and CLI task-start paths now skip host `workspace.ensureWorktree` for Cline/default tasks, so sandbox starts do
    not pre-create host task worktrees. Explicitly non-Cline legacy agent tasks still use the host worktree preparation
    path.
  - The broader task-worktree subsystem is still used by terminal agents and legacy fallback paths.
  - Remaining cleanup before closing this item: retire saved host worktree patch semantics where they no longer apply,
    decide how terminal-agent legacy worktrees fit into the strict Cline sandbox model, and only then consider any
    internal API/module renames that would otherwise create churn without changing behavior.

- [x] Share one sandbox pool and expose its health/settings instead of creating ad hoc managers.
  - The first chunk creates a production `AgentSandboxManager` for Cline task-session services.
  - Runtime API acceptance verification now routes through the scoped Cline task-session service, so the Settings-configured sandbox pool, queue, and pause controller are reused instead of constructing an endpoint-local manager.
  - Persisted pool sizing now exists (`sandboxMaxContainers`, `sandboxAgentsPerContainer`, `sandboxMemoryPerContainerMb`, `sandboxCpusPerContainer`, `sandboxIdleTimeoutMinutes`), is exposed in General settings, and is applied to the task-session manager whenever a scoped Cline service is requested.
  - Runtime startup now records sandbox preflight status, General settings exposes Docker/image health, and Cline task starts refresh that preflight before launch and fail closed with `agent_sandbox_unavailable` when blocked.
  - Runtime startup now also removes stale `nklein.kind=agent-sandbox` containers and generated `nklein-agent-ws-<slot>` volumes left by a previous crash before new sandbox work begins.
  - Pool queue draining now reserves a freed slot before any async Docker wait, so multiple queued tasks cannot overfill the same container and queued handoff does not poison later idle teardown.
  - Sandbox-capacity waits now emit a typed `queued` task-session summary, show "Queued — waiting for sandbox capacity" on the card, and count as active for concurrency/overlap checks until a slot frees.
  - Runtime acceptance auto-repair now calls the scoped `ClineTaskSessionService.verifyTaskAcceptanceInSandbox`, so it reuses the task-session service's sandbox manager and pause controller instead of constructing a one-shot manager.
  - CLI `nklein task verify` now routes its default verification path through the runtime `verifyTaskAcceptance` mutation, reusing the scoped runtime sandbox pool. The injected `runAcceptanceGate` path remains for unit tests and explicit harnesses.
  - Production `new AgentSandboxManager` construction is now limited to runtime-server ownership: one startup preflight manager and one scoped task-session manager per runtime workspace.
  - J7 still needs the final no-host-fallback audit across custom !Klein tools/MCP and any non-Cline legacy start surfaces before strict isolation can be called complete, but it is no longer blocked by ad hoc acceptance-verification managers.

- [x] Reconcile MCP execution with the isolation policy.
  - Locally executing stdio MCP servers are now skipped when building the Cline MCP tool bundle under strict isolation.
  - The user-facing warning is `MCP local execution is disabled under strict isolation.`, and remote HTTP/SSE MCP servers keep their existing OAuth/auth flow.
  - Containerizing local MCP servers remains out of scope for v1; the shipped behavior is default-deny for host subprocess MCP.

- [x] Add Docker-gated lifecycle integration coverage.
  - Unit tests cover Docker run lockdown flags, fail-closed availability checks, queueing, stable task UIDs, one shared
    container with two agents plus a queued third task, two dedicated containers with configured CPU/RAM caps, and the
    no-host-execution guard for SDK default tools plus sandbox acceptance.
  - `test/integration/agent-sandbox.integration.test.ts` now skips cleanly when Docker or the sandbox image is missing,
    and runs against the real image when available. It prepares two task workspaces from a temp Git repo, proves sibling
    UID isolation, runs `bash`, `readFile`, `editor`, and `applyPatch` through `/opt/nklein/tool-runner.cjs`, captures a
    binary staged patch, proves that patch applies to a throwaway host clone through trusted !Klein code, verifies no
    temp-home host worktree directory was created, disposes the task workspace, and waits for idle container/volume
    teardown by Docker label/name.
  - The real Docker run found and fixed four bugs that unit stubs could not expose: named volumes may need `chmod 1777`
    after mount, Docker cannot `exec -w /workspaces/<taskId>` until that directory exists, the bundled runner must be
    CJS with `import.meta.url` rewritten to a file URL for bundled dependencies, and with `--cap-drop ALL` cleanup must
    run as the task UID rather than container root.
  - Queue-specific Docker integration now verifies that a real one-container/two-agent pool queues the third ready task,
    keeps it unresolved until one active task releases, and starts it in the same sandbox pool. Docker-free tests still
    own the resource-cap and setting-change permutations because they can assert exact Docker argv and fake-timer
    behavior deterministically.

## Runtime pause/replay work still has unsolved surfaces

- [ ] Complete Docker-gated manual strict-isolation verification after the sandbox image can be built locally.
  - Recheck on 2026-06-19 found Docker Desktop running (`docker version` succeeded), but
    `docker image inspect nklein-agent-sandbox:latest` reported the sandbox image missing.
  - `npm run sandbox:build` was attempted and canceled after roughly two minutes because Docker stayed at the pinned
    `node:22-bookworm-slim` metadata step with no progress. This looked like a base-image pull/registry wait, not a
    TypeScript/build failure.
  - Do not mark the remaining strict-isolation manual checks complete until `npm run sandbox:build` finishes,
    `docker image inspect nklein-agent-sandbox:latest` succeeds, and real task starts can be observed in Docker.

- [x] Finish per-card pause/resume as a complete API + UI feature, not just a service primitive.
  - Per-card pause now persists to `.cline/nklein/paused-tasks.json`, exposes `pauseTask` / `resumeTask` tRPC mutations, flips the shared `ClinePauseController`, and threads Pause/Resume controls through the board.
  - Mutation responses update the parent session summary immediately, and the board overlays returned paused task ids so the card control flips without waiting for the next session event.
  - Backend and UI coverage now exercise the persistence helper, runtime API pause/resume flow, card controls, and board-level Pause → Resume transition.

- [x] Gate sandbox/tool side effects on pause before claiming "processing goes into a queue."
  - Docker-backed SDK default tool executors (`bash`, `readFile`, `search`, `editor`, `applyPatch`) now await `ClinePauseController.waitUntilResumed` before entering the sandbox tool runner.
  - Sandbox acceptance-gate commands now await the same pause controller before `docker exec`, and acceptance auto-repair receives the task-session service's pause wait from the runtime hub.
  - Stopping or aborting a task now rejects queued pause waiters before clearing paused state, so blocked side-effect calls unwind instead of hanging.
  - This completes the pause queue for the Docker-backed SDK default-tool and sandbox acceptance paths; host-side !Klein custom tools and local MCP execution remain tracked above under the strict Docker-isolation findings.

- [x] Add replay only after its destructive reset semantics are explicit and tested.
  - Replay is now gated by the global `replayCardsEnabled` setting, which defaults to false and is saved through the normal runtime config path.
  - Finished cards show no action by default; when enabled, Replay confirms with the user, stops any old session, deletes the prior task workspace, clears stale session/workspace metadata, recreates the workspace, and starts from the original card prompt.
  - Tests cover the setting persistence, settings switch save path, finished-card affordance, and interaction-hook reset/start sequence.
