# A suite that lives at the boundaries — test-authoring brief

## The job

`src/interval.mjs` already works. It has no tests. Write the suite.

You are not asked to change the module, improve it, or find bugs in it — there are none. You are asked to produce a
suite that would CATCH a bug if one were introduced, and the acceptance check measures exactly that.

This module is deliberately chosen: everything it can get wrong lives at an edge. The empty collection. The single
element. An endpoint that is inside the interval rather than just outside it. Two ranges that touch without
overlapping. The top of the range itself. A suite built from comfortable mid-range examples is green, feels
thorough, and catches none of it.

## How your suite is measured — mutation testing

`mutants/` holds seven copies of `src/interval.mjs`, each with exactly one behavioural change: a comparison shifted
by one, a guard widened, a bound moved. `diff src/interval.mjs mutants/m1/interval.mjs` shows you precisely what
changed.

For every mutant you claim in `tests/manifest.json`, `npm test` runs your suite twice:

1. against the correct `src/` — it must **pass**;
2. in a throwaway copy where that mutant's file has replaced `src/interval.mjs` — it must **fail**.

A suite that passes both cannot tell working code from broken code, and the verifier reports the mutant that
survived by name. A suite that fails the first run is worse still: it rejects the right answer.

**Every one of these seven mutants is invisible to a happy-path suite.** Overlapping ranges merged, an interior
point found, the widest of three picked out, a point clamped from below — all of that behaves identically in the
correct module and in all seven mutants. There is no way to reach them except by choosing the input at the edge.

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

## The seven mutants

These are the only ones that count.

| Id | File | Where it differs |
|---|---|---|
| `m1` | `src/interval.mjs` | `mergeIntervals` — the guard for an empty collection |
| `m2` | `src/interval.mjs` | `mergeIntervals` — the test for whether two intervals meet |
| `m3` | `src/interval.mjs` | `mergeIntervals` — which end the merged interval keeps |
| `m4` | `src/interval.mjs` | `contains` — the comparison against the lower endpoint |
| `m5` | `src/interval.mjs` | `contains` — the comparison against the upper endpoint |
| `m6` | `src/interval.mjs` | `widest` — the guard on how many intervals there are |
| `m7` | `src/interval.mjs` | `clampToBounds` — the upper bound it clamps to |

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

Decompose by boundary class — empty, singleton, endpoints, adjacency, the top of the range — rather than by
function, and never into "write tests" then "update the manifest". Each card should end with real tests written,
the mutants they kill recorded, and the suite green. Reserve the last card for the completeness pass, then set
`"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
