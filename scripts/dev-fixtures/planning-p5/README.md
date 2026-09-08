# Planning fixture — card plan for the Fleet Telemetry Platform

`input/specification.md` is the specification you are planning against. It is READ-ONLY: never edit it.

Your deliverable is `plan/cards.json`. It already exists in a valid, empty form, so `npm test` is green before you
start. The verifier in `test/` derives everything it grades against from the specification on every run: the
obligations, each one's module, the modules each implementation uses, which obligations are documentation-only, and
the card ceiling the specification states.

- **Every card you write is checked strictly, immediately** — shape, sizing, file ownership, ordering, testability
  honesty, documentation separation, acyclicity, and the ceiling.
- **Coverage is only required once you set `"complete": true`.**

The trap in this one is scale. The specification carries more obligations than the plan is allowed to have cards,
so a card per obligation cannot be made to fit and the ceiling is enforced whether or not you have declared the
plan complete. Group the obligations that belong to one module onto one card and the numbers come out; mirror the
bullet list and they never will.
