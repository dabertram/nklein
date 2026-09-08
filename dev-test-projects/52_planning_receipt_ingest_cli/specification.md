# Card plan for the Receipt Ingest CLI — planning brief

## The job

`input/specification.md` is a product specification for a small offline CLI. It is READ-ONLY input; do not edit it.

Your job is the architect's job: turn that specification into a **card plan** — the dependency-linked set of work
items an implementation team would pick up. You are not asked to write the CLI, and no code from the specification
should appear in this workspace. The plan is the deliverable.

## The deliverable

`plan/cards.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "cards": [], "dependencies": [] }
```

Each entry in `cards` is an object with at least these fields:

| Field | Meaning |
|---|---|
| `id` | A short identifier, starting with a letter, `[A-Za-z0-9_-]`, unique across the plan. |
| `title` | At least eight characters saying what the card delivers. |
| `filesLikelyTouched` | 1 to 3 relative paths the card is expected to change. No absolute paths, no `..`. |
| `dependsOn` | Card ids this card must follow. May be empty. |
| `testability` | `"testable"` or `"not_testable"` — see the honesty rule below. |
| `coversObligations` | One or more obligation ids from the specification. |

`dependencies` is the same graph written out as edges: one `{ "from": "<card>", "to": "<card>" }` object for every
entry in every card's `dependsOn`, meaning *`from` depends on `to`*. The two representations must agree exactly.

Set `"complete": true` only when every obligation in the specification is covered by some card.

## How the verifier reads the specification

`npm test` derives the obligation set at run time. It is a checker, not an answer key: it contains no obligation
ids and no card names.

- An **obligation** is a list item that begins `- **OBL-NN** — `. Its text is that line's remainder joined with any
  indented continuation lines up to the first blank or unindented line.
- A path counts as a **test file** when one of its directory segments is `test` or `tests`, or when its basename
  contains `.test.` or `.spec.` — for example `test/ingest.js`, `src/ledger/writer.test.js`.

`input/specification.md` is frozen evidence, not workspace. The suite hashes it on every run and fails loudly if
it changes, because trimming an obligation out of it would make coverage trivially satisfiable.

## The rules your plan must satisfy

1. **Referential integrity.** Every id in `dependsOn` is a declared card; no card depends on itself. Every id in
   `coversObligations` is an obligation the specification declares. Every card covers at least one obligation.
2. **Sizing.** At most three entries in `filesLikelyTouched`, and no two cards may claim the same file — two cards
   editing one file is a merge conflict by construction.
3. **Acyclicity.** The dependency graph is a DAG. A cycle fails the suite and the message prints the cycle.
4. **Edge-list agreement.** `dependencies` contains exactly the edges the cards' `dependsOn` imply — no more, no
   fewer.
5. **Testability honesty.** A card whose `filesLikelyTouched` contains no test file MUST be `not_testable`; a card
   that does contain one MUST be `testable`. This is not bookkeeping: a card marked `testable` with nothing to test
   is bounced by the test-driven gate and parked, which is exactly the failure this project exists to catch.
6. **Coverage.** Required only when you set `"complete": true`, at which point the failure message names every
   obligation no card covers.

## How your work is checked

The suite stays green while you work, breaks the moment you write a card that is malformed, unreferenced, oversized,
cyclic or dishonest, and breaks again if you declare completion with an obligation uncovered. A single bad card
fails the run even with `"complete": false` — a wrong card is strictly worse than a missing one.

## How to plan this

The dependencies here are mostly linear: argument handling and file discovery come before parsing, parsing before
normalisation, normalisation before duplicate detection, and the writer last. Decompose so that each card is a real
unit of work with its own files, and reserve the last card for the completeness pass that sets `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
