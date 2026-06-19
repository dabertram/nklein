# Findings From Follow-up Work 4

## Strict Docker isolation still has open host-touching surfaces

- [ ] Route !Klein custom Cline tools through the Docker sandbox before calling the isolation work complete.
  - The first isolation chunk wires SDK-owned default executors (`bash`, `readFile`, `search`, `editor`, `applyPatch`) through `RuntimeCapabilities.toolExecutors`.
  - `cline-session-runtime.ts` still registers !Klein extra tools such as file discovery, retrieval, large-file workflow, write-file/write-files, decomposition, repo-map, and gated web research on the host side.
  - Passing the sandbox workdir as `cwd` prevents those tools from touching the user repo directly, but it is not sufficient: the tool code still executes in the host runtime process and can attempt host filesystem I/O against `/workspaces/...`.
  - Do not mark J1/J5/J7 complete until each extra tool is either implemented as an in-container runner or structurally disabled/replaced with an equivalent sandboxed implementation.

- [ ] Replace the remaining host worktree/diff/merge lifecycle with container clone-in / patch-out.
  - Cline starts no longer call `resolveTaskCwd` and no longer create host task worktrees in `runtime-api.ts`.
  - The broader task-worktree subsystem is still used by terminal agents, merge/review flows, trash cleanup, evidence, UI copy, and several CLI commands.
  - The correct next step is a deliberate workspace lifecycle refactor: produce diffs from `git -C /workspaces/<taskId> diff --staged --binary`, apply them to the host repo through trusted !Klein code, then retire/rename UI and CLI text that promises host task worktrees.

- [ ] Share one sandbox pool and expose its health/settings instead of creating ad hoc managers.
  - The first chunk creates a production `AgentSandboxManager` for Cline task-session services and one-shot managers for acceptance verification.
  - J8 still requires persisted pool settings, runtime startup preflight status, settings UI rows, and clear blocked-start messaging when Docker/image preflight fails.
  - Until that lands, the manager uses hardcoded defaults: one container, unlimited agents per container, 4096 MB, 4 CPUs, 10 minute idle timeout.

- [ ] Reconcile MCP execution with the isolation policy.
  - Locally executing MCP tools are still not audited or routed through Docker.
  - This should be handled alongside the custom Cline tool audit because both are host-runtime tool execution surfaces.

- [ ] Add Docker-gated integration coverage after the lifecycle refactor.
  - Unit tests cover Docker run lockdown flags, fail-closed availability checks, queueing, and stable task UIDs.
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
