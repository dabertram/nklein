# Contributing to !Klein

Thanks for your interest in contributing to !Klein. This fork is focused on making local-first coding-agent orchestration work well on limited hardware, especially with smaller local NKlein-compatible models.

For naming: use `!Klein` in user-facing copy and `nklein` for CLI references. The repository path and some compatibility internals still use `kanban`.

## What We're Looking For

!Klein currently supports Claude, Codex, Gemini, OpenCode, Droid, Kiro, and NKlein as runtime agents, and runs on macOS, Linux, and Windows. The surface area for cross-compatibility issues is large, and that's where contributions have the most impact.

We are actively looking for help with:

- Cross-platform support: fixing bugs and inconsistencies across macOS, Linux, and Windows (terminal behavior, path handling, symlinks, shell detection, etc.)
- Agent compatibility: adding support for new CLI agents, fixing integration issues with existing ones, and improving agent detection/lifecycle management
- Bug fixes: anything that makes the current feature set more stable and reliable
- Test coverage: adding tests for untested paths, especially platform-specific and agent-specific behavior

Large feature changes should start with an issue or discussion. The current priority is reliability for local models, small-hardware workflows, and safe task orchestration.

## Reporting Bugs

Before opening a new issue, search existing issues to avoid duplicates. When filing a bug, include:

- Your OS and version
- Which CLI agent you're using (and its version)
- Steps to reproduce
- Expected vs. actual behavior
- Any relevant terminal output or screenshots

If you discover a security vulnerability, please report it privately using [GitHub's security advisory tool](https://github.com/dabertram/nklein/security/advisories/new).

## Before Contributing

For bug fixes and compatibility improvements, open an issue first (unless it's a trivial fix like a typo or minor correction). Describe the problem and your proposed approach so we can align before you invest time.

PRs without a corresponding issue may be closed.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/dabertram/nklein.git
   cd kanban
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the dev server:
   ```bash
   npm run dev        # Backend watch mode
   npm run web:dev    # Frontend Vite dev server (in a separate terminal)
   ```

4. Before submitting a PR, make sure both of these pass locally:
   ```bash
   npm run check      # Lint + typecheck + tests
   npm run build      # Full production build
   ```

## Writing and Submitting Code

1. Keep PRs small and focused. One bug fix or one compatibility improvement per PR. If your change touches multiple areas, split it into separate PRs.

2. Code quality:
   - No `any` types. Find the correct type from source or `node_modules`.
   - No inline or dynamic imports. Use standard top-level imports.
   - Write production-quality code, not prototypes.

3. Add tests for your changes. Run `npm run test` to verify everything passes.

4. Use [conventional commit](https://www.conventionalcommits.org/) format for commit messages (e.g., `fix(terminal):`, `feat(agents):`, `test:`). Reference the issue number with `fixes #123` or `closes #123` when applicable.


## Adding Support for a New CLI Agent

If you'd like to add support for a new CLI agent, open an issue first to discuss. A good agent integration PR typically includes:

- Agent detection (checking if the CLI is installed and available on PATH)
- Session startup and lifecycle management
- Side panel prompt injection for supported agents so the agent can interact with the board
- Terminal integration and hook support
- Tests covering the above

Look at the existing agent implementations in `src/` for reference. The agent list lives in `src/cli.ts` and the runtime abstractions are nearby.

## Philosophy

!Klein is in fork-foundation mode. Favor clear primitives, local-model reliability, and good tooling over early complexity. Upstream Cline Kanban changes may be checked and integrated when useful, but this fork does not optimize for strict upstream parity.

The main driver is making smaller local LLMs usable on limited hardware. Early fork work addressed practical blockers like the long-turn HTTP body-timeout failure path, then kept going to improve reliability, guardrails, and day-to-day usability for small-model workflows.

## Community

- Use this repository's issues/discussions for fork-specific work.
- Upstream Cline Kanban remains useful context, but !Klein may intentionally diverge.

## License

By submitting a pull request, you agree that your contributions will be licensed under the project's [Apache 2.0 license](./LICENSE).
