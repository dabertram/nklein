# Contacts adapter — integration brief

## The job

`service/contacts-service.mjs` is a small, deterministic, in-process API. Write `src/adapter.mjs` so an
application can use it without knowing anything about statuses, cursors or error bodies.

## The service

`createContactsService()` returns an object with:

- `request(method, path, options)` → **always** `{ status, body }`, and it **never throws**. `options` may carry
  `query` and `body`.
- `calls()` → every call it has received, oldest first, as `{ method, path, query, body }`.
- `forceNext(response)` → makes the next call return that response, whatever it asks for. The conformance suite
  uses this to exercise error paths; you do not need to call it.
- `seeded()` → the contacts it starts with.

Routes:

| Call | Success | Failure |
|---|---|---|
| `GET /contacts` with `query.limit` (1..3) and optional `query.cursor` | `200 { items, nextCursor }`, `nextCursor` is a string or `null` | `400` with `error.code` `bad_limit` or `bad_cursor` |
| `GET /contacts/:id` | `200` with the contact | `404` with `error.code` `not_found` |
| `POST /contacts` with `body { name, email }` | `201` with the created contact | `422` with `error.code` `validation_failed` and `error.fields` |

An error body is always shaped `{ error: { code, message, ...} }`.

## What you write

`src/adapter.mjs` must export `createContactsClient(service)`, returning an object with:

- **`listAll()`** — every contact, in service order. The service pages at 3 per request, so this must follow
  `nextCursor` until it is `null`. Do not request a limit outside 1..3, do not send a cursor on the first call,
  and do not keep asking once the service says there is no next page.
- **`get(id)`** — the contact, or **`null`** when the service says `not_found`. A missing record is an answer, not
  a failure.
- **`create(input)`** — the created contact. On `validation_failed` it must reject with an error whose `name` is
  **`ValidationError`** and whose `fields` is the service's field list.
- **Any other non-2xx**, anywhere, must reject with an error whose `name` is **`ServiceError`**, carrying
  `status` and the service's `error.code` as `code`. A failure while listing must propagate — never return a short
  list as though it were complete.

The methods may be async; the conformance suite awaits them either way.

## What is frozen

`service/`, `conformance/`, `test/integration.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run and fails if any of them moved. Read
`conformance/cases.mjs` — it is the precise statement of what is checked, and reading it is expected, not cheating.

## The deliverable

`integration/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "implemented": [] }
```

`implemented` lists the conformance case ids your adapter satisfies. Set `"complete": true` only when it satisfies
all of them.

## How your work is checked

1. **Every case you list is RUN**, against a fresh service and a fresh adapter, immediately and strictly. Listing a
   case you have not implemented fails the suite and names it. An overstated manifest is strictly worse than an
   empty one.
2. **The whole suite is demanded only when you set `"complete": true`**, and the failure names every case missing
   from `implemented`.
3. Some cases assert the **call log**, not just the return value. An adapter that pages incorrectly but returns
   the right list still fails, and it should.

The untouched fixture passes `npm test` with the stub in place, because an empty manifest claims nothing. That is
deliberate: a green baseline means the acceptance signal reports *your* work rather than a pre-existing failure.
