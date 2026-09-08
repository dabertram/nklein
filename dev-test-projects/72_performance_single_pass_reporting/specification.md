# Single-pass reporting — performance brief

## The job

`src/reports.mjs` produces correct reports and reads the dataset far more than it needs to. Make it cheap. Do not
change a single answer.

## How cost is measured

The dataset is only reachable through `dataset.at(index)`, and **every call is counted**. A budget is a number of
reads.

This is deliberate. Wall time depends on what else the machine is doing, so a time-based budget fails at random
and teaches you to distrust the grader. A read count is a claim about the algorithm — "one pass over the rows" —
and it is identical on every machine, every time.

`dataset` exposes `size`, `at(index)`, `reads()` and `resetReads()`. Reading a row costs one read whatever you do
with it, so caching the row yourself is exactly the point.

## What you may change

Everything under `src/`, and `performance/manifest.json`.

`src/index.mjs` must keep exporting `totalsByTeam` and `amountsFor`.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run and fails if any of them moved. The workloads state their
own expected answers, derived from the rows — not copied from a run of the current code.

## The behaviour, stated

- **`totalsByTeam(dataset)`** → one entry per team that appears, `{ team, totalMinor }`, sorted by team name.
- **`amountsFor(dataset, ids)`** → one entry per id, in the order given: the row's `amountMinor`, or **`null`** when
  no row has that id.

## The budgets

Listed in full, with reasons, in `performance/budgets.json`. Each names a workload and a maximum number of reads.

- **`B1`** — totalling every team costs at most one pass (60 reads for 60 rows).
- **`B2`** — resolving 40 ids costs at most one pass.
- **`B3`** — the same, when a third of the ids are missing. Absence should be as cheap to establish as presence.

## The deliverable

`performance/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "optimised": [] }
```

`optimised` lists the budget ids you have met.

## How your work is checked

1. **Behaviour is checked on every run**, whatever your manifest says. A faster wrong answer is not an
   optimisation, and this is the only thing between "make it cheaper" and "make it return nothing".
2. **Every budget you list is MEASURED**, and the failure prints the actual read count against the budget and the
   reason the budget exists. Claiming a budget you have not met is strictly worse than claiming none.
3. **Every budget is demanded only when you set `"complete": true`.**

The untouched fixture passes `npm test`, because an empty manifest claims nothing while the answers are already
correct. A green baseline means the acceptance signal reports *your* work rather than a pre-existing failure.
