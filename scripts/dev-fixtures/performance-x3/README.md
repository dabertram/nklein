# performance-x3 — one fetch per order

`src/enrich.mjs` is correct and goes back to the store once per order, so the same forty customers are fetched
over and over. The two-hop report does it twice per order.

## Two different questions, counted separately

- **calls** — how many round trips. A hundred single-id fetches and one batch of a hundred return the same data;
  only one of them survives contact with a network.
- **duplicate ids** — asking for the same customer forty times in one batch is cheaper than forty calls and still
  forty times more than necessary.

Both are exact and machine-independent, which wall time is not.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you change

Everything under `src/`, plus `performance/manifest.json`. The store refuses a batch larger than 25 ids —
batching is not the same as fetching everything.

## How it is graded

**Behaviour is checked always.** A budget you list is then measured, and the failure prints the call count and the
ids that were fetched more than once. `"complete": true` demands every budget.
