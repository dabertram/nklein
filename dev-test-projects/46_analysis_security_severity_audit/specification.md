# Handler Security Audit — analysis brief

## The job

`input/` holds four handler modules from a checkout platform plus `routes.mjs`, the gateway's route table. It is
READ-ONLY evidence. Your job is to find the security defects and rate each one with the rubric below. You are not
asked to fix, patch or rotate anything, and you must not edit anything under `input/`.

`routes.mjs` is load-bearing: it states, per handler, what a caller must already hold to reach it — `"public"`
(no credential at all), `"session"` (any signed-in user), or `"admin"` (a session whose role is admin). Reachability
is half of every severity in this audit.

## The deliverable

`analysis/security.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "findings": [] }
```

Each entry in `findings` is an object with exactly these fields:

| Field | Meaning |
|---|---|
| `file` | The evidence file, e.g. `input/webhook.mjs`. |
| `line` | The 1-based line that exhibits the defect. |
| `kind` | One of the four classes below. Nothing else is accepted. |
| `severity` | `low`, `medium`, `high` or `critical`, as the rubric yields — not as it feels. |
| `why` | At least twelve characters on what an attacker gets, not a restatement of the class name. |

Set `"complete": true` only when every defect of these four classes is recorded and rated.

## The four defect classes

These are the only classes that count. A real problem outside them is out of scope for this audit — do not report
it, because an unrecognised finding fails the check.

- **`sql_injection`** — a query built by interpolating a value into a template literal handed to `db.query(...)`,
  instead of being passed as a parameter. The defect is on the query line.
- **`missing_authorization`** — a handler that `routes.mjs` registers with `"auth": "admin"` and whose body never
  calls `requireAdmin(...)`. The defect is on the handler's declaration line. A `public` route is public *by
  design*: not proving the caller's identity there is not this defect.
- **`unsafe_deserialization`** — caller-supplied bytes turned back into live objects through the JavaScript
  evaluator (`eval`, `new Function`, `vm.runInNewContext`). The defect is on the evaluating line.
- **`hardcoded_secret`** — a credential written into the source as a string literal: a `const` whose name contains
  `SECRET`, `KEY`, `TOKEN` or `PASSWORD` assigned a literal of eight characters or more. A value read from the
  environment is not this defect, however sensitive the name.

## The severity rubric

Start from the class, then apply **at most one** modifier — the first that matches, in this order:

**Base severity**

| Class | Base |
|---|---|
| `sql_injection` | `high` |
| `missing_authorization` | `high` |
| `unsafe_deserialization` | `high` |
| `hardcoded_secret` | `medium` |

**Modifiers, first match wins**

1. The defect's **enclosing function** is registered in `routes.mjs` with `"auth": "public"` → **raise one step**.
   The enclosing function is the nearest function declaration the defect line sits inside; a defect at module
   scope has none, and a helper that a public route happens to call is not itself a public route.
2. The defect is a `hardcoded_secret` whose literal begins with `sk_live_` → **raise one step**.
3. Otherwise → unchanged.

The ladder is `low` → `medium` → `high` → `critical`, and raising past `critical` stays at `critical`.

## What is frozen

`input/`, everything under `test/`, and `scripts/run-tests.mjs` are **evidence, not workspace**. `npm test`
recomputes their content digests on every run and fails if any of them moved.

This matters more here than it looks. The verifier DERIVES its truth from the evidence on every run, so deleting a
problem from the input would shrink the truth set and let a short answer pass as complete. Editing the verifier
would do the same in one line. Neither is a shortcut; both simply fail.

## How your work is checked

`npm test` runs a verifier that re-derives the defects *and their severities* from the evidence on every run. It
is a checker, not an answer key: it names no file, no line and no severity.

1. **Every finding you record is checked immediately and strictly.** A file outside the evidence, a line that does
   not exhibit the class you claim, an unknown `kind`, a duplicate, a thin `why`, or a severity the rubric does not
   yield all fail the suite — a genuine finding with an inflated rating fails exactly like an invented one.
2. **Coverage is required only when you set `"complete": true`.** At that point every defect must be present and
   correctly rated, and the failure message names what is missing.

So the suite stays green while you work, breaks the moment you record something untrue or misrated, and breaks
again if you declare completion early.

## How to plan this

Read `routes.mjs` first and write down the handler-to-`auth` map: without it you cannot rate anything, and two of
the four classes are defined in terms of it. Then decompose by class, one card each, ending with findings recorded
and the suite green. Rate as you go rather than in a sweep at the end — the modifier depends on which function the
line sits in, which is cheapest to establish while you are still looking at it. Reserve the last card for the
completeness pass before you set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
