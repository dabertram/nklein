# Item reporting — performance brief

## The job

`src/reporting.mjs` produces correct reports by repeatedly asking its dependencies for facts that have not
changed. Make it pay for each fact once. Do not change a single output.

## How cost is measured

Two instrumented dependencies, both pure and deterministic:

- **`priceBook.rateFor(currency)`** — the rate for a currency. Counted.
- **`scorer.scoreOf(item)`** — an item's score. Counted. The same item always scores the same.

A budget is a number of calls. Neither probe is slow in wall-clock terms, deliberately: the defect being graded is
redundant work, and redundant work is countable while "felt slow" is not. Counts are identical on every machine.

## What you may change

Everything under `src/`, and `performance/manifest.json`.

`src/index.mjs` must keep exporting `convertAll`, `rankByGroup` and `groupReport`.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run. The workloads state their own expected answers, derived
from the inputs rather than copied from a run of the current code.

## The behaviour, stated

- **`convertAll(items, priceBook)`** → `{ id, baseMinor }` per item, in input order, where
  `baseMinor = round(amountMinor * rate / 100)`.
- **`rankByGroup(items, scorer)`** → one entry per group that appears, `{ group, ranked }`, groups sorted by name.
  `ranked` is the group's item ids ordered by **score descending**, ties broken by **id ascending**.
- **`groupReport(items, priceBook, scorer)`** → one entry per group, `{ group, totalBaseMinor, top }`, groups
  sorted by name. `top` is the id of the group's highest-scoring item, ties broken by id ascending.

## The budgets

Listed in full, with reasons, in `performance/budgets.json`. Each names a workload and one or more per-probe
limits.

- **`B1`** — `W1` may call `rateFor` at most **4** times. There are four currencies and two hundred items.
- **`B2`** — `W2` may call `scoreOf` at most **200** times: once per item.
- **`B3`** — `W3` may call `rateFor` at most **4** times **and** `scoreOf` at most **200** times.

## The deliverable

`performance/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "optimised": [] }
```

## How your work is checked

1. **Behaviour is checked on every run**, whatever your manifest says. A cheaper wrong answer is not an
   optimisation.
2. **Every budget you list is MEASURED**, and the failure prints the actual count per probe against the limit,
   with the reason the budget exists. Claiming a budget you have not met is strictly worse than claiming none.
3. **Every budget is demanded only when you set `"complete": true`.**

The untouched fixture passes `npm test`, because an empty manifest claims nothing while the answers are already
correct.
