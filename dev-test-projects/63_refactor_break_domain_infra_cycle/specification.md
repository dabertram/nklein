# Break the order/shipment cycle — refactor brief

## The job

`src/` models orders, shipments and a small store. Three things are wrong with its shape, and nothing is wrong with
its behaviour. Fix the shape. Do not change the behaviour.

## What you may change

Everything under `src/`, and `refactor/manifest.json`. New files and new directories are fine.

`src/index.mjs` must keep exporting `orderIsPayable`, `orderTotalMinor`, `saveOrder`, `loadOrder`,
`summariseOrder`, `shipmentStateFor`, `describeShipment` and `reset`. Re-exporting them from new modules is exactly
the point; renaming or dropping one is a behaviour change.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are evidence, not workspace. `npm test`
recomputes their content digests on every run and fails if any of them moved.

## The deliverable

`refactor/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "addressed": [] }
```

`addressed` lists the goal ids you have met. Set `"complete": true` only when you have met all of them.

## The goals that count

Listed in full, with reasons, in `refactor/goals.json`. Nothing outside this list is measured.

- **`G1` — no import cycle under `src/`.** The import graph of `src/**/*.mjs` must be acyclic.
- **`G2` — the domain does not import infrastructure.** No module under `src/domain/` may import a module under
  `src/infra/`. Note what this does *not* say: it does not forbid some other layer from knowing both.
- **`G3` — no module is longer than 45 meaningful lines.** Comments and blank lines do not count, so reformatting
  will not satisfy it.

## How your work is checked

`npm test` measures both halves on every run and contains no answers — which module violates what, and how to
restructure it, is the work.

1. **Behaviour first.** Every frozen scenario must still pass, whatever your manifest says.
2. **Every goal you list is checked immediately and strictly**, and the failure names the exact cycle, import or
   module. Claiming a goal you have not met is strictly worse than claiming nothing.
3. **Coverage is required only when you set `"complete": true`.**

The untouched fixture passes `npm test`. That is deliberate: a green baseline means the acceptance signal reports
*your* work rather than a pre-existing failure.
