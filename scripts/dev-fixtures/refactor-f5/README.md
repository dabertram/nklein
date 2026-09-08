# refactor-f5 — a rate limiter that only exists once

The counters, the settings and the clock are module-level `let` bindings, so two limiters cannot coexist, no test
can isolate itself, and every caller shares one hidden object. The limiter records denials through the audit log
and the audit log reads the limiter's configuration back, so neither module can be loaded or understood alone.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are **evidence, not workspace**. `npm test`
recomputes their digests on every run and fails loudly if any of them moves.

Every scenario controls time through `setClock`, so nothing depends on wall time.

## What you change

Everything under `src/`, plus `refactor/manifest.json`. `src/index.mjs` must keep its exports — including the
module-level convenience functions, which callers still use. Keeping them while removing the shared mutable state
is the actual exercise.

## How it is graded

Behaviour and structure together: no module-level mutable state, no import cycle, at most 15 meaningful lines and
4 branch points per function. Listing a goal asserts you have met it and is checked immediately; `"complete": true`
demands all four.
