# Order coordinator — integration brief

## The job

Placing an order spans two services with no transaction between them. Write `src/adapter.mjs` so an application
can place one and trust what is left behind afterwards.

## The services

Both are deterministic, in-process, and **never throw**: every call returns `{ status, body }`. Both expose
`request(method, path, options)` (with `headers` and `body`), `calls()`, and `queueResponses([...])`.

**Ledger** (`createLedgerService`) — also `holds()`, `reservedMinor()`:

| Call | Response |
|---|---|
| `POST /holds` with `body.amountMinor` and an `idempotency-key` header | `201` with the hold; `200` replaying the first result if the key is known; `422` `validation_failed`; `409` `insufficient_funds`; `400` `idempotency_key_required` |
| `POST /holds/:id/capture` | `200` with the hold captured; `409` `wrong_state`; `404` `not_found` |
| `POST /holds/:id/release` | `200` with the hold released; `409` `wrong_state`; `404` `not_found` |

Capture and release are **idempotent**: asking for a state the hold already has is a success, not a conflict.

**Fulfilment** (`createFulfilmentService`) — also `shipments()`, `stockOf(sku)`:

| Call | Response |
|---|---|
| `POST /shipments` with `body.sku` and an `idempotency-key` header | `201` with the shipment; `200` replaying the first result if the key is known; `422` `validation_failed`; `409` `out_of_stock`; `400` `idempotency_key_required` |

## What you write

`src/adapter.mjs` must export `createOrderCoordinator({ ledger, fulfilment, sleep })` returning an object with
**`placeOrder({ orderId, amountMinor, sku })`**.

The behaviour, exactly:

1. **Hold the money first.** If the hold cannot be created, fail — and do **not** touch fulfilment. A refusal on
   the money side must not book goods.
2. **Then book the shipment.**
3. **If the shipment fails, release the hold**, then reject with the **original** failure. The caller needs to know
   why the order failed, not that a compensation ran.
4. **Then capture.** Once a capture has been *attempted*, never release: a `504` is not a "no", and releasing money
   the ledger may already hold as captured turns a failed order into a lost one.
5. **Idempotency.** Both writes carry an idempotency key derived from `orderId`, so placing the same order twice
   holds once and ships once, while different orders stay separate.
6. **Retries.** Retry only a `5xx` — a `4xx` is a decision, and repeating it repeats the decision. Wait through
   the injected `sleep(ms)`. The compensating release is retried the same way; if it genuinely cannot be completed,
   fail loudly rather than pretending the saga unwound.
7. A `validation_failed` rejects with a **`ValidationError`** carrying `fields`; every other failure rejects with a
   **`ServiceError`** carrying `status` and `code`.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run. Read `conformance/cases.mjs` — it states precisely what
is checked, and reading it is expected.

Some cases **wrap `ledger.request`** to make one step fail. Call the services through the objects you were given;
capturing a method once at construction will not see the wrapper.

## The deliverable

`integration/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "implemented": [] }
```

## How your work is checked

1. **Every case you list is RUN** against fresh services. Listing a case you have not implemented fails and names
   it.
2. **The whole suite is demanded only when you set `"complete": true`.**
3. Every case checks the **final state of both services**. A saga is judged on what it leaves behind: no money held
   that nothing backs, no goods booked against money that was released.

The untouched fixture passes `npm test` with the stub in place, because an empty manifest claims nothing.
