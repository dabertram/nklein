# Reference Solution — habit-many-small

> Gold-standard end-state and judging rubric for the `many_small` sweep preset. NOT shown to the model
> under test. The task decomposes into MANY SMALL INDEPENDENT cards; the correct end state is a flat fan
> of tiny pure helpers plus one barrel that re-exports them.

## Task
Add a large number of tiny, independent, single-purpose pure helpers to the habit CLI to stress parallel
execution and the sandbox pool. Concretely:

- Add **at least twenty** tiny pure helper functions, **each in its own file** under `src/helpers/`, each
  with **one focused test**.
- **Each helper is independent** — no helper imports another helper (fully parallelizable, independently
  reviewable).
- Every helper is **pure and total**: a typed signature over a documented input domain, deterministic, and
  it **never throws on valid input**.
- Add **exactly one** barrel card (`src/helpers/index.ts`) that **re-exports every helper exactly once**
  with no name collisions; importing the barrel pulls in all of them. The barrel is the only artifact that
  depends on all the helpers.
- Acceptance command: `npm test`. Existing tests (`calculateHabitScore`, `summarizeHabitWeek`) stay green.
  Add no dependencies; do not touch `habit-score.ts`, `habit-insights.ts`, configs, or `package.json`.

**Fixture mechanics that constrain the shape of a *correct* answer:**
- `package.json` runs tests with `node --experimental-strip-types --test test/*.test.js`. The glob is
  `test/*.test.js` (non-recursive, `.js` extension, importing `.ts` source via relative path). Therefore a
  helper's "one focused test" must be a `test/<name>.test.js` file for the runner to discover it. A test
  written as `src/helpers/<name>.test.ts` (or any file not matching `test/*.test.js`) is **never executed**
  and does not count.
- `tsconfig.json` is `strict`, `NodeNext`, `allowImportingTsExtensions: true`, `noEmit`. Relative imports
  **must carry the `.ts` extension** (e.g. `from "./clamp.ts"`). Omitting it fails `npm run build` and is a
  module-resolution error at runtime.

## Suggested decomposition
The fan-out a strong agent produces — N independent leaf cards + 1 join card. The point of this preset is
**breadth and genuine independence**, not depth. Each helper card is reviewable in isolation and has zero
edges to its siblings; the only fan-in is the barrel.

Independent leaf cards (one helper + one test each; ≥20). A clean canonical set:

| # | Card (helper) | Signature | Domain / contract |
|---|---|---|---|
| 1 | `clamp` | `clamp(value, lo, hi): number` | returns `value` bounded to `[lo, hi]`; assumes `lo <= hi` |
| 2 | `percent` | `percent(part, whole): number` | `whole === 0 → 0`; else `(part/whole)*100`, total over all reals |
| 3 | `roundHalfUp` | `roundHalfUp(value): number` | round to nearest integer, `.5` rounds toward `+∞` |
| 4 | `roundTo` | `roundTo(value, digits): number` | round to `digits` decimal places (`digits >= 0`) |
| 5 | `dayOfWeek` | `dayOfWeek(index): string` | `index` mod 7 → `"Mon"…"Sun"`; total for any integer |
| 6 | `streakBucket` | `streakBucket(days): string` | `"none" / "building" / "strong" / "elite"` by `days` thresholds |
| 7 | `labelForBand` | `labelForBand(score): string` | `0–100` band → `"low" / "fair" / "good" / "great"` |
| 8 | `isWeekend` | `isWeekend(index): boolean` | day index → Sat/Sun |
| 9 | `pluralize` | `pluralize(n, singular, plural?): string` | `"1 day" / "2 days"` |
| 10 | `ordinal` | `ordinal(n): string` | `1 → "1st"`, handles 11–13 |
| 11 | `clampPercent` | `clampPercent(value): number` | clamp to `[0, 100]` |
| 12 | `average` | `average(values): number` | `[] → 0`; else arithmetic mean |
| 13 | `sum` | `sum(values): number` | total of a list; `[] → 0` |
| 14 | `lerp` | `lerp(a, b, t): number` | linear interpolation, `t` clamped to `[0,1]` |
| 15 | `toFixedNumber` | `toFixedNumber(value, digits): number` | numeric fixed-precision |
| 16 | `capitalize` | `capitalize(s): string` | uppercase first char; `"" → ""` |
| 17 | `truncate` | `truncate(s, max): string` | cut to `max` with ellipsis; `max <= 0 → ""` |
| 18 | `weekProgress` | `weekProgress(completed, target): number` | `clampPercent(percent(...))` semantics, inline (no helper import) |
| 19 | `gradeForScore` | `gradeForScore(score): string` | `"A".."F"` band |
| 20 | `trendArrow` | `trendArrow(delta): string` | `"↑" / "↓" / "→"` by sign of delta |
| 21 | `safeDivide` | `safeDivide(a, b): number` | `b === 0 → 0`; else `a/b` |
| 22 | `bandIndex` | `bandIndex(score, bands): number` | index of the band `score` falls into |

A correct decomposition has **≥20 such cards plus exactly one barrel card** (card N+1) that re-exports all of
them. Equivalent helper names/sets are fine — what matters is the *structure*: many tiny leaves, zero
helper-to-helper edges, one join. Splitting a helper into "impl card" + "test card" is acceptable but
unnecessary; merging two helpers into one file, or having helper B import helper A, is **wrong** (it
collapses independence — the whole point of the preset).

Barrel / join card (depends on all leaves):
- `src/helpers/index.ts` — `export { clamp } from "./clamp.ts";` … one line per helper, each name exported
  exactly once.

## Reference implementation
Representative full content. The pattern repeats identically for every helper; the rubric judges the
*shape*, so a few helpers are shown in full and the rest follow the same template. All twenty-plus would be
present in a complete solution.

### src/helpers/clamp.ts
```ts
/** Bound `value` to the inclusive range [lo, hi]. Assumes lo <= hi. Total over all finite numbers. */
export function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}
```

### src/helpers/percent.ts
```ts
/** Percentage of `part` relative to `whole`. Total: whole === 0 returns 0 (never throws / never NaN). */
export function percent(part: number, whole: number): number {
	if (whole === 0) {
		return 0;
	}
	return (part / whole) * 100;
}
```

### src/helpers/roundHalfUp.ts
```ts
/** Round to the nearest integer; exact halves round toward +Infinity. Total over all finite numbers. */
export function roundHalfUp(value: number): number {
	return Math.floor(value + 0.5);
}
```

### src/helpers/dayOfWeek.ts
```ts
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Short weekday name for a 0-based index. Total: any integer is wrapped mod 7 (negatives handled). */
export function dayOfWeek(index: number): string {
	const i = ((Math.trunc(index) % 7) + 7) % 7;
	return DAYS[i];
}
```

### src/helpers/streakBucket.ts
```ts
/** Bucket a streak length into a coarse band. Total over all numbers; negatives map to "none". */
export function streakBucket(days: number): string {
	if (days <= 0) return "none";
	if (days < 7) return "building";
	if (days < 30) return "strong";
	return "elite";
}
```

### src/helpers/labelForBand.ts
```ts
/** Human label for a 0-100 score band. Total: values outside [0,100] clamp to the nearest band. */
export function labelForBand(score: number): string {
	if (score < 40) return "low";
	if (score < 70) return "fair";
	if (score < 90) return "good";
	return "great";
}
```

### src/helpers/average.ts
```ts
/** Arithmetic mean. Total: an empty list returns 0 (never NaN, never throws). */
export function average(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((acc, n) => acc + n, 0) / values.length;
}
```

### src/helpers/index.ts (the barrel — depends on all helpers)
```ts
export { clamp } from "./clamp.ts";
export { percent } from "./percent.ts";
export { roundHalfUp } from "./roundHalfUp.ts";
export { roundTo } from "./roundTo.ts";
export { dayOfWeek } from "./dayOfWeek.ts";
export { streakBucket } from "./streakBucket.ts";
export { labelForBand } from "./labelForBand.ts";
export { isWeekend } from "./isWeekend.ts";
export { pluralize } from "./pluralize.ts";
export { ordinal } from "./ordinal.ts";
export { clampPercent } from "./clampPercent.ts";
export { average } from "./average.ts";
export { sum } from "./sum.ts";
export { lerp } from "./lerp.ts";
export { toFixedNumber } from "./toFixedNumber.ts";
export { capitalize } from "./capitalize.ts";
export { truncate } from "./truncate.ts";
export { weekProgress } from "./weekProgress.ts";
export { gradeForScore } from "./gradeForScore.ts";
export { trendArrow } from "./trendArrow.ts";
export { safeDivide } from "./safeDivide.ts";
export { bandIndex } from "./bandIndex.ts";
```

### test/clamp.test.js (the "one focused test" pattern — one per helper, in `test/` so the runner finds it)
```js
import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/helpers/clamp.ts";

test("clamp bounds a value into [lo, hi]", () => {
	assert.equal(clamp(5, 0, 10), 5);
	assert.equal(clamp(-3, 0, 10), 0);
	assert.equal(clamp(99, 0, 10), 10);
	assert.equal(clamp(7, 7, 7), 7);
});
```

### test/percent.test.js
```js
import test from "node:test";
import assert from "node:assert/strict";
import { percent } from "../src/helpers/percent.ts";

test("percent is total and returns 0 when whole is 0", () => {
	assert.equal(percent(1, 4), 25);
	assert.equal(percent(0, 0), 0);
	assert.equal(percent(5, 0), 0);
});
```

### test/barrel.test.js (asserts the join: every helper re-exported exactly once)
```js
import test from "node:test";
import assert from "node:assert/strict";
import * as helpers from "../src/helpers/index.ts";

test("barrel re-exports every helper as a function, no collisions", () => {
	const names = Object.keys(helpers);
	assert.ok(names.length >= 20, `expected >= 20 helpers, got ${names.length}`);
	assert.equal(new Set(names).size, names.length, "duplicate / colliding export names");
	for (const name of names) {
		assert.equal(typeof helpers[name], "function", `${name} is not a function`);
	}
});
```

> The remaining helpers (`roundTo`, `isWeekend`, `pluralize`, `ordinal`, `clampPercent`, `sum`, `lerp`,
> `toFixedNumber`, `capitalize`, `truncate`, `weekProgress`, `gradeForScore`, `trendArrow`, `safeDivide`,
> `bandIndex`, …) each follow the identical template: one `src/helpers/<name>.ts` with a single pure typed
> export and a JSDoc domain line, plus one `test/<name>.test.js` asserting the contract incl. the total /
> edge case. No file in `src/helpers/` (other than `index.ts`) imports another file in `src/helpers/`.

## Why this is correct
| Invariant | Enforcement |
|---|---|
| **≥20 helpers, each its own file** | One `src/helpers/<name>.ts` per helper; barrel test asserts `Object.keys(...).length >= 20`. |
| **Each helper pure & total — never throws on valid input** | Every function is a straight expression / guarded branch over its whole domain (`whole === 0 → 0`, `[] → 0`, negative day index wrapped mod 7, score clamped to nearest band). No `throw`, no I/O, no mutation of inputs. Per-helper tests assert the edge/total case. |
| **Deterministic** | No `Date.now`, `Math.random`, locale, or ambient state — every helper is a pure function of its arguments. Same input → same output across runs and machines. |
| **No helper imports another (fully parallelizable)** | Each leaf file imports nothing from `src/helpers/`. `weekProgress` inlines the clamp/percent math rather than importing `clampPercent`/`percent`. Verifiable statically: `grep` each leaf for `from "./` → only `index.ts` matches. |
| **Barrel re-exports every helper exactly once, no collisions** | `index.ts` is one `export { name } from "./name.ts"` line per helper; barrel test asserts `new Set(names).size === names.length` and that each is a `function`. Importing the barrel transitively loads all helpers. |
| **Tests are actually executed** | Each focused test is `test/<name>.test.js`, matching `package.json`'s `test/*.test.js` glob; `.js` files import `.ts` source via `--experimental-strip-types`. |
| **`.ts` import extensions** | Every relative import carries `.ts` (required by `NodeNext` + `allowImportingTsExtensions`); passes `tsc --noEmit`. |
| **Existing tests stay green / nothing else touched** | `habit-score.ts`, `habit-insights.ts`, `index.ts`, `tsconfig.json`, `package.json` are untouched; the original `test/habit-score.test.js` still passes verbatim. No dependencies added. |

## Quality rubric (for judging a model's output)

**Must-pass invariants (any failure ⇒ not EXCELLENT; several ⇒ FAILING):**
- ≥20 distinct pure helpers, **one per file** under `src/helpers/`.
- **No helper file imports another helper file** (only the barrel imports helpers). This is the defining
  property of the preset — independence/parallelizability.
- Exactly **one barrel** re-exporting **every** helper **exactly once**, no name collisions; importing it
  pulls in all helpers.
- Every helper is **pure, total, deterministic**, typed, and **never throws on valid input** (documented
  domain covered, incl. the obvious edge: divide-by-zero, empty list, negative index, out-of-band score).
- Each helper has **one focused test that the runner actually executes** — i.e. a `test/*.test.js` file
  (not an unrun `src/helpers/*.test.ts`).
- The two **original tests still pass**; `habit-score.ts` / `habit-insights.ts` / `index.ts` / configs /
  `package.json` are **unchanged**; **no new dependencies**.
- `.ts` extensions on all relative imports (build + runtime resolve).

**Dimension scoring:**

*Correctness*
- EXCELLENT: every helper pure/total/typed, edge cases handled, barrel complete and exact, `npm test` green.
- MEDIOCRE: helpers work but a few miss their total/edge case (e.g. `percent` returns `NaN` for `whole === 0`,
  `average([])` is `NaN`) without throwing; barrel present but missing one or two helpers.
- FAILING: a helper throws or returns `NaN`/`undefined` on valid input; barrel missing/incomplete; build or
  a test fails.

*Independence of cards* (the load-bearing dimension here)
- EXCELLENT: zero helper→helper imports; every leaf reviewable in isolation; only the barrel fans in.
- MEDIOCRE: 1–2 incidental cross-imports (e.g. `clampPercent` imports `clamp`) — still mostly parallel but
  no longer fully independent.
- FAILING: helpers chained into a dependency graph, or many helpers crammed into one file — collapses the
  many-small fan-out into a few coupled units.

*Determinism*
- EXCELLENT: no time/random/locale/global state anywhere; tests assert exact values, not ranges.
- MEDIOCRE: deterministic logic but a test relies on `toLocaleString`/float formatting that could vary.
- FAILING: any helper reads `Date.now()`/`Math.random()`/env, or a test is flaky.

*Minimalism*
- EXCELLENT: each file is a tiny single-purpose function + JSDoc domain line; no scaffolding, no dead code.
- MEDIOCRE: helpers carry extra unused params, defensive `throw`s, or verbose boilerplate.
- FAILING: helpers bloated with unrelated logic, classes, config objects, or a framework.

*No added deps*
- EXCELLENT: `package.json` untouched; only `node:test` / `node:assert`.
- MEDIOCRE: adds a dev-only formatter/lint config but no runtime dep.
- FAILING: adds any npm dependency (lodash, jest, vitest, zod, …).

**Common small-model pitfalls:**
- Putting tests at `src/helpers/<name>.test.ts` — they don't match `test/*.test.js` and **never run**, so
  "tests pass" is vacuous. Tests must live in `test/` with the `.js` extension.
- Dropping the `.ts` extension on imports → `NodeNext` resolution error / build failure.
- Helpers importing other helpers (DRY instinct) — kills the independence the preset measures.
- Cramming many helpers into one big `helpers.ts` instead of one file each.
- A barrel that misses a helper, double-exports a name, or renames on re-export causing a collision.
- Impure/non-total helpers: `percent`/`safeDivide` returning `NaN` or throwing on `0`; `average([])` `NaN`;
  `dayOfWeek(-1)` throwing or returning `undefined`.
- Editing `habit-score.ts`/`habit-insights.ts`/`index.ts` or `package.json` "to wire things up" — out of
  scope; the barrel does not need to be imported by `index.ts`.
- Producing only a handful of helpers (under the ≥20 floor) — fails the fan-out the preset exists to stress.
- Adding a test framework (jest/vitest) or other dependency.

## Acceptance
`npm test` (`node --experimental-strip-types --test test/*.test.js`) passes with all helper tests, the barrel
test, and the two original tests green. Key assertions:
- Original `test/habit-score.test.js` unchanged and green: `calculateHabitScore({4,5,3}) === 86` and the
  `summarizeHabitWeek` deep-equal.
- Per-helper edge/total assertions hold, e.g. `clamp(-3,0,10) === 0`, `percent(5,0) === 0`,
  `roundHalfUp(2.5) === 3`, `dayOfWeek(-1) === "Sun"`, `average([]) === 0`.
- Barrel test: `Object.keys(helpers).length >= 20`, `new Set(names).size === names.length`, every export is a
  `function`.
- Static checks: no file in `src/helpers/` other than `index.ts` imports another helper; all relative imports
  carry `.ts`; `package.json` / `tsconfig.json` / `habit-score.ts` / `habit-insights.ts` / `index.ts`
  unchanged; no new dependencies.
