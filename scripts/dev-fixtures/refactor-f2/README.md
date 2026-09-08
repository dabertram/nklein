# refactor-f2 — orders and shipments that cannot be separated

`src/domain/order.mjs` imports shipments and shipments import orders back, so neither can be read, tested or moved
without the other. The same module also reaches straight into `src/infra/db.mjs`, so the payment rule cannot be
exercised without a store, and it carries the payment rule, the totals, persistence and presentation together.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are **evidence, not workspace**. `npm test`
recomputes their digests on every run and fails loudly if any of them moves.

## What you change

Everything under `src/`, plus `refactor/manifest.json`. `src/index.mjs` must keep its exports: the public surface
is part of the behaviour being preserved. New directories are fine — a layer that may know both the domain and the
store is a normal answer to the layering goal.

## How it is graded

Behaviour and structure together. The goals in `refactor/goals.json` are measured against your source on every run;
listing one in `manifest.addressed` asserts you have met it and is checked immediately. `"complete": true` demands
all of them.
