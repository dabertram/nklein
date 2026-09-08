# Field Service Dispatch API — specification brief

## The job

`input/brief.md` describes the field-service domain: how the work actually goes, the nouns the API must model, and
the capabilities a caller must have. It deliberately specifies no endpoints, payloads or field names — those are
your decisions. It is READ-ONLY evidence, and you must not edit anything under `input/`.

You are not asked to implement anything. The deliverable is the specification.

## The deliverable

`spec/api.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "entities": [], "operations": [] }
```

**An entity** is `{ "name", "identity", "fields" }`:

| Field | Rule |
|---|---|
| `name` | PascalCase, unique across the specification. |
| `fields` | A non-empty array of `{ "name", "type" }`. Field names are camelCase and unique within the entity. |
| `identity` | The name of the field that addresses one instance. It must be one of that entity's own fields. |

**An operation** is `{ "name", "capability", "input", "output", "errors" }`:

| Field | Rule |
|---|---|
| `name` | camelCase, unique across the specification. |
| `capability` | One of the brief's `CAP-NN` ids. This is what ties the API back to what the business asked for. |
| `input` | An array of `{ "name", "type" }` — possibly empty, names unique. |
| `output` | A type, or `"void"` when the operation returns nothing. |
| `errors` | A non-empty array of `{ "code", "when" }`. Codes are `SCREAMING_SNAKE_CASE`, unique within the operation; each `when` is at least twelve characters describing the condition that produces it. |

**Types** are the primitives `string`, `integer`, `decimal`, `boolean`, `timestamp`, `id`; any entity this
specification defines; or `T[]` for an array of any of those.

Set `"complete": true` only when every domain noun is modelled and every capability is served.

## What is actually being checked

Not "is this the API I would have designed" — there is no answer key, and several good designs pass. What is
checked is that the document is **consistent with itself and anchored to the brief**:

- every type you mention resolves to a primitive or to an entity you defined — no dangling references;
- every entity carries an identity field that it actually has;
- every operation cites a capability the brief requires;
- every operation declares at least one way to fail. The brief's closing section lists failures the scheduling
  team hits weekly; a specification in which nothing can go wrong is not finished, it is unread.

This holds at **every** run, not only at the end. If you record an operation that returns an entity, define that
entity in the same edit — a half-written specification that mentions a type it has not defined is exactly the
state this check exists to catch.

## What is frozen

`input/`, everything under `test/`, and `scripts/run-tests.mjs` are **evidence, not workspace**. `npm test`
recomputes their content digests on every run and fails if any of them moved.

This matters more here than it looks. The verifier DERIVES its truth from the evidence on every run, so deleting a
problem from the input would shrink the truth set and let a short answer pass as complete. Editing the verifier
would do the same in one line. Neither is a shortcut; both simply fail.

## How your work is checked

`npm test` runs a verifier that derives the domain nouns and the capability ids from the brief on every run, then
checks your specification against itself. It is a checker, not an answer key: it names no entity, no operation and
no error code.

1. **Everything you record is checked immediately and strictly.** A duplicate name, a bad case convention, a
   dangling type, an identity that is not a field, a missing or empty `errors` list, a duplicated error code, a
   thin `when`, or a capability the brief does not list all fail the suite.
2. **Coverage is required only when you set `"complete": true`.** At that point every domain noun must have an
   entity and every capability must be served by an operation; the failure message names what is missing.

## How to plan this

Model before you operate: a first card that defines the entities and their identities makes every later operation
cheap, because the types it needs already resolve. Then take the capabilities in small groups, one card each,
each ending with those operations recorded and the suite green. Write the error cases with the operation rather
than in a sweep afterwards — the brief's closing section is a checklist of real failures, and mapping them onto
operations as you go is what stops the specification being a happy path with a title. Reserve the last card for
the completeness pass before you set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
