# Card plan for the Fleet Telemetry Platform — planning brief

## The job

`input/specification.md` is the platform specification. It is READ-ONLY input; do not edit it.

Your job is the architect's job: turn that specification into a **card plan** — the dependency-linked set of work
items an implementation team would pick up. You are not asked to write the platform, and no implementation code
should appear in this workspace. The plan is the deliverable.

This specification is the largest in the family, and the plan for it has a hard size limit. That limit is the point:
there are more obligations than the plan is allowed to have cards, so the work of planning is deciding what belongs
together, not transcribing a bullet list.

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
| `testability` | `"testable"` or `"not_testable"` — see the honesty rules below. |
| `coversObligations` | One or more obligation ids from the specification. |

`dependencies` is the same graph written out as edges: one `{ "from": "<card>", "to": "<card>" }` object for every
entry in every card's `dependsOn`, meaning *`from` depends on `to`*. The two representations must agree exactly.

Set `"complete": true` only when every obligation in the specification is covered by some card.

## How the verifier reads the specification

`npm test` derives everything it grades against at run time. It is a checker, not an answer key: it contains no
obligation ids, no module paths, no card names, and not even the ceiling — it reads that from the specification too.

- An **obligation** is a list item that begins `- **OBL-NN** — `. Its text is that line's remainder joined with any
  indented continuation lines up to the first blank or unindented line.
- An obligation's **module** is the path in the `[module: <path>]` annotation inside its text.
- The modules an obligation **uses** are the paths in its `[uses: <path>]` annotations. There may be several.
- An obligation is **documentation-only** when its text contains the marker `(documentation-only)`.
- The **card ceiling** is the number in the specification's `Card ceiling: <n> cards.` line.
- A path counts as a **test file** when one of its directory segments is `test` or `tests`, or when its basename
  contains `.test.` or `.spec.` — for example `test/trip.js`, `src/process/resample.test.js`.

`input/specification.md` is frozen evidence, not workspace. The suite hashes it on every run and fails loudly if
it changes, because trimming an obligation out of it would make coverage trivially satisfiable.

## The rules your plan must satisfy

1. **Referential integrity.** Every id in `dependsOn` is a declared card; no card depends on itself. Every id in
   `coversObligations` is an obligation the specification declares. Every card covers at least one obligation.
2. **Sizing.** At most three entries in `filesLikelyTouched`, and no two cards may claim the same file — two cards
   editing one file is a merge conflict by construction.
3. **Module ownership.** For every obligation annotated `[module: M]` that your plan covers, at least one of the
   cards covering it must list `M` in `filesLikelyTouched`. Obligations that share a module therefore share a card,
   and exactly one card ever *builds* a given module.
4. **Derived ordering.** If an obligation is annotated `[uses: M]`, every card covering that obligation must reach
   the card that builds `M` — the one whose `filesLikelyTouched` contains `M` — through `dependsOn`, directly or
   transitively, unless it is that card itself. If no card builds `M` yet, the rule is silent. The specification
   never says one obligation depends on another; it states the import graph and expects you to derive the edges.
5. **Acyclicity.** The dependency graph is a DAG. A cycle fails the suite and the message prints the cycle. The
   specification's `uses` graph is acyclic, so rules 4 and 5 are satisfiable together.
6. **Edge-list agreement.** `dependencies` contains exactly the edges the cards' `dependsOn` imply — no more, no
   fewer.
7. **Testability honesty.** A card whose `filesLikelyTouched` contains no test file MUST be `not_testable`; a card
   that does contain one MUST be `testable`.
8. **Documentation cards are separate and not testable.** A card must not mix documentation-only obligations with
   implementation obligations, and a card covering only documentation-only obligations MUST be `not_testable`,
   which by rule 7 means it lists no test file. A documentation card declared `testable` is bounced by the
   test-driven gate and parked.
9. **The card ceiling.** The plan MUST NOT exceed the ceiling the specification states. This is enforced on every
   run, not only when you declare the plan complete, so you cannot sketch a card per obligation and prune later.
10. **Coverage.** Required only when you set `"complete": true`, at which point the failure message names every
    obligation no card covers.

Rules 9 and 10 are the squeeze: there are more obligations than the ceiling allows cards, so a complete plan is
only reachable by grouping.

## How your work is checked

The suite stays green while you work, breaks the moment you write a card that is malformed, unreferenced, oversized,
misplaced, mis-ordered, cyclic or dishonest — or the moment the plan grows past the ceiling — and breaks again if
you declare completion with an obligation uncovered. A single bad card fails the run even with `"complete": false`.

## How to plan this

Collect the distinct `[module: …]` paths first; that count, not the obligation count, is the size of the plan. Then
lay the `[uses: …]` edges over it to get the layering: core units, time, ids and geometry at the bottom; ingest on
those; the store beside it; processing on the store; alerting on processing; reports, APIs and operations on top;
and the documentation cards last, depending on whatever they describe. Give each card its own test file, except the
documentation cards, which have none.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
