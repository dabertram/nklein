# Orders client — integration brief

## The job

`service/orders-service.mjs` is a deterministic, in-process orders API that fails on purpose. Write
`src/adapter.mjs` so an application can call it without knowing about statuses, retry budgets or rate limits.

## The service

`createOrdersService()` returns:

- `request(method, path, options)` → **always** `{ status, body }`, **never throws**, **never sleeps**.
- `calls()` → every call, with the `atMs` it was made at.
- `advance(ms)` / `nowMs()` → the clock. It moves only when something calls `advance`.
- `queueResponses([...])` → responses returned instead of routing, oldest first. A queued response **overrides
  everything, including the rate limit**, and does not consume a rate-limit slot. The conformance suite uses this
  to script failures; you do not need to call it.

Routes and failures:

| Situation | Response |
|---|---|
| `GET /orders/:id` found | `200` with the order |
| `GET /orders/:id` missing | `404`, `error.code` `not_found` |
| `POST /orders` with `body.totalMinor` a positive integer | `201` with the order |
| `POST /orders` otherwise | `422`, `error.code` `validation_failed`, `error.fields` |
| more than 3 requests in any 1000ms window | `429`, `error.code` `rate_limited`, plus a top-level `retryAfterMs` |
| scripted by the suite | whatever it queued, typically `503`/`500` |

## What you write

`src/adapter.mjs` must export `createOrdersClient(service, options)` returning `{ getOrder(id), createOrder(input) }`.

`options` carries:

- **`sleep(ms)`** — always provided. **This is the only way you may wait.** It advances the service's clock; a real
  timer does not, so the service will never leave its rate-limit window and the call will not recover.
- **`maxAttempts`** — total attempts including the first. Default **4**.
- **`baseDelayMs`** — the first backoff. Default **100**.

The policy, exactly:

- **Retry `429` and any `5xx`.** Never retry any other non-2xx — a `4xx` is an answer about the request, and
  repeating it cannot change it.
- **After a `429`, wait exactly the `retryAfterMs` the service sent.** Not your backoff schedule; the service knows
  when its window opens.
- **After a `5xx`, wait `baseDelayMs * 2 ** (attempt - 1)`** — so with the defaults, 100, 200, 400.
- **Never exceed `maxAttempts` calls**, and never wait after the last one.
- **`getOrder`** returns the order, or **`null`** when the service says `not_found`.
- **`createOrder`** returns the created order.
- A `validation_failed` rejects with an error named **`ValidationError`** carrying `fields`. Every other failure
  rejects with an error named **`ServiceError`** carrying `status`, `code` and **`attempts`** — the number of calls
  actually made.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run. Read `conformance/cases.mjs`: it is the precise
statement of what is checked, and reading it is expected.

## The deliverable

`integration/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "implemented": [] }
```

`implemented` lists the conformance case ids your adapter satisfies.

## How your work is checked

1. **Every case you list is RUN** against a fresh service and a fresh adapter, immediately and strictly. Listing a
   case you have not implemented fails and names it.
2. **The whole suite is demanded only when you set `"complete": true`.**
3. Cases assert the **exact waits** and the **exact call count**, so an approximately-right policy fails. That is
   the point: a retry policy nobody can state precisely is a retry policy nobody can operate.

The untouched fixture passes `npm test` with the stub in place, because an empty manifest claims nothing.
