# refactor-f3 — one function that decides four event kinds against four channels

`routeNotification` grew a branch per event kind and a branch per channel inside each of those, and the
reachability computation it needs was copied into `audit.mjs` so the two must agree with nothing making them.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are **evidence, not workspace**. `npm test`
recomputes their digests on every run and fails loudly if any of them moves.

The scenarios pin the routing rules one precedence at a time, so a restructuring that quietly reorders a
preference fails the scenario that owns that preference rather than a wall of snapshots.

## What you change

Everything under `src/`, plus `refactor/manifest.json`. `src/index.mjs` must keep its exports.

## How it is graded

Behaviour and structure together. The goals in `refactor/goals.json` are measured against your source on every run;
listing one in `manifest.addressed` asserts you have met it and is checked immediately. `"complete": true` demands
all of them.
