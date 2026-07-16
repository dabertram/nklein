# Engineering Docs

This folder is the starting point for engineers working on !Klein itself. It is deliberately small — the active backlog
and tribal knowledge live in [`../todo.md`](../todo.md), shipped work in [`../done.md`](../done.md), and repository
instructions in [`../AGENTS.md`](../AGENTS.md). We do **not** keep a pile of "maybe-needed" reference docs here: stale
documentation is worse than none, so anything kept here must be current and maintained.

Naming rule of thumb: say `!Klein` for product/UI-facing references, `nklein` for commands, and expect some repo/internal compatibility paths to still say `kanban`.

New to the codebase? Read in order:

1. [`../README.md`](../README.md) — product overview and local setup.
2. [`architecture.md`](./architecture.md) — the system map (runtime model, key files).

## Layout

- `architecture.md` — the system map.
- `security-threat-model.md` — the Phase 7S trust-boundary map: untrusted ingestion points × privileged actions × the
  defenses that cover each. The living anchor for the security work in `todo.md`.
- `dev/` — maintained design, integration, simulator, and research references. They may explain evidence or current
  behavior, but all actionable work belongs in `todo.md`.

When adding new engineering docs, prefer putting stable, maintained explanations here and linking them from this index. If a piece of knowledge is needed to work an open task, fold it directly into that task in `todo.md` instead of starting a new reference file.
