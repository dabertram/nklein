# performance-x5 — an aggregate rebuilt for every question

`src/view.mjs` answers correctly by rebuilding the whole report each time it is asked. Ten queries mean ten full
passes over the rows and ten full re-folds of the totals.

## Two counters, two different wastes

- **`dataset.at(index)`** — reading the original rows. A view that re-reads its source on every query has not built
  anything; it is a query dressed up as a view.
- **`folder.add(total, delta)`** — combining one number into a running total. A view that re-folds every row on
  every query is recomputing the answer it was already holding. This is the counter that makes "incremental" mean
  something specific.

## The one subtlety worth knowing before you start

A team with no rows left is **absent** from the report, not present with a total of zero. Maintaining sums alone
gets this wrong the first time a team's last row moves elsewhere.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you change

Everything under `src/`, plus `performance/manifest.json`.
