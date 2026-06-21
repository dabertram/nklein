# !Klein

!Klein is a local-first orchestration board for running coding agents in parallel. It is forked from NKlein Kanban, but the user-facing tool name is now `!Klein` and the command-line entry point is `nklein`.

The main driver for this fork is making agentic coding usable with small local LLMs on limited hardware. Early work started with practical blockers such as long local-model turns hitting HTTP body timeout errors, then continued into local-only model routing, larger effective context windows, task decomposition, guardrails, and recovery flows that make smaller models easier to use productively.

The repository name remains `kanban` for now, but when docs or UI refer to the product they should say `!Klein`, and when they refer to the CLI they should say `nklein`.

### Install and Run

```bash
# Run directly
npx nklein

# Or install globally
npm i -g nklein
nklein
```

Run `nklein` from a git repository to open that project, or launch it without a project and add one from the UI.

### What It Does

- Runs many coding-agent tasks in parallel, each with its own task card and worktree.
- Supports native NKlein sessions plus CLI-backed agents such as Claude Code, Codex, Gemini, OpenCode, Droid, and Kiro.
- Helps decompose larger requests into linked task cards.
- Surfaces runtime state, diffs, review actions, merge actions, and recovery controls in a local web UI.
- Prioritizes local NKlein-compatible model providers and small-hardware workflows.

### Fork Direction

!Klein may periodically check whether upstream NKlein Kanban changes are worth integrating. It does not treat upstream parity as a primary goal. This codebase is moving forward around the needs that prompted the fork: local LLM reliability, limited-hardware usability, and practical small-model orchestration.

### Development

```bash
npm run install:all
npm run dev:full
```

On Windows, run `start.bat` from the repository root. It checks the required local tools, installs missing
dependencies, and starts the same full development runtime.

See [DEVELOPMENT.md](./DEVELOPMENT.md) and [docs/architecture.md](./docs/architecture.md) for the current engineering notes.

### License

[Apache 2.0 © 2026 NKlein Bot Inc.](./LICENSE)
