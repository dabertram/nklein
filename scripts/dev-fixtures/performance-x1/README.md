# performance-x1 — reporting that re-reads the data

`src/reports.mjs` is correct and reads the dataset far more than it needs to: totalling five teams costs six
passes, and every id lookup scans from the start, so a miss costs a whole pass before it gives up.

## Performance here is a COUNT, never a duration

The data is only reachable through the instrumented `dataset.at(index)`, and every read is counted. Wall time on a
shared machine is noise — it depends on what else is running — and a grader that fails when the laptop is busy
teaches an agent to distrust the grader. A budget of "one pass over the rows" is a claim about the algorithm that
is either true or false, and it is identical on every machine.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you change

Everything under `src/`, plus `performance/manifest.json`.

## How it is graded

**Behaviour is checked always**, whatever the manifest says: a faster wrong answer is not an optimisation. A budget
you list in `optimised` is then MEASURED, and the failure prints the count against the budget. `"complete": true`
demands every budget.
