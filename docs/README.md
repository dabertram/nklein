# Engineering Docs

This folder is the starting point for engineers working on !Klein itself.

Naming rule of thumb: say `!Klein` for product/UI-facing references, `nklein` for commands, and expect some repo/internal compatibility paths to still say `kanban`.

If you are new to the codebase, read these in order:

1. [`../README.md`](../README.md) for the product overview and local setup.
2. [`architecture.md`](./architecture.md) for the system map, runtime model, and key file guide.

The active development backlog lives in [`../todo.md`](../todo.md) (future work) and [`../done.md`](../done.md) (shipped archive); [`../AGENTS.md`](../AGENTS.md) holds tribal knowledge. `todo.md` is self-contained — these docs are background/provenance, not a substitute for it.

## Layout

- `architecture.md` — the system map (runtime model, key files).
- `architecture/` — deeper architecture references: the live runtime-hooks design, the agent-isolation policy, and the NKlein↔kanban architecture cleanup plan/handoff.
- `research/` — !Klein's own design research grounding the roadmap (anti-patterns, target architecture/structure, small-LLM optimization, context smart-zone, dynamic roles/skills, substrate/milestones, planning-column, §5.A worktree-retirement notes, the founding ideation).
- `dev/` — living dev-process trackers: `cross-model-verification.md` (the §5.Z matrix), `local-llm-tests.md` (the §5.O output-robustness log), `autonomous-decisions.md` (the autonomous-run decision log).
- `history/` — shipped-work provenance kept for the record (e.g. `security-issues.md`, the source of the shipped §5.Y hardening).
- `node22-ci-hanging-tests-investigation.md` — the CI-hang playbook (cited by AGENTS.md).

When adding new engineering docs, prefer putting stable explanations here and linking them from this index. The main product direction is support for small local LLMs on limited hardware; upstream Cline Kanban remains relevant context but !Klein moves forward on that local-first constraint rather than strict upstream parity.
