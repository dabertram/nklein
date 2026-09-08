# integration-i2 — retry, backoff and a rate limit, with a clock you control

`service/orders-service.mjs` is flaky on purpose and rate limited on purpose, and time only moves when someone
calls `advance(ms)`. The conformance suite's `sleep` does not sleep: it records the wait and advances the
service's clock by exactly that much. So every backoff and every rate-limit window is checked to the millisecond
and the whole suite runs instantly.

That is deliberate. A retry test that depends on wall time is a flaky test, and a flaky grader is worse than no
grader.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you write

`src/adapter.mjs`, which ships as a stub, plus `integration/manifest.json`. Wait only through the injected
`options.sleep(ms)` — a real timer will make the waiting cases fail, because nothing else advances the clock.

## How it is graded

A case you list in `implemented` is RUN against a fresh service and a fresh adapter. `"complete": true` demands
the whole suite.
