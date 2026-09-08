# Card plan for the Payments Reconciliation Service — planning brief

## The job

`input/specification.md` is the service specification. It is READ-ONLY input; do not edit it.

Your job is the architect's job: turn that specification into a **card plan** — the dependency-linked set of work
items an implementation team would pick up. You are not asked to write the service, and no implementation code
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

`npm test` derives everything it grades against at run time. It is a checker, not an answer key: it contains no
obligation ids, no module paths and no card names, and it does not know which obligations are related — it works
that out from the annotations, the same way you have to.

- An **obligation** is a list item that begins `- **OBL-NN** — `. Its text is that line's remainder joined with any
  indented continuation lines up to the first blank or unindented line.
- An obligation's **module** is the path in the `[module: <path>]` annotation inside its text.
- The modules an obligation **uses** are the paths in its `[uses: <path>]` annotations. There may be several.
- A path counts as a **test file** when one of its directory segments is `test` or `tests`, or when its basename
  contains `.test.` or `.spec.` — for example `test/match.js`, `src/match/fuzzy.test.js`.

`input/specification.md` is frozen evidence, not workspace. The suite hashes it on every run and fails loudly if
it changes, because trimming an obligation out of it would make coverage trivially satisfiable.

## The rules your plan must satisfy

1. **Referential integrity.** Every id in `dependsOn` is a declared card; no card depends on itself. Every id in
   `coversObligations` is an obligation the specification declares. Every card covers at least one obligation.
2. **Sizing.** At most three entries in `filesLikelyTouched`, and no two cards may claim the same file — two cards
   editing one file is a merge conflict by construction.
3. **Module ownership.** For every obligation annotated `[module: M]` that your plan covers, at least one of the
   cards covering it must list `M` in `filesLikelyTouched`. Obligations that share a module therefore share a card,
   and because of rule 2 exactly one card ever *builds* a given module.
4. **Derived ordering — the rule this project is about.** If an obligation is annotated `[uses: M]`, then every
   card covering that obligation must reach the card that builds `M` — the one whose `filesLikelyTouched` contains
   `M` — by following `dependsOn` edges, directly or transitively. A card is exempt only when it is that card
   itself. If no card builds `M` yet, the rule is silent; it starts applying the moment you plan that module in.

   Nothing in the specification says "OBL-13 depends on OBL-10". The dependency is stated as an import — `[uses:
   src/match/exact.js]` on one obligation, `[module: src/match/exact.js]` on another — and you are expected to
   derive the edge from it, because that is what an architect does with a design document. A plan that omits such
   an edge produces a card whose imports do not exist when it is picked up. That has already happened here once.
5. **Acyclicity.** The dependency graph is a DAG. A cycle fails the suite and the message prints the cycle. The
   specification's `uses` graph is acyclic, so rules 4 and 5 are satisfiable together.
6. **Edge-list agreement.** `dependencies` contains exactly the edges the cards' `dependsOn` imply — no more, no
   fewer.
7. **Testability honesty.** A card whose `filesLikelyTouched` contains no test file MUST be `not_testable`; a card
   that does contain one MUST be `testable`. A card marked `testable` with nothing to test is bounced by the
   test-driven gate and parked.
8. **Coverage.** Required only when you set `"complete": true`, at which point the failure message names every
   obligation no card covers.

## How your work is checked

The suite stays green while you work, breaks the moment you write a card that is malformed, unreferenced, oversized,
misplaced, mis-ordered, cyclic or dishonest, and breaks again if you declare completion with an obligation
uncovered. A single bad card fails the run even with `"complete": false` — a wrong card is strictly worse than a
missing one.

## How to plan this

Build the module graph before you build the card list: collect every `[module: …]`, then every `[uses: …]`, and you
have the layering. Money, time and identifiers sit at the bottom with no imports; the three readers sit on money and
identifiers; matching sits on those; reconciliation on matching; reporting, the endpoints, audit and replay on top.
Then turn each module into a card with its own test file and let the edges fall out of the import graph.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
