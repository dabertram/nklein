# §5.A — Host-worktree retirement: autonomous plan

**Status:** lined up 2026-06-23. **Verification is AUTONOMOUS via Playwright — not "watched"** (user confirmed
2026-06-23 the agent can drive a headless browser itself; capability verified: Playwright/chromium drives the
running app at `127.0.0.1:4173`). Each increment is its own commit behind its own gate (automated test +
Playwright UI check, and `docker`/`AgentSandboxManager` inspection for the shell gate), so any gate failure
reverts cleanly. Execute at the **start of a fresh context window** — it's a ~40-file, semantically-subtle
refactor and needs the full budget for a clean job (this is a context constraint, not a babysitting one).

**Increment-1 subtlety (found 2026-06-23, must not regress):** `web-ui/src/runtime/native-agent.ts`
`isNKleinProviderAuthenticated` is **cloud-oriented** — it requires `apiKeyConfigured` / `oauthAccessTokenConfigured`,
both **false for a local-only NKlein setup**. So today `isTaskAgentSetupSatisfied` for a local user actually leans
on the terminal-CLI fallback (`agents.some(... isRuntimeAgentLaunchSupported && installed)`). When that fallback is
removed for nklein-only, readiness must become **local-aware** — the native agent is ready when a local model is
configured (`nkleinProviderSettings.providerId` + a `modelId`/`baseUrl`), not when an apiKey/oauth exists. First
confirm how `nkleinProviderSettings.modelId`/`baseUrl` is populated for local (LM Studio auto-selects the first
loaded model — §6.10) so the new check matches reality, then rework `isTaskAgentSetupSatisfied` + its
`native-agent.test.ts` accordingly. Verify with web-ui vitest AND a Playwright check that the navbar shows no
spurious "No agent configured" with only a local model set.

## Decided scope (from §5.0 / §5.A)
Full retirement: terminal/CLI agents stay permanently disabled under local-only; **shell-on-task = `docker exec`
into that task's hardened sandbox container** (no host checkout, no worktree — the user shell is as isolated as the
agent); delete the host-worktree subsystem + the saved-host-patch path. **`nklein/tasks/<task>` result branches
STAY** (that's the sandbox delivery path, not a worktree) — only `task-worktree*.ts` goes. Keep
`usesLegacyHostTaskWorkspace` as THE boundary predicate until the very end (it becomes always-false once terminal
agents are gone, then can be removed in the final cleanup with an invariant test).

## Surface inventory (mapped 2026-06-23)
- **Catalog / type / launch:** `src/core/agent-catalog.ts` (RUNTIME_AGENT_CATALOG, RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS,
  usesLegacyHostTaskWorkspace), `src/core/api-contract.ts` (`runtimeAgentIdSchema` enum), `src/config/runtime-config.ts`
  (`normalizeAgentId` — already clamps every non-nklein id → nklein under local-only).
- **Boundary-predicate consumers (4):** `agent-catalog.ts`, `src/server/shutdown-coordinator.ts`,
  `src/server/workspace-metadata-monitor.ts`, `src/commands/task.ts`.
- **Worktree subsystem (delete):** `src/workspace/task-worktree.ts`, `-auto-merge.ts`, `-path.ts`, `-sync.ts`,
  `-turbopack.ts`.
- **Shell-on-task:** `src/terminal/session-manager.ts` + `resolveTaskCwd({ ensure: true })` in
  `src/state/workspace-state.ts`; the `ensureWorktree` tRPC path in `src/trpc/workspace-api.ts` / `app-router.ts`.
- **Terminal/CLI agent integration (~18 files, src/terminal/):** agent-registry, agent-session-adapters,
  claude/codex-workspace-trust, codex-hook-config, opencode-paths, command-discovery, hook-runtime-context,
  pty-session, session-state-machine, terminal-* , ws-server; plus `src/commands/hook-events/*` (codex/kiro/droid),
  `src/commands/hooks.ts`, `src/prompts/append-system-prompt.ts`, `src/nklein-agent/nklein-provider-service.ts`.
- **Worktree/shell consumers to rewire (~20):** `src/trpc/{workspace,projects,runtime,app-router}-api.ts`,
  `src/server/runtime-server.ts`, `src/nklein-agent/{nklein-acceptance-auto-repair,nklein-trusted-auto-merge}.ts`,
  `src/workspace/project-health.ts`, `src/server/shutdown-coordinator.ts`, `src/server/workspace-metadata-monitor.ts`.
- **web-ui:** `src/runtime/native-agent.ts` (the `isTaskAgentSetupSatisfied` fallback to other launch-supported
  agents — confirmed it breaks when launch-support is nklein-only; its `native-agent.test.ts` needs the nklein-only
  rework), `runtime-settings-dialog.tsx`, `task-start-agent-onboarding-carousel.tsx`, `board-card.tsx`,
  `hooks/use-task-sessions.ts`.

## Increments (each = one commit + one gate)
1. **Catalog + launch-support + web-ui native-agent → nklein-only.**
   - `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS = ["nklein"]`; remove terminal entries from `RUNTIME_AGENT_CATALOG`;
     rework `isTaskAgentSetupSatisfied`/`getTaskAgentNavbarHint` (native-agent.ts) to nklein-only + update
     `native-agent.test.ts`; trim the onboarding carousel / settings agent options.
   - **Gate (test):** root tsc + tests; web-ui tsc + vitest. **Gate (browser):** open the app → the task-agent
     picker/onboarding shows only the NKlein agent; no console errors; starting a task still works.
2. **Shell-on-task → `docker exec`.**
   - Rework `startShellSession` (`session-manager.ts`) + `resolveTaskCwd({ ensure: true })` (`workspace-state.ts`)
     to attach to the task's sandbox container (`AgentSandboxManager` exec into `/workspaces/<taskId>`) instead of
     ensuring a host checkout; drop the `ensureWorktree` tRPC mutation.
   - **Gate (LIVE, autonomous — Playwright + docker exec inspection):** start a task on the NKlein agent; open its shell → confirm it lands *inside the
     sandbox container* (`/workspaces/<taskId>`, isolated, `--network none`), commands run, exit is clean; confirm
     **no host worktree dir** appears under `~/.nklein/nklein/worktrees`.
3. **Delete the worktree subsystem + saved-host-patch + dead terminal integration.**
   - Remove `task-worktree*.ts`; rewire/clean the ~20 consumers (most just stop calling the worktree path — the
     NKlein result-branch path already handles delivery); remove the saved-host-patch retirement code; delete the
     now-unreachable `src/terminal/*` CLI-agent integration + `hook-events/*`; shrink `runtimeAgentIdSchema` to
     `["nklein"]` (or keep + document) and simplify `normalizeAgentId`; remove or invariant-pin
     `usesLegacyHostTaskWorkspace`.
   - **Gate (test):** tsc + full suite green. **Gate (browser):** review/diff/merge on a finished task still works;
     project-health shows no "accidental worktree" false positives.
4. **Full verification pass (autonomous):** the checklist below; update AGENTS.md (worktree tribal knowledge →
   "retired"), todo.md (§5.A → done), CHANGELOG.

## Browser/Docker verification checklist (autonomous: Playwright + docker inspection)
- [ ] Agent picker / onboarding offers only the NKlein agent; settings reflect it.
- [ ] Start a task → runs in a Docker sandbox; **no** `~/.nklein/nklein/worktrees/<task>` dir is created.
- [ ] Open a shell on that task → attaches to the sandbox container (`/workspaces/<taskId>`), not a host checkout.
- [ ] Review lane: diff renders, Verify + Merge work, result applied via `nklein/tasks/<task>` branch.
- [ ] Project-health: no accidental-worktree warnings; removing/re-adding the project is clean.
- [ ] `scripts/verify-strict-isolation.mts` still passes (no host worktree, clean teardown).

## Risks / rollback
- Biggest risk is increment 2 (shell semantics) — verify live before increment 3 deletes the worktree fallback.
- Each increment is a standalone commit; if a gate fails, `git revert` that commit and reassess. Do **not** start
  increment 3 (deletions) until increment 2's live shell gate passes.

## Follow-on autonomous sessions (separate)
- **§5.R** (dissolve the internal-SDK boundary — repo-wide inlining) and the big **§5.H** (native-core/python-core
  defaults) / **§5.M** (chat + memory) similarly want their own fresh-context autonomous session; line up each the
  same way when reached.
