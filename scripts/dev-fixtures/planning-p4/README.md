# Planning fixture — card plan for the Payments Reconciliation Service

`input/specification.md` is the specification you are planning against. It is READ-ONLY: never edit it.

Your deliverable is `plan/cards.json`. It already exists in a valid, empty form, so `npm test` is green before you
start. The verifier in `test/` derives the obligation set, each obligation's module, and the modules that
obligation's implementation consumes, from the specification on every run.

- **Every card you write is checked strictly, immediately.** Unknown obligations, dangling dependencies, more than
  three files, a file two cards both claim, a cycle, a dishonest `testability`, an obligation planned away from its
  module, or a card that never reaches the card building a module its obligations import: any one of those fails
  the suite at once.
- **Coverage is only required once you set `"complete": true`.**

The trap in this one is ordering. The specification states its import graph in `[uses: <path>]` annotations, and a
card whose obligations import a module must reach — through `dependsOn`, directly or transitively — the card that
builds it. A plan that lists the right cards in the wrong order is the plan that ships a card whose imports do not
exist yet.
