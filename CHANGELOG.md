# Changelog

## [Upcoming !Klein 0.0.1]

- New **`nklein chat`** command — a first, board-independent way to talk to a unified chat agent on a loaded local model (todo §5.M). It discovers the loaded model from your local endpoint (LM Studio / Ollama; `--model`/`--base-url` to override), keeps a persisted session you can continue with `--session`, accepts a standing `--goal` kept in focus across turns, and recalls relevant long-term memories into each reply — all local, fail-closed against cloud. This is the simple-completion entry point; the tool-using multi-turn agent, streaming, and a chat UI build on top of it.

- **Chat is now in the app** (todo §5.M). A new **Chat button** in the top bar opens a board-independent chat with a loaded local model: a session list (create / select / delete) on the left, the conversation on the right, and a composer to talk to the model. Each session keeps its own persisted transcript and recalls relevant long-term memory into replies — all local, fail-closed against cloud. (The reply currently arrives whole; token streaming and in-UI session rename/scope pickers are still to come.)

- **`nklein chat --workspace <dir>`** makes the chat agent tool-using (todo §5.M). With a workspace, the model is offered read-only file tools (`read_file` / `list_dir`) and answers from the actual project files instead of guessing — the agent calls a tool, !Klein runs it, feeds the result back, and repeats until it answers (both single-message and the interactive REPL, which shows which tools each turn used). Adding `--allow-write` also offers a `write_file` tool, but every write is **confirm-prompted** (a `y/N` you must approve) before it runs — so a mutating action never happens silently. Every tool call (run or refused) goes through the per-action policy gate and is recorded to the host-action audit log; the tools are confined to the workspace (absolute paths and `..` escapes are refused) and the agent only ever sees workspace-relative paths.

- An **empty board now explains itself** instead of showing six blank columns (todo §5.A). When a project is loaded but has no cards, a banner under the swarm header invites you to **create your first task** with a one-click CTA — and if Docker agent isolation is unavailable, it shows an **"Isolation unavailable"** marker (with the daemon/image failure reason) so it's clear why tasks couldn't start anyway.

- The board header now surfaces a **merge-status chip** for the dependency-ordered auto-merge (todo §5.G). When the swarm finishes a card it merges the ready task worktrees back in dependency order; each pass is now recorded durably (per workspace) and the swarm header shows the latest outcome — green **"Merged N"** on success or red **"Merge conflicts N"** when recent passes hit a conflict — with a hover tooltip listing the recent passes (timestamp, merged/skipped counts, or the conflict reason and path count). It refreshes when you switch projects and as running tasks complete. Previously merge results were only visible in CLI/integration output.

- Settings now shows a **Python core (core-py) health line** under the !Klein model panel (todo §5.H): whether the local ML sidecar is enabled, running/not-reachable (a live `GET /health` probe), and its endpoint — with a hint to set `NKLEIN_CORE_PY=1` when it's disabled. Previously the `probeKleinCorePyHealth` helper existed but was never surfaced.

- The swarm can now run **multiple agents in parallel on one model** when you tell it the model's capacity (todo §5.T). Each model in the Model Performance registry (Settings → !Klein, and the agent chat model panel) gets a **"Parallel requests" field** to set its per-model concurrent-request capacity (e.g. to match LM Studio's per-model concurrent-requests setting); the endpoint scheduler, which previously serialized one task at a time per shared local endpoint, now allows up to that many concurrent sessions before holding the next start (with a "shared endpoint is at its N concurrent-request capacity" note). The default stays 1, so behavior is unchanged until a capacity is set.

- The **local swarm guardrails** (autonomous turns per task, autonomous wall-time, repeated no-diff checkpoints, repeated identical tool calls) are now **editable from Settings** instead of fixed constants (todo §5.T). The "Local swarm guardrails" section turns the four per-task limits into number inputs (wall-time in hours) with a **Reset to defaults** button; the limits persist in the runtime config (`swarmGuardrails`) and are honored by the autonomous-run watchdog at every turn checkpoint. They fall back to the same defaults as before (12 turns / 2 hours / 4 no-diff repeats / 3 tool-call repeats), and each value is clamped to a sane range (turns 1–1000, wall-time 1 minute–7 days, no-diff 1–100, tool-calls 2–100) so a typo can't disable a guardrail — an out-of-range entry shows an inline hint and is clamped on save.

- Restored the codebase-orientation **repo map** for Docker-isolated tasks (todo §5.A). The runtime injects a compact "repo map" (a PageRank-ranked, workspace-relative symbol outline) into the agent's context so it can navigate the project without blindly reading files — but under strict isolation it had gone silently empty: it was being built from the agent's sandbox working directory (`/workspaces/<taskId>`), which doesn't exist on the host, so every isolated task ran with no orientation. The map is now built host-side from the project root (a trusted-runtime read that emits only workspace-relative paths, no host leak) while the agent's own perceived working directory stays the sandbox path. Verified live (the orientation rail is injected again, with zero host-path leakage).

- A Docker-isolated agent is no longer told the **host** filesystem path as its working directory (todo §5.A HARDEN; the primary "agents must never see host details" leak). The agent's system prompt carries an `<env>` block whose "Working Directory" line is rendered from the cwd we pass — and while the agent-core `config.cwd` had been switched to the in-container sandbox path (`/workspaces/<taskId>`), the system prompt was still built from the host mount path. So a sandboxed planning/worker agent read its own system prompt, saw e.g. `Working Directory: /private/var/folders/…/T/nklein-…`, and then issued `read_files`/`list_files` against those host absolute paths. Both surfaces now derive the working directory from one shared helper (`resolveNKleinAgentPerceivedCwd`) so they can never drift again: a real task always perceives its sandbox workdir; only non-sandboxed home/chat sessions keep the host cwd. Verified end-to-end with a new live harness (`scripts/verify-decompose-isolation.mts`) that runs a real decompose against LM Studio in a Docker sandbox and asserts nothing the agent emits contains the host path, plus a regression test that builds the real SDK system prompt and asserts it carries the sandbox workdir, never the host mount.

- A sandboxed planning agent no longer sees the host filesystem path in its `decompose_project` result (todo §5.A HARDEN, "agents must never see host details"). The tool's result is agent-facing, but it returned **absolute host paths** for the generated plan artifacts (`specPath`/`planPath`/`questionsPath`/`decisionsPath`/`revisionsPath`/`summaryPath`/`taskGraphPath`, e.g. `/private/var/folders/…/T/nklein-…/.nklein/nklein/plans/<slug>/spec.md`), embedded the host workspace path in a `--project-path <abs>` CLI hint, and could surface a host path inside an apply-error message. These now show the **workspace-relative** path (`.nklein/nklein/plans/<slug>/spec.md`), drop the `--project-path` argument, and redact the host mount path out of any interpolated error message. Host-side consumers (the runtime API / CLI / evidence bundles) still read the real absolute paths directly from the plan-artifact writer, unchanged. Locked by a regression test.

- Made the large-file reading workflow much easier for small models to drive: instead of composing opaque `read:`/`stitch:` cursors, the model now just triggers `read_large_file` with a path and calls it again with `cursor: "next"` (or no cursor) to advance through each chunk and stitching area. !Klein tracks the position and each result reports index/total progress ("Covered N of M lines", "Verified N of M stitching areas"). The previous explicit cursors still work for back-compat.

- Decomposition no longer stalls when a weak local model raises a clarifying question it can't resolve. Previously an `open` question with options but no default was rejected with "add an `assumption`", and small models often just re-sent the identical `decompose_project` call, looping until the task paused. !Klein now auto-supplies a sensible default from the question's recommended (or first) option so the plan proceeds; the question stays open for later clarification.

- Tasks and second-opinion reviews no longer intermittently fail with "Lock file is already being held" when several cards run in parallel. The on-disk lock (`proper-lockfile`) is a cross-process lock; using it to coordinate the many concurrent callers inside one runtime process (the swarm persisting board state) meant they raced it and, when a holder held longer than the retry window, threw `ELOCKED` — which surfaced as queued task-starts failing and second-opinion reviews being skipped. `LockedFileSystem` now serializes same-process callers through an in-process, re-entrant per-lockfile mutex first, so the file lock is only ever contended across processes. (Re-entrant: a nested lock on the same path from one call stack now proceeds instead of self-blocking.)

- Silenced the noisy per-call "System messages in the prompt … can be a security risk" log line. It comes from the external `ai` package (Vercel AI SDK) and was printed on every model call; !Klein passes system messages by design, so the runtime now logs the rationale once at startup and disables the SDK's per-call warning via its official switch.

- Model Performance now shows an exact, per-model rollup (todo §5.Q backend precision aggregate). The "By Model (global)" table is computed straight from the raw run observations on the server — keyed by **provider + normalized model id + canonical endpoint** — so its success rate **and** average run time are exact (no longer a roll-up of pre-averaged rows), and loopback endpoint spellings (`localhost` / `127.0.0.1` / `0.0.0.0` / `::1`) dedup into one row the same way the model registry keys them. The three identity normalizers (`normalizeProviderId` / `normalizeModelId` / `normalizeEndpoint`) are now a single shared `src/core/model-identity.ts` module used by the registry, the endpoint scheduler, and telemetry, so all three agree; the per-endpoint swarm serialization also picks up the loopback canonicalization (a model addressed as `localhost` in one card and `127.0.0.1` in another now correctly serializes against itself). The web-ui falls back to the previous client-side roll-up when talking to an older server.

- Deleted two `src/terminal/` modules orphaned by the agent-launcher removal (todo §5.A, increment 3 C7d follow-up): `session-state-machine.ts` (the agent `reduceSessionTransition` state machine — its only caller was the deleted `applySessionEvent`) and `output-utils.ts` (`stripAnsi` — only used by the deleted Codex prompt detectors). Zero references remained anywhere. `src/terminal/` is down to the live shell + config surface (8 files). Root tsc + biome + full fast suite (1300) green.

- Deleted the terminal-CLI **agent launcher** + its helper modules (todo §5.A, increment 3 C7d step 3b). `TerminalSessionManager.startTaskSession` (the PTY launch for Claude/Codex/Gemini/OpenCode/etc.) and everything only it used are gone: the workspace-trust auto-confirm, Codex deferred-startup/prompt detection, agent output-transition adapters, agent egress-restriction env, and the agent auto-restart machinery (`shouldAutoRestart`/`scheduleAutoRestart` + the `restartRequest`/`suppressAutoRestartOnExit`/`autoRestartTimestamps`/`pendingAutoRestart` entry fields). `ActiveProcessState` is trimmed to what the shell needs (`session`/`cols`/`rows`/`terminalProtocolFilter`). Deleted the 7 now-orphaned helper files — `agent-session-adapters`, `claude-workspace-trust`, `codex-workspace-trust`, `codex-hook-config`, `opencode-paths`, `hook-runtime-context`, `task-image-prompt` — plus 5 obsolete test files. `session-manager.ts` drops 940 → 427 lines. **Every remaining change to the shell path is a behavioral no-op** (it only removed agent-only branches that shell sessions never triggered): `startShellSession` and the shared lifecycle (`attach`/`writeInput`/`resize`/`stopTaskSession`/`recoverStaleSession`/pause-resume/`getRestoreSnapshot`/`hydrateFromRecord`) are intact and stay live for shell-on-task. Kept `agent-registry` (`detectInstalledCommands`/`buildRuntimeConfigResponse`, used by runtime-config + runtime-api) and `command-discovery` (`isBinaryAvailableOnPath`, used by `server/browser`). Root tsc + biome + full fast suite (1300) green.

- Removed the dead terminal task stop/input fallbacks + dead hook-driven manager methods (todo §5.A, increment 3 C7d step 3a). With the terminal `startTaskSession` path gone (step 2), `runtimeApi.stopTaskSession`/`sendTaskSessionInput` no longer fall back to `terminalManager` when there's no NKlein session (terminal/CLI agents are disabled under the local-only lockdown, so a missing NKlein session simply means the task isn't running). Deleted four `TerminalSessionManager` methods that had **zero remaining callers** — `transitionToReview`, `applyHookActivity`, `transitionToRunning`, `applyTurnCheckpoint` — they were driven only by the now-removed hook-ingest tRPC (step 1) and terminal turn-checkpoint path (step 2). The shared shell lifecycle (`startShellSession`, `attach`/`writeInput`/`resize`/`stopTaskSession`/`recoverStaleSession`/pause-resume, `getRestoreSnapshot`, `hydrateFromRecord`) is untouched and stays live for shell-on-task. Removed the two obsolete manager tests (hook-activity, turn-checkpoint). Root tsc + biome + full fast suite (1333) green.

- Removed the dead terminal-CLI-agent **`startTaskSession`** path from the runtime API (todo §5.A, increment 3 C7d step 2). The task-start handler branched on `effectiveAgentId` — an NKlein path (`nkleinTaskSessionService.startTaskSession`) and a legacy terminal path (`terminalManager.startTaskSession` + a host turn-checkpoint via `captureTaskTurnCheckpoint`/`applyTurnCheckpoint`) — selected by a `previousTerminalAgentId` (`terminalManager.getSummary`) / `body.agentId` / `selectedAgentId` resolution plus a persisted-NKlein-session probe (`rebindPersistedTaskSession`). Under the local-only lockdown terminal/CLI agents are disabled, so every task runs on NKlein: removed the terminal branch, the agent-id resolution, and the probe (`resumeFromTrash` is self-hydrated inside `startTaskSession` via `readPersistedTaskSession`, so no probe is needed); the active-task **concurrency** count now reads NKlein session summaries only (terminal agents no longer produce sessions). `terminalManager` is no longer touched by task-start — it remains live for **shell-on-task** (`startShellSession`) and the still-present stop/input fallbacks (removed next with the agent-path files). `resolveAgentCommand`/`captureTaskTurnCheckpoint` imports auto-pruned. Removed 6 obsolete terminal-path tests (host turn-checkpoint, terminal concurrency, persisted-session probe x2, CLI image-forwarding, non-NKlein OAuth-skip — all now covered by NKlein-path tests) and converted the chat-clear test to the NKlein path (asserting `resumeFromTrash` is forwarded). Root tsc + biome + full fast suite (1335) green.

- Removed the dead terminal-CLI-agent **hook-ingest** path (todo §5.A, increment 3 C7d step 1). The `nklein hooks` CLI (`ingest`/`notify`/`gemini-hook`/`codex-hook`) + `commands/hook-events/*` + the `hooks.ingest` tRPC procedure (`hooks-api.ts`) existed only so external terminal CLIs (Claude/Codex/Gemini/Kiro) could POST status back into the runtime — terminal/CLI agents are disabled under the local-only lockdown, and native NKlein agents report through their SDK session, so nothing called it. Deleted the CLI + its registration, the tRPC procedure + `createHooksApi` wiring, `parseHookIngestRequest`, and the `runtimeHookIngestRequest/Response` schemas (kept `RuntimeHookEvent`, still used by the legacy agent-session adapters pending C7d). Removed the now-obsolete hook tests. Root tsc + biome + full fast suite green.

- Removed the dead web-ui task-workspace-**info** store (todo §5.A, increment 3 C7e). The per-task host-worktree path/branch store (`taskWorkspaceInfoByTaskId` + `getTaskWorkspaceInfo`/`setTaskWorkspaceInfo`/`clearTaskWorkspaceInfo`/`useTaskWorkspaceInfoValue`/`toTaskWorkspaceInfo` in `workspace-metadata-store`) has been empty since the metadata monitor went home-git-only (C6a), so its readers always fell through. Removed it and its consumers — `App.tsx` navbar path/subtitle/hint (now use the review snapshot ?? project path; the "task workspace not prepared/cleaned up" hint is gone, irrelevant without host worktrees), `top-bar` git-status (uses the snapshot), the now-dead `selectedTaskBaseRef` prop threading, and `use-board-interactions` `clearTaskWorkspaceInfo` calls. The separate `taskWorkspaceSnapshot` (review/git summary) is kept. Zero behavior change for native NKlein tasks. web-ui tsc + biome + full vitest (683) green; live Playwright smoke renders the board with 0 console errors.

- Deleted the host-worktree **creation** machinery (todo §5.A, increment 3 C7c). With every consumer rewired (C1–C7b), `task-worktree.ts` is slimmed to its legacy **cleanup** surface — `deleteTaskWorktree` / `removeTaskWorktreeSetupLock` / `deleteTaskPatchFilesForRepo` (+ patch capture, used when deleting a legacy worktree with `preserveChanges`) — and the now-dead create/sync/symlink-mirror functions (`ensureTaskWorktreeIfDoesntExist`, `resolveTaskCwd`, `getTaskWorkspaceInfo`, `getTaskWorkspacePathInfo`, `mirrorIgnoredPath`, ignored-path/submodule/exclude helpers) are gone. Deleted `task-worktree-turbopack.ts` and the now-dead `runtimeWorktreeEnsureRequest/ResponseSchema` + `parseWorktreeEnsureRequest`. `task-worktree-sync.ts` is kept (still used by `nklein-trusted-auto-merge`). Removed the retired-behavior tests (worktree mirroring/turbopack/creation-lifecycle integration; the stream test's per-task-worktree-metadata blocks) and trimmed the unit test to the cleanup surface. Root + web-ui tsc + biome + full fast suite (1378) green.

- Removed the `ensureWorktree` and `getTaskContext` tRPC procedures (todo §5.A, increment 3 C7b). With the web-ui (C6b) and CLI (C7a) no longer calling them, the two worktree procedures + their `createWorkspaceApi` handlers + the `parseWorktreeEnsureRequest` usage are gone from the runtime boundary. `deleteWorktree` is retained (it backs `cleanupTaskWorkspace` on replay/trash and cleans up any legacy on-disk worktrees from pre-§5.A builds — a no-op for native NKlein tasks). This leaves `ensureTaskWorktreeIfDoesntExist`/`getTaskWorkspaceInfo` as dead exports (deleted next with the rest of the worktree creation machinery). Root + web-ui tsc + biome + full fast suite (1392) green.

- Retired the host-worktree plumbing from the `nklein task` CLI (todo §5.A, increment 3 C7a). `task start` prepared a host worktree via a `shouldPrepareLegacyHostTaskWorkspace`-gated `ensureWorktree` tRPC call (dead for native NKlein), and `task verify` (`runVerifyTaskAcceptanceCommand`) had a `resolveTaskCwd` + `runAcceptanceGate` host-acceptance branch that was never wired in production (the live path is the sandbox `verifyTaskAcceptance` tRPC). Removed the gated `start` block, the host-acceptance branch, the `shouldPrepareLegacyHostTaskWorkspace` helper, and the `resolveTaskCwd`/`runNKleinAcceptanceGate`/`usesLegacyHostTaskWorkspace` imports — acceptance always runs in the task's Docker sandbox, and `--workspace-root` (which referenced a host checkout) now errors clearly. With this the CLI no longer calls `workspace.ensureWorktree` or `resolveTaskCwd` (only the result-branch `task merge` and the `verifyTaskAcceptance` flag remain), clearing the gate for removing those tRPC mutations. Tests rewired to the sandbox verifier. Root tsc + biome + full fast suite (1392) green.

- Removed the web-ui's dead host-worktree prep scaffolding (todo §5.A, increment 3 C6b). The board kicked off tasks through a `shouldPrepareLegacyHostTaskWorkspace`-gated `ensureTaskWorkspace` (→ `ensureWorktree` tRPC) across four flows (start / resume-from-trash / replay / decompose), plus a `fetchTaskWorkspaceInfo` (→ `getTaskContext` tRPC) — but that predicate mirrors `usesLegacyHostTaskWorkspace`, **always false for native NKlein** (and terminal/CLI agents are disabled under the local-only lockdown), so the worktree prep never ran. Removed `ensureTaskWorkspace`/`fetchTaskWorkspaceInfo` (and the gated blocks, the `shouldPrepareLegacyHostTaskWorkspace` helper, and the obsolete saved-patch-warning test) from `use-board-interactions`/`use-task-sessions`/`App.tsx`; native NKlein tasks just start in their Docker sandbox. The web-ui no longer calls the `ensureWorktree`/`getTaskContext` tRPC at all (their backend removal is the next step). web-ui tsc + biome + full vitest (683) green; live Playwright smoke renders the board with 0 console errors.

- The workspace metadata monitor is now home-git-only (todo §5.A, increment 3 C6a). It polled a per-task host-workspace git summary for every *legacy-agent* card (via `getTaskWorkspacePathInfo` against a host worktree) — but native NKlein tasks were already never tracked (`collectTrackedTasks` skipped any non-legacy agent), and terminal/CLI agents are disabled under the local-only lockdown, so that path only ever ran for agents that can no longer exist. Removed the per-task tracking entirely (and the `getTaskWorkspacePathInfo`/`usesLegacyHostTaskWorkspace` imports + the `board` input the monitor no longer needs): the monitor polls only the project's home git summary, and `RuntimeWorkspaceMetadata.taskWorkspaces` is now always `[]` (kept in the contract for web-ui back-compat — it was already empty for every NKlein workspace). Root tsc + biome + full fast suite green.

- Removed the last host-worktree resolution from the runtime API (todo §5.A, increment 3 C5). `resolveExistingTaskCwdOrEnsure` resolved a task's host worktree, **creating one on miss** (`ensure: true`) — so `collectTaskEvidence` on a task with no result branch would silently materialize a host worktree. Both call sites now use the project repo path: task evidence is gathered there (a completed task's delta is its result branch; an in-progress task's work lives in its sandbox), and the legacy terminal `startTaskSession` (terminal/CLI agents are disabled under the local-only lockdown) runs at the project root. Deleted the helper and the `task-worktree` import from `runtime-api`. Root tsc + biome + full fast suite green.

- The workspace git-changes/summary handlers no longer touch host worktrees (todo §5.A, increment 3 C2). `loadChanges`, `loadGitSummary`, and `discardGitChanges` each resolved an optional task scope through `resolveTaskCwd` (a host worktree). With worktrees retired: `loadChanges` returns the task's result-branch diff (base → `nklein/tasks/<task>`) when present and an **empty** diff otherwise (an in-progress task's work lives in its sandbox; the host tree is untouched) — the legacy per-turn host-checkpoint diff (`selectLastTurnSummary` + the terminal/nklein checkpoint merge) is removed, since for a sandbox task the host working tree never reflects mid-run state; `loadGitSummary`/`discardGitChanges` operate on the project repo (a task has no per-task host tree to summarize or reset). This drops `resolveTaskCwd` entirely from `workspace-api` (the `ensureWorktree`/`deleteWorktree`/`loadTaskContext` surface is handled separately). Tests rewired to the result-branch behavior. Root tsc + biome + full fast suite green.

- The auto-complete delivery merge is now **result-branch-only** (todo §5.A, increment 3 C4). `mergeTaskWorktreesInDependencyOrder` — the dependency-ordered merge invoked on every task auto-complete — was already result-branch-first, with a host-worktree (`resolveTaskCwd` → `git rev-parse HEAD`) fallback for tasks without a result branch. With worktrees retired, that fallback can never produce a host-visible commit, so it's removed: a task with **no `nklein/tasks/<task>` result branch** is now cleanly **skipped** (nothing host-visible to merge) instead of reaching into a nonexistent worktree. Dropped the `resolveTaskCwd` injection and the `task-worktree` import from the merge module (it keeps its name; it remains the live delivery-merge path). Tests rewired off the worktree fallback (+ a new "absent result branch → skipped" case). Root tsc + biome + full fast suite green.

- Acceptance auto-repair is now **sandbox-only** (todo §5.A, increment 3 C3). The auto-repair check that re-runs a task's acceptance command before marking it ready had two paths: a worktree-backed host gate (`resolveTaskCwd` + `runAcceptanceGate`) and the Docker-sandbox verifier (`service.verifyTaskAcceptanceInSandbox`). The host gate was **never used in production** — the runtime hub only ever passes the scoped session service — so it was dead/test-only weight coupling auto-repair to the retiring worktree subsystem. Removed it: acceptance always verifies against the task's sandbox working copy, dropping the `resolveTaskCwd`/`runAcceptanceGate` injection points and the `task-worktree` import. The "acceptance unavailable" skip reason is renamed from `worktree_unavailable` → `acceptance_unavailable` (no external consumer reads it). Tests rewired to the sandbox verifier (+ a new "no verifier → skipped" case). Root tsc + biome + full fast suite (1393) green.

- Task **git-history (log / refs / commit diff)** now works for native NKlein tasks (todo §5.A, increment 3 C1). These three review handlers resolved the task scope through `resolveTaskCwd({ ensure: false })`, which **throws for a worktree-free nklein task** ("Task workspace not found") — so opening a task's git-history threw instead of showing anything. They're now result-branch-aware: a task's inspectable history is its `nklein/tasks/<task>` result commit, whose objects live in the **project repo's shared object DB**, so the log targets that commit and refs/diff resolve straight from the project repo path — no host worktree. (The main `loadChanges` diff and `collectTaskEvidence` were already result-branch-first; this brings log/refs/diff in line as the worktree subsystem is retired.) Root tsc + biome + full fast suite (1392) green.

- Shell-on-task no longer creates a host worktree (todo §5.A, increment 3 step 1): a task with an active Docker sandbox shells into its container via `docker exec` (as before), and a task without an active sandbox — or a non-task shell — now opens at the **project root** instead of an ensured host worktree. This drops the `resolveTaskCwd({ ensure: true })` fallback from the shell path, the first step of retiring the host-worktree subsystem. The increment-2 shell gate is verified live: node-pty driving `docker exec -it` into the sandbox image yields a working login shell (mechanism, args, and PTY integration confirmed).

- The code-intelligence panel now has a **"Configure embedding model"** link (todo §5.I-1#3) that opens the **Project Settings** dialog — where the per-project code-embedding override lives — so the embedding model is configurable right from where its status is shown, without a separate in-panel picker (one source of truth, per decision). Sits under the embedding provider/config status and opens Project Settings for the current project.

- Finished moving per-project settings out of global Settings (todo §5.I#3, increment B): the per-project code-embedding override is fully removed from the global runtime-settings dialog (its state, dirty-check, config-load effect, save-time validation, save inclusion, and the override UI section). Global Settings → **Code embeddings** now shows only the global **defaults**; the per-project override lives solely in the **Project Settings** dialog (the ⋯ menu). The shared embedding form was also extracted into its own `code-embedding-fields.tsx` module (imported by both dialogs) rather than exported from the 4000-line settings dialog. No behavior change to the global defaults or the override itself. web-ui tsc + dialog/panel tests green.

- Per-project settings now have a dedicated home (todo §5.I#3): a new **Project Settings** dialog, opened from each project's "⋯" menu in the sidebar, hosts the per-project **code-embedding override** (toggle + provider + endpoint/model, reusing the shared embedding form). It saves as a scoped partial merge — `save({ codeEmbeddingOverride })` — which `updateRuntimeConfig` applies field-by-field, so a project override never touches global or other-project config. (Increment A: the dialog + entry point; removing the now-duplicate override from the global Settings dialog is the immediate follow-up.)

- The §5.B decomposition-knowledge signal now has a **UI** (completing §5.B): the Model & Knowledge stats dialog gained a **"Decomposition Knowledge"** section — headline metrics (decompositions, how many consulted knowledge tools first, the knowledge-first rate) plus a per scope × role × model × project breakdown — surfacing whether the architect actually used codebase-retrieval / code-index / architecture-knowledge tools *before* decomposing, not just a usage count. The global totals are an exported, unit-tested `summarizeDecompositionKnowledge` (sums only the overall-scope aggregates so version/project re-rollups aren't double-counted; recomputes the rate). web-ui tsc + dialog tests green.

- Shell-on-task now opens **inside the task's Docker sandbox container** when one is running (todo §5.A, increment 2b): the `startShellSession` runtime handler resolves the task's sandbox shell target (via the memoized per-workspace `NKleinTaskSessionService.getTaskShellTarget` → `AgentSandboxManager`) and, when present, spawns the terminal PTY as `docker exec -it -u <taskUid> -w /workspaces/<taskId> <container>` (login bash→sh) — so a user shell on a running task lands in the same hardened, `--network none` working copy as the agent, not a separate host worktree. When the task has no active sandbox it falls back to the legacy host-worktree shell (retained until the §5.A increment-3 retirement). The docker-vs-host decision is a pure, unit-tested `buildTaskShellSpawnSpec`; the docker-exec-into-workspace path was **live-verified against the running sandbox container** (lands in the cloned repo as the task user; `/usr/bin/bash -l` starts cleanly). The full browser-terminal e2e is folded into the §5.A increment-4 verification pass.

- Added the sandbox seam for **shell-on-task via `docker exec`** (todo §5.A, increment 2a — foundation): `AgentSandboxManager.getTaskShellTarget(taskId)` returns a prepared task's container name + task user + workdir (or null), and a pure `buildAgentSandboxInteractiveShellArgs` assembles the interactive `docker exec -it -u <uid> -w <workdir> <container> <shell>` argv — mirroring the existing non-interactive task-user exec, defaulting to a login bash→sh shell that works across base images. This is the prerequisite for dropping host worktrees from the shell-on-task flow: a user shell will `docker exec` into the task's hardened sandbox container (as isolated as the agent) instead of a host checkout. Unit-tested. The PTY wiring (terminal session → spawn `docker` with these args, replacing `resolveTaskCwd({ ensure: true })`) and its live "shell lands in the container" gate are increment 2b.

- The native NKlein agent is now the **sole launch-supported agent** (todo §5.A, increment 1b): `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS` is shrunk to `["nklein"]`, so the task-agent picker and the runtime-settings agent list (both driven by `getRuntimeLaunchSupportedAgentCatalog()`) now offer only NKlein, and terminal/CLI agents (Claude/Codex/Droid/Kiro/…) are no longer launchable. This matches the existing local-only lockdown — `normalizeAgentId` already clamps every non-nklein id to nklein, so the shrink only removes the now-dead cloud selection path (its behavior is unchanged under the lockdown). Catalog entries remain for the legacy terminal integration a later §5.A increment deletes. Root tsc + full fast suite + web-ui tsc + picker/settings/native-agent tests all green.

- A pure local-only setup no longer shows a spurious **"No agent configured"** (todo §5.A, increment 1a). Task-agent readiness (`isTaskAgentSetupSatisfied`) was cloud-oriented — it only counted the native NKlein agent "ready" when an API key / OAuth token was configured, otherwise falling back to *another installed CLI agent*. A local-only user (e.g. LM Studio, no API key, no other CLI installed) was therefore told no agent was configured despite a working local model. Readiness is now **local-aware**: a new `isNKleinLocalModelConfigured` treats a selected local provider (lmstudio/ollama, or a custom provider carrying a model id / local endpoint) as configured — the runtime auto-discovers the loaded model and falls back to the catalog base URL at launch (§6.10) — while the existing cloud-auth path still counts. This drops the CLI fallback for the NKlein branch (the first step of the §5.A nklein-only / worktree-retirement direction). web-ui tsc + unit-tested.

- Added four **parallel-fan-out dev-test project presets** (todo §5.O) so multi-agent parallelism can be exercised and hardened under real concurrency (swarm executor, sandbox pool, result-branch merges, the §5.K review / §5.L delivery flow): `wide_fanout` (many independent formatter cards + two join points), `deep_chain` (a strictly linear pipeline, almost no parallelism), `mixed_dag` (a diamond — shared root → two parallel branches → a join), and `many_small` (20+ tiny independent helper cards + a barrel). Each is a `--preset` for `nklein dev test-project`, reuses the small TS CLI template, and steers the decomposition toward its DAG shape via the seed prompt (kept user-level — no internal tool tokens). Unit-tested (preset resolution → distinct scenarios, shape-steering phrases, scaffold). The matrix-sweep automation that *drives* these stays deferred per §5.O until the user supplies the quant / K-V-cache configs and its shape is agreed.

- Decomposition quality now records whether the architect **actually consulted knowledge tools before decomposing** — not just a usage count (todo §5.B). The knowledge-tool-usage observation log already timestamps every tool call per planning session (`taskId`) and marks where a decomposition landed (`decomposition_applied`); a new pure correlator (`src/telemetry/knowledge-tool-decomposition-signal.ts`) turns that into a per-decomposition signal: did any **codebase-retrieval / code-index / architecture-knowledge** tool run *before* the decomposition. It anchors on the applied event (which comes last), so a rejected-then-retried decomposition still credits the knowledge work done in between; it reports the distinct knowledge categories consulted; and it rolls up per scope × role × provider × model as "X of Y decompositions consulted knowledge first (rate)". Surfaced in the knowledge-tool-usage stats API response (`decompositionKnowledgeSignals` + `decompositionKnowledgeAggregates`, additive/back-compatible via schema defaults). Unit-tested (correlation, aggregation, retry-credit, after-decompose exclusion, custom category set) plus a read-path integration test. (The Settings stats column that renders it is the remaining web-ui piece; the audio-VST scoring rubric is the user's to draft.)

- The built-in code-embedding GGUF (todo §5.I-1) now **frees its RAM when indexing goes idle** and **integrity-checks its download**. (1) A host-side idle-unload scheduler (`nklein-embedding-idle-unload.ts`) is re-armed on every embed and, after the idle window (default 2 min) with no further activity, calls the Python core's `POST /v1/embed/unload` to drop the resident model. It's keyed by `(sidecarUrl, gguf_path)` rather than tied to a provider instance — providers are created per request, but the core caches the loaded model across them, so that resident model is what holds RAM at rest. Active indexing bursts keep re-arming the timer so it never unloads mid-flight; the timer is `unref`-ed so a pending unload never keeps the process alive; injectable timer/fetch make it deterministically unit-tested. (2) The default manifest now carries the **verified `sha256`** of `nomic-embed-text-v1.5.Q4_K_M.gguf` (confirmed by a full download + hash; matches HuggingFace's LFS `X-Linked-ETag`), so the existing integrity check actually runs and a corrupt/tampered download is rejected and re-provisioned instead of served. Leaves only the in-panel model-override picker from the §5.I-1 residual list.

- The **Model Performance** stats view no longer lists the same model many times (todo §5.Q). The data was already clean (one canonical registry entry per model, no id variance); the duplication was the display — every aggregate was split by scope × role × project × version and rendered flat, so one model that ran as architect *and* worker filled many rows. The dialog now leads with a **By Model (global)** table — one consolidated row per model (summed runs/outcomes, exact recomputed success rate) — with the detailed scope/role/project/version rows kept below as **Breakdowns**. The global rollup sums only the overall-scope rows so runs aren't double-counted; unit-tested.

- Decomposition no longer forces the model to **fabricate answers to its own clarifying questions**. `validatePlanQuestions` used to hard-reject any `open` question, so a model that correctly raised a question with a sensible `assumption` (a working default) had to flip it to `assumed-default` just to get past validation — burning turns on weak models (observed live: qwen3-8b looped `{}` → open-question reject → self-assumed) and discarding the genuine clarification. Now an `open` question is accepted as long as it carries a working default (`assumption` or `answer`); it stays **open for later clarification** (the architect/reviewer auto-clarify loop or the user, todo §5.S) while the plan proceeds against the assumption. Only an open question with no working default at all is rejected, with a directive not to invent a hard answer. The decomposition prompt now prefers `open` + `assumption` over a fabricated answer. Unit-tested (open+assumption accepted; open-with-nothing rejected).

- More **hover/focus tooltips** (todo §5.I#5): extended universal-tooltip coverage to the card-detail controls (reject pending artifact, collapse expanded diff, toggle split diff), the **swarm cockpit** (max-concurrency cap, pause/resume the swarm, code-intelligence chip), **git-history "Discard all changes"**, and the **terminal "Close"** — each now shows a name + one-line description from the `ELEMENT_TOOLTIPS` registry. This covers the high-value icon-only controls across the board, card, and cockpit surfaces (beyond the already-covered top bar / board columns / cards).

- Settings → Tasks now has a **Max review rounds** input (todo §5.K): the second-opinion review round cap (`reviewMaxRounds`, default 20) is now editable from the UI — a number input next to the review toggle, disabled when review is off, threaded through the settings dialog's state/dirty-check/save like the other settings. Completes §5.K.

- Agents now **re-anchor their focus chain** every turn (todo §5.N): the chain an agent authors via `update_focus_chain` is captured per live session and re-projected into each model request by the `beforeModel` hook, so a small model stays on its own plan across turns and after context compaction (which otherwise drops the chain — it only lived as the tool call/result). The rail strips any prior focus-chain rail before prepending the current one, so it never stacks or goes stale, and it's a fail-safe no-op when there's no chain. Logic lives in a standalone, unit-tested `nklein-focus-chain-rail.ts` (`reanchorFocusChainMessages`).

- Timeout outcomes can now be broken down **by agent role and by dev-test scenario** (todo §5.C): the durable run-summary record carries a coarse `role` (`reviewer` for the synthetic `<taskId>::review` session, `architect` for decomposition turns, else `worker`, inferred at the terminal capture) and a `scenario` (parsed from the `devtest-<scenario>-<ts>` task id), and `summarizeTimeoutOutcomes` groups timeout-triggered runs by provider × model × timeout-source × role × scenario — so "which role/model/timeout-source/scenario combinations keep timing out, and what happens when they do" is answerable from the durable log (the by-scenario view feeds the §5.O robustness sweeps). Additive + backward-compatible (older records default to the `unknown` role / `null` scenario group); unit-tested.

- The second-opinion reviewer now sees the worker's **focus chain** (todo §5.N): when a card carries a self-authored focus chain, the reviewer's seed prompt includes it under "Worker's focus chain (its self-authored plan)" and is told to judge whether the work actually followed and completed its own plan — unfinished/skipped steps that matter to the objective, or a chain whose done steps don't match the diff, warrant `request_changes`. Wired from the live review runner through `card.focusChain`; pure and unit-tested.

- !Klein now **recovers tool calls that a weak model emits as text instead of a structured call** — the project principle is to be robust against small-model output errors rather than to teach the model. Small/quantized local models routinely "narrate" the Hermes/Qwen-style `<tool_call>{"name": …, "arguments": …}</tool_call>` block into their content or reasoning channel rather than the structured tool-calling path; the SDK then sees a plain text turn, finds no tool to run, and the turn stalls (observed live twice mid-decomposition: a 35B model wrote a `read_large_file` continuation, then a `list_files` call, as `<tool_call>` text and stopped). A new pure parser (`src/nklein-sdk/nklein-narrated-tool-call.ts`) extracts narrated `<tool_call>`/`<function_call>` blocks (tolerant of the `<|tool_call|>` variant, a missing closing tag, double-encoded string arguments, and sloppy JSON via the shared `repairJsonValue`), and an `afterModel` hook parses any such call out of the assistant message and **appends a real tool-call part so the agent loop executes it** — exactly as if the model had emitted it natively (the hook runs before the loop extracts tool calls). Conservative to avoid false positives: it only fires when the turn produced no real tool call and an explicit wrapper carrying a tool `name` is present; recoveries are logged via self-observation telemetry. This supersedes re-prompting for this failure mode. Unit-tested against the exact evidence-bundle payloads.

- Delivery-autonomy gate (todo §5.L) now governs auto-delivery: when a reviewed card is about to be auto-merged, the runtime resolves the **delivery tier** (`decideDeliveryAction`) against the safety gates and only auto-merges when the tier allows it and the gates pass — **self-merge is allowed** at the open tiers (per decision), but a diff that touches **protected safety paths always holds** the card in Review instead of merging. The default tier (`fully_open`) still auto-merges as before; lower tiers (or a protected-path change) leave the card in Review for manual/PR handling, with the reason logged. (Auto-commit/PR actions, a measured regression delta, and per-project/per-card tier overrides are follow-ups; tests + review are treated as passed at this point since acceptance runs upstream and the second-opinion review already gated this step.)

- Delivery-autonomy now supports a **per-card override** (todo §5.L, "adapt … per project and per card"): the auto-delivery gate resolves the effective delivery tier with scope precedence **card > project > (role override > global preset)** via a new pure `resolveEffectiveDeliveryTier`, and the board card schema carries an optional `deliveryTierOverride` (additive/CRDT-safe). A card with an override is gated at that tier regardless of the global setting; cards without one are unaffected. (Per-project storage + the Settings/card UI to set it, and auto-commit/PR at the lower tiers, are the next increments.)

- Began per-agent **focus chains** (todo §5.N): the data core for an agent-authored, ordered task checklist (the steps it drafts at the start of a task and works through, à la Cline). A pure module (`src/core/focus-chain.ts`) normalizes an agent-emitted chain (trim/clamp step text, drop empties, coerce unknown status, cap at 30 steps), summarizes status counts + completion, and renders a markdown checklist for re-anchoring the model on its plan; the card schema carries an optional `focusChain` (steps + status + updatedAt). Added the `update_focus_chain` tool (`src/nklein-sdk/nklein-focus-chain-tool.ts`): the agent calls it to draft its plan and re-sends the full list with each step's status as it progresses (the reliable shape for small models), mirroring how `decompose_project`/`submit_review` give a structured artifact instead of prose. Unit-tested. **Now wired into board agents:** the efficiency rules tell every agent to draft a focus chain at task start and keep it updated, the session runtime attaches `update_focus_chain` whenever the runtime wires a persistence handler, and the state hub persists each update onto the card's `focusChain` (+ broadcasts), so it survives turns and restarts. The card detail view renders the chain as a live **todo-list** panel (✓ done / ▸ in-progress / ○ pending / – skipped, with an x/total count). The chat-agent surface (§5.M) follows.

- Per-role model pools (todo §5.L / #4): a role's model config can now carry an `additionalModels` pool, so a single role (e.g. Worker) can be backed by several local models. At task-start every pool member becomes a candidate tagged with that role, and the existing free-first routing fans concurrent tasks out across the free, capability-feasible members instead of queueing them on one model. Reuses the existing `modelRoles` config plumbing (loads/preserves/round-trips), so single-model roles are unchanged; the primary model keeps its strict context-policy gate while an over-budget pool member is simply skipped. Settings → !Klein → Model roles now has an "Additional models" pool toggle per role (chips of the provider's other loaded models) so you can build the pool from the UI.

- The Python core sidecar (`core-py`) is now **default-on** (opt-out via `NKLEIN_CORE_PY=0`) instead of opt-in. Structured-generation and embedding callers already fall back instantly to the in-process path on any error, and an absent localhost sidecar is an immediate connection refusal (not a timeout), so when the core isn't running behavior is unchanged — but when it *is* running it's now used automatically with zero config (incl. the in-process GGUF code-embeddings). Added `probeKleinCorePyHealth` (a short-timeout `GET /health` probe that never throws) for surfacing core status. (Follow-up: a startup health-gate to harden the reachable-but-hung edge, and the Settings status line.)

- Swarm fan-out across free models (todo §5.L / #4): when a task starts and its preferred model is already busy running another task, the runtime now routes it to a free, capability- and context-feasible alternative instead of queueing — so parallel tasks spread across the available local models. Single-model setups and the configured per-role preference (e.g. the architect model for plan-mode) are unchanged whenever the preferred model is free; the fan-out only triggers under contention. Built on the unit-tested `selectRoleModel` core (free-first, difficulty/context-gated).

- Settings → Tasks now has an **Agent Capabilities & Autonomy** section: pick the capability tier (sandbox network/tools) and the delivery-autonomy tier (how far commit→PR→merge proceeds), each with a plain-language description of the selected tier. Saves through the runtime config and is read back on reload. Both default to **fully open**; the section notes that Docker isolation and the local-models-only lockdown never relax at any tier. (Per-role overrides — already supported by the config/core — are a follow-up; this exposes the global presets.)

- When a weak local model repeatedly calls `decompose_project` with **empty arguments** (it plans the whole decomposition in its reasoning channel but never emits it as the tool's JSON arguments, so nothing decomposes), the repeated-tool-call guard now parks with a **diagnostic** message naming the real cause and remedy — switch the Architect/planning role to a more capable model, or reduce scope — instead of the generic "same input" notice. (Observed live with a 26B local model that reasoned a full plan, then emitted `{}` three times.)

- Began universal hover/focus tooltips so any control is self-explanatory: a new single-source-of-truth copy registry (`element-tooltips.ts`) + an `ElementTooltip` helper render a control's **name** plus a one-line **description** from a typed id (a missing entry is a compile error), and carry their own tooltip provider so they drop in anywhere. First batch wired the top-bar icon buttons (Settings, Debug, Back to board, sidebar toggle); the rest of the UI follows.

- Fixed decomposition silently producing nothing when a small local model emits a malformed `decompose_project` call. The tool's input schema was strict at the SDK boundary (`required` fields, no extra keys) — *at every depth*, including each task and question — so the SDK rejected a slightly-off call *before* !Klein's handler ran, answering with a multi-KB raw Zod validation dump that a small model can't recover from, that burns its context budget, and that bypasses !Klein's own JSON-repair. Observed live across several runs: a model called the tool with a typo'd task key (`acceptenceCommand`), or omitted `title`, or degraded into repeated empty `{}` calls — and decomposed nothing. The whole boundary schema tree is now relaxed (every `required` stripped, every object opened, while the map-valued `expansions` schema and all property descriptions are preserved) so *every* call reaches the handler, which validates in-process and throws a short, directive message instead — naming the missing fields and nudging a small first payload ("3–6 tasks, keep spec/plan brief, don't resend empty"). Empty `{}`, blank-string fields, and typo'd task keys are now recoverable (a typo'd acceptance command falls back to `defaultAcceptanceCommand`). (Distinct from the existing re-prompt for turns that end with *no* tool call — here the model did call the tool, with bad arguments.)

- Fixed a runtime crash where the whole process would die mid-task with `ECOMPROMISED` (`utime '.../workspaces/index.json.lock'`). `proper-lockfile` refreshes a held lock's mtime on a timer; when the event loop is blocked long enough (heavy local-model startup, SDK host boot) the lock goes stale, another holder reclaims it, and the library's *default* `onCompromised` rethrows from inside that timer — an uncaught exception that took down the runtime. Locks now install a non-throwing default handler that records the anomaly via self-observation instead of crashing (writes here are atomic temp-file+rename, so a momentarily lost lock means at worst a lost update, never a corrupt file), and lock release is now resilient so a compromised-lock `ERELEASED` rejection can't escape, mask the operation's result, or leave sibling locks unreleased.

- Began the second-opinion reviewer workflow (every worker card gets a real review pass from the reviewer role, like a human dev team): the pure decision core decides approve→deliver, request-changes→bounce-back-to-worker, or park, with a generous round cap plus **stall** (no worker change since the last round) and **identical-loop** (same feedback on unchanged work) detection so a weak model can't ping-pong forever; and a `submit_review` tool gives the reviewer a structured verdict (`approve`/`request_changes` + summary/feedback/insight) instead of prose to parse. Added the pure orchestration core that sits between that decision and the live runtime: stable work/feedback fingerprinting, the reviewer-role seed prompt (objective + acceptance summary + prior change request + the diff under review + **the worker's own reasoning** and **the card's board/plan context** — its plan objective, the cards it depends on, the cards that depend on it, and its sibling cards — so the reviewer judges the *approach* and the card's *fit in the whole plan*, not just the bytes changed; ending in a single required `submit_review` call), the worker bounce-back prompt that carries the feedback as the next turn, the approval sign-off, and `resolveReviewTransition` (verdict + round + history → deliver / bounce-to-worker / park, plus the review-history record to persist). All unit-tested. Persisted state + settings are in place too: a global **Second-opinion review** setting (default **on**) with a configurable **round cap** (default 20) round-trips through the runtime config, and the board card schema now carries an optional `review` object (status, round, per-round history with verdict + work/feedback fingerprints, last summary/feedback/insight, sign-off, parked reason) — additive and CRDT-compatible (whole-object last-writer-wins), so older boards load unchanged. The review orchestrator (`runNKleinSecondOpinionReview`) ties it together with injected I/O (mirroring the acceptance auto-repair pattern): gate the card → extract the worker diff → run a reviewer session for a verdict → map it to a transition → persist the review round and call the matching side effect (deliver / bounce-to-worker / park). Unit-tested with mocked dependencies. Settings → Tasks now has a **Second-opinion review of completed cards** toggle (default on) wired to the `secondOpinionReviewEnabled` config. The card detail view now shows a **Second-opinion review** panel (status + round + the reviewer's summary, requested changes, sign-off, or parked reason) whenever a card carries review state. The live wiring is now in place: `getTaskResultBranchDiff` provides the worker's diff, the session runtime attaches the `submit_review` tool for a reviewer turn (only when given a verdict handler), the task-session service's `runSecondOpinionReviewSession` runs an isolated reviewer turn under a synthetic `<taskId>::review` session (prepared from the result branch, reviewer model, bounded by a timeout, always torn down), and the review runs **in the delivery-gating seam** — `finalizeHeadlessAutoReviewTask`, right after a card moves to Review and before any auto-merge/complete — so the verdict actually gates delivery: approve → proceed to deliver; request-changes → the card is already back in In Progress with the worker re-driven, so delivery is skipped; park → it stays in Review. **Gated on the setting and fully fail-safe**: any review error (or a skip when disabled) falls through to the prior auto-complete behavior, so the review can never block delivery on its own failure. The gate runs after `resolveReviewSandboxResult` settles (the result-branch capture is async), so when there is a diff the reviewer has it — and it runs for a **no-change result too**: an empty patch (no files touched) is reviewed rather than silently auto-completed, because a no-op usually signals bad planning or a mis-processed task; the reviewer is told there were no changes and asked to judge whether that's genuinely valid or warrants `request_changes`. The flow is unit-tested with mocked I/O and was exercised against a live local model + Docker: the runtime boots clean on it, a worker task runs in the sandbox and its result is captured + auto-delivered, and the review gate executes in the correct seam (verified via a new outcome log + reviewer-session-failure telemetry). Small reviewer models often end a turn without emitting `submit_review`, so the reviewer session now **re-prompts** (mirroring the decomposition nudge): if a turn ends with no verdict, it tells the reviewer to call `submit_review` now and tries again, bounded by a small nudge budget and the overall time budget; only after that does it fall back to `no_verdict` (which still fail-safe-delivers). The whole reviewer session — first turn + nudges — is bounded by one overall deadline and always torn down.

- Fixed the !Klein default-model selector spinner spinning forever when the live model list (e.g. LM Studio `/v1/models`) is slow or unreachable: the provider-models fetch is now bounded by a 15s timeout, so loading always resolves or errors instead of hanging. Removed the redundant/obsolete refresh button next to the default model selector (it duplicated — and could hang like — the working **Refresh** in the *Model context windows* panel, which already reloads every model dropdown). Relabeled the selector to **Default model** with a hint that it applies to all work unless a role (Architect / Worker / Reviewer) overrides it, and where to refresh the lists.

- Fixed decomposition tasks silently stalling when a reasoning model (e.g. deepseek-r1) spends its whole turn in the reasoning channel and ends without emitting a `decompose_project` tool call. The turn previously went to `awaiting_review` with nothing decomposed and no error (the self-review hook bails on empty output). !Klein now re-prompts such a turn to emit the tool call now (bounded by the same nudge budget as the chat-only nudge, and only on a clean stop with no tool call and no pending user question), and the decomposition prompt tells the model explicitly that reasoning alone is not an answer and a tool call is mandatory.

- Fixed a second decomposition stall in the same family: a turn that stops **mid `read_large_file` workflow** never recovered. Observed live with a 35B local model decomposing an 83 KB spec — it read the first chunk, then *narrated* the next `read_large_file` continuation as a `<tool_call>{…}</tool_call>` **text block in its reasoning channel** instead of emitting a real tool call, so no tool ran, the turn ended at line 788 of 1277, and `decompose_project` was never called. The existing stall re-prompt didn't fire because the clean-stop summary (`agent_end`) preserves the last tool name, so "a tool ran this turn" (`read_large_file`) wrongly exempted it — and because the model never made another call, the large-file workflow's own `beforeModel` continuation guidance (which re-injects the exact cursor and restricts tools to `read_large_file`) never re-fired. The stall recovery is now a pure decision core (`src/core/decomposition-stall.ts`, unit-tested) that classifies the two shapes — reasoning-only (re-prompt to emit `decompose_project`) vs. mid-read (`read_large_file` was the last tool → re-prompt to make a *real* tool call and finish reading through EOF with the `nextCursor`, then decompose, explicitly noting a tool call written as text does not execute) — sharing the same bounded nudge budget. Once the model makes a real `read_large_file` call again, the existing workflow guidance takes back over.

- Acceptance-command failures are now classified into a small taxonomy (command-not-found, missing-script, missing-dependency, type-error, lint-error, compile/syntax-error, test-failures, timeout, or unknown) with a human label and a next-step hint, instead of just an exit code and raw output. The acceptance gate stamps the category and hint on its result, they round-trip through the runtime contract (the wire `failureCategory` is the typed enum, derived from a single source-of-truth category list shared with the classifier), and the card detail view's **Verify acceptance** result now renders the classified label plus the next-step hint on failure (e.g. *"Missing dependency — A required module/package is not installed…"*) so you see *why* a check failed at a glance, not just that it did.

- The project Code-intelligence panel now shows the built-in embedding model's status: which provider is effective, whether the GGUF is downloaded (and its size) or will download on first index, and a clear note when it is running as the lexical fallback because the Python core is disabled.

- Added the built-in, zero-config code-embedding model (`local_gguf`, now the default): a quantized GGUF (nomic-embed-text-v1.5) is auto-downloaded on first use to the runtime home (streamed to disk with progress + integrity/version checks, the one sanctioned host-side fetch), then embedded in-process by the Python core — no LM Studio/Ollama required. The model loads lazily on first embed and frees on idle. If the Python core is disabled or the model/sidecar is unavailable, embeddings degrade cleanly to the existing `local_lexical` provider, so a fresh install behaves exactly as before until the core is enabled and indexing never hard-fails.

- Python core can now embed via an in-process quantized GGUF model (`llama-cpp-python`, `embedding=True`): `/v1/embed` accepts a host-provided `gguf_path` (+ a CPU-thread cap so it never competes with the main LLM), caches the loaded model across index batches, and a new `/v1/embed/unload` frees it when idle. Any load/embed failure degrades to the dependency-free lexical embedding so indexing never hard-fails. This is the in-process, no-external-runtime backend for the upcoming zero-config code-embedding default (nomic-embed-text-v1.5); the host-side GGUF download + provider wiring follow.

- Instruct local models to keep responses and reasoning short, and to act with tools instead of writing long prose. Added a prominent "Response Length And Reasoning Discipline" section to the per-task efficiency rules (applied to every task) and a brevity directive to the decomposition planning prompt. Oversized outputs/reasoning waste the context budget and can crash a local model host under memory pressure — reasoning models like deepseek-r1 are especially prone to emitting very long chains of thought — so this both reduces crashes and saves budget.

- When a local model host (LM Studio/Ollama) crashes or unloads its model mid-run — a real failure mode under memory pressure, e.g. a reasoning model at a large context window on limited hardware — !Klein now recognizes the resulting dropped-connection / model-not-loaded errors, parks the task fast (after a single transient retry instead of the generic three) instead of retry-storming a model that is gone, and shows an actionable card warning: reload the model in your local host, or pick a smaller / non-reasoning model or a smaller context window, then resume.

- The committed portable board CRDT (`<repo>/.nklein/nklein/workspace/board-crdt.json`) now migrates forward on read: a forward-migration registry upgrades older committed files (e.g. one fetched from a machine still on a prior schema) up to the current version, and a file written by a *newer* schema this build cannot safely downgrade is refused rather than silently coerced or partially read. Previously any `schemaVersion` other than the current one was dropped to `null`, which would have lost cross-machine board state on the first schema bump. A future bump is now a one-line migration entry plus a version constant change.
- Wired the dev-test harness to a running runtime: `nklein dev test-project --preset <mid_task|complex_dag|audio_vst|daw_foundation>` starts the scenario's seed card via the runtime tRPC API and monitors the board to a single classified outcome, reading live state and falling back to the last persisted board when the runtime is unreachable. Added `nklein dev cleanup-report`, which scans for scaffolded dev-test workspaces (by their marker file, sized via `du`) and `nklein`-prefixed Docker sandbox volumes, retains the active run, and reports reclaimable vs retained bytes. The state-reader fallback and cleanup active/retained classification are unit-tested.
- Terminal run summaries now record where a timeout that ended a run came from: each bounded stream/tool/conversation timeout carries provenance (`role_override` vs `global_config` vs `autonomous_default`), resolved from the same launch-config precedence that picks the timeout value, and the source of the timeout that actually fired is persisted on the run summary (previously always `null`). Added a `summarizeTimeoutOutcomes` aggregator that groups timeout-triggered runs by model and timeout source with their terminal outcomes, so "which model/timeout-source combinations keep timing out, and what happens when they do" is answerable from the durable run log.
- Hardened near-valid tool-payload handling for small local models: `expand_task` now recovers a JSON-stringified replacement graph (with the same trailing-brace/whitespace repair `decompose_project` already applies to `tasks`/`expansions`) instead of failing schema validation, and added a broadened fuzz suite covering `expand_task`, `write_file`/`write_files`, and the discovery tools (`list_files`/`find_files`/`get_file_size`) — exercising stringified nested JSON, the `file_path` alias, boolean/number-as-string options, out-of-range clamping, and harmless extra keys, while still failing clearly on genuinely unusable input.
- Locked the workspace-scoping of the model-performance and knowledge-tool-usage telemetry caches with regression tests: the same repeated dev-test task id used across two projects now provably stays as two distinct observations (no task-id-only key collision), keeping per-project stats correct.
- Fixed plan-mode dev-test cards that displayed "Architect working" while still carrying Worker model settings; plan-mode starts now re-resolve to the configured Architect role, and local scheduling uses per-model endpoint slots (`endpoint#model`) so two available local role models can run different cards concurrently unless explicitly grouped to the same shared endpoint.
- Made plan-mode !Klein starts prefer the configured Architect role model and added board-card role chips so cards show whether Architect or Worker will run them, including active/queued status.
- Fixed planning/decomposition system guidance so local models are no longer told to call `/kanban-decompose` as a tool; the runtime still loads the overridable decomposition workflow internally, but agents now get explicit `decompose_project` tool-first instructions, including for large implementation-card graph prompts.
- Linked the DAW foundation dev-test fixture into the left-sidebar Dev Test Scenarios card as a `daw_foundation` preset, backed by the dedicated DAW template and full foundation-release specification.
- Fixed the same local model showing up twice in the model registry/picker — once selected with blank/"unknown" stats and once with the real telemetry. Loopback endpoint spellings (`localhost` vs `127.0.0.1`/`0.0.0.0`/`::1`, and trailing slashes) are now canonicalized in the model-registry key, so a model configured as `127.0.0.1` but observed as `localhost` is a single entry; existing persisted duplicates merge on load, keeping the entry that carries the observations.
- Integrated the NKlein SDK directly into the repo instead of treating it as an installed package. Removed the `@nklein/{core,agents,llms,shared}` `file:` dependencies and now resolve the `@nklein/*` specifiers (used by our code and the SDK's own internal cross-imports) through in-repo path aliases — `tsconfig` paths (tsc + tsx), a shared `vitest`/`esbuild` alias module (`scripts/nklein-sdk-alias.mjs`) — pointing at `vendor/nklein-sdk/*/dist`. The SDK's own runtime dependencies were hoisted to the root manifest. The SDK is now plain repo-owned code we can edit freely, not an external package. Verified: typecheck, the full runtime suite, both esbuild bundles, and `tsx` dev resolution all pass with no `@nklein` package in `node_modules`.
- Stopped a background crash loop: the SDK session host now runs with the in-process `local` backend instead of `auto`. `auto` selected the shared "hub" daemon whose cron/automation entrypoint is broken in the pinned SDK build (the bundled daemon entry throws `ReferenceError` on load — an upstream defect, independent of !Klein), so it crash-looped in `~/.nklein/data/logs/hub-daemon.log`. !Klein is a single local-only app and does not use the hub's scheduled-agent features, so the local backend is both the fix and the correct mode.
- Fixed Planning-column cards never starting from their buttons: the Start (play) button shown on Planning cards was wired only for Backlog, so clicking it did nothing; it now launches the task. Starting a card that is already in its active column (a plan-mode card started in place in Planning) no longer drops the kickoff through a degenerate same-column move. And **Approve for execution** now actually launches the task when nothing is running yet, instead of only flipping the card out of plan mode and leaving it parked as "Execution approved".
- Fixed approved act-mode planning cards never running: a card sitting in **Planning** with `startInPlanMode: false` (a seeded or decomposition-generated implementation card, which has no Start button) is only startable by dragging it into **In Progress**, but that drag moved the card without launching an agent session, so the task silently never ran. The `planning → in_progress` drag now kicks off the session for such cards, while plan-mode cards and cards that already own a live session keep their existing approve/continue flow.

- Separated hidden !Klein planning/decomposition guidance from visible task prompts: dev-test seed cards now show product-focused user requests, runtime decomposition guardrails are delivered as system guidance, and chat transcripts collapse those system prompts behind an explicit “Show system prompt” control.
- Standardized user-facing app branding on `!Klein` across settings, card/chat copy, onboarding, CLI help, and surfaced runtime errors, and tightened the brand regression guard so visible `NKlein` text cannot be reintroduced accidentally.
- Added an OpenHands-inspired "watch the agent's hands" view: a per-card **Watch** tab that shows, in one place, the agent's live state/model/elapsed/current-tool, an accumulated **activity timeline** (every tool/step it takes, streamed from the data the runtime already broadcasts), and the **files it is changing this run** — plus a jump to its interactive terminal. Built on a new client-side activity-timeline accumulator (unit-tested) with no backend changes.
- Vendored the SDK packages !Klein depends on under `vendor/nklein-sdk` as local `@nklein/*` packages and removed the external SDK package boundary, so the runtime now builds against repo-owned NKlein SDK packages.
- Fixed LM Studio model selection after the NKlein rename: live model discovery now falls back to the catalog localhost base URL when no model base URL is saved, the settings dialog no longer defaults live-only LM Studio providers to stale SDK defaults like `openai/gpt-oss-20b`, and it auto-selects the first currently loaded LM Studio model when the saved draft is empty or unloaded.
- Reworked Add Project so repeated clicks open one controlled dialog instead of stacking native folder pickers, added an Existing Folder flow with a guarded Browse action and editable project name, and added a New Folder flow that derives a filesystem-safe folder name from the project name while allowing manual override.
- Stopped auto-registering the runtime's launch checkout as the initial project, so running !Klein from its own source no longer pre-fills `kanban`; adding the running source folder now goes through the explicit self-project confirmation gate.
- Hardened local-only model/provider visibility across the web UI: stale `cloudProviderSupportEnabled` config can no longer reveal cloud providers, per-card override model loading ignores hidden cloud defaults, and model-role overrides only preserve providers that pass the same visible-local provider policy.
- Added the audio VST / psytrance dev-test preset to the left sidebar Dev Test Scenarios card, including the same create-and-start flow as the other seeded decomposition scenarios.
- Tightened explicit decomposition planning starts, including the audio VST dev-test seed, so local models call `decompose_project` immediately after one focused context pass, recover from duplicate-read guardrails without looping, and record domain knowledge gaps inside the generated plan instead of streaming long chat reports. If a small model still starts a chat-only decomposition report or stalls after announcing `decompose_project`, !Klein now uses bounded corrective restarts with stricter tool-call-only instructions instead of waiting for the full stream timeout.
- Raised the repeated-call parking threshold for !Klein's richer `read_files` and `run_commands` NKlein tools while keeping stricter native tool loop guards, so autonomous dev-test cards are not parked for legitimate repeated verification or multi-file context reads.
- Reconciled board lanes after recovery input restarts a NKlein task from Review/Backlog/Planning, so resumed cards move back to their active lane instead of remaining as stale review blockers.
- Treated SDK `aborted` turn endings after completed mutating/acceptance tools as reviewable NKlein completions, preventing successful sandbox work from being left as an interrupted/lost active card when no final prose is emitted.

- Python core Phase 4 — decomposition quality: ported the dependency-coherence validator and best-of-N graph selection (self-consistency) to the Python core (`/v1/decompose/select`), so weak local models can sample several plans and keep the most coherent one — directly targeting the decomposition under-scoping that the audio-VST dev-test run exposed. Unit-tested.

- Python core Phase 3 — native agent core: a ReAct tool-calling loop (`/v1/agent/run`) that runs entirely in the Python core on the local model with constrained-JSON action selection, workspace-scoped tools (`read_file`/`write_file`/`edit_file`/`list_files` with path containment), and the aider-style fuzzy search/replace editor ported from the TS implementation (exact → whitespace → leading-blank → `...` elision → fuzzy ≥0.8). Loop guards: repeated-action stall, unknown-tool feedback, max-turn budget. Unit-tested.

- Python core Phase 2 — ML services: `/v1/compress` (LLMLingua-2-style token-importance compression; dependency-free heuristic default, real LLMLingua-2 as an opt-in `ml` extra), `/v1/embed` (deterministic lexical embedding default, sentence-transformers opt-in), and `/v1/repomap` (PageRank-ranked symbol map). All local-only and unit-tested (FastAPI TestClient); the `llama-cpp-python` own-GGUF generation backend is verified installed.

- Started the polyglot migration: added a local-only Python core sidecar (`core-py/`, FastAPI) that will own !Klein's ML + native-agent capabilities, beginning with **constrained generation** (`/v1/generate`, `/v1/generate_structured`) that the NKlein SDK can't provide — full sampling (`min_p`/`top_k`/`repeat_penalty`) plus grammar / JSON-schema decoding, via either its own `llama-cpp-python` backend or by proxying a local OpenAI server. The TS runtime calls it through a new `KleinCoreClient` that is a drop-in for the existing local client and **falls back automatically** when the sidecar is disabled/unreachable; it is opt-in via `NKLEIN_CORE_PY` (default off), so behavior is unchanged until enabled. The React UI/Electron and the NKlein runtime are untouched.

- Began !Klein's own native agent core (`src/agent-core/`): a constrained tool-calling (ReAct) loop that runs on the !Klein-owned local model client instead of the NKlein SDK, with stall/loop and max-turn guards and a `LocalLlmClient` action decider that selects the next tool via JSON-schema-constrained decoding (reliable for small/quantized models). The NKlein SDK remains one supported runtime; it is no longer the only one.
- Added `THIRD_PARTY_NOTICES.md` documenting the decision to adopt implementations from the wider local-agent ecosystem (aider, Roo Code, Continue — Apache-2.0; OpenHands — MIT) by re-implementing them in our own codebase with attribution, and explicitly excluding AGPL-3.0 code (Open Interpreter) to keep !Klein Apache-2.0.

- Added a per-model/per-role sampling policy (`resolveLocalSamplingOptions`) for the local model path: deterministic low temperature for coding, near-greedy for structured output, slightly higher for planning, with tighter temperature + repetition penalty and `min_p` for small/quantized model families to prevent loops and incoherent output.
- Added a shared, well-tested tool-argument JSON repair (`repairJsonValue`) that recovers near-valid JSON from small models (code fences, surrounding prose, trailing commas, unquoted keys, single quotes, truncated brackets) and unified the previously duplicated parsers in `decompose_project`, `write_files`, and `edit_file` behind it.
- Added best-of-N decomposition selection (self-consistency): sample several candidate task graphs and pick the best by the existing sizing + dependency-coherence validators, so weak local models produce better plans without a stronger model.
- Added LLMLingua-2-style selective prompt compression: an opt-in token-importance compressor that keeps the highest-information tokens to fit small context windows, with a zero-dependency heuristic scorer as the batteries-included default (best for limited hardware) and a runtime model download/update manager for an optional ONNX scorer that users can opt into. Wired as a `selective` mode in the context compressor with the existing caveman/minify path as the opt-out fallback.
- Added a !Klein-owned local model client (`LocalLlmClient`) for local OpenAI-compatible servers (LM Studio / Ollama / llama.cpp) that is not limited by the NKlein SDK's request layer: it sends full sampling controls (`temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `stop`, `max_tokens`) and grammar / JSON-schema **constrained decoding** (`response_format` + llama.cpp `grammar`), which keep small/quantized models reliable. It is local-only (fail-closed via the cloud-lockdown policy) and offers a `generateStructured` helper that returns schema-valid JSON with prose/code-fence recovery and a single corrective retry. This is the foundation for using a direct local path (instead of only NKlein) for structured operations.
- Added an `edit_file` tool that applies token-efficient search/replace edits with a lenient fuzzy-match fallback ladder (exact → whitespace-flexible re-indentation → leading-blank tolerance → `...` elision → closest fuzzy match ≥80% similarity), modeled on aider's edit-block coder. This lets small/quantized local models edit large files reliably without whole-file rewrites and without looping on near-miss exact matches; failures return a corrective hint with the closest-match similarity. It reuses the existing protected-path, secret-scan, file-scope, and per-file-line write guards and is registered in the Docker sandbox tool runner.

- Added decomposition dependency-coherence validation: `decompose_project` now rejects task graphs where a test/acceptance card does not depend on the implementation it verifies or a documentation card does not depend on the work it documents, and surfaces softer graph-quality warnings (sparse graphs, isolated cards, likely-reversed test edges, UI cards ignoring domain/control cards) in the tool result and self-observation telemetry.
- Added a `knowledgeDebt` field to decomposition task cards plus a knowledge-acquisition and "scope pressure" pass in the `kanban-decompose` workflow, so domain-heavy work (audio/DSP, crypto, hardware, ML) records what each card still does not know and is checked for being under-decomposed by 10x/100x instead of treated as a small CRUD feature.
- Classified sandbox result-patch capture failures: a corrupt/garbled captured diff is now distinguished from a patch that does not apply, the failing file and hunk are extracted, the failing patch is preserved under the runtime home `patch-failures/` directory, and all of this is attached to the review card and self-observation telemetry instead of a bare "corrupt patch at line N".
- Added a structured note to NKlein stream/tool inactivity timeouts recording the last model activity, last tool, whether workspace changes were captured, and whether resuming is safe, so a stall-induced review is diagnosable.
- Added durable terminal task-run summaries: when a task ends in review/failed/interrupted, !Klein now records a run summary (provider/model, endpoint, review reason, last activity, token usage, exit code, timing) to a runtime-home `task-runs/` log that survives runtime shutdown (unlike the live `sessions.json`), and exposes recent run summaries through the task diagnostics API so unfinished cards stay inspectable after the runtime stops.
- Narrowed the same-turn file-read guard so only additional content reads (`read_files`/`read_large_file`) are serialized within an assistant turn; harmless discovery (`list_files`/`find_files`/`get_file_size`) and edits/commands after a read are allowed, and the rejection text now tells the model to continue with the result already shown instead of "waiting".
- Made `decompose_project` tolerate a `null` `summary` from small local models, matching the other already-nullable fields.
- Added a near-valid tool-payload fuzz suite for `decompose_project` and a regression test proving generated cards land in Planning with start preconditions met.
- Added a portable, cross-machine board CRDT (per-field last-writer-wins with tombstones for cards/placement and presence registers for the DAG) plus a committed `<repo>/.nklein/nklein/workspace/board-crdt.json` store with export/import; imports drop the source machine's model assignments so roles/fit re-resolve against the importing machine's local models, keeping the local-only invariant. The durable board is exported to the CRDT on every state save and recovered from it (with local re-resolution) on a fresh machine when no runtime cache or board mirror exists.
- Added an official dev-test harness (`runDevTestProject` + `buildDevTestSeedStartPayload`) that sends the exact UI-equivalent seed-card start payload and runs a bounded monitor loop which degrades when the runtime becomes unreachable and ends with a single classified run outcome, replacing ad-hoc fresh-run scripts.
- Added a dev-test cleanup report summarizer that classifies obsolete dev-test workspaces, sandbox volumes, and editor/cache artifacts, never reclaims the active run, and reports reclaimable vs retained bytes per category.
- Added a dev-test run-outcome classifier that tracks acceptance-command success and board completion separately, so a run where `npm test` passes but cards remain unfinished is reported as `acceptance_green_workflow_incomplete` rather than "green"; also classifies `blocked_by_review_cards`, `stagnant`, `runtime_down`, and `failed`, with a helper to derive counts from a persisted board for observers running after runtime shutdown.
- Added local model performance statistics for NKlein task runs, aggregating observed outcomes, timing, token usage, context pressure, model, role, project, and !Klein version with a detailed Settings view next to model roles.
- Added knowledge-tool usage statistics for NKlein retrieval, code-index, file discovery/read, planning-control, architecture-knowledge, and external-fetch tool events, with project/global aggregates in the Settings statistics view.
- Added a domain-knowledge-heavy audio VST/psytrance dev-test preset with a dedicated DSP fixture for kick/bass synthesis, phase-aligned sequencing, UI state, and clean-effect guardrails.
- Made `decompose_project` tolerate stringified task arrays and expansion maps from small local models at both the advertised tool schema and execution parser layers while still validating the parsed graph with the normal strict decomposition contract.
- Made `decompose_project` recover JSON-stringified task arrays with stray trailing closing braces, matching a malformed local-model tool call observed in the complex dev-test seed card.
- Matched `decompose_project`'s advertised nullable fields to its runtime parser, so answered questions and optional task hints that use `null` are not rejected before execution.
- Made `write_files` tolerate JSON-stringified batch file arrays from small local models at both the advertised tool schema and execution parser layers.
- Made `write_files` tolerate harmless extra keys on batch file entries, such as range fields copied from read tools, while still validating the actual `path` and `content` fields before writing.
- Blocked exact repeated batch `read_files` requests across NKlein turns, so agents that reread the same file group are steered to use existing context, narrow the requested range, edit, or run acceptance instead of looping.
- Normalized host project paths embedded inside sandboxed bash command strings, preventing agents from misdiagnosing the sandbox as unavailable after running `cd <host temp project> && ...` inside `/workspaces/<task>`.
- Added bounded autonomous timeout defaults to dev-test seed cards and decomposition-generated cards unless a role explicitly opts into unlimited timeouts, so stalled local-model turns surface during autonomous QA instead of hanging indefinitely.
- Lowered the default Docker agent sandbox memory cap from 4096 MB to 2048 MB per container to reduce Docker VM swap pressure on constrained developer machines; saved runtime settings can still raise it.
- Completed successful auto-review cards that finish with an explicit empty sandbox patch, so analysis/no-change generated cards unblock their dependent Planning cards instead of getting stuck in Review.
- Normalized host workspace absolute paths inside sandboxed `list_files`, `find_files`, and `get_file_size`, matching the existing `read_files` recovery path and preventing repeated discovery-tool loops on temp project paths.
- Tightened the complex dev-test decomposition seed so broad test and README cards depend on the implementation leaves they validate or describe, avoiding early test-card scope drift.
- Preserved workspace lock contention during scoped runtime requests so transient state writes retry instead of being misreported as an unknown workspace.
- Treated sandbox result-patch staging failures from already-invalid/non-Git teardown workspaces as benign cleanup, avoiding misleading capture warnings when an interrupted task had no result to preserve.
- Enforced generated-card write scopes in NKlein tool approval so cards with `filesLikelyTouched` can only edit their declared files.
- Forced successful decomposition source cards back to Completed after stopping their NKlein session, closing a race where a late SDK completion event could leave the source card in Review.
- Skipped headless auto-review finalization for cards already in Completed, preventing late NKlein summaries from moving completed decomposition source cards back to Review.
- Skipped headless auto-review finalization for planning-mode cards, leaving decomposition source completion to the dedicated decomposition callback instead of trying to merge a nonexistent task result branch.
- Reduced NKlein's consecutive and repeated tool/schema mistake limits so malformed tool-call loops park quickly instead of burning several autonomous turns.
- Normalized decomposition tasks that set `testFirst: true` without an `acceptanceTestPrompt` back to normal execution, so otherwise valid DAGs are not rejected for an optional test-first hint.
- Added a Windows `start.bat` development launcher that checks Node.js 22+, npm, Git, and Docker Desktop reachability, installs missing repo/web/desktop dependencies, and starts the existing full dev runtime for Windows testing.
- Restored autonomous decomposition under strict Docker isolation: the trusted control-plane `decompose_project` / `expand_task` tools (which mutate only !Klein plan artifacts and the board, never the user's working tree) now stay available host-side during sandboxed planning, so a single high-level prompt can again become a Planning-lane DAG of dependent cards. Planning prompts advertise the decomposition workflow again, and the host workspace root is always forwarded to the session runtime so board/plan mutations resolve to the owning workspace rather than the container workdir.
- Fixed decomposition-generated Planning cards so the original decomposition source card is moved to Completed after successful auto-apply, root cards are requested for automatic start through the runtime queue while dependents remain linked behind prerequisites, default project acceptance commands override brittle per-card shell probes, and routine workspace-resolution polling no longer floods local self-observation telemetry.
- Tightened dev-test decomposition seeds so each scenario gets a distinct task id and prompts explicitly require workspace-relative reads, the real `specification.md` as the source of truth, and valid `acceptanceTestPrompt` values for test-first leaves.
- Stopped the sandboxed NKlein repo-map rail from exposing host-only absolute workspace paths to agents, reducing invalid read/list-file retries inside Docker workspaces.
- Normalized exact host-project path prefixes and workspace-root absolute paths at the sandbox tool-runner boundary, so NKlein file tools recover when a model supplies `/src/...` or the trusted runtime's project path for files that exist inside the Docker workspace clone.
- Added a leaf-scope guard to decomposition-generated card prompts so agents treat the shared spec as context and avoid implementing dependent downstream cards early.
- Fixed normal NKlein task exits (`reviewReason: "exit"`) so they enter the same acceptance/ready handling as hook/attention/error review states instead of leaving generated cards stuck In Progress with captured result branches.
- Added an explicit `minimumTaskCount` guard to `decompose_project` and wired the complex dev-test seed to require 10 leaves, preventing local models from accepting 9-card DAGs as satisfying "at least ten" work.
- Embedded the complex dev-test capability list in the seed prompt so decomposition stays anchored to the intended product spec even when a local model misrecalls a previous `specification.md` read.
- Completed decomposition source sessions automatically after successful auto-apply and kept queued generated root cards in Planning until their NKlein session actually starts, preventing source-card artifact-inspection loops from blocking the generated DAG.
- Tightened the complex dev-test seed with a 12-leaf outline and immediate-tool-call instructions so local models stop spending the first 10 minutes narrating a decomposition plan instead of applying the generated DAG.
- Added an execution-pace guard to generated leaf prompts so implementation cards read focused context once, then edit and run acceptance instead of looping through unchanged files or chat-only plans.
- Blocked duplicate single-file `read_files` requests across NKlein turns until a mutating tool runs, while still allowing focused line-range rereads when context focus has compacted older full-file bodies away and avoiding false coverage after failed batch reads.
- Treated NKlein aborted/done events that include a final agent message as reviewable completions when the user did not cancel the turn, so finished sandbox work is captured instead of leaving generated cards interrupted.
- Fixed follow-up input for sandboxed NKlein sessions to resolve runtime setup from the host project path instead of `/workspaces/<task>`, preventing queued steering messages from breaking the prepared Docker workspace.
- Reconciled NKlein tasks that are already awaiting review when the runtime-state hub attaches, so captured sandbox result branches still enter acceptance/ready handling after a restart or delayed hub subscription.
- Added runtime-side headless auto-review for commit-mode NKlein cards: captured task result branches are moved through Review, merged into the base workspace, completed, and newly unblocked dependent cards are auto-started without requiring a browser client. Task-result auto-merge now ignores project-local `.nklein/nklein` runtime mirrors when checking whether the base workspace is clean.
- Renamed task evidence actions to `Create evidence` and made the board-card control visibly labeled, clarifying that the action creates an evidence bundle and copies the agent-ready prompt; the self-improvement project button remains a separate flow that can consume an evidence bundle path.
- Started the project-portability implementation: workspace state writes now mirror board state, session summaries, revision metadata, and workspace identity into `<project>/.nklein/nklein/workspace/`, and project loads can recover from that workspace-local mirror if the runtime-home workspace cache is missing.
- Hardened decomposition planning against sandbox artifact-inspection loops: successful auto-apply now tells agents to stop the planning card instead of reading control-plane artifact paths, and repeated failed inspections of the same plan artifact path across different tools park the task with a guardrail warning.
- Fixed the complex dev-test follow-through path observed in a 30-minute live run: seeded decomposition cards now pass the fixture acceptance command as `defaultAcceptanceCommand`, workspace diagnostics are scoped by project even when task ids repeat, workspace state loads include live NKlein summaries, and generated implementation cards can be started from the Planning lane into execution.
- Added the strict-isolation safety guards to the protected test suite (no-host-execution guard, Docker sandbox lockdown/fail-closed/uid-isolation, and the fail-closed task-start preflight), so weakening agent isolation now requires explicit human approval.
- Documented `usesLegacyHostTaskWorkspace` as the single host-worktree boundary predicate and locked the retirement invariant with a test: the default NKlein/sandbox agent (and unset agent ids) never create a host task worktree, so under local-only no reachable task start creates one.
- Reconciled the AGENTS.md worktree guidance to the container-workspace + result-branch model, marking the host worktree subsystem as legacy (reached only by disabled terminal/CLI agents and user shell terminals) and recording the precise prerequisites for fully deleting it.
- Added a scripted strict-isolation verification runbook (`scripts/verify-strict-isolation.mts`) that drives a real NKlein task against a local LM Studio/Ollama endpoint in an isolated HOME and asserts the isolation invariants (a sandbox container appears, no host worktree is created, the container tears down cleanly, and start fails closed when the sandbox image is missing). Verified end-to-end against real Docker + LM Studio.
- Treated sandbox result-patch capture failures as benign when the workspace was already disposed concurrently or disappeared during staging, avoiding misleading runtime-error warnings while preserving real capture failures.
- Parked cloud-dependent advisor, web-research, and native NKlein team surfaces under local-only mode: Settings no longer renders advisor actions, env flags no longer expose host web research or SDK team delegation, and the modules remain documented as compile-only parked helpers.

- Renamed the fork's user-facing product to `!Klein` and the command-line entry point/package command to `nklein`, while preserving repository/internal compatibility names where they still matter.
- Replaced the remaining app-brand "NKlein" labels in the UI with `!Klein` (sidebar wordmark, UI error screen, runtime-disconnected screen, and offline fallback now say `!Klein` / `nklein`), while keeping genuine NKlein engine/provider/account references intact.
- Kept the current robot app mark for `!Klein 0.0.1`, renamed the sidebar icon component to `NKleinMark`, and removed the leftover `NKleinIcon` UI component name.
- Continued the rename migration across desktop metadata, protocol handling, runtime env vars, workspace headers, session cookies, runtime-home paths, and terminal/status surfaces, with one-release compatibility fallbacks for legacy `KANBAN_*` env vars plus legacy workspace header/cookie acceptance.
- Swept remaining user-facing `Kanban` wording from launch scripts, runtime messages, desktop shims, model/tool prompts, and UI tests, and allowed the new `x-nklein-workspace-id` CORS header alongside the legacy header.
- Kept the sidebar `!Klein Agent` in local-only mode from auto-launching terminal/cloud CLI agents such as Claude, defaulted settings back to local NKlein, hid cloud agent rows behind a static local-only settings line, and limited onboarding to the local NKlein agent when cloud support is disabled.
- Taught the desktop runtime health probe to recognize both the current `!Klein` browser title and the legacy `Kanban` title during the rename transition, so packaged shells can still attach to already-running older runtimes.
- Tightened the Electron shell with regression coverage for isolated/sandboxed renderer preferences, packaged devtools disabling, deny-by-default popup handling, and a CSP on the disconnected recovery page; desktop window/menu fallback titles now use `nKlein`.
- Added a small brand-regression guard that scans UI/CLI user-visible strings and fails if a new accidental app-brand `NKlein`/`Kanban` string slips back in outside the explicit engine/legacy allowlist.
- Hid cloud-only NKlein account/sign-in affordances in the local-only UI, filtered cloud providers out of task/setup/settings pickers, gated Featurebase/cloud feedback behind the shared runtime cloud-support flag, and removed the `Cloud` timeout-profile option when cloud providers are disabled.
- Added an `Open data dir` shortcut to Developer Tools, verified the gated dev-test sidebar tools are present in the web UI, and cleaned up stale follow-up checklist statuses so the docs match the shipped debug/developer surfaces.
- Added automatic migration from legacy `~/.nklein/kanban` runtime data into `~/.nklein/nklein`, plus browser localStorage key migration from `kanban.*` to `nklein.*`, so existing installs keep their plans, telemetry, dev runs, config, code index, and UI preferences.
- Added a task-detail `Create evidence` action backed by a typed runtime evidence bundle endpoint, capturing card prompt, base ref/commit, worktree path, transcript, bounded diff evidence, and runtime config before copying a ready-to-paste external-agent prompt.
- Added a separate protected-test runner (`npm run test:protected`) with a curated manifest and co-located rationale docs, plus write-guard blocks for protected-suite paths and config files.
- Added topic-based guidance routing for decomposition-generated cards, injecting the matching `/nklein-security`, `/nklein-ui`, or `/nklein-ts` skill command from a maintained topic map.
- Added structured protected-test edit denial payloads with `intent`, `diff`, `reason`, and `expectedEffects`, so blocked agents can ask for exact human review through the existing follow-up question channel.
- Added one-use protected-test edit approvals in the NKlein chat panel, scoped to the exact structured request and audited to local telemetry before the matching retry is allowed.
- Added a create-task prompt template menu with quick starts for bug fixes, small features, tests, security review, and decomposition.
- Added create-task context imports from local files, GitHub issues, and GitHub PR diffs, appending bounded context blocks directly into the task prompt via the local `gh` CLI for GitHub sources.
- Added a task-detail evidence drawer after evidence collection, showing the bundle path, generated evidence files, transcript paths, and copied external-agent prompt block.
- Expanded the task-detail evidence drawer into a consolidated evidence/diff viewer with tabs for summary, bounded diff evidence, and the external-agent prompt.
- Added a gated Developer Tools self-improvement flow that loads the currently running dev checkout, accepts optional notes/evidence, and seeds a protected-guarded NKlein Backlog task.
- Pinned self-improvement tasks seeded from an evidence bundle to the recorded evidence `baseCommit`, so follow-up work starts from the version that produced the evidence instead of drifting to the current branch head.
- Expanded the sidebar Project Health card into a compact diagnostics dashboard that lists every health issue for affected projects, including pending artifacts and lost-session artifact warnings.
- Added Git clone ref selection for project add, letting cloned projects check out a branch, tag, or commit in detached mode after clone.
- Added an additive command palette on `Cmd/Ctrl+K` for core board actions including new task, add project, settings, git history, backlog start, and Developer Tools.
- Added a local-model setup action to the empty project state so first-run users can open onboarding before adding their first repository.
- Reduced stale local model telemetry noise by sharing the loaded-model filter across Settings and task chat, labeling registry rows as past telemetry, adding per-row removal plus Clear stale models actions, and showing the selected loaded model's live context window in both places.
- Renamed the persistent debug toggle to a global Developer Mode setting, moved it into General settings, made saved values override debug env vars, and gated sidebar dev-test scenarios, command-palette Developer Tools, debug tools, data-dir, and reset surfaces behind that setting.
- Added the first Docker agent-sandbox boundary: a pinned sandbox image build, in-container SDK tool runner, Docker-backed NKlein default tool executors, sandboxed acceptance verification, and NKlein starts that no longer create host task worktrees.
- Added persisted Docker agent-sandbox pool settings for container count, agents per container, memory, CPU, and idle timeout, with General settings controls and runtime manager wiring for new placements.
- Added Shared and Dedicated sandbox pool presets in General settings as shortcuts over the existing numeric pool controls.
- Added Docker agent-sandbox preflight status to Settings and made NKlein task starts fail closed with the sandbox remediation message when Docker or the sandbox image is unavailable.
- Fixed Docker agent-sandbox queue draining so freed slots are reserved before async startup waits, preventing queued tasks from overfilling a container or blocking later idle teardown.
- Added a typed queued task-session state for sandbox-capacity waits, including card-visible "Queued — waiting for sandbox capacity" activity and active-task accounting.
- Applied live sandbox pool setting changes to the active manager so lowering max containers retires only idle excess containers and lets occupied excess containers finish before cleanup.
- Routed !Klein's custom NKlein workspace tools through the Docker sandbox tool-runner for sandboxed NKlein tasks, covering repo map/search, file discovery, large-file reads, and write-file tools.
- Prevented env-enabled web research from registering on sandboxed NKlein tasks, preserving the no-host-network strict isolation boundary.
- Omitted host-side decomposition tools from sandboxed NKlein sessions and adjusted strict-isolation planning prompts so agents do not call unavailable host mutation workflows.
- Added Docker-gated agent-sandbox lifecycle integration coverage and fixed the real-image issues it exposed: workspace volume permissions, first-workspace bootstrap workdir, CJS tool-runner bundling, task-owned cleanup under `--cap-drop ALL`, binary patch capture, and Docker stderr in sandbox execution errors.
- Added Docker-gated sandbox pool queue coverage for the real one-container/two-agent wait/release path.
- Required NKlein task-session service construction to pass an `AgentSandboxManager`, with only an explicit test-only unisolated mode for in-process unit harnesses.
- Captured completed sandbox task changes as binary patches into deterministic `nklein/tasks/<task>` result branches via a temporary Git index, keeping the user's checkout clean while review diff, evidence, and merge flows prefer the branch over legacy host task worktrees.
- Added discard cleanup for sandbox task result branches, threading `preserveChanges=false` through permanent task delete, Clear Trash, project removal, dev cleanup, and Replay while leaving ordinary move-to-trash cleanup on the preserving path; restoring from Trash now resumes from the preserved result branch when present.
- Routed runtime task acceptance verification through the scoped NKlein task-session service, reusing the configured sandbox pool and pause controller instead of constructing an endpoint-local Docker sandbox manager.
- Reconciled sandbox/result-branch wording across prompts, CLI help/errors, merge observations, evidence summaries, auto-review notices, project-health diagnostics, and cleanup confirmations so visible surfaces describe task workspaces and task results instead of host task worktrees.
- Reused the scoped runtime sandbox pool for acceptance auto-repair and the default `nklein task verify` path, removing the remaining ad hoc acceptance-verification `AgentSandboxManager` instances outside runtime-server ownership.
- Stopped web and CLI NKlein/default task starts from pre-creating host task worktrees before sandbox launch, while retaining the legacy host-worktree preparation path for explicitly non-NKlein task agents.
- Scoped shutdown host-worktree cleanup to explicit legacy task agents and de-duped managed/indexed workspaces by canonical path, so NKlein/default sandbox tasks are interrupted without entering saved host-patch cleanup.
- Scoped host task-workspace metadata polling to explicit legacy task agents, so active NKlein/default cards no longer publish fake missing host-workspace paths while terminal-agent worktrees still report Git status.
- Decoupled task commit/PR prompt dispatch from host task-workspace metadata, using each review card's base ref for `{{base_ref}}` so sandbox-native NKlein/default tasks can request git actions without a host worktree path.
- Stopped trashed default/NKlein sandbox cards from reconstructing synthetic `~/.nklein/worktrees/...` paths, while preserving that fallback for explicit legacy host-workspace agents.
- Kept Commit/Open PR controls visible for sandbox result-branch review tasks by recognizing captured result patches even when no host task-workspace snapshot exists.
- Updated auto-review commit/PR scheduling to use sandbox result-patch dirty/clean signals when host workspace metadata is unavailable, and neutralized its durable notices away from host-workspace wording.
- Fixed sandbox task result capture after local agent commits by diffing the staged index against the task base ref, and rewrote default Commit/Open PR prompts to stay inside the isolated workspace/result-branch flow instead of mutating host worktrees.
- Made acceptance-gate host execution explicit opt-in, so agent acceptance checks use the sandbox path instead of silently falling back to host shell execution.
- Added a no-host-execution guard test for sandboxed SDK default tools and sandbox acceptance checks.
- Reaped stale Docker agent-sandbox containers and generated workspace volumes on runtime startup, so crash leftovers are removed before new sandbox work begins.
- Persisted Docker agent-sandbox start failures on task cards, keeping the remediation visible after the failed start toast.
- Disabled stdio MCP servers under strict agent isolation, returning a warning instead of spawning local MCP subprocesses.
- Gave the NKlein context-usage bar its own full-width chat-panel row and widened the active-card mini context bar so context telemetry no longer competes with model/activity controls.
- Added subtle per-message NKlein chat timestamps with persisted collapse/expand controls and duration hover details.
- Moved board pause stop-signal files from `.nklein/kanban` to `.nklein/nklein`, while reading and clearing the legacy path during the rename transition.
- Made board pause park native NKlein tasks at the next turn checkpoint with a distinct `paused` session state, aborting the SDK before another turn and automatically continuing paused tasks when the board is resumed.
- Made board/card pause park and abort active native NKlein tasks immediately, and added a pre-dispatch pause gate so queued/restart paths cannot make additional LLM requests while paused.
- Added per-card Pause/Resume controls backed by durable `.nklein/nklein/paused-tasks.json` state, runtime API mutations, immediate board/session updates, and restart-aware NKlein pause-controller hydration.
- Made Docker-backed SDK tool executors and sandbox acceptance checks honor board/card pause before running side effects, with task stop/abort rejecting queued pause waits.
- Marked structured `run_commands` failures with the same collapsed chat failure indicator as top-level tool errors, and added next-step guidance for structured command failures.
- Added next-step guidance to Docker sandbox tool failures, including failed `bash` executions and tool-runner failures, while avoiding duplicate guidance when an error already contains it.
- Added a specsheet follow-up to ship a purpose-built in-sandbox operator for real command execution inside the Docker image.
- Added an opt-in finished-card Replay control, disabled by default in global settings, that confirms before stopping the old session, clearing the prior task workspace/session state, and starting again from the original card prompt.

- Made project registration explicit on startup, added self-source confirmation for loading !Klein as a project, and blocked implicit task-worktree project registration.
- Added durable decomposition artifact manifests, provenance on generated Planning cards, and idempotent graph application so retrying a plan does not duplicate cards or links.
- Added a decomposition auto-apply setting plus pending artifact Apply/Reject actions on source card details for manual plan review and recovery.
- Added a lost-heartbeat policy setting for NKlein sessions, defaulting to Park + actions with a recovery warning while preserving the latest transcript/activity for resume or interruption handling.
- Added a Mark interrupted recovery action for lost NKlein sessions on task details.
- Added task-detail Verify and Merge actions for acceptance-check and review cards, backed by typed runtime endpoints that run checks in task worktrees and report merge conflicts inline.
- Added durable auto-review notices on cards, so failed/no-op auto-commit and auto-PR attempts explain the recovery path instead of only surfacing transient UI feedback.
- Preserved full per-task NKlein context/timeout overrides when changing detail-panel model settings, and clarified context/timeout labels in settings surfaces.
- Added an Advisor send flow in settings that sends generated prompts to a selected local NKlein model and shows response output with sent/received timestamps.
- Added runtime-configured code intelligence embeddings with global defaults, project overrides, OpenAI-compatible local endpoint support, automatic LM Studio endpoint/model discovery, embedding-model-first sorting, and project sidebar status that shows the effective provider/model.
- Added `/models` discovery and endpoint tests for custom OpenAI-compatible providers and code-intelligence embedding endpoints, including one-click model loading in the setup/settings UI plus LM Studio and Ollama helper examples to reduce local endpoint guesswork.
- Added project health detection for accidental task-worktree projects, with sidebar inspect/remove/migrate choices and explicit plan-artifact migration back to the detected parent project.
- Added project health diagnostics for pending generated plan artifacts that have not yet been applied or rejected.
- Added project health diagnostics for lost NKlein sessions that still have pending generated artifacts needing review.
- Recorded task-scoped telemetry when turn checkpoint capture fails, keeping task start best-effort while making recovery-impacting checkpoint loss visible.
- Recorded task-scoped telemetry when generated plan artifacts cannot be auto-applied, keeping artifacts pending while making the recovery failure diagnosable.
- Recorded task-scoped recovery telemetry when NKlein session reload/rebind paths fail, so restart/resume problems surface as actionable recovery diagnostics instead of only generic start failures.
- Added sanitized plan-artifact lifecycle telemetry for create/apply/reject transitions, logging only artifact metadata and counts rather than plan prompts or contents.
- Added lost-session recovery transition telemetry for persisted-session rebound and explicit interrupted recovery actions, making those recovery choices visible in diagnostics.
- Logged workspace resolver decisions for explicit workspace ids, explicit project paths, detected parent task-worktree ownership, existing index hits, and rejected task-worktree auto-registration.
- Rebased single-card board move conflicts in the web client against the latest workspace state before retrying save, preserving simple user drag actions instead of always forcing a full refetch.
- Added a persistent inline board notice for unsafe save conflicts, so users get retry/reapply guidance after sync instead of relying on a transient toast alone.
- Preserved the last local board edit across unsafe save conflicts by syncing the latest board state first and offering an explicit restore-my-edit recovery path instead of forcing the user to redo the change.
- Added deterministic replay for single board operations during save-conflict recovery, so one-card edits and single dependency changes can be reapplied against the latest revision instead of always falling back to manual recovery.
- Hardened self-observation telemetry redaction for prompt-like metadata keys, so specs, plans, summaries, and prompt bodies are dropped before local telemetry is written.
- Kept best-effort task-worktree cleanup failures out of the main UI toaster path, so non-blocking cleanup noise stays diagnostic-only unless recovery actually depends on it.
- Routed NKlein decomposition artifacts and generated cards to the parent workspace even when the NKlein task runs inside its task worktree, with a 10-card regression matching the stalled complex dev-test failure mode.
- Preserved runtime-owned task session state during UI board saves, so stale browser snapshots cannot move a running/review/lost session backward.
- Made browser board saves session-free; the runtime now attaches current session state server-side and low-level board-only saves preserve existing sessions.
- Tightened the public workspace save contract to board-only persistence, so browser saves no longer accept task-session payloads and the runtime/session layer remains the sole owner of session summaries.
- Moved settings-side dogfood/smoke-eval controls and sidebar dev-test project tools behind debug-mode Developer Tools gating so normal settings stay focused on user-facing runtime configuration.
- Hardened dev-test cleanup with a durable !Klein marker, confirmation prompts, scoped stale patch removal, marked-project-only deletion, and partial-failure reporting.
- Enforced local-only NKlein model usage: cloud provider selections are ignored or hard-stopped, cloud providers and recommendations are hidden from the picker, routing drops cloud candidates, and cloud-blocked cards are parked with a clear local-model message.
- Added a !Klein-owned effective context ceiling for NKlein starts/restarts and proactive pre-send overflow telemetry, so oversized prompts are compacted or blocked before provider dispatch.
- Removed the 200k effective-context clamp for local NKlein models, preserving million-token advertised windows end-to-end while keeping overflow guards, native compaction, and budget bars on the same resolved window.
- Improved oversized single-prompt failures with a specific recovery message, cold-start timeout floors for models without speed samples, and a regression guard that blocks persisted cloud launch metadata during overflow restarts.
- Passed MCSR/user effective context windows through runtime routing into native NKlein starts and chat budget displays, preventing provider-advertised windows from overruling !Klein's effective guard.
- Persisted sanitized NKlein launch metadata with SDK sessions and reused it during resume/overflow recovery, preventing recoverable compaction restarts from failing with missing session config.
- Treated legacy cloud timeout profiles as local-model timeouts and clamped positive NKlein timeouts to at least 60 seconds, so slow local model sessions cannot inherit stale one-second request, stream, tool, agent, or conversation limits.
- Raised positive local NKlein timeouts from MCSR speed observations at task start, using measured wall-time-per-1k prompt tokens, prefill/decode rates, TTFT, and wall-time samples while preserving unlimited mode.
- Added an effectively unlimited timeout mode as the fix for the HTTP "body timeout error" (undici `UND_ERR_BODY_TIMEOUT`) that otherwise aborts long-running local model streams: selecting it disables !Klein's request, stream, tool, agent, and conversation timeouts so a slow local model can finish a long turn without its response body being timed out mid-stream.
- Parked NKlein tasks after repeated identical start/send failures, suppressing duplicate failure telemetry and system messages once a task is clearly stuck.
- Hardened NKlein acceptance checks to use a non-login shell with an explicit PATH fallback and a larger output buffer, avoiding shell-init hangs and false failures from large passing output.
- Tightened acceptance auto-repair prompts so failing assertions and TypeScript/compiler errors are extracted as explicit next-turn constraints before the bounded raw output.
- Centralized passcode session cookie construction and added coverage for strict `HttpOnly`/`SameSite=Strict` flags plus TLS-only `Secure` cookies while keeping the runtime bound to `127.0.0.1` by default.
- Added obvious-secret scanning to NKlein agent write approvals and direct write-file tools, blocking private keys, provider tokens, GitHub tokens, AWS access keys, and long credential assignments before files are written.
- Added an opt-in best-effort local-only egress environment for task-agent PTYs via `NKLEIN_AGENT_EGRESS_RESTRICTION=best_effort_local_only`, blackholing proxy-aware outbound traffic while preserving loopback access for local runtimes.
- Added a backend-fed NKlein context budget breakdown and segmented chat-panel bar using the effective context window, with fallback to the existing estimate when breakdown data is unavailable.
- Normalized NKlein context budget bar segment widths so they sum to the visible budget width and cannot overflow narrow panels.
- Added routing regression coverage for preferred feasible local models and candidate-specific 32k/80k context-window assignment.
- Split retained `read_files` / `read_large_file` results into the context budget bar's included-file segment instead of hiding that content inside other history.
- Applied decomposed NKlein task graphs into the Planning lane, normalized persisted boards to include Planning, and let dependency-unblocked Planning cards flow into execution.
- Seeded the !Klein decomposition prompt as an overridable NKlein workflow and resolved `/kanban-decompose` through the user instruction service instead of hardcoding the prompt into runtime starts.
- Added recursive `decompose_project.expansions`, so oversized decomposition leaves can be replaced in one validated tool call with bounded-depth splitting and dependency rewriting to terminal replacement tasks.
- Made `decompose_project` explicit when connected local model fit has not been validated yet, and kept slug-colliding decomposed task IDs disambiguated with regression coverage.
- Added clarification-question support to decomposition plans: the workflow asks for questions/assumptions, `decompose_project` rejects unresolved open questions, and `questions.md` is written and exposed with plan artifacts.
- Added lightweight clarifying-question answer chips to the NKlein chat panel, with answers sent through the existing planning chat turn and free-text composer still available.
- Added `summary.md` to decomposition plan artifacts and exposed `summaryPath`, giving the later Planning DAG review a plain-language summary to display.
- Tightened the NKlein context budget display to use effective model-window wording, retain the segmented health-colored bar, and label fallback estimates as fallback working budgets instead of available model context.
- Improved NKlein context budget breakdowns by retaining the SDK system prompt per task and estimating enabled !Klein tool-schema overhead instead of leaving tool tokens at zero.
- Enforced the project task concurrency cap across UI starts, dependency auto-starts, and backend runtime starts, while preserving the fast Codex restore path by counting only already-loaded NKlein services.
- Unified local endpoint serialization with the local-only provider policy, so custom local OpenAI-compatible endpoints are serialized by URL while distinct local endpoints can run in parallel.
- Broadened NKlein model tool-routing rules so weak local model families, including custom local OpenAI-compatible providers, receive a trimmed SDK default toolset while stronger models keep the full tool surface and NKlein's typed sequential execution default.
- Added workspace-scoped NKlein file discovery, file-size, retrieval, large-file, and batched write tools, with context-budget-aware read guidance and per-file write limits.
- Added a local-gated NKlein web research tool for current HTTPS sources on an allow-list, intended for docs, model, MCP, and changelog research without enabling arbitrary browsing.
- Added NKlein team delegation and team-progress projection so multi-agent SDK activity can be tracked and summarized inside !Klein.
- Personalized repo-map ranking around current task/chat text, explicit repo-map queries, and seed paths, so small local models see symbols relevant to the active card instead of only globally central code.
- Merged repo-map symbol matches into `search_code` alongside lexical line hits and semantic code-index chunks, giving small local models hybrid retrieval that orients around relevant symbols even when the query only matches file paths or declarations.
- Seeded overridable `!Klein` guidance skills for security, UI, and TypeScript into each workspace's NKlein skills config and enabled the SDK skills extension so small local models can load terse topic guidance on demand.
- Added compact codebase-specific examples to the seeded guidance skills so matched skill prompts include concrete !Klein patterns for small local models.
- Added task-card `Create evidence` and dev-test "Copy evidence" actions so evidence bundles can be collected and copied without opening the detail panel or dropping to the CLI.
- Made decomposition role assignment write the NKlein router-selected role settings onto created Planning cards, including route-up cases and default-model selections.
- Added structured `endpoint_busy` NKlein start responses with MCSR-derived retry estimates for same-local-endpoint contention.
- Added queued local-endpoint admission for dependency auto-starts, so same-endpoint NKlein tasks are deduplicated, paced by MCSR wait estimates, and retried when the busy local endpoint frees.
- Persisted `filesLikelyTouched` on decomposition-created cards and used it to skip overlapping task starts across UI single starts, start-all, dependency auto-starts, and CLI `task start`.
- Added `decisions.md` plan artifacts and compact shared spec/decision injection for decomposition-created cards, so dependent NKlein tasks inherit the same plan contracts.
- Added `nklein task merge` to merge reviewed/completed task worktree heads into a clean base worktree in dependency order, abort conflicts, and create a Planning integration card with conflicted paths.
- Wired `nklein task done` to auto-merge reviewed task worktrees before cleanup/dependent auto-start, preserving worktrees and creating integration cards when merges block or conflict.
- Added a workspace swarm stop signal with `nklein task swarm-stop` / `swarm-resume`; project task starts now return a typed `swarm_stopped` response while paused.
- Recorded typed self-observation telemetry when native NKlein reaches the consecutive mistake guardrail and stopped the task through the SDK callback, making repeated tool/API failure stalls diagnosable.
- Added a NKlein autonomous turn-budget guardrail that aborts over-budget task sessions, parks the card for review, and records `budget_wall` telemetry with checkpoint evidence.
- Added a !Klein repeated-tool stall watchdog for NKlein tasks, parking sessions after 5 repeated non-attention tool starts with the same input and surfacing the limit in settings.
- Bounded NKlein tool transcript inputs, outputs, and errors, including stack-noise filtering plus next-step hints for failed tools so small local models keep more usable context.
- Added a board-level Local swarm strip with running/waiting/blocked counts and a Pause/Resume control wired to typed runtime swarm-stop endpoints.
- Added Local swarm nudges for single-endpoint serialization and model-load-aware start-all ordering that prefers cards targeting an already-running local model.
- Added an inline Local swarm concurrency slider that saves `maxConcurrentTasks` from the board header.
- Added local shared-endpoint ids to NKlein session summaries and surfaced per-endpoint running utilization in the board Local swarm strip.
- Enriched running task cards with compact swarm telemetry: token counts, approximate output tok/s, elapsed time, turn count, current activity/tool, and a mini context-budget bar.
- Added Advanced policy visibility in settings for routing policy, context-budget inputs, acceptance command source, and local telemetry diagnostics paths/limits.
- Added a board-level code-intelligence chip to surface repo-map/index readiness from the existing typed runtime status endpoint.
- Added a no-LLM task Diagnostics panel backed by local self-observation JSONL telemetry and a typed runtime `getTaskDiagnostics` endpoint.
- Added a card-detail Activity surface that summarizes planning/routing, context budget, current tool activity, and acceptance state from existing session data.
- Promoted acceptance and merge into Activity pipeline steps backed by local diagnostics, and recorded task-scoped worktree merge telemetry for merged, skipped, blocked, and conflicted merge outcomes.
- Stamped decomposition-created cards with backend model-fit evidence from the NKlein routing guard and surfaced that evidence as a Planning DAG fit badge.
- Expanded the Planning DAG review panel to show the full connected dependency component around the selected card, including indirect linked plan cards.
- Added revised-plan flags to the Planning DAG panel for integration, decision, contradiction, split, and decomposition-blocked adaptation cards.
- Added an explicit Planning DAG approval action that marks plan-mode Planning cards execution-ready without clearing revision metadata.
- Added `revisions.md` plan artifacts and exposed `revisionsPath` through decomposition tool, CLI, and dogfood API outputs for future adaptive re-planning audit trails.
- Added `nklein task plan-gap` and a typed `plan_gap` self-observation signal so execution agents can report missing decisions, contradictions, dependencies, oversized scope, or unplanned integration work.
- Let `nklein task plan-gap --kind integration_needed` create a Planning integration card with evidence while returning the created card in the command response.
- Broadened acceptance failure plan-gap classification with domain patterns for unresolved decisions, contradictions, missing packages/files/commands/config/schema, and scope/resource exhaustion.
- Recorded a concrete `integration_card_added` plan revision when automatic integration-card adaptation runs with `--plan-slug`.
- Added bounded plan-gap adaptation cards for scope and decision gaps: oversized cards are blocked for decomposition, decision/contradiction gaps pause into Planning, and repeated adaptations reuse the existing Planning card.
- Recorded concrete `decision_card_added` and `scope_split_card_added` revisions when adaptive plan-gap cards are created for a known decomposition plan.
- Added `nklein task expand-plan-task` to apply approved recursive replacement tasks to saved plan DAGs, re-link dependencies through entry/terminal replacements, and append `recursive_task_replaced` revisions.
- Fixed NKlein team-progress summaries so `task_end` events with string-shaped errors are reported as failures instead of completions.
- Named and documented NKlein context-budget policy constants for reserve caps, unknown-window fallbacks, pressure curves, and file chunk sizing without changing budget behavior.
- Documented the NKlein repo-map heuristic and refreshed cached repo maps after successful workspace-mutating tools, so code-orientation context no longer stays stale after edits.
- Upgraded NKlein repo maps with TypeScript AST symbol extraction, PageRank-style reference/import ranking, stable prompt-prefix ordering, and tests for refreshed, first-position repo-map rails.
- Debounced NKlein model-registry persistence so observations update the in-memory MCSR immediately while locked disk writes are coalesced, with fractional EWMA speed stats preserved across reloads.
- Switched NKlein model-registry event extraction to the SDK session-event types, recording observations from typed usage events plus !Klein-measured request duration instead of guessed `run-finished` payloads.
- Recorded explicit local NKlein launch context windows into the model registry immediately and added advertised/observed/user-override context-window precedence for MCSR entries.
- Added first-run NKlein onboarding controls for setting a local model context-window override and seeding model roles with the selected reasoning effort.
- Hardened `nklein dev smoke-eval` to score only local NKlein providers and include the selected local model plus guard, overflow, and timeout telemetry counts in the evidence bundle.
- Added a local dev smoke fixture, NKlein eval harness, and evidence bundle writer so local-model runs can capture prompts, telemetry, diffs, and score artifacts for regression review.
- Let `nklein task plan-gap --plan-slug <slug>` append concrete gap entries to a plan's `revisions.md` audit trail while still recording the structured self-observation signal.
- Recorded automatic `plan_gap` telemetry when acceptance verification finds a missing acceptance contract or exhausts repair/escalation attempts.
- Added an expandable NKlein model telemetry panel backed by the MCSR, showing local-only model endpoint, context-window, throughput, latency, capability, samples, and missing-window prompts.
- Included configured local NKlein provider/model selections and model-role roster entries in MCSR responses even before they have telemetry samples.
- Improved fallback NKlein model labels on task cards so raw provider-qualified GPT/Claude IDs render as readable model names when the provider catalog is not loaded.
- Replaced cloud NKlein examples in task CLI help with local-model examples and added a production-source boundary scan for cloud-provider literals.
- Added a NKlein code-intelligence status panel in settings, exposing repo-map availability and code-index cache coverage, staleness, embedding metadata, cache path, and search readiness.
- Made MCSR capability scores age-aware by decaying old eval/pass-rate evidence toward the static prior instead of letting stale observations dominate forever.
- Improved startup onboarding for local NKlein setup: it reopens when NKlein lacks a configured local model, shows detected Ollama/LM Studio endpoints and loaded models, and seeds architect/worker/reviewer roles from the selected local model on first save.
- Let `nklein task plan-gap` infer the owning decomposition plan from decomposition-created task IDs, so inferred integration-card adaptations append to `revisions.md` without requiring `--plan-slug`.
- Classified exhausted acceptance failures that clearly indicate missing dependencies, contradictory requirements, or oversized scope as structured `plan_gap` events instead of always recording a generic review gap.
- Added a guided first-run local endpoint start panel with Ollama and LM Studio download links plus install, server-start, model-load, and verification commands.
- Added a NKlein autonomous wall-time guardrail that aborts over-budget task sessions, parks the card for review, and records `budget_wall` telemetry with checkpoint evidence.
- Added a repeated no-diff checkpoint watchdog for NKlein tasks, parking sessions that keep checkpointing the same commit without producing new diff progress.
- Added ownership-aware task worktree sync and !Klein-created repository markers, preserving agent edits on overlapping paths and safely cleaning repository metadata only for repos !Klein owns.
- Hardened project removal/re-add flows so task worktrees and saved task patches are cleaned up consistently and stale task content cannot be restored accidentally.
- Added a Planning card DAG review panel in task detail, showing linked prerequisite/dependent cards with status, complexity, likely files, and model/agent hints.
- Added a Local swarm guardrails section to settings, surfacing the current concurrency cap plus enforced NKlein turn, wall-time, no-diff, and mistake guardrails.
- Added local-only per-model NKlein context-window overrides, with a typed runtime save/clear API plus controls in both the Model Telemetry panel and NKlein settings.
- Added live code-index progress reporting for local code search, surfacing scan/embed/cache-write phases plus file/chunk and cache hit/miss counters in NKlein settings.
- Enriched the card Activity surface with explicit card-selected/runtime-selected routing details and a separate retrieval/indexing step for file and code-search tools.
- Recorded initial `recursive_split` plan revisions when `decompose_project.expansions` rewrites oversized tasks before saving the plan graph.
- Added a shared 12-card swarm batch budget for start-all and dependent auto-start launches, surfaced alongside the other Local swarm guardrails in settings.

## [Cline Kanban 0.1.68]

- Codex hooks are now pre-trusted, eliminating permission prompts when !Klein manages Codex sessions
- Fixed signal handling to properly re-raise signals and ignore SIGQUIT for cleaner process cleanup
- Updated NKlein SDK from 0.0.36 to 0.0.38, which includes: new OpenAI ChatGPT Subscription and v0 providers, Ollama no longer requires an API key, file-based and event-driven automation, auto-compaction for provider requests, per-turn usage metrics on assistant messages, normalized provider usage costs, web fetch enabled by default in act mode, various message handling and abort fixes

## [Cline Kanban 0.1.67]

- "New version available" notification with one-click update from the web UI
- Renamed the "Trash" column to "Done" and added CLI command aliases
- Allow entering a custom model ID when no matching models are found in the model selector
- Use Codex hooks for task state transitions
- Fixed stale worktree setup locks not being cleaned up on shutdown
- Fixed task ID generation to avoid timestamp-derived fallback IDs
- Added scaffolding for an Electron desktop app (not yet available)

## [Cline Kanban 0.1.66]

- Added a refresh button for LiteLLM and custom provider model lists, so you can re-fetch available models without leaving settings
- Enforced origin and host validation on the !Klein websocket service to prevent unauthorized connections

## [Cline Kanban 0.1.65]

- Model catalog now auto-refreshes on startup so newly available models appear immediately
- Fixed task cards resizing and causing layout shifts on the board
- Fixed initial NKlein message not being sent after starting a new session
- Added runtime child process manager for the desktop app

## [Cline Kanban 0.1.64]

- Multi-line diff comments: Shift+click to select a range of lines, click the line number to open the comment box, and comments now include file path, line number, and column context
- File tree panel in diff views can now be toggled open or closed
- Task title editing now requires clicking the pencil icon that appears on card hover, preventing accidental edits when clicking the card

## [Cline Kanban 0.1.63]

- Fixed task detail view being lost on page refresh
- Fixed API key getting reset when modifying NKlein agent settings
- Fixed !Klein agent starting in thinking state instead of idle

## [Cline Kanban 0.1.62]

- Fixed NKlein chats on the home screen not resuming correctly from persisted history, causing conversation context to be lost
- Fixed NKlein thinking indicator hiding prematurely during active requests
- Reasoning blocks now animate their collapse after finishing streaming
- Fixed model selector not scrolling to the selected model when opened, and improved visual clarity of the selected model and reasoning effort states

## [Cline Kanban 0.1.61]

- Added device code authorization for signing into NKlein on remote systems
- Revamped theme system with new theme picker and improved color palettes
- Fixed duplicate MCP tool registration when using SDK 0.0.34
- Fixed MCP settings not showing up during NKlein setup

## [Cline Kanban 0.1.60]

- Choose a different agent per task, or change the model and provider for NKlein tasks, when creating tasks from the board
- Adds remote file browser for adding projects when running !Klein on a remote server, with git clone support for adding projects by repository URL
- HTTPS and passcode authentication support for secure remote access
- Adds Kiro CLI agent support
- Pick from 10 new color themes to personalize your board
- NKlein account organization switching and credit balance display in settings
- Set and edit task titles
- Incremental expand in the diff viewer -- click to show 20 more lines in collapsed context blocks
- Mobile-responsive layout for the web UI, including adaptive navigation, task detail views, and chat panels
- Friendly labels for task commands (like file edits and shell commands) in the sidebar chat
- NKlein credit usage notifications with a link to manage your plan
- Fixed startup onboarding reappearing after being dismissed
- Fixed browser back button not returning from task detail view to the board
- Fixed chat state not reinitializing properly when resuming a trashed task
- Fixed `/clear` not fully resetting chat for restored sessions
- Fixed diff mode toggle not reflecting its active state
- Fixed detached notification process orphans on shutdown
- Disabled unnecessary startup update checks for Codex agent
- Faster trash restore for Codex tasks by skipping unnecessary session probes
- Redesigned settings dialog with sidebar navigation, scroll-spy highlighting, and card-style sections
- Updated NKlein SDK from 0.0.28 to 0.0.33, which includes: checkpoint support (configurable, disabled by default), correct model list for NKlein provider via OpenRouter, compaction at 95%, steer messages fix, and team agent identity in event payloads

## [Cline Kanban 0.1.59]

- Added a beta hint card to the project sidebar with quick access to send feedback or report issues
- Added "Read the docs" button in the settings dialog linking to documentation
- Adjusted prompting for the commit button to better handle stale git lock files and multiple stashes at once

## [Cline Kanban 0.1.58]

- More panels are now resizable (agent chat, git history, and more) and your layout preferences persist across sessions
- Adds full Factory Droid CLI agent support
- Add, edit, and delete custom OpenAI Compatible providers from the settings dialog
- Fixed trashed task cards being openable from the board
- Fixed git history cache not clearing when closing the view
- Terminal cursor defaults now match VS Code behavior
- Feedback widget no longer triggers authentication until you actually click it
- Updated NKlein SDK from 0.0.24 to 0.0.28, which includes: OpenAI-compatible provider support via AI SDK, custom provider CRUD in core, better handling of overloaded and insufficient-credits errors, fixed tool schema format for OpenAI-compatible providers, accurate input token reporting

## [Cline Kanban 0.1.57]

- Added `nklein --update` command so you can check for and install updates manually
- Fixed Windows agents (like Codex) being incorrectly launched through cmd.exe when they're native executables
- Reduced latency when switching between projects
- Restored the feedback widget with proper JWT authentication
- Fixed telemetry service configuration for NKlein agents
- Updated NKlein SDK from 0.0.23 to 0.0.24, which includes reasoning details support and improved JSON Schema handling for tool definitions

## [Cline Kanban 0.1.56]

- Automatic context overflow recovery: when the conversation history exceeds the model's context window, !Klein now compacts old messages and retries instead of failing
- Credit limit errors (insufficient balance / 402) are now surfaced immediately without unnecessary retries or confusing system messages
- Added report issue and feature request links to the settings dialog
- Added NKlein icon to browser notifications
- Updated NKlein SDK from 0.0.22 to 0.0.23, which includes: LiteLLM private model support, provider-specific setting configs, loop detection as a built-in agent policy, provider ID normalization for model resolution, OAuth token refresh fix for spawned agents

## [Cline Kanban 0.1.55]

- Fixed non-ASCII file paths (e.g. Japanese, Chinese, Korean characters) rendering as garbled octal escape sequences in the diff view

## [Cline Kanban 0.1.54]

- Task agent chat panel resizing now persists when navigating between tasks

## [Cline Kanban 0.1.53]

- Added `/clear` slash command to reset the NKlein agent chat session
- Added hints for environment variables in NKlein provider setup
- Aligned NKlein provider and model fallbacks with SDK defaults for more reliable configuration
- Fixed Codex plan mode not working
- Fixed slash command file watchers to reuse a single watcher per workspace instead of creating duplicates
- Show loading skeleton in onboarding carousel while videos load
- Added VS Code Insiders as a file open target

## [Cline Kanban 0.1.52]

- Added support for custom OpenAI-compatible providers, so you can connect any OpenAI-compatible API as a NKlein model provider
- Added PWA support -- the web UI can now be installed as a standalone desktop app from Chrome, with window controls overlay and an offline fallback page that auto-reconnects when the server comes back
- Sticky file headers in the diff viewer now pin under the toolbar while scrolling through large diffs
- Show a cleanup spinner during Ctrl+C shutdown instead of silently hanging
- Fixed Codex status monitoring to reliably track the latest tool call
- Fixed terminal color detection for TUI apps like Codex CLI that query both foreground and background colors at startup
- Fixed activity preview text getting truncated in hooks
- Fixed project column sizing not persisting across sessions
- Fixed home sidebar session IDs not matching the current format

## [Cline Kanban 0.1.51]

- Task terminals now support multiple simultaneous viewers, so opening the same task in several browser tabs no longer causes disconnections
- Terminal TUI state is now preserved across reconnects, so you no longer lose your terminal view when the connection drops and re-establishes
- Fixed Codex CLI content disappearing or rendering incorrectly -- PTY sessions are now fully server-side, so you can refresh the page, switch between tasks, and unmount terminals without losing any output
- Fixed home sidebar terminal sessions not reconnecting after navigation
- Switched to esbuild for faster builds
- Claude agent hyperlinks now render correctly in !Klein terminals
- Fixed screen flickering and unnecessary polling when viewing trashed tasks
- Fixed restoring tasks from trash using the wrong agent
- Fixed stale git worktree registrations that could cause worktree operations to fail

## [Cline Kanban 0.1.50]

- Updated NKlein SDK from 0.0.21 to 0.0.22, which includes: fixed hook worker process launching to use a more robust internal launch mechanism

## [Cline Kanban 0.1.49]

- Updated NKlein SDK from 0.0.16 to 0.0.21, which includes: organization fetching support, SDK declaration maps for better type resolution, OpenAI Compatible provider migration and cleanup of the legacy provider, agent telemetry events with agent ID and metadata, bash tool and home directory fixes on Windows, and exposed LoggerTelemetryAdapter in the node package

## [Cline Kanban 0.1.48]

- Fixed sidebar agent attempting to edit files and write code instead of staying focused on !Klein board management

## [Cline Kanban 0.1.47]

- Fixed browser open failing on Linux systems where `xdg-open` is not available

## [Cline Kanban 0.1.46]

- Added reasoning level dropdown to NKlein provider settings and the model selector in the chat composer
- Images can now be attached when creating tasks for Claude Code and Codec CLI agents -- images are saved as temporary files and their paths are passed into the prompt since TUIs don't support inline images
- Added shortcuts for diff view actions and a "Start and Open" shortcut as an alternative to starting a task (shout out to Shey for the idea!)
- Fixed issues with the sidebar NKlein chat session not reloading after adding MCP servers
- The project column can now be collapsed all the way to the edge for a minimal view (shout out to Shey for this idea!)
- Fixed issues with some Next.js project configurations in worktrees
- Fixed diff viewer showing false changes for end-of-file-only differences
- Fixed a crash in older browsers when generating UUIDs for board state
- Fixed a crash on Windows when resizing the terminal after the PTY process has exited

## [Cline Kanban 0.1.45]

- Fixed kanban access validation to only apply restrictions to enterprise customers, so non-enterprise users are no longer incorrectly blocked

## [Cline Kanban 0.1.44]

- Fixed remote configuration not being applied correctly

## [Cline Kanban 0.1.43]

- !Klein access can now be gated via NKlein remote config
- Fixed "C" (create task) keyboard shortcut crashing when no projects exist
- Fixed macOS directory picker treating cancel as an error instead of a normal cancellation
- Improved agent selection copy during onboarding
- File paths in the settings dialog now display with `~` instead of the full home directory
- Fixed incorrect "kanban" branding in the disconnected screen (now says "NKlein")
- Fixed cancel button showing wrong label in detail view panels
- Temporarily disabled Featurebase feedback widget

## [Cline Kanban 0.1.42]

- Fixed auto-update failing on Windows by using the correct `.cmd` extensions for package manager commands (npm, pnpm, yarn)

## [Cline Kanban 0.1.41]

- NKlein agent sessions now automatically recover after a runtime teardown, so work isn't lost if the runtime restarts
- Per-task plan/act mode now persists when switching between tasks
- Chat messages sent while the agent is actively working are now queued and delivered when the turn completes, instead of being dropped
- Fixed repeated MCP OAuth callbacks causing errors when the browser fires the redirect more than once
- Fixed corrupt patch captures when trashing tasks in worktrees
- Session IDs are now sanitized for Windows-safe file paths
- Agent mistake tolerance increased from 3 to 6 consecutive errors, giving the agent more room to recover from transient failures
- Fixed the navbar agent setup hint showing incorrect state
- Use the `open` package for cross-platform URL opening instead of custom logic
- Updated NKlein SDK to 0.0.15 with file-based store fallbacks, remote config support, improved chat failure handling with message state rollback, and a new `maxConsecutiveMistakes` option to prevent agents from getting stuck in failure loops

## [Cline Kanban 0.1.40]

- Sidebar agent now stays focused on board management and redirects coding requests to task creation, so dedicated agents handle implementation work in their own worktrees
- Fixed feedback widget initialization for NKlein-authenticated users

## [Cline Kanban 0.1.39]

- Fixed the feedback widget not opening reliably when clicking "Share Feedback"
- Capitalized button labels for consistency ("Add Project", "Share Feedback")

## [Cline Kanban 0.1.38]

- First-run onboarding for script shortcuts -- new users are guided through creating their first shortcut directly from the top bar
- Settings file URLs can now be opened
- Fixed terminal bottom pane content clearing when running script shortcuts

## [Cline Kanban 0.1.37]

- Slash commands and file mentions in the client chat input field
- Share Feedback button in the bottom left, powered by Featurebase and enriched with NKlein account data like email so we can see who reports are coming from, with a Linear integration for automatic issue creation
- MCP OAuth callbacks consolidated onto the main runtime server with real-time auth status updates
- Linear MCP shortcut for one-click install setup
- Updated startup onboarding carousel with a screen about using camera and the agent to add tasks
- Conversation history always visible in detailed task view
- Fixed an issue where adding MCPs wouldn't be available in existing NKlein chats -- adding MCPs now resets NKlein chats to use them
- Fixed an issue where the client chat would get into a "task chat session is not running" error state. You can now send a message to continue the conversation when NKlein fails a tool call
- Fixed an issue where binary diffs would not show up in diff views
- Diff renderer groups removals before additions for easier reading
- Fixed default model selection when OAuth login leaves it blank
- Updated NKlein SDK with fixes for ask question tool being disabled in yolo mode, cost calculation, and tool description and truncation logic improvements

## [Cline Kanban 0.1.36]

- Added Sentry error reporting to help identify and fix crashes faster
- Fixed terminal sessions sometimes failing to reconnect, which caused the terminal emulator to scroll to the top during card transitions before scrolling back down
- Fixed onboarding to default to NKlein as the AI provider and automatically set the provider's default model, preventing errors when switching providers without updating the model
- Fixed Ctrl+C to wait for NKlein to finish shutting down before fully exiting, preventing false double-interrupt exits
- Upgraded NKlein SDK from 0.0.7 to 0.0.11 with numerous fixes and improvements:
  - Fixed prompt caching being broken for Anthropic models, meaning users were paying full price every turn. Cost calculation was also fixed (it was double-counting cache reads and ignoring cache writes)
  - Fixed cancelling a request causing all subsequent requests in the session to immediately fail, due to a reused AbortController
  - Fixed Gemini tool use failing for most non-trivial tool schemas. JSON Schema properties not in Gemini's allowed set (like `default`, `pattern`, `minLength`) caused Gemini to reject entire requests
  - Fixed tools with no required parameters (like "list all") being silently dropped
  - Fixed CLI hanging indefinitely in CI/Docker environments when stdin was detected as "not a TTY" but wasn't providing input
  - Fixed Vercel AI Gateway being completely broken (base URL was `.app` instead of `.sh`, so all requests 404'd)
  - Fixed internal metadata fields leaking into API requests sent to providers, wasting tokens
  - Fixed multi-agent team tools failing when the orchestrator sent null for optional filter parameters. Also added concurrent run prevention and better error visibility for teammate failures
  - Fixed MCP tool names with special characters or exceeding 128 chars causing provider schema validation errors (now sanitized with a hash suffix)
  - Fixed OpenRouter and other gateway error messages showing opaque nested JSON blobs instead of the actual error
  - Fixed `--json` mode output being impure (plain text warnings leaked into stdout, breaking JSONL parsing)
  - Fixed SQLite crashing with a disk I/O error on first run instead of auto-creating the data directory
  - Fixed "Sonic boom is not ready yet" error on CLI exit
  - Removed hardcoded 8,192 max output tokens per turn cap, so models are no longer artificially limited
  - Added OpenAI-compatible prompt caching support
  - Added OpenAI-compatible providers now surface truncated responses (`finish_reason: "length"`) so callers can detect them
  - Headless mode no longer requires a persisted API key -- env vars like `ANTHROPIC_API_KEY` now work
  - Headless mode output cleaned up: model info, welcome line, and summary gated behind `--verbose`
  - Config directory is now overridable via `--config` flag or `NKLEIN_DIR` env var for isolated config across multiple SDK instances
  - `readFile` executor now supports optional `start_line`/`end_line` parameters, enabling models to read specific portions of large files

## [Cline Kanban 0.1.35]

- Added runtime debug tools accessible from the top bar for troubleshooting configuration and agent state
- Settings now automatically retry loading when the initial attempt fails, improving reliability on slower connections

## [Cline Kanban 0.1.34]

- Model pickers now show recommended NKlein models for quick selection
- Failed tasks show a red error icon and failure reason on the board card instead of a spinner
- When adding a project on a headless/remote runtime where no directory picker is available, you can now enter the project path manually
- Fixed workspace not refreshing correctly on startup by waiting for the runtime snapshot before syncing
- Fixed !Klein agent creating tasks for worktree paths instead of the main project

## [Cline Kanban 0.1.33]

- Fixed task worktree setup for Turbopack projects no longer attempting slow background copies of node_modules; affected subproject dependencies are now correctly skipped instead of symlinked

## [Cline Kanban 0.1.32]

- Fix concurrent task mutations (e.g. adding multiple tasks at the same time) failing due to write conflicts -- task mutations now use a workspace lock to safely handle simultaneous operations
- Fix a bug where stopping a task that was restored from a previous session would fail because the session wasn't properly reconnected on startup
- Fix a bug where restarting the app would show raw metadata in user messages for old NKlein sessions that were reloaded
- Fix worktrees for projects using Turbopack, where symlinked node_modules would cause build failures -- worktrees now fall back to copying node_modules for Turbopack projects
- Fix SDK command parsing that could cause agent system prompts to be malformed
- Fix Cmd+V image paste in the chat composer not working due to the paste handler running asynchronously, causing the browser to swallow the event
- Fix proper-lockfile crashing due to accidentally passing undefined as the onCompromised handler
- Require confirmation before git init when adding projects
- Fix task card agent preview flickering to empty state
- Cancel inline task edit on Escape key press
- Move task worktrees to ~/.nklein/worktrees
- Update onboarding intro video and frame width
- Change the start-all-tasks shortcut to Cmd+B

## [Cline Kanban 0.1.31]

- Add ability to resume NKlein tasks that were trashed
- Support image attachments for NKlein agent chat
- Fix the commit and make PR button in the NKlein agent chat panel
- Fix issue where creating multiple tasks at the same time with git submodules would run into a git config locking issue
- Fix script shortcuts to interrupt previously long-running commands, so you no longer need to Ctrl+C before hitting the shortcut again
- Fix issue where running incorrect kanban commands would auto-open the browser
- Preserve runnable kanban command in sidebar prompt
- Avoid premature Codex review state transitions
- Fix diff "Add" button incorrectly sending NKlein chat messages
- Various UX improvements (checkbox labels, NKlein thinking shimmer animation)

## [Cline Kanban 0.1.30]

- Add MCP server management and OAuth authentication for NKlein providers
- Add "Start All Tasks" keyboard shortcut (Alt + Shift + S)
- Show assistant response previews in task card activity instead of generic "Agent active" text
- Track full chat history per task, enabling richer conversation display and reliable message streaming
- Display API key expiry as a human-readable date instead of a raw number
- Support launching !Klein without a selected project (global-only mode)
- Automatically restart agent terminals when the underlying process exits unexpectedly
- Fix prewarm cleanup accidentally disposing the detail panel terminal for active tasks
- Fix task card expand animation jumping by waiting for measured height before animating
- Fix NKlein thinking indicator flicker in the chat panel

## [Cline Kanban 0.1.29]

- Fix onboarding and settings screens not working when no projects exist
- Update NKlein SDK with auth migration for existing CLI users and fixes for OpenAI-compatible APIs

## [Cline Kanban 0.1.28]

- Onboarding dialog for first-time users with guided walkthroughs for auto-commit, linking, and diff comments
- Dependency links now show arrowheads so you can see direction at a glance, and the agent provides guidance about link direction when creating them
- NKlein chat input field now includes a model selector, plan/act mode toggle, and a cancel button to stop generations midstream
- Resizable project sidebar (drag to resize, persists across sessions)
- Show the full command in expanded run_commands tool calls
- Review actions (Commit, Open PR) only appear when there are actual file changes
- NKlein chat preserves your scroll position when reading older messages
- Failed tool calls display proper error messages instead of deadlocking the session
- "Thinking" indicator shows while tool calls are loading
- ANSI escape codes from CLI output are stripped instead of showing raw characters
- Inline code in NKlein chat wraps correctly instead of overflowing
- Tasks with uncompleted dependencies can no longer be started
- Better error reporting when NKlein fails to start (clear messages instead of silent hangs)
- Gracefully handles missing provider settings instead of crashing
- Removed OpenAI, Gemini, and Droid agents to reduce surface area at launch (coming back in follow-up releases)

## [Cline Kanban 0.1.27]

- Upgraded NKlein SDK to stable v0.0.4, replacing nightly builds for more reliable native NKlein sessions

## [Cline Kanban 0.1.26]

- Trashing a task now saves a git patch of any uncommitted work, and restoring it from trash automatically reapplies those changes so nothing gets lost
- "Create more" toggle in the new task dialog lets you create multiple tasks in a row without reopening the dialog each time
- New keyboard shortcuts: Cmd/Ctrl+G toggles the git history view, Cmd/Ctrl+Shift+S opens settings, and Esc closes git history from the home screen
- Shortcut commands now safely interrupt any running terminal process before executing, so commands no longer get jumbled with whatever was previously running
- Agent file-read activity now shows the full list of files being accessed instead of truncating with "(+N more)"
- Expanding the diff view now automatically closes the terminal panel to avoid overlapping views
- Task worktree cleanup no longer gets stuck when patch capture fails
- Fixed the "Thinking..." indicator incorrectly appearing while the agent is actively streaming a response
- Native NKlein sessions now correctly capture their latest changes when entering review
- Removed the redundant "Projects" label below the sidebar segment tabs
- Consistent spacing and alignment across all alert dialogs
- Fixed terminal background color in the detail view to match the rest of the overlay

## [Cline Kanban 0.1.25]

- Added a chat view to the home sidebar for project-scoped agent conversations. What used to be the project column is now a sidebar that can switch between projects and chat.
- The agent can now trash and delete tasks on your behalf using new task management commands
- When no CLI agent is detected, a guided setup flow walks you through getting started
- Replaced the !Klein skill system with `--append-system-prompt` -- since the board now has a dedicated agent, we just append context to its prompt instead of maintaining a separate skill
- Native NKlein SDK chat runtime with cancelable turns
- `--host` flag to bind the server to a custom IP address
- Submodules are now initialized automatically in new task worktrees
- Fix Escape key unexpectedly closing the detail view
- Increased shortcut label and footer font sizes
- Capped agent preview lines in task cards

## [Cline Kanban 0.1.24]

- Fixed multiline prompt arguments being broken on Windows cmd.exe

## [Cline Kanban 0.1.23]

- Fix Windows terminal launches incorrectly escaping arguments with spaces, parentheses, and other special characters

## [Cline Kanban 0.1.22]

- Fix Windows terminal launch failing for bare executables (e.g. `nklein`) due to unnecessary quoting

## [Cline Kanban 0.1.21]

- Fix Windows agent commands failing to launch
- Fix update detection for Windows npm-cache npx transient installs
- Reduce false-positive triggering of the kanban skill
- Show worktree errors in toasts

## [Cline Kanban 0.1.20]

- Fix branch picker showing remote tracking refs instead of just local branches, and enable trackpad scrolling in the picker
- Fix task card activity not updating when Opencode completes hook actions
- Fix NKlein tasks getting stuck instead of returning to in-progress when asking follow-up questions during review

## [Cline Kanban 0.1.19]

- Fixed a race condition where navigating to a task's detail view could trigger an unintended auto-start
- Fixed shutdown cleanup to reliably stop all running tasks across projects

## [Cline Kanban 0.1.18]

- Fix layout stability when moving cards between columns programmatically
- Improve checkbox contrast on dialog footers
- Reduce dialog header/footer side padding to match vertical padding
- Fix description briefly flashing on card mount

## [Cline Kanban 0.1.17]

- Fix keyboard shortcuts (Cmd+Enter) not working when focus is on dialog inputs

## [Cline Kanban 0.1.16]

- Fixed agent startup reliability and command detection
- Fixed path handling on Windows and Linux for cross-platform support

## [Cline Kanban 0.1.15]

- Fix diff view syntax highlighting colors in git history
- Improve graceful shutdown handling for CLI processes
- Fix worktree symlink mirroring for ignored paths to avoid blocking operations
- Fix process cleanup on Windows when tasks time out
- Support Windows AppData path discovery for Opencode integration
- Make "Open in Editor" workspace actions work correctly across platforms
- Add directory picker support on Windows
- Fix transcript path detection in hooks
- Handle Linux directory picker fallbacks and errors gracefully

## [Cline Kanban 0.1.14]

- Fixed a crash on Linux systems where no browser opener (xdg-open, etc.) was available

## [Cline Kanban 0.1.13]

- New task creation dialog with list detection for quickly creating multiple tasks at once
- Git history now shows remote refs and branch divergence so you know if you need to pull
- Expandable task card descriptions -- click to reveal the full description inline
- Notifications now show the latest agent message
- Improved split diff rendering by consolidating same hunk changes
- Fixed issue where cards in the kanban column updating content would cause scroll jumps

## [Cline Kanban 0.1.12]

- Redesigned the web UI with a refined dark theme, custom UI primitives, and polished controls for a more professional look and feel
- Added split diff view so you can click the expand button above any diff to see changes side by side
- Added last turn changes, which takes a Git snapshot each time you send a message to your agent so you can see exactly what changed since your last message
- Added an all changes view to see every modification in a task's worktree at a glance
- Resizable agent terminal emulator so you can drag to make it bigger or smaller
- Inline task creation controls with keyboard shortcut hints
- Fix diff panel persisting stale content when switching views
- Fix last-turn diff transitions flickering during scope changes
- Only keep terminal connections alive for tasks actively on the board, and clean them up when the runtime disconnects
- Fix WebSocket proxy so terminal connections work correctly during local development
- Fix the dogfood launcher not waiting for the child process to exit, which could leave orphaned processes on shutdown

## [Cline Kanban 0.1.11]

- Add !Klein skill for creating and managing tasks directly from your agent
- Remove !Klein MCP server in favor of skill-based task automation

## [Cline Kanban 0.1.10]

- Add "Start task" button to create task card -- press `c` to create, type your task, then Cmd+Shift+Enter to start it right away
- Add "Cancel auto-review" actions to task cards
- Add "Start All" button to backlog column header to start all backlog tasks at once
- Add Cmd+Enter shortcut for sending diff comments
- Show keyboard shortcut hints on the create task button
- Simplified shortcut icon picker
- Show authentication warning callout in Linear MCP setup dialog
- Show loading state on trash button while deleting
- Resume paused droid tasks when read/grep hooks fire
- Fix stale diff persisting when switching between task details
- Fix stale script shortcuts lingering after switching projects
- Fix git history flicker during scope switches
- Fix terminal rendering for Droid CLI in split terminals
- Fix linked task start animations
- Detect when GitHub/Linear/!Klein MCPs are already installed to skip unnecessary setup dialogs
- Fix resuming trashed tasks after terminal refactors
- Fix Droid CLI review state transitions around AskUser tool calls
- Default new users to NKlein CLI when installed
- Highlight active branch button in blue
- Fix settings dialog appearing disabled during config refresh
- Center selected detail card in sidebar

## [Cline Kanban 0.1.9]

- Fix worktree paths with symlinks in ignored directories being incorrectly treated as active

## [Cline Kanban 0.1.8]

- Terminal now properly renders full-screen TUI applications like OpenCode
- Fixed terminal content disappearing and scroll back being lost when opening a task. Terminals are now created proactively for each agent instead of connecting mid-session, which preserves full scroll back and content rendering. This is especially important for rendering TUI apps like Codex and Droid correctly.
- Improved terminal rendering quality, inspired by VS Code's xterm and node-pty implementation. Noticeably higher FPS, smoother scrolling, and a more native look and feel for terminal emulators.

## [Cline Kanban 0.1.7]

- When a task prompt mentions creating tasks (e.g. "break down into tasks", "create 3 tickets", "split into cards"), !Klein now shows a setup dialog offering to install the !Klein MCP before the task starts
- Similar setup dialogs appear for Linear and GitHub CLI when task prompts reference those services
- MCP server instructions now guide agents to detect the ephemeral worktree path and pass the main worktree as projectPath, so "add tasks in kanban" tasks correctly create tasks in the main workspace instead of the ephemeral task worktree

## [Cline Kanban 0.1.6]

- Show live hook activity (tool calls, file edits, command runs) on task cards as agents work
- Auto-confirm Codex workspace trust prompts so tasks start without manual intervention
- Show working copy changes in the detail panel's git history
- Fix terminal pane state bleeding across tasks when switching between them
- Fix duplicate paste events in agent terminals
- Stop detail terminals when trashing tasks to free resources
- Automatically pick up new versions when launching with `npx nklein`
- Fix git metadata not updating reliably when switching projects
- Stabilize workspace metadata stream startup

## [Cline Kanban 0.1.5]

- Added Droid CLI agent support alongside Claude and Codex
- Dogfood launcher for quickly opening !Klein on its own repo with runtime port selection
- Terminal rebuilt around xterm and node-pty for better performance and reliability
- Filter terminal device attribute auto-responses from being sent to agents as input
- Fix workspace metadata causing unnecessary rerenders, with retry recovery
- Fix task worktrees being recreated when the base ref updates if they already exist
- Fix self-ignored directories being symlinked in task worktrees
- Fix bypass permissions toggle resetting unexpectedly
- Fix git refs not clearing when switching detail scope

## [Cline Kanban 0.1.4]

- Each task gets its own CLI agent working in a git worktree, so they can work in parallel on the same codebase without stepping on each other
- When an agent finishes, review diffs and leave comments before deciding what to merge
- Commit or open a PR directly from the board, and the agent writes the commit message or PR description for you
- Link tasks together to create dependency chains, where one task finishing kicks off the next, letting you complete large projects end to end
- "Automatically commit" and "automatically open PR" toggles give agents more autonomy to complete work on their own
- MCP integration lets agents add and start tasks on the board themselves, decomposing large work into parallelizable linked tasks
- Built-in git visualizer shows your branches and commit history so you can track the work your agents are doing
