# refactor-f4 — one module that parses, validates, aggregates, formats and exports

`buildReport` is a whole pipeline written as one function body: it splits lines, applies five rejection rules,
groups by category, computes averages, pads a table and totals it. `receipts.mjs` carries a verbatim copy of the
money formatter, so money can start formatting two ways after any rounding change.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are **evidence, not workspace**. `npm test`
recomputes their digests on every run and fails loudly if any of them moves.

Column widths, padding, rejection wording and rejection ORDER are all observable and all pinned.

## What you change

Everything under `src/`, plus `refactor/manifest.json`. `src/index.mjs` must keep its exports.

## How it is graded

Behaviour and structure together. Four goals, measured against your source on every run: module length, function
length, branch count and cross-module duplication. Listing a goal asserts you have met it and is checked
immediately; `"complete": true` demands all four.
