# Planning fixture — card plan for the Receipt Ingest CLI

`input/specification.md` is the specification you are planning against. It is READ-ONLY: never edit it.

Your deliverable is `plan/cards.json`. It already exists in a valid, empty form, so `npm test` is green before you
start. The verifier in `test/` derives the obligation set from the specification on every run and checks the plan:

- **Every card you write is checked strictly, immediately.** A card that names an obligation the specification does
  not declare, depends on a card that does not exist, touches more than three files, claims a file another card
  already claims, closes a dependency cycle, or lies about its testability fails the suite at once.
- **Coverage is only required once you set `"complete": true`.** At that point every obligation must be covered by
  some card, and the failure message names the ones that are not.

The rule that matters most here: a card whose `filesLikelyTouched` contains no test file must be `not_testable`,
and one that does must be `testable`. Calling a card `testable` when nothing in it can be tested is how a card gets
parked by the test-driven gate.
