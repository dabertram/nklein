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

- [ ] Finish per-card pause/resume as a complete API + UI feature, not just a service primitive.
  - The board-level pause core now parks native Cline sessions as `state: "paused"` at the next turn checkpoint and drains those tasks when the board is resumed.
  - Per-card pause still needs `.cline/nklein/paused-tasks.json`, `pauseTask` / `resumeTask` tRPC mutations, `BoardCard` Pause/Resume button states, board/column prop threading, and runtime-state refetch/update after mutation.
  - Do not model card pause as only UI state. It must persist across runtime restarts and feed the same `ClinePauseController` gate used by board pause.

- [ ] Gate sandbox/tool side effects on pause before claiming "processing goes into a queue."
  - `ClinePauseController.waitUntilResumed` exists for this purpose, but Docker-backed tool executors and acceptance-gate `runCommand` do not call it yet.
  - Until those executor calls await the pause gate, a turn that already received tool calls may still run side effects before the checkpoint parks the next turn.
  - This should be implemented with abort-signal handling so stopping or aborting a paused task rejects any queued tool waiters cleanly.

- [ ] Add replay only after its destructive reset semantics are explicit and tested.
  - The `replayCardsEnabled` setting, finished-card `Replay` affordance, confirmation prompt, and task worktree/session reset path are still open.
  - Replay should not reuse the pause/resume continuation path; it must deliberately clear/recreate task execution state and start from the card prompt.
