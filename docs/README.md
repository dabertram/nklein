# Engineering Docs

This folder is the starting point for engineers working on !Klein itself. It is deliberately small — the active backlog and all the knowledge needed to work it live in [`../todo.md`](../todo.md) (self-contained, future work) and [`../done.md`](../done.md) (shipped archive); [`../AGENTS.md`](../AGENTS.md) holds tribal knowledge. We do **not** keep a pile of "maybe-needed" reference docs here: stale documentation is worse than none, so anything kept here must be current and maintained.

Naming rule of thumb: say `!Klein` for product/UI-facing references, `nklein` for commands, and expect some repo/internal compatibility paths to still say `kanban`.

New to the codebase? Read in order:

1. [`../README.md`](../README.md) — product overview and local setup.
2. [`architecture.md`](./architecture.md) — the system map (runtime model, key files).

## Layout

- `architecture.md` — the system map.
- `architecture/runtime-hooks-architecture.md` — the **live** runtime-hooks design (how agent session state is tracked via `nklein hooks …`; linked from [`../DEVELOPMENT.md`](../DEVELOPMENT.md)).
- `dev/` — living dev-process trackers tied to open todo work: `cross-model-verification.md` (the §5.Z matrix), `local-llm-tests.md` (the §5.O output-robustness log), `autonomous-decisions.md` (the autonomous-run decision log).

When adding new engineering docs, prefer putting stable, maintained explanations here and linking them from this index. If a piece of knowledge is needed to work an open task, fold it directly into that task in `todo.md` instead of starting a new reference file.
