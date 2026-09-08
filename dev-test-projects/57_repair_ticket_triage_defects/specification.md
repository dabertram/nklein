# Ticket triage repair — brief

## The job

`src/triage.mjs` is a working support-desk triage module with **three seeded defects**. Each one is independently
observable: you can see it, fix it and prove it without touching the other two.

Repair the code. Do not rewrite the module, do not change its exported names, and do not weaken the suite that
grades you.

## What is frozen

`scenarios/` and `test/` are **evidence, not workspace.** They are the behaviour specification: every scenario
drives the module's public API over a range of inputs, so a defect cannot be papered over by special-casing
whatever one assertion happens to look at.

The verifier recomputes a content digest of every frozen file on each run and compares it with the digest recorded
when the fixture was built. Editing, adding or deleting anything under `scenarios/`, or editing
`test/repair.test.js` or `scripts/run-tests.mjs`, fails the suite immediately and names the file. There is no way to
pass by softening a scenario, and trying is the one thing that fails this task outright.

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

1. **The base tree is green.** An empty `repaired` list asserts nothing, so `npm test` passes before you start.
2. **Strict now.** Every id you list is *executed*. If the scenario still fails, the suite fails and prints its
   assertion. An unknown id fails and prints the full list of valid ids. A duplicate id fails. Claiming a scenario
   you have not fixed is strictly worse than leaving it out.
3. **Coverage later.** `"complete": true` demands every scenario the fixture defines, and the failure message names
   the ones that are missing.
4. **Anti-tamper.** The frozen digest check runs first, on every run, whatever else you have done.

## The three defects

They live in `src/triage.mjs` and nowhere else. These are the classes that count:

- an **off-by-one** in how many tickets a queue hands back;
- a **boundary comparison** that is exclusive where the desk's promise is inclusive;
- a **default argument** that does not match the desk default the module documents and exports.

Nothing else in the fixture is deliberately wrong.

## How to plan this

One card per defect, each ending with the relevant scenario ids added to `repaired` and the suite green. Reserve the
last card for the completeness pass: run `npm test` with every id listed, confirm it is green, then set
`"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
