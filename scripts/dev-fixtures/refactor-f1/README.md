# refactor-f1 — order pricing that was copied instead of shared

Two modules compute the same discount ladder. They were one module once; the second copy was made when invoicing
was added, and they have been edited in parallel ever since. The pricing entry point has also grown into a single
function that validates, sums, discounts, taxes and ships.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are **evidence, not workspace**. They pin the
behaviour you must preserve and they measure the structure you must improve. `npm test` recomputes their digests
on every run and fails loudly if any of them moves.

## What you change

Everything under `src/`, plus `refactor/manifest.json` — the artifact you are graded on.

`src/index.mjs` must keep exporting `applyOrderPricing` and `renderInvoiceTotals`: the public surface is part of
the behaviour being preserved.

## How it is graded

Behaviour and structure, together. Neither is worth anything alone: passing the scenarios while changing nothing is
not a refactor, and restructuring that breaks a scenario is a rewrite with a nicer name.

The goals live in `refactor/goals.json` and are **measured against your source on every run** — there is no list of
which module violates what. Listing a goal in `manifest.addressed` asserts you have met it, and is checked
immediately: a goal you claim but have not met fails the suite, so an overstated manifest is strictly worse than an
empty one. `"complete": true` demands every goal at once.
