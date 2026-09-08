# A deterministic suite for retry, cancellation and concurrency — test-authoring brief

## The job

`src/task-runner.mjs` already works. It has no tests. Write the suite.

You are not asked to change the module, improve it, or find bugs in it — there are none. You are asked to produce a
suite that would CATCH a bug if one were introduced, and the acceptance check measures exactly that.

This is the hardest fixture in the family, for two reasons.

**The defects are in timing and ordering, not in return values.** How many attempts ran. What delays were asked
for. Whether a cancellation observed mid-backoff actually stopped the next try. Which slot a result was filed
under once two calls overlapped. How many workers were in flight at the peak. None of that is visible in the value
a successful call returns.

**Determinism is mandatory.** The module never reads a clock, never creates a timer and never touches a global:
`sleep` is injected, the cancellation token is built by the caller, and the worker is the caller's own function.
That is what makes exact assertions about ordering possible without waiting for anything. A test that reaches for
a real timer is testing the timer instead, and the check rejects it on sight.

## How your suite is measured — mutation testing

`mutants/` holds nine copies of `src/task-runner.mjs`, each with exactly one behavioural change: a loop bound moved,
an exponent shifted, a guard removed, a result filed under the wrong index, a runner count changed, concurrency
collapsed into a sequence. `diff src/task-runner.mjs mutants/m1/task-runner.mjs` shows you precisely what changed.

For every mutant you claim in `tests/manifest.json`, `npm test` runs your suite twice:

1. against the correct `src/` — it must **pass**;
2. in a throwaway copy where that mutant's file has replaced `src/task-runner.mjs` — it must **fail**.

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

## The nine mutants

These are the only ones that count.

| Id | File | Where it differs |
|---|---|---|
| `m1` | `src/task-runner.mjs` | `runWithRetry` — the bound on the attempt loop |
| `m2` | `src/task-runner.mjs` | `runWithRetry` — the exponent in the backoff delay |
| `m3` | `src/task-runner.mjs` | `runWithRetry` — whether the last failure is followed by a backoff |
| `m4` | `src/task-runner.mjs` | `runWithRetry` — the cancellation check before an attempt |
| `m5` | `src/task-runner.mjs` | `mapWithConcurrency` — which slot a finished call's result is filed under |
| `m6` | `src/task-runner.mjs` | `mapWithConcurrency` — how many runners are started |
| `m7` | `src/task-runner.mjs` | `mapWithConcurrency` — how many runners are started (a different wrong count) |
| `m8` | `src/task-runner.mjs` | `mapWithConcurrency` — whether the runners actually overlap |
| `m9` | `src/task-runner.mjs` | `createCancellation` — `onCancel` on a token that is already cancelled |

`m6`, `m7` and `m8` all change how much work overlaps — too much, far too much, and none at all. Only a test that
observes the number of calls in flight at the peak, and asserts the exact figure, separates the correct behaviour
from all three.

## Where you may write

`test/agent/**` (your suite, as `*.test.js` files, plain ESM with `node:test` + `node:assert/strict`) and
`tests/manifest.json`. Nothing else.

`src/`, `mutants/`, `test/mutation.test.js`, `test/frozen-digests.json`, `package.json` and `scripts/` are FROZEN.
Their SHA-256 digests are recorded and re-checked on every run, and the check names any file that moved. They are
evidence, not workspace.

Your suite must also be a *behavioural* and *deterministic* suite. It may not import `node:fs`,
`node:child_process`, `node:vm`, `node:module` or `node:worker_threads`; it may not mention a `mutants/` path; it
may not assert on `Function.toString()`; and it may not call `setTimeout`, `setInterval`, `setImmediate`,
`Date.now()` or `performance.now()`. Each of those is either a way to fail a mutant run without testing anything or
a way to make the suite flaky, and each one fails the check on sight. Everything you need — the sleep seam, the
cancellation token, the worker — is a parameter you already control.

## How your work is checked

`npm test` runs the frozen verifier in `test/mutation.test.js`. It contains no answers: it discovers the mutants
from the directory tree and gets its verdicts by executing your suite.

1. **Strict now.** Every mutant you list is run. A listed mutant that survives fails the suite, and so does a suite
   that fails against the correct `src/`, or one that lists an unknown id, a duplicate, or a thin `why`. A suite
   that hangs against a mutant is not a kill either — the verifier says so.
2. **Coverage later.** `"complete": true` demands every mutant in `mutants/`, and the failure names the ones missing.

So the suite is green before you start, breaks the moment you claim a kill you have not earned, and breaks again if
you declare completion early. Claiming a mutant you have not actually killed is strictly worse than leaving it out.

## How to plan this

Decompose by observable property — attempt count, backoff schedule, cancellation timing, result ordering, peak
concurrency, late-subscriber notification — not by function, and never into "write tests" then "update the
manifest". Build the recording seams first (a sleep that records its argument, a worker that counts how many of
itself are in flight); every later card reuses them. Each card should end with real tests written, the mutants they
kill recorded, and the suite green. Reserve the last card for the completeness pass, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
