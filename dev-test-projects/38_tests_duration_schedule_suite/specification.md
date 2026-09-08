# A suite that covers the error paths too — test-authoring brief

## The job

`src/parse-duration.mjs` and `src/schedule.mjs` already work. Neither has tests. Write the suite.

You are not asked to change either module, improve them, or find bugs in them — there are none. You are asked to
produce a suite that would CATCH a bug if one were introduced, and the acceptance check measures exactly that.

Half of what these modules promise lives on the failure side: which error type comes out, what it carries, and what
input is refused outright. A suite that only checks the values returned by valid input leaves that half unpinned.

## How your suite is measured — mutation testing

`mutants/` holds six copies of one of the two source files, each with exactly one behavioural change: a constant
moved, a guard dropped, a pattern loosened, a comparison shifted. `diff src/parse-duration.mjs
mutants/m1/parse-duration.mjs` shows you precisely what changed.

For every mutant you claim in `tests/manifest.json`, `npm test` runs your suite twice:

1. against the correct `src/` — it must **pass**;
2. in a throwaway copy where that mutant's file has replaced its original — it must **fail**.

A suite that passes both cannot tell working code from broken code, and the verifier reports the mutant that
survived by name. A suite that fails the first run is worse still: it rejects the right answer.

## The deliverable

`tests/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "killed": [] }
```

Each entry in `killed` is an object with exactly these fields:

| Field | Meaning |
|---|---|
| `id` | The mutant directory name, e.g. `"m2"`. Nothing else is accepted. |
| `why` | At least twelve characters naming the behaviour that separates the mutant from the correct code. |

Set `"complete": true` only when your suite kills every mutant listed below.

## The six mutants

These are the only ones that count.

| Id | File | Where it differs |
|---|---|---|
| `m1` | `src/parse-duration.mjs` | the size of one unit in the unit table |
| `m2` | `src/parse-duration.mjs` | how tightly the literal pattern is anchored |
| `m3` | `src/parse-duration.mjs` | the guard that rejects a non-string |
| `m4` | `src/schedule.mjs` | `nextRun` — how many whole periods have passed |
| `m5` | `src/schedule.mjs` | `nextRun` — the comparison against the start instant |
| `m6` | `src/schedule.mjs` | `describeFailure` — which errors it treats as duration errors |

Three of the six change nothing at all about a successful call: they are reachable only by driving the modules into
failure and looking closely at what comes back. `assert.throws(fn)` on its own is not close enough — an assertion
that any error at all was raised cannot distinguish this module's own error from a stray one thrown deeper down.

## Where you may write

`test/agent/**` (your suite, as `*.test.js` files, plain ESM with `node:test` + `node:assert/strict`) and
`tests/manifest.json`. Nothing else.

`src/`, `mutants/`, `test/mutation.test.js`, `test/frozen-digests.json`, `package.json` and `scripts/` are FROZEN.
Their SHA-256 digests are recorded and re-checked on every run, and the check names any file that moved. They are
evidence, not workspace.

Your suite must also be a *behavioural* suite. It may not import `node:fs`, `node:child_process`, `node:vm`,
`node:module` or `node:worker_threads`; it may not mention a `mutants/` path; it may not assert on
`Function.toString()`; and it may not use real timers or the real clock. Each of those is a way to fail a mutant run
without testing anything, and each one fails the check on sight.

## How your work is checked

`npm test` runs the frozen verifier in `test/mutation.test.js`. It contains no answers: it discovers the mutants
from the directory tree and gets its verdicts by executing your suite.

1. **Strict now.** Every mutant you list is run. A listed mutant that survives fails the suite, and so does a suite
   that fails against the correct `src/`, or one that lists an unknown id, a duplicate, or a thin `why`.
2. **Coverage later.** `"complete": true` demands every mutant in `mutants/`, and the failure names the ones missing.

So the suite is green before you start, breaks the moment you claim a kill you have not earned, and breaks again if
you declare completion early. Claiming a mutant you have not actually killed is strictly worse than leaving it out.

## How to plan this

Decompose by module or by mutant, not into "write tests" then "update the manifest". Each card should end with real
tests written, the mutants they kill recorded, and the suite green. Give the error paths a card of their own —
they are half this brief. Reserve the last card for the completeness pass, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
