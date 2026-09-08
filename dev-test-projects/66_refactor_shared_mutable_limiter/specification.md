# Rate limiter — refactor brief

## The job

`src/limiter.mjs` is a fixed-window rate limiter whose entire state — counters, settings, clock — lives in
module-level `let` bindings, and `src/audit-log.mjs` imports it back to read the configuration in force.

Give a limiter its own state and break the cycle. Change nothing it does.

## What you may change

Everything under `src/`, and `refactor/manifest.json`. New files are expected.

`src/index.mjs` must keep exporting `allow`, `configure`, `currentConfig`, `setClock`, `reset`, `denials` and
`clearDenials` **as callable module-level functions**. Callers use them and they are part of the behaviour. Keeping
them while removing the shared mutable state is the exercise, not an obstacle to route around.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are evidence, not workspace. `npm test`
recomputes their content digests on every run and fails if any of them moved.

## The behaviour, stated

- `allow(key)` returns `{ allowed, remaining, resetAt }`. A key must be a non-empty string or it throws
  `TypeError`.
- The window is **fixed from the first hit**: `resetAt = now + windowMs`. It rolls when `now >= resetAt` —
  `resetAt` itself already belongs to the new window.
- A denied call does **not** add a hit, and `remaining` is `0`.
- Keys are counted independently.
- `configure(next)` merges into the current settings and returns them; it accepts no argument and `undefined`.
  `currentConfig()` returns a **copy** — mutating it must not change the limiter.
- A changed limit applies to the window in force as well: it is read at decision time, not captured when the
  window opened.
- `reset()` clears the counters and leaves the settings alone.
- `setClock(fn)` installs a clock; `setClock` with anything that is not a function restores real time.
- Each denial is logged with the key, the time, and the `max`/`windowMs` **in force at that moment**.
  `denials()` returns copies; `clearDenials()` empties the log.

## The deliverable

`refactor/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "addressed": [] }
```

## The goals that count

Listed in full, with reasons, in `refactor/goals.json`. Nothing outside this list is measured.

- **`G1` — no module-level mutable state.** No `let` or `var` binding at the top level of any module under `src/`.
  A `const` holding an object you mutate is not flagged; a named instance is a legitimate answer.
- **`G2` — no import cycle under `src/`.**
- **`G3` — no function is longer than 15 meaningful lines.**
- **`G4` — no function has more than 4 branch points** (`if`, `case`, ternary, `&&`, `||`, `catch`).

## How your work is checked

1. **Behaviour first.** Every frozen scenario must still pass, whatever your manifest says.
2. **Every goal you list is checked immediately and strictly**, naming the exact binding, cycle path or function.
   Claiming a goal you have not met is strictly worse than claiming nothing.
3. **Coverage is required only when you set `"complete": true`.**

The untouched fixture passes `npm test`, so the acceptance signal reports *your* work rather than a pre-existing
failure.
