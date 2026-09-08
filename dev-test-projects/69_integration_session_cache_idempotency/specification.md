# Inventory client — integration brief

## The job

`service/inventory-service.mjs` is a deterministic, in-process inventory API with a session, conditional reads and
idempotent writes. Write `src/adapter.mjs` so an application can use it without handling any of that.

## The service

`createInventoryService()` returns:

- `request(method, path, options)` → **always** `{ status, body, ...}`, **never throws**. `options` may carry
  `headers` and `body`. Header names are matched case-insensitively.
- `calls()` → every call **with its headers**, oldest first.
- `advance(ms)` / `nowMs()` → the clock, which moves only when something calls `advance`.
- `queueResponses([...])` → responses returned instead of routing, oldest first, taken by whatever call comes
  next. Used by the suite to script failures.
- `bump(id, changes)` → change an item behind the client's back, so its etag moves.
- `itemCount()`, `tokenTtlMs()`.

The contract it enforces:

| Situation | Response |
|---|---|
| `POST /auth/token` | `200 { token, expiresAtMs }`. Tokens live `tokenTtlMs()` and each new one invalidates the last. |
| any other route without a valid `authorization: Bearer <token>` | `401`, `error.code` `unauthorized` |
| any other route with an expired token | `401`, `error.code` `token_expired` |
| `GET /items/:id` | `200` with the item and an `etag` field |
| `GET /items/:id` with a matching `if-none-match` | `304`, **`body: null`**, and the `etag` |
| `GET /items/:id` unknown | `404`, `error.code` `not_found` |
| `POST /items` without an `idempotency-key` header | `400`, `error.code` `idempotency_key_required` |
| `POST /items` with a key seen before | `200` replaying the **first** result; nothing new is created |
| `POST /items` with a bad body | `422`, `error.code` `validation_failed`, `error.fields` |
| `POST /items` otherwise | `201` with the created item |

## What you write

`src/adapter.mjs` must export `createInventoryClient(service, options)` returning `{ getItem(id), createItem(input) }`.

`options` carries **`now()`** (the service's clock, in ms) and **`sleep(ms)`**. Use them; `Date.now()` and real
timers cannot see or move this service's clock.

The behaviour, exactly:

- **Hold the session.** Fetch a token on first need and reuse it. Do not re-authenticate per call.
- **Refresh before it expires.** When `now()` has reached the token's `expiresAtMs`, get a new one *before*
  sending the request — not after being rejected.
- **Refresh once on a `401`, then retry.** If the retry is rejected too, give up with a `ServiceError`; never loop.
- **Read conditionally.** Remember the `etag` the service returned for an id and send it as `if-none-match` next
  time. A `304` carries **no body**, so return the cached item. When the etag has moved, the service answers `200`
  and the cache must take the new value.
- **`getItem`** returns the item, or **`null`** on `not_found`.
- **Write idempotently.** Every write sends an `idempotency-key`. Different writes use different keys, and a
  **retry of the same write reuses its key** — otherwise a retried create makes two items.
- A `validation_failed` rejects with an error named **`ValidationError`** carrying `fields`; every other failure
  rejects with a **`ServiceError`** carrying `status` and `code`.

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

1. **Every case you list is RUN** against a fresh service and a fresh adapter. Listing a case you have not
   implemented fails and names it.
2. **The whole suite is demanded only when you set `"complete": true`.**
3. Most cases read the **call log**. Returning the right value is not enough when the contract is about what you
   send.

The untouched fixture passes `npm test` with the stub in place, because an empty manifest claims nothing.
