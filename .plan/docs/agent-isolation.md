# Agent Isolation

This document records the strict local-isolation policy for !Klein-managed Cline task execution.

## Policy

- Cline agent tool side effects run in Docker, not directly on the host project checkout.
- The host !Klein process remains trusted orchestration code. It owns model-provider HTTP calls, UI/API state, telemetry, config, and final patch application to the user's repository.
- The Docker sandbox is mandatory for Cline task execution. There is no setting or environment flag that falls back to host tool execution when Docker is unavailable.
- The sandbox image is pinned as `nklein/agent-sandbox:0.0.1`; do not use `latest`.
- Containers run with `--network none`. Agent web fetch is disabled instead of falling back to host fetch.
- Secrets are never injected into the sandbox environment. Provider credentials stay in the host runtime.

## Container Boundary

Each pool container is launched with:

- `--network none`
- `--cap-drop ALL`
- `--security-opt no-new-privileges`
- `--read-only`
- `--tmpfs /tmp:noexec,nosuid,size=512m`
- a named `/workspaces` volume
- read-only project mounts under `/repos/<projectKey>`
- resource limits from global runtime settings: memory, CPU, and pids limit

The pool is configured by:

- `sandboxMaxContainers`
- `sandboxAgentsPerContainer`
- `sandboxMemoryPerContainerMb`
- `sandboxCpusPerContainer`
- `sandboxIdleTimeoutMinutes`

`maxConcurrentTasks` remains the outer application-level parallelism cap.

## Workspace Lifecycle

The target model is clone-in / patch-out:

1. Register the host project as a read-only `/repos/<projectKey>` mount.
2. Allocate a task placement in the pool.
3. Create `/workspaces/<taskId>` owned by a stable unprivileged task uid.
4. Clone from `/repos/<projectKey>` into that workspace and check out the task base ref.
5. Run SDK default tools and acceptance checks through `docker exec` in that workspace.
6. Extract a binary diff from the container workspace.
7. Apply the diff to the host repository only through trusted !Klein code.
8. Remove the task workspace and release the pool slot.

Current implementation note: SDK default tool executors and sandbox acceptance checks are Docker-backed. Some !Klein custom Cline tools, local MCP execution, and broader diff/merge flows still need the remaining audit/refactor before strict isolation can be considered complete.

## Pause, Stop, And Queueing

Board and card pause gates run before Docker-backed tool execution and sandbox acceptance commands. If a model response arrives with tool calls while the task is paused, those side effects wait until the task is resumed. Stopping or aborting the task rejects queued pause waiters so tool calls unwind instead of hanging.

Pool capacity queueing is FIFO. A task may wait for sandbox capacity before workspace preparation when all configured pool slots are occupied.

## Fail Closed

Runtime startup records Docker daemon and image preflight status. Settings displays that status as read-only Agent isolation health.

Before a Cline task starts, the runtime refreshes the same preflight. If Docker or the sandbox image is unavailable, start returns `agent_sandbox_unavailable` with a remediation message and no Cline session is created.

Required remediation:

```bash
npm run sandbox:build
```

Docker must also be installed and running.

## Shutdown And Cleanup

Stopping the runtime should call the sandbox manager shutdown path so all pool containers and named workspace volumes are removed. Removing a pool container is the implicit kill switch for all agent activity in that container.

Idle containers are reused first. Once empty for `sandboxIdleTimeoutMinutes`, a container and its named volume are removed.

## Test Expectations

No-Docker unit tests should cover:

- locked-down `docker run` arguments
- pinned image usage
- stable task uid assignment
- fail-closed Docker/image availability checks
- pool capacity queueing and reuse
- idle timer arming/cancellation
- pause-gated executor behavior
- no host fallback for SDK default tool executors and sandbox acceptance checks

Docker-gated integration tests should cover:

- building and inspecting the pinned image
- preparing two task workspaces in the same default pool
- uid isolation between sibling task workspaces
- real `bash`, `readFile`, `editor`, `applyPatch`, and acceptance commands inside the container
- patch extraction and host application through trusted code
- cleanup of task workspaces, containers, and volumes
