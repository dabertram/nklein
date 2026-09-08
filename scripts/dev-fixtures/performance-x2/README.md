# performance-x2 — asking the same question over and over

`src/reporting.mjs` is correct and keeps asking for things it has already been told: a currency rate looked up once
per item rather than once per currency, and an item's score recomputed on both sides of every comparison in a
hand-rolled selection sort.

## Performance here is a CALL COUNT, never a duration

Neither probe is slow in wall-clock terms, on purpose. The question is not "did it feel fast" but "how many times
did you ask for something you already knew". Both probes are pure and deterministic, so the counts are exact and
identical on every machine.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you change

Everything under `src/`, plus `performance/manifest.json`.

## How it is graded

**Behaviour is checked always**, whatever the manifest says. A budget you list is then measured, and the failure
prints the actual count against the budget. `"complete": true` demands every budget.
