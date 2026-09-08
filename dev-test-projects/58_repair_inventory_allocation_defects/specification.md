# Inventory allocator repair — brief

## The job

`src/` holds three small modules of a warehouse allocator — a stock ledger, a reservation store and the allocator
that puts them together — with **three seeded defects**, one per module.

They interact. One of them is currently *hiding* another: fix the first in the obvious way and a scenario that was
green goes red, because the second defect stops being masked. That is not the suite being unfair; it is the second
defect becoming visible for the first time. Expect it, and finish the job.

Repair the code. Do not rewrite the modules, do not change their exported names, and do not weaken the suite.

## What is frozen

`scenarios/` and `test/` are **evidence, not workspace.** They are the behaviour specification. The verifier
recomputes a content digest of every frozen file on each run and compares it with the digest recorded when the
fixture was built; editing, adding or deleting anything in there fails the suite immediately and names the file.
Softening a scenario is the one thing that fails this task outright.

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
of its own — the scenarios are the specification, and the verifier is the harness that enforces your claims.

1. **The base tree is green.** An empty `repaired` list asserts nothing.
2. **Strict now.** Every id you list is *executed* on every run. If the scenario fails, the suite fails and prints
   its assertion — including a scenario that used to pass and stopped once you unmasked the next defect. An unknown
   id fails and prints the valid ids. A duplicate id fails.
3. **Coverage later.** `"complete": true` demands every scenario the fixture defines and names the missing ones.
4. **Anti-tamper.** The frozen digest check runs first, on every run.

## The three defects

One per module, and nothing else in the fixture is deliberately wrong:

- a **state-mutation** defect: something documented as a value is edited in place, so callers holding it see
  arithmetic they never asked for;
- a **stale-read** defect: a computed result is thrown away and the stale input is used instead — invisible today,
  because the mutation defect happens to keep the stale input fresh;
- a **filter** defect: a store counts entries that should no longer count.

## How to plan this

Do not plan a card per file blindly. Plan the mutation defect first, expect the unmasking, and give the newly-red
scenarios their own card. Reserve the last card for the completeness pass: run `npm test` with every id listed,
confirm it is green, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
