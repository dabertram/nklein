# A suite that tests a cache over time — test-authoring brief

## The job

`src/lru-cache.mjs` already works. It has no tests. Write the suite.

You are not asked to change the module, improve it, or find bugs in it — there are none. You are asked to produce a
suite that would CATCH a bug if one were introduced, and the acceptance check measures exactly that.

This module is deliberately chosen: every rule it enforces is about HISTORY. Which key was touched, in what order,
and how long ago. Look at any single call and it appears correct even when it is not — `get` returns the right
value whether or not it promotes the entry, `set` returns the same cache whether or not it refreshes recency, `has`
answers the same question whether or not it quietly counts as a use. The damage only becomes visible several
operations later, when the wrong entry is evicted.

## How your suite is measured — mutation testing

`mutants/` holds eight copies of `src/lru-cache.mjs`, each with exactly one behavioural change: a promotion
dropped, an eviction that picks the wrong entry, a capacity comparison moved by one, a query given a side effect.
`diff src/lru-cache.mjs mutants/m1/lru-cache.mjs` shows you precisely what changed.

For every mutant you claim in `tests/manifest.json`, `npm test` runs your suite twice:

1. against the correct `src/` — it must **pass**;
2. in a throwaway copy where that mutant's file has replaced `src/lru-cache.mjs` — it must **fail**.

A suite that passes both cannot tell working code from broken code, and the verifier reports the mutant that
survived by name. A suite that fails the first run is worse still: it rejects the right answer.

**None of these eight mutants can be killed by a single call.** Each one needs a sequence: several operations
performed in a chosen order, and then a question — usually `keys()`, `size` or `has()` — asked afterwards about
what survived.

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

## The eight mutants

These are the only ones that count.

| Id | File | Where it differs |
|---|---|---|
| `m1` | `src/lru-cache.mjs` | `get` — whether a read counts as a use |
| `m2` | `src/lru-cache.mjs` | `set` — whether rewriting an existing key refreshes it |
| `m3` | `src/lru-cache.mjs` | `set` — which entry the eviction picks |
| `m4` | `src/lru-cache.mjs` | `set` — the comparison against the capacity |
| `m5` | `src/lru-cache.mjs` | `delete` — what it actually does to the entry |
| `m6` | `src/lru-cache.mjs` | `has` — whether asking is free of side effects |
| `m7` | `src/lru-cache.mjs` | `keys` — the order it reports |
| `m8` | `src/lru-cache.mjs` | `set` — which entry the eviction picks (a different wrong one from `m3`) |

`m3` and `m8` both break the eviction, in two different directions. A test that pins down exactly which key is gone
after the cache overflows separates the correct behaviour from both; a test that merely checks that *something* was
evicted separates it from neither.

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

Decompose by the property being pinned down — recency on read, recency on rewrite, eviction choice, capacity,
deletion, query purity, reported order — not by method, and never into "write tests" then "update the manifest".
Each card should end with real tests written, the mutants they kill recorded, and the suite green. Reserve the last
card for the completeness pass, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
