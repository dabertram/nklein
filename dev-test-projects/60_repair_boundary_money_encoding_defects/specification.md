# Boundary repair — brief

## The job

`src/` holds three tiny modules that are right in the middle of their range and wrong at the edges. Each one has a
**seeded boundary defect**:

- **`src/money.mjs`** — an even split of whole minor units that does not conserve the total.
- **`src/label.mjs`** — a truncation that counts JavaScript string units where the hardware counts UTF-8 bytes.
- **`src/calendar.mjs`** — a calendar-day key that ignores the site's UTC offset, so it is only wrong near the
  day boundary.

Repair the code. Do not rewrite the modules, do not change their exported names, and do not weaken the suite.

## Some scenarios are already green, and that is the trap

Three of the frozen scenarios pass on the shipped tree. They are not free marks and they are not decoration: they
pass **for the wrong reason**, because a broken implementation happens to satisfy them.

The obvious partial fix for the money split — floor every share and give the whole remainder to the last one —
makes the failing scenario go green and takes two currently-green scenarios red with it. The obvious partial fix
for the label — cut the encoded bytes at the budget — does the same. If a scenario that was passing goes red after
one of your changes, the change was the wrong shape; do not go looking for a way to make the scenario agree with it.

You may list a green scenario in the manifest before you have touched anything. It is still checked on every run,
so it will take the build red the moment a shallow patch breaks it. That is the point.

## What is frozen

`scenarios/` and `test/` are **evidence, not workspace.** They are the behaviour specification. The verifier
recomputes a content digest of every frozen file on each run and compares it with the digest recorded when the
fixture was built; editing, adding or deleting anything in there fails the suite immediately and names the file.

## The deliverable

`repair/manifest.json`, which already exists in a valid, empty form:

```json
{ "schemaVersion": 1, "complete": false, "repaired": [] }
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Always `1`. |
| `repaired` | The ids of the frozen scenarios you have confirmed pass. |
| `complete` | Set to `true` only when every scenario this fixture defines is repaired. |

## How your work is checked

`npm test` runs a verifier that reads the scenario set out of `scenarios/` at run time. It holds no expected values
of its own — the scenarios are the specification.

1. **The base tree is green.** An empty `repaired` list asserts nothing.
2. **Strict now.** Every id you list is executed on every run. An unknown id fails and prints the valid ids. A
   duplicate id fails.
3. **Coverage later.** `"complete": true` demands every scenario the fixture defines and names the missing ones.
4. **Anti-tamper.** The frozen digest check runs first, on every run.

The three defect classes above are the only ones seeded. Nothing else in the fixture is deliberately wrong.

## How to plan this

One card per module. Start each by listing that module's currently-green scenarios in the manifest, so a shallow
patch fails the card that produced it instead of surviving to the end. Reserve the last card for the completeness
pass.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
