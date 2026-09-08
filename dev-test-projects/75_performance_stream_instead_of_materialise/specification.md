# Query pipeline — performance brief

## The job

`src/pipeline.mjs` answers three questions correctly and reads all 500 records to answer each of them. Make it read
only as far as it must. Change nothing it returns.

## How cost is measured

The source is an **iterable that counts records pulled**. That count is the budget.

It being an iterable is the trap: `[...source]`, `Array.from(source)` and every array method work perfectly and
pull the whole thing before any filter has run. Reading with `for...of` and stopping is what costs less.

## What you may change

Everything under `src/`, and `performance/manifest.json`. `src/index.mjs` must keep exporting `firstBigNorthern`,
`topTenDoubled` and `anyOver`.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run.

## The behaviour, stated

- **`firstBigNorthern(source)`** → the id of the first record with `region === "north"` and `amountMinor > 5000`,
  or **`null`** if there is none.
- **`topTenDoubled(source)`** → for the first ten records with `amountMinor > 4000`, in order, the string
  `` `${id}:${amountMinor * 2}` ``. Fewer than ten if fewer match.
- **`anyOver(source, threshold)`** → `true` if any record's `amountMinor` exceeds `threshold`.

## The budgets

Listed in full, with reasons, in `performance/budgets.json`. Each is the position of the record that settles the
answer — the honest lower bound for a stream.

- **`B1`** — `W1` in at most **22** pulls.
- **`B2`** — `W2` in at most **18** pulls. The tenth match is the eighteenth record, so this is tight: a lazy
  `take` that checks its counter *before* pulling the next value reads one record too many and fails.
- **`B3`** — `W3` in at most **173** pulls.

**`W4` has no budget on purpose.** Nothing in it matches, so answering it honestly means reading all 500 records —
and that is not waste. It exists to catch a pipeline that became fast by giving up early, and its answer is checked
on every run whatever your manifest says.

## The deliverable

`performance/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "optimised": [] }
```

## How your work is checked

1. **Behaviour is checked on every run.** A pipeline that stops early and returns the wrong answer fails here
   first.
2. **Every budget you list is MEASURED**, and the failure prints how far it read against the budget, with the
   reason.
3. **Every budget is demanded only when you set `"complete": true`.**

The untouched fixture passes `npm test`, because an empty manifest claims nothing while the answers are already
correct.
