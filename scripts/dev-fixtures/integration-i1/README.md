# integration-i1 — an adapter over a paging contacts service

`service/contacts-service.mjs` behaves like a small HTTP API: every call returns `{ status, body }` and it never
throws for an error status. Turning a status into an outcome is the adapter's job, and that is the exercise.

The service also records every call it receives, so a conformance case can check **how** the adapter talked to it.
An adapter that fetches everything and filters locally returns the right answer for the wrong reason, and only the
call log tells the two apart.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run and fails loudly if any of them moves.

## What you write

`src/adapter.mjs`, which ships as a stub, plus `integration/manifest.json`.

## How it is graded

Each case builds a fresh service and a fresh adapter, so no case can be affected by another. A case you list in
`implemented` is RUN — listing one you have not written fails immediately, so an overstated manifest is strictly
worse than an empty one. `"complete": true` demands the whole suite.
