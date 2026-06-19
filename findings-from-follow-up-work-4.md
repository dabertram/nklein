# Findings From Follow-up Work 4

## Strict Docker isolation still has open host-touching surfaces

- [ ] Route !Klein custom Cline tools through the Docker sandbox before calling the isolation work complete.
  - The first isolation chunk wires SDK-owned default executors (`bash`, `readFile`, `search`, `editor`, `applyPatch`) through `RuntimeCapabilities.toolExecutors`.
  - Acceptance-gate host execution is now explicit opt-in: `runClineAcceptanceGate` requires an injected runner or `allowHostExecution=true`, and agent-task acceptance uses `runClineAcceptanceGateInSandbox`.
  - A no-host-execution guard test now mocks `node:child_process` and `node:fs/promises` write APIs for the SDK default tool executors and sandbox acceptance path.
  - `cline-session-runtime.ts` still registers !Klein extra tools such as file discovery, retrieval, large-file workflow, write-file/write-files, decomposition, repo-map, and gated web research on the host side.
  - Passing the sandbox workdir as `cwd` prevents those tools from touching the user repo directly, but it is not sufficient: the tool code still executes in the host runtime process and can attempt host filesystem I/O against `/workspaces/...`.
  - Do not mark J1/J5/J7 complete until each extra tool is either implemented as an in-container runner or structurally disabled/replaced with an equivalent sandboxed implementation.

- [ ] Replace the remaining host worktree/diff/merge lifecycle with container clone-in / patch-out.
  - Cline starts no longer call `resolveTaskCwd` and no longer create host task worktrees in `runtime-api.ts`.
  - The Cline task-session service now prepares the Docker workspace before SDK start, passes the sandbox workdir and Docker-backed default tool executors into the SDK runtime, releases workspaces on start failure/stop/abort/clear, and calls `stopNow()` when the service is disposed.
  - Completion/awaiting-review intentionally does not dispose the sandbox workspace yet: until patch-out exists, deleting `/workspaces/<taskId>` at completion would destroy the only Docker-side copy of the agent's changes before the review/diff flow can consume them.
  - The broader task-worktree subsystem is still used by terminal agents, merge/review flows, trash cleanup, evidence, UI copy, and several CLI commands.
  - The correct next step is a deliberate workspace lifecycle refactor: produce diffs from `git -C /workspaces/<taskId> diff --staged --binary`, apply them to the host repo through trusted !Klein code, then retire/rename UI and CLI text that promises host task worktrees.

- [ ] Share one sandbox pool and expose its health/settings instead of creating ad hoc managers.
  - The first chunk creates a production `AgentSandboxManager` for Cline task-session services and one-shot managers for acceptance verification.
  - Persisted pool sizing now exists (`sandboxMaxContainers`, `sandboxAgentsPerContainer`, `sandboxMemoryPerContainerMb`, `sandboxCpusPerContainer`, `sandboxIdleTimeoutMinutes`), is exposed in General settings, and is applied to the task-session manager whenever a scoped Cline service is requested.
  - Runtime startup now records sandbox preflight status, General settings exposes Docker/image health, and Cline task starts refresh that preflight before launch and fail closed with `agent_sandbox_unavailable` when blocked.
  - Runtime startup now also removes stale `nklein.kind=agent-sandbox` containers and generated `nklein-agent-ws-<slot>` volumes left by a previous crash before new sandbox work begins.
  - Pool queue draining now reserves a freed slot before any async Docker wait, so multiple queued tasks cannot overfill the same container and queued handoff does not poison later idle teardown.
  - J7 still needs the final no-host-fallback audit across custom !Klein tools/MCP and any non-Cline legacy start surfaces before strict isolation can be called complete.
  - Acceptance verification and command paths that create one-shot `AgentSandboxManager` instances still need to share the configured pool or be reconciled with the final pool lifecycle.

- [x] Reconcile MCP execution with the isolation policy.
  - Locally executing stdio MCP servers are now skipped when building the Cline MCP tool bundle under strict isolation.
  - The user-facing warning is `MCP local execution is disabled under strict isolation.`, and remote HTTP/SSE MCP servers keep their existing OAuth/auth flow.
  - Containerizing local MCP servers remains out of scope for v1; the shipped behavior is default-deny for host subprocess MCP.

- [ ] Add Docker-gated integration coverage after the lifecycle refactor.
  - Unit tests cover Docker run lockdown flags, fail-closed availability checks, queueing, stable task UIDs, one shared
    container with two agents plus a queued third task, two dedicated containers with configured CPU/RAM caps, and the
    no-host-execution guard for SDK default tools plus sandbox acceptance.
  - Integration tests that require a real Docker daemon/image are still open: build image, prepare workspace, prove sibling task UID isolation, run a real SDK tool through `/opt/nklein/tool-runner.mjs`, and confirm no host writes occur.

## Runtime pause/replay work still has unsolved surfaces

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
