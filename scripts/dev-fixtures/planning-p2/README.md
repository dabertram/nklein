# Planning fixture — card plan for the Warehouse Stock Ledger

`input/specification.md` is the specification you are planning against. It is READ-ONLY: never edit it.

Your deliverable is `plan/cards.json`. It already exists in a valid, empty form, so `npm test` is green before you
start. The verifier in `test/` derives the obligation set — and the module each obligation belongs in — from the
specification on every run.

- **Every card you write is checked strictly, immediately.** Unknown obligations, dangling dependencies, more than
  three files, a file two cards both claim, a cycle, a dishonest `testability`, or an obligation planned somewhere
  other than the module the specification assigns it: any one of those fails the suite at once.
- **Coverage is only required once you set `"complete": true`.**

The trap in this one is sizing. Several obligations name the same module, and no two cards may claim the same file,
so a card per obligation cannot be made to fit: those obligations have to be planned together on one card.
