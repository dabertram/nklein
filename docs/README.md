# Engineering Docs

This folder is the starting point for engineers working on !Klein itself.

Naming rule of thumb: say `!Klein` for product/UI-facing references, `nklein` for commands, and expect some repo/internal compatibility paths to still say `kanban`.

This follows the usual split a small engineering team would want:

- `README.md` explains the product, fork direction, local setup, and everyday usage.
- `docs/` holds stable onboarding and architecture references for humans.
- `.plan/docs/` holds active plans, handoffs, and deeper change-history context for larger refactors.

If you are new to the codebase, read these in order:

1. [`../README.md`](../README.md) for the product overview and local setup.
2. [`architecture.md`](./architecture.md) for the system map, runtime model, and key file guide.

This `docs/` folder should stand on its own for normal onboarding. Active plans and handoffs may still exist in `.plan/docs`, but a new engineer should not need those to understand the current architecture.

The main product direction here is support for small local LLMs on limited hardware. Upstream Cline Kanban remains relevant context, but !Klein moves forward based on that local-first constraint rather than strict upstream parity.

When adding new engineering docs, prefer putting stable explanations here and linking them from this index.
