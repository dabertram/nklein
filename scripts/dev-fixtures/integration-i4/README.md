# integration-i4 — an at-least-once event stream with server-side checkpoints

`service/event-stream-service.mjs` re-delivers the last event of every batch at the start of the next one. That is
not a bug to work around; it is what an at-least-once stream does, and a consumer that cannot tolerate it will
double-process every boundary event. Checkpoints live on the server, so "resume where you left off" is a real
question with a checkable answer.

The order of *handle* and *checkpoint* is observable in the call log, and it is the entire difference between
at-least-once and at-most-once. A consumer that checkpoints a batch before processing it passes the
"every event was handled" case and still loses events on a crash — one case exists purely to catch that.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are **evidence, not
workspace**. `npm test` recomputes their digests on every run.

## What you write

`src/adapter.mjs`, which ships as a stub, plus `integration/manifest.json`.

## How it is graded

A case you list in `implemented` is RUN against a fresh service. `"complete": true` demands the whole suite.
