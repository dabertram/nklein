# integration-i5 — a two-service saga with compensation

An order takes money on one service and goods on another, and there is no transaction across them. The
coordinator has to hold the money, book the shipment, then capture — and unwind cleanly when the middle step
fails, without unwinding a step whose outcome it cannot know.

Both services are deterministic, in-process, and idempotent by key. That is not a convenience: a distributed write
that cannot be retried cannot be part of a saga at all.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you write

`src/adapter.mjs`, which ships as a stub, plus `integration/manifest.json`.

Some cases wrap `ledger.request` to make one step fail, so read the services through the objects you were given —
capturing a method once at construction will miss it.

## How it is graded

A saga is judged on what it leaves behind, so every case checks the final state of BOTH services: no money held
that nothing backs, no shipment booked against money that was released. `"complete": true` demands the whole suite.
