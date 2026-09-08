# Async pipeline repair — brief

## The job

`src/` is a small job pipeline: an IO seam, a record sink, a shared tally and the pipeline that drives them. It has
**three seeded defects**, and all three are about time rather than arithmetic:

- a **floating promise** — asynchronous work is started and never waited for, so the caller is told a job is done
  while it is still in flight;
- a **lost update** — a shared tally is read, an IO turn happens, and the stale value is written back, so
  concurrent increments overwrite each other;
- a **swallowed error** — a catch-all turns a thrown failure into an absent value, so a broken job is reported as a
  success.

Repair the code. Do not rewrite the modules, do not change their exported names, and do not weaken the suite.

## Time is injected, not real

Nothing in this fixture may sleep, poll or read the clock. Every asynchronous step goes through the injected `io`
seam (`src/io.mjs`), whose only method is `yield()`. The frozen scenarios pass an `io` they step by hand: parked
callers are released one at a time, in the order they parked, so ordering is decided by the code under test and a
failure is a defect, never flake.

Your fix must keep that property. A repair that introduces a real timer, a `setTimeout` delay or a sleep is wrong
even if the suite happens to go green.

## What is frozen

`scenarios/` and `test/` are **evidence, not workspace.** They are the behaviour specification, including the exact
shape of the pipeline's result. The verifier recomputes a content digest of every frozen file on each run and
compares it with the digest recorded when the fixture was built; editing, adding or deleting anything in there fails
the suite immediately and names the file.

## The deliverable

`repair/manifest.json`, which already exists in a valid, empty form:

```json
{ "schemaVersion": 1, "complete": false, "repaired": [] }
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Always `1`. |
| `repaired` | The ids of the frozen scenarios you have actually fixed. |
| `complete` | Set to `true` only when every scenario this fixture defines is repaired. |

## How your work is checked

`npm test` runs a verifier that reads the scenario set out of `scenarios/` at run time. It holds no expected values
of its own — the scenarios are the specification.

1. **The base tree is green.** An empty `repaired` list asserts nothing.
2. **Strict now.** Every id you list is executed on every run; a scenario that still fails fails the suite and
   prints its assertion. An unknown id fails and prints the valid ids. A duplicate id fails.
3. **Coverage later.** `"complete": true` demands every scenario the fixture defines and names the missing ones.
4. **Anti-tamper.** The frozen digest check runs first, on every run.

## How to plan this

One card per defect. The sink scenarios and the failure-reporting scenarios overlap — one scenario needs both the
floating promise and the swallowed error fixed before it goes green — so sequence those two cards rather than
running them in parallel. Reserve the last card for the completeness pass.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
