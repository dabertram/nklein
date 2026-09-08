# performance-x4 — a pipeline that reads everything before answering anything

`src/pipeline.mjs` is correct and spreads the source into an array as its first move, so every query reads all 500
records — including the one whose answer is settled by the 22nd.

The source is an iterable, which is exactly the trap: `[...source]`, `Array.from`, and every array method work
perfectly and pull the whole thing.

## Cost is how far it read

The source counts records pulled. That single number is the whole story: a materialising pipeline pulls everything
before the first filter runs; a streaming one pulls as far as the answer requires and stops.

One workload has no match at all, so answering it honestly requires reading everything. It carries **no budget** —
it is there to catch a pipeline that got fast by giving up early. Behaviour is checked on every run.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you change

Everything under `src/`, plus `performance/manifest.json`.
