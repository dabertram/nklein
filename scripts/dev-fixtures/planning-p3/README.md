# Planning fixture — card plan for the Encrypted Backup and Restore tool

`input/specification.md` is the specification you are planning against. It is READ-ONLY: never edit it.

Your deliverable is `plan/cards.json`. It already exists in a valid, empty form, so `npm test` is green before you
start. The verifier in `test/` derives the obligation set, each obligation's module, and which obligations are
documentation-only from the specification on every run.

- **Every card you write is checked strictly, immediately.** Unknown obligations, dangling dependencies, more than
  three files, a file two cards both claim, a cycle, a dishonest `testability`, an obligation planned away from its
  module, or a documentation obligation mixed into implementation work: any one of those fails the suite at once.
- **Coverage is only required once you set `"complete": true`.**

The trap in this one is honesty about testability. Four obligations are marked `(documentation-only)` and are
discharged by writing prose. A card that covers only those has nothing a test runner can assert, so it must be
`not_testable` and must list no test file. Marking it `testable` is exactly the mistake that gets a card bounced by
the test-driven gate and parked.
