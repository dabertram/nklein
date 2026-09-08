# integration-i3 — a session, conditional reads and idempotent writes

`service/inventory-service.mjs` needs a bearer token that expires, serves `304 Not Modified` when you send the
etag it gave you, and requires an `Idempotency-Key` on every write — replaying the first result if it sees a key
twice.

Most of this contract is about what the adapter **sends**, so most conformance cases read the service's call log.
A conditional read that never sends `if-none-match` is not a conditional read, and a retry that mints a fresh
idempotency key is not idempotent — it is how duplicates get created.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you write

`src/adapter.mjs`, which ships as a stub, plus `integration/manifest.json`. Time is injected: `options.now()` is
the service's clock and `options.sleep(ms)` is how you wait. `Date.now()` tells you nothing here.

## How it is graded

A case you list in `implemented` is RUN against a fresh service and a fresh adapter. `"complete": true` demands
the whole suite.
