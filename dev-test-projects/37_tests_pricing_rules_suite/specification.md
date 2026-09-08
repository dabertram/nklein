# A suite that pins down order pricing — test-authoring brief

## The job

`src/pricing.mjs` already works. Nobody ever wrote tests for it, so nothing stops the next edit from quietly
breaking it. Write that suite.

You are not asked to change the module, improve it, or find bugs in it — there are none. You are asked to produce a
suite that would CATCH a bug if one were introduced, and the acceptance check measures exactly that.

## How your suite is measured — mutation testing

`mutants/` holds four copies of `src/pricing.mjs`, each with exactly one behavioural change: a comparison moved by
one, a rounding turned the wrong way, an operator swapped. `diff src/pricing.mjs mutants/m1/pricing.mjs` shows you
precisely what changed.

For every mutant you claim in `tests/manifest.json`, `npm test` runs your suite twice:

1. against the correct `src/` — it must **pass**;
2. in a throwaway copy where that mutant's file has replaced `src/pricing.mjs` — it must **fail**.

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

## The four mutants

These are the only ones that count.

| Id | File | Where it differs |
|---|---|---|
| `m1` | `src/pricing.mjs` | `discountPercentFor` — the comparison at a band edge |
| `m2` | `src/pricing.mjs` | `applyDiscount` — the direction the discount is rounded |
| `m3` | `src/pricing.mjs` | `splitEvenly` — how the indivisible remainder is handed out |
| `m4` | `src/pricing.mjs` | `isFreeShipping` — how the two conditions combine |

All four are reachable through the module's exported functions. You do not need to reach inside anything.

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

Decompose by mutant, or by exported function — not into "write tests" then "update the manifest". Each card should
end with real tests written, the mutants they kill recorded, and the suite green. Reserve the last card for the
completeness pass: confirm every mutant is claimed, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
