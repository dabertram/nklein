# Event consumer — integration brief

## The job

`service/event-stream-service.mjs` is a deterministic, in-process event stream with server-side checkpoints. Write
`src/adapter.mjs` so an application can consume it exactly once per event, resumably.

## The service

`createEventStreamService()` returns:

- `request(method, path, options)` → **always** `{ status, body }`, **never throws**. `options` may carry `query`
  and `body`.
- `calls()` → every call, oldest first.
- `queueResponses([...])`, `allEvents()`, `checkpointOf(consumer)`, `setCheckpoint(consumer, after)` — used by the
  conformance suite.

Routes:

| Call | Response |
|---|---|
| `GET /events` with `query.limit` (1..4) and optional `query.after` | `200 { events, nextAfter }`; `nextAfter` is a string or `null` |
| `GET /checkpoints/:consumer` | `200 { consumer, after }`, or `404` `not_found` when none is stored |
| `PUT /checkpoints/:consumer` with `body.after` (a non-empty string) | `200`, or `422` `validation_failed` |

**At-least-once delivery.** A read with `after: "4"` returns the event whose `seq` is 4 **and** the ones following
it. The cursor is inclusive on purpose: the stream would rather send an event twice than lose it. Recognising the
repeat is the consumer's job.

## What you write

`src/adapter.mjs` must export `createEventConsumer(service, options)` returning an object with **`run()`**.

`options` carries **`consumerId`**, **`handle(event)`** (may be async, may throw) and **`batchSize`** (default 4).

The behaviour, exactly:

- **Resume.** Load the stored checkpoint first. A `404` means "never run" — start from the beginning, and do
  **not** invent a cursor on that first read.
- **Read in batches** of `batchSize`, following `nextAfter` until it is `null`, then stop.
- **Handle each event once**, in ascending `seq` order. An event at or below what has already been handled is a
  re-delivery and must be skipped, not handled again.
- **Checkpoint after the work, never before.** The stored `after` must never name an event that has not been
  handled successfully. This is the whole difference between at-least-once and at-most-once: a consumer that
  records progress first loses every event in the window when it dies.
- **A throwing handler stops the run** and the error propagates. The checkpoint must not cover the failed event, so
  a later run reprocesses from it.
- A non-2xx from the service rejects with an error named **`ServiceError`** carrying `status` and `code`.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run. Read `conformance/cases.mjs` — it states precisely what
is checked, and reading it is expected.

## The deliverable

`integration/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "implemented": [] }
```

## How your work is checked

1. **Every case you list is RUN** against a fresh service. Listing a case you have not implemented fails and names
   it.
2. **The whole suite is demanded only when you set `"complete": true`.**
3. Several cases read the **call log** — the cursor on the first read, the batch limit, and the position of the
   first checkpoint write relative to the first handled event.

The untouched fixture passes `npm test` with the stub in place, because an empty manifest claims nothing.
