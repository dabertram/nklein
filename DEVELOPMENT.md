# Development

This repo is still named `kanban`, but the product name is `!Klein` and the CLI command is `nklein`.

## Requirements

- Node.js 20+
- npm 10+
- Docker, for strict local isolation of NKlein agent tool execution

## Install

```bash
npm run install:all
```

Build the pinned agent sandbox image before starting NKlein-backed tasks:

```bash
npm run sandbox:build
```

The runtime fails closed when Docker is unavailable or the sandbox image has not been built. Settings shows the current Docker daemon and sandbox image status in the Agent isolation row.

## Hot reload workflow

Fast path:

```bash
npm run dev:full
```

- Starts the runtime in watch mode and the Vite web UI dev server together
- Auto-picks free runtime and web UI ports so multiple checkouts can run side by side
- Best for day-to-day source development, especially web UI work and runtime changes that benefit from fast iteration

Manual equivalent in two terminals:

1. Runtime server (API + PTY agent runtime):

```bash
npm run dev
```

- Runs on `http://127.0.0.1:3484`

2. Web UI (Vite HMR):

```bash
npm run web:dev
```

- Runs on `http://127.0.0.1:4173`
- `/api/*` requests from Vite are proxied to `http://127.0.0.1:3484`

Use `http://127.0.0.1:4173` while developing UI so changes hot reload.

## Choose the right workflow

Use `npm run dev:full` when you are actively developing !Klein and want fast iteration. It runs the source checkout with `tsx watch` plus the Vite web UI dev server, so runtime changes reload and web UI changes get HMR.

By default, `dev:full` now starts !Klein with `--skip-shutdown-cleanup` so stopping a debug/dev instance does not move cards to Trash or delete task worktrees from your active boards.

To opt back into shutdown cleanup while using `dev:full`, run:

```bash
npm run dev:full -- --with-shutdown-cleanup
```

If `node_modules` has not been installed in this worktree, `dev:full` auto-runs `npm ci` before launch.

Use `npm run dogfood` when you want to validate the latest built CLI behavior more realistically. It builds the current checkout and launches `dist/cli.js`, which is better for checking packaged behavior, startup and shutdown flows, multi-instance dogfooding, and launch behavior against a target project.

## VS Code F5 debugging

The repo includes `.vscode/launch.json` with two configurations:

- `Dev (Full Stack)`: Launches the same workflow as `npm run dev:full`, starting both the runtime and Vite in one terminal.
- `Run Tests`: Runs `vitest run` with the debugger so you can set breakpoints in tests.

Shutdown cleanup flags:

- `--skip-shutdown-cleanup`: do not move sessions to trash or delete task worktrees on shutdown

## Build and run packaged CLI

```bash
npm run build
node dist/cli.js
```

This mode serves built web assets from `dist/web-ui` and does not hot reload the web UI.

Runtime port options:

```bash
# fixed port
node dist/cli.js --port 3484

# pick the first free port starting at 3484
node dist/cli.js --port auto
```

You can still use `KANBAN_RUNTIME_PORT` for compatibility if needed, but `--port` is preferred for local multi-instance runs. Compatibility names like `KANBAN_*` remain in some internal/runtime interfaces while the public CLI name is `nklein`.

## Dogfooding with two !Klein instances

Run your stable orchestrator first (main checkout):

```bash
cd /path/to/kanban-main
npm run build
node dist/cli.js --port 3484
```

Then run a test checkout against a target project (feature worktree):

```bash
cd /path/to/kanban-feature-worktree
npm run dogfood -- --project /path/to/target/repo --port auto
```

If `--project` is omitted, the launcher starts !Klein from a non-git cwd so runtime behaves like launching outside a git repo and opens the first indexed project (if any):

```bash
npm run dogfood -- --port auto
```

Dogfood launcher behavior:

- builds the current checkout by default
- launches `dist/cli.js` with `cwd` set to the target project
- supports `--port <number|auto>`
- supports `--no-open`
- supports `--skip-build` when you already built and want faster restarts
- is the right choice when you want to test the latest built CLI rather than the source-mode dev server

## Run `nklein` from any directory

After cloning and installing dependencies, create/update the global CLI link from this repo:

```bash
npm run link
```

Verify:

```bash
which nklein
nklein --version
```

Then run from any project directory:

```bash
cd /path/to/your/project
nklein
```

After local code changes, run `npm run build` again before using the linked command.

When switching between worktrees, re-run `npm run link` from the worktree you want to test so the global `nklein` binary points at the right `dist/cli.js`. For sidebar agent automation guidance, inspect `src/prompts/append-system-prompt.ts`.

Remove the global link:

```bash
npm run unlink
```

## Scripts

- `npm run build`: build runtime and bundled web UI into `dist`
- `npm run dogfood -- [--project <path>] [--port <number|auto>] [--no-open] [--skip-build]`: build and launch this checkout, optionally targeting a specific project path
- `npm run dev`: run CLI in watch mode
- `npm run dev:full`: run the runtime watch server and Vite web UI dev server together
- `npm run web:dev`: run web UI dev server
- `npm run web:build`: build web UI
- `npm run sandbox:build`: build the pinned Docker image used for NKlein agent tool isolation
- `npm run typecheck`: typecheck runtime
- `npm run web:typecheck`: typecheck web UI
- `npm run test`: run runtime tests
- `npm run web:test`: run web UI tests
- `npm run check`: lint, typecheck, and test runtime package

## Tests

- `test/integration`: integration tests for runtime behavior and startup flows
- `test/runtime`: runtime unit tests
- `test/utilities`: shared test helpers

## Agent session-state tracking

!Klein tracks a task's lifecycle through internal runtime session states (`running`, `awaiting_review`, …) with guarded transitions (duplicate or invalid transitions are no-ops).

The native NKlein agent is the single source of session-state truth: it reports progress and lifecycle directly through its SDK session, which the runtime observes via the session service in `src/nklein-agent/` (see `nklein-task-session-service.ts` / `nklein-session-state.ts`) and maps onto those runtime states. These are distinct from NKlein SDK plugin runtime hooks (`beforeRun`, `beforeTool`, `afterTool`, `afterRun`), which operate inside a single agent run.

> Historical note: earlier versions also accepted state callbacks from external terminal-CLI agents (Claude/Codex/Gemini/OpenCode/Droid) via a `nklein hooks ingest` CLI plus a `hooks.ingest` tRPC procedure. Those terminal-CLI agents are disabled under the local-only, Docker-isolated model, so that hook-ingest path was **removed** (commit `93c35b19`). Don't reintroduce it — the native agent's SDK session reporting replaces it.

## PostHog telemetry config

The web UI reads PostHog settings at build time:

- `POSTHOG_KEY`
- `POSTHOG_HOST`

Local development:
- Set these in `web-ui/.env.local` (see `web-ui/.env.example`).
- If `POSTHOG_KEY` is missing, telemetry does not initialize.

Release builds:
- The publish workflow injects `POSTHOG_KEY` and `POSTHOG_HOST` from GitHub Secrets.
- `POSTHOG_HOST` is optional and defaults to `https://data.nklein.bot`.

Result:
- Official releases have telemetry enabled.
- Forks and source builds have telemetry disabled unless a key is explicitly provided.
