# Reference solution — habit-mixed-dag

> Gold-standard end-state for judging a model's output. NOT shown to the model under test.

## Task
Extend the TypeScript habit CLI with a **diamond-shaped feature slice**: one shared config root, two
independent parallel arms built on it (a **goals** arm and a **streak-analytics** arm), and a **reporting**
join that consumes both. The two arms must not import each other. Invalid config throws a typed error from the
shared validator; both arms assume already-valid config. `buildReport` is a pure join exposing data from BOTH
arms. Broad deterministic tests cover each arm in isolation plus the join; the CLI wires the whole pipeline. No
new dependencies; existing tests stay green.

The fixture is a small habit CLI (`src/habit-score.ts`, `src/habit-insights.ts`, `src/index.ts`,
`test/habit-score.test.js`). The existing score/insights code is correct and must remain untouched and green;
the new slice is added as fresh modules under `src/core/`, `src/goals/`, `src/analytics/`, `src/report/`.

## Suggested decomposition
The product spec + user-prompt outline a literal **diamond DAG** (8 cards). A strong agent reproduces it:

```
                ┌──────────────────────────────────────────┐
                │ 1. core/config.ts  (shared ROOT)          │
                │    HabitConfig + validateConfig (throws)  │
                └───────────────┬──────────────────────────-┘
                  ┌─────────────┴─────────────┐
        GOALS ARM │                           │ ANALYTICS ARM   (the two arms run in PARALLEL,
                  ▼                           ▼                  neither imports the other)
        ┌───────────────────┐       ┌────────────────────────┐
        │ 2. goals/settings │       │ 4. analytics/streak    │
        │    (depends on 1) │       │    streakStats (dep 1) │
        └─────────┬─────────┘       └───────────┬────────────┘
                  ▼                             ▼
        ┌───────────────────┐       ┌────────────────────────┐
        │ 3. goals/progress │       │ 5. analytics/<part 2>  │
        │    goalProgress   │       │    (depends on 4)      │
        │    (depends on 2) │       │                        │
        └─────────┬─────────┘       └───────────┬────────────┘
                  └─────────────┬───────────────┘
                                ▼  JOIN
                ┌──────────────────────────────────────────┐
                │ 6. report/build.ts  buildReport(g, a)     │  ← ONLY module importing BOTH arms
                │    (depends on 3 AND 5)                   │
                └───────────────┬──────────────────────────-┘
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
        ┌───────────────────┐       ┌────────────────────────┐
        │ 7. broad tests    │       │ 8. README / CLI wiring │
        │    (depends on 6) │       │    (depends on 6)      │
        └───────────────────┘       └────────────────────────┘
```

| Card | Module | Runs | Edges (depends on) |
|------|--------|------|--------------------|
| 1 | `src/core/config.ts` — `HabitConfig`, `validateConfig` | first (root) | — |
| 2 | `src/goals/settings.ts` — goal target derivation | parallel arm A | 1 |
| 3 | `src/goals/progress.ts` — `goalProgress(config, completedDays)` | parallel arm A | 2 |
| 4 | `src/analytics/streak.ts` — `streakStats(days)` | parallel arm B | 1 |
| 5 | `src/analytics/index.ts` — arm-B aggregate/barrel | parallel arm B | 4 |
| 6 | `src/report/build.ts` — `buildReport(goals, analytics)` | **join** (after 3 AND 5) | 3, 5 |
| 7 | `test/report.test.js` (+ per-arm tests) | after join | 6 |
| 8 | `src/index.ts` CLI wiring (+ README if produced) | after join | 6 |

Judging the DAG: cards **2–3** and **4–5** must be mutually independent (the two arms can be built/reviewed in
parallel — verify by grepping their imports). Card **6** is the single join and the only file importing both
arms. Cards **7/8** are leaves depending on 6. Splitting an arm into 2 cards (settings→progress, streak→agg) or
collapsing each arm to a single card are both acceptable; what matters is the *shape* (root → 2 parallel arms →
join → leaves), the arm independence, and the join exclusivity. A linear chain, a star/fan-out, or arms that
import each other is the **wrong shape**.

## Reference implementation
The existing fixture files are correct; only `src/index.ts` is modified (to wire the new pipeline) and new
files are added. `src/habit-score.ts`, `src/habit-insights.ts`, and the original `test/habit-score.test.js` are
left **byte-for-byte unchanged** (so their assertions stay green). Tabs for indentation and `.ts` import
specifiers match the fixture's style and its `allowImportingTsExtensions` config.

### src/core/config.ts
```ts
export interface HabitConfig {
	weeklyTargetDays: number;
}

export class InvalidHabitConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidHabitConfigError";
	}
}

/**
 * Shared diamond ROOT. Validates a raw config and returns a known-good HabitConfig.
 * Both arms import ONLY this module and may assume the result is already valid.
 */
export function validateConfig(config: HabitConfig): HabitConfig {
	const days = config.weeklyTargetDays;
	if (!Number.isInteger(days) || days < 1 || days > 7) {
		throw new InvalidHabitConfigError(
			`weeklyTargetDays must be an integer in 1..7, got ${days}`,
		);
	}
	return { weeklyTargetDays: days };
}
```

### src/goals/settings.ts
```ts
import type { HabitConfig } from "../core/config.ts";

export interface GoalSettings {
	targetDays: number;
}

/**
 * GOALS arm, step 1. Derives goal settings from already-valid config.
 * Imports only from the shared root — never from the analytics arm.
 */
export function goalSettings(config: HabitConfig): GoalSettings {
	return { targetDays: config.weeklyTargetDays };
}
```

### src/goals/progress.ts
```ts
import type { HabitConfig } from "../core/config.ts";
import { goalSettings } from "./settings.ts";

/**
 * GOALS arm, step 2 (arm output). Fraction of the weekly goal met, clamped to 0..1.
 * Pure; assumes config is already valid.
 */
export function goalProgress(config: HabitConfig, completedDays: number): number {
	const { targetDays } = goalSettings(config);
	const safeCompleted = Math.max(0, completedDays);
	const ratio = safeCompleted / targetDays;
	return Math.max(0, Math.min(1, ratio));
}
```

### src/analytics/streak.ts
```ts
export interface StreakStats {
	current: number;
	best: number;
}

/**
 * ANALYTICS arm, step 1. Treats a day as "active" when its value is > 0.
 * `current` = length of the trailing active run; `best` = longest active run anywhere.
 * Pure; imports nothing from the goals arm.
 */
export function streakStats(days: number[]): StreakStats {
	let best = 0;
	let run = 0;
	let current = 0;
	for (const day of days) {
		if (day > 0) {
			run += 1;
			best = Math.max(best, run);
			current = run;
		} else {
			run = 0;
			current = 0;
		}
	}
	return { current, best };
}
```

### src/analytics/index.ts
```ts
import type { HabitConfig } from "../core/config.ts";
import { streakStats, type StreakStats } from "./streak.ts";

export type { StreakStats } from "./streak.ts";
export { streakStats } from "./streak.ts";

export interface AnalyticsSummary {
	streak: StreakStats;
	activeDays: number;
}

/**
 * ANALYTICS arm, step 2 (arm output). Aggregates the streak stats with a simple
 * active-day count. `config` is accepted to mirror the goals arm's contract; both
 * arms build only on the shared root.
 */
export function analyticsSummary(_config: HabitConfig, days: number[]): AnalyticsSummary {
	return {
		streak: streakStats(days),
		activeDays: days.filter((d) => d > 0).length,
	};
}
```

### src/report/build.ts
```ts
import type { AnalyticsSummary } from "../analytics/index.ts";

export interface Report {
	goalProgress: number;
	currentStreak: number;
	bestStreak: number;
	activeDays: number;
}

/**
 * The JOIN. The ONLY module importing from BOTH arms (goals progress is passed in as a
 * number; analytics is the AnalyticsSummary type from the analytics arm). Pure: identical
 * (goals, analytics) inputs always yield an identical Report, and it surfaces data from
 * BOTH arms so neither is dropped at the join.
 */
export function buildReport(goalProgress: number, analytics: AnalyticsSummary): Report {
	return {
		goalProgress,
		currentStreak: analytics.streak.current,
		bestStreak: analytics.streak.best,
		activeDays: analytics.activeDays,
	};
}
```

### src/index.ts
```ts
import { summarizeHabitWeek } from "./habit-insights.ts";
import { validateConfig } from "./core/config.ts";
import { goalProgress } from "./goals/progress.ts";
import { analyticsSummary } from "./analytics/index.ts";
import { buildReport } from "./report/build.ts";

const summary = summarizeHabitWeek({
	completedDays: 4,
	previousCompletedDays: 3,
	targetDays: 5,
	streakDays: 3,
});

console.log(`habit score: ${summary.score}`);
console.log(`trend: ${summary.trend}`);

const config = validateConfig({ weeklyTargetDays: 5 });
const days = [1, 1, 0, 1, 1, 1, 0];
const progress = goalProgress(config, days.filter((d) => d > 0).length);
const analytics = analyticsSummary(config, days);
const report = buildReport(progress, analytics);

console.log(`goal progress: ${Math.round(report.goalProgress * 100)}%`);
console.log(`current streak: ${report.currentStreak}`);
console.log(`best streak: ${report.bestStreak}`);
```

### test/report.test.js  (new — broad coverage for the slice; lives alongside the original test, matched by `test/*.test.js`)
```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig, InvalidHabitConfigError } from "../src/core/config.ts";
import { goalProgress } from "../src/goals/progress.ts";
import { streakStats } from "../src/analytics/streak.ts";
import { analyticsSummary } from "../src/analytics/index.ts";
import { buildReport } from "../src/report/build.ts";

test("shared root: validateConfig returns a known-good config", () => {
	assert.deepEqual(validateConfig({ weeklyTargetDays: 5 }), { weeklyTargetDays: 5 });
});

test("shared root: invalid config throws the typed error", () => {
	for (const bad of [0, 8, -1, 3.5, Number.NaN]) {
		assert.throws(
			() => validateConfig({ weeklyTargetDays: bad }),
			InvalidHabitConfigError,
			`weeklyTargetDays=${bad} should throw`,
		);
	}
});

test("goals arm: progress is the clamped completed/target ratio", () => {
	const config = validateConfig({ weeklyTargetDays: 5 });
	assert.equal(goalProgress(config, 0), 0);
	assert.equal(goalProgress(config, 5), 1);
	assert.equal(goalProgress(config, 10), 1); // clamped
	assert.equal(goalProgress(config, -3), 0); // clamped
	assert.equal(goalProgress(config, 2), 0.4);
});

test("analytics arm: streakStats finds trailing current and overall best run", () => {
	assert.deepEqual(streakStats([1, 1, 0, 1, 1, 1]), { current: 3, best: 3 });
	assert.deepEqual(streakStats([1, 1, 1, 0, 1]), { current: 1, best: 3 });
	assert.deepEqual(streakStats([0, 0, 0]), { current: 0, best: 0 });
	assert.deepEqual(streakStats([]), { current: 0, best: 0 });
});

test("the two arms do not import each other (parallel independence)", async () => {
	const fs = await import("node:fs/promises");
	const url = await import("node:url");
	const goals = await fs.readFile(
		url.fileURLToPath(new URL("../src/goals/progress.ts", import.meta.url)),
		"utf8",
	);
	const settings = await fs.readFile(
		url.fileURLToPath(new URL("../src/goals/settings.ts", import.meta.url)),
		"utf8",
	);
	const streak = await fs.readFile(
		url.fileURLToPath(new URL("../src/analytics/streak.ts", import.meta.url)),
		"utf8",
	);
	const analyticsIdx = await fs.readFile(
		url.fileURLToPath(new URL("../src/analytics/index.ts", import.meta.url)),
		"utf8",
	);
	assert.ok(!/from\s+["'][^"']*analytics/.test(goals + settings), "goals arm must not import analytics");
	assert.ok(!/from\s+["'][^"']*goals/.test(streak + analyticsIdx), "analytics arm must not import goals");
});

test("join: buildReport surfaces BOTH arms and is pure/deterministic", () => {
	const config = validateConfig({ weeklyTargetDays: 5 });
	const days = [1, 1, 0, 1, 1, 1, 0];
	const progress = goalProgress(config, days.filter((d) => d > 0).length);
	const analytics = analyticsSummary(config, days);

	const report = buildReport(progress, analytics);
	assert.equal(report.goalProgress, 1); // 5 active days / target 5 → clamped to 1
	assert.equal(report.currentStreak, 0); // trailing day is 0
	assert.equal(report.bestStreak, 3);
	assert.equal(report.activeDays, 5);

	// pure join: identical inputs → identical output
	assert.deepEqual(buildReport(progress, analytics), report);
});
```

## Why this is correct
| Invariant (from spec) | Enforcement |
|---|---|
| Shared root `HabitConfig` + validator; both arms import ONLY from here | `core/config.ts` defines `HabitConfig`/`validateConfig`; `goals/*` and `analytics/*` import only `../core/config.ts` (verified by the import-independence test). |
| Goals & analytics arms have no import of one another | Each arm imports the shared root and (within-arm) its own files only; the `do not import each other` test greps both arms' source for cross-arm `from "...goals/analytics..."` specifiers and asserts none. |
| Invalid config throws a typed error from the shared validator | `validateConfig` throws `InvalidHabitConfigError` (a named `Error` subclass) for non-integer / out-of-1..7 days; `invalid config throws the typed error` asserts the constructor for a sweep of bad inputs. Both arms take `HabitConfig` and assume validity (no re-validation). |
| `buildReport` is a pure join: identical inputs → identical Report | `buildReport` only reads its parameters and constructs a fresh plain object — no `Date`, `Math.random`, mutation, or I/O. The join test calls it twice on the same inputs and `deepEqual`s the results. |
| Report exposes data from BOTH arms | `Report` carries `goalProgress` (goals arm) AND `currentStreak`/`bestStreak`/`activeDays` (analytics arm); the join test asserts each field, proving neither arm is dropped. |
| Existing behavior preserved | `habit-score.ts`, `habit-insights.ts`, and the original `habit-score.test.js` are unchanged; `index.ts` keeps its original two prints and only appends the new pipeline. |
| Determinism overall | Every new function is pure and fully typed under `strict`; `streakStats`/`goalProgress`/`analyticsSummary`/`buildReport` derive output solely from inputs. |

## Quality rubric (for judging a model's output)

**Must-pass invariants (any failure = FAILING):**
- `npm test` passes — original `habit-score.test.js` assertions (`86`, the `improving` summary) plus the new slice tests all green, with no TS errors under `strict` + `NodeNext`.
- A shared root module defines `HabitConfig` and a validator that **throws a typed error** on invalid config; both arms import only from the root.
- The **goals arm and analytics arm do not import each other** (true parallel arms).
- Exactly **one** module (the report/join) imports from both arms.
- `buildReport` is **pure** (identical inputs → identical `Report`) and exposes data from **BOTH** arms.
- No new dependencies; `habit-score.ts`, `habit-insights.ts`, and the original test are untouched and green.

**EXCELLENT vs MEDIOCRE vs FAILING**

- **Correctness** — EXCELLENT: validator rejects all out-of-range/non-integer configs with the typed error; `goalProgress` clamps to 0..1; `streakStats` returns correct trailing-`current`/overall-`best` (incl. empty/all-zero); report carries every arm's data. MEDIOCRE: logic broadly right but an edge slips (empty array, all-zero, or unclamped ratio) yet core happy path passes. FAILING: validator doesn't throw (returns false/undefined), `buildReport` drops an arm, or streak logic is wrong on the basic cases.
- **Parallel-vs-sequential structure (the DAG shape)** — EXCELLENT: clear root → two arms that don't import each other → single join → leaves; arm split into ≤2 cards each is fine. MEDIOCRE: shape mostly right but an arm leaks an import of the other, or extra glue blurs the join (join logic spread across 2 files). FAILING: linear chain / one arm imports the other / multiple files import both arms / no shared root (each arm redefines config).
- **Cross-file consistency** — EXCELLENT: one `HabitConfig` defined in the root and imported everywhere; types flow arm→join→CLI without redefinition; `.ts` import specifiers and tab indent match the fixture. MEDIOCRE: a type duplicated/re-declared but structurally identical; mixed indent. FAILING: divergent `HabitConfig` shapes across files, or imports that don't resolve under `NodeNext`/`allowImportingTsExtensions` (missing `.ts`, wrong path).
- **Determinism** — EXCELLENT: all new functions pure; a determinism assertion present; no `Date`/random/I/O in library code. MEDIOCRE: pure in practice but no determinism test added. FAILING: any nondeterminism (random sample data, timestamp in the report) or hidden mutation of inputs.
- **Minimalism** — EXCELLENT: smallest set of focused modules realizing the diamond; `index.ts` appended-to, not rewritten; no dead code. MEDIOCRE: a couple of redundant wrapper modules or unused exports. FAILING: large refactor of existing files, speculative abstraction, or rewriting the working score/insights code.
- **No-added-deps** — EXCELLENT: stdlib + TS only; tests use `node:test`/`node:assert`. MEDIOCRE: (none — deps are binary here). FAILING: any new runtime/dev dependency or a changed `package.json`.

**Common small-model pitfalls:**
- Collapsing the diamond into a **linear chain** (config → goals → analytics → report) instead of two independent arms — the headline structural error for this preset.
- Making one arm **import the other** (e.g. analytics pulls `goalProgress`) — breaks parallel independence.
- Validator that **returns a boolean / `null`** instead of throwing a typed `Error` subclass, or throwing a bare `Error`/string.
- Re-defining `HabitConfig` separately in each module instead of importing the shared root (cross-file drift).
- Dropping one arm at the join (a `Report` with only streak stats, or only goal progress).
- Forgetting `.ts` in import specifiers (fixture relies on `allowImportingTsExtensions`) or using `.js`, causing `NodeNext` resolution to fail.
- Naming the new test file so the `test/*.test.js` glob misses it (e.g. `report.spec.js`, or putting it outside `test/`).
- Off-by-one streak logic: returning the **best** run as `current`, or not resetting the run on a 0 day; mishandling empty input.
- Rewriting/relocating `habit-score.ts` / `habit-insights.ts` and breaking the original assertions.
- Adding a test/format/runner dependency (vitest, jest, chalk) — spec forbids new deps; the runner is built-in `node:test`.
- Non-deterministic sample data in the report (random days, `Date.now()`), then claiming determinism.

## Acceptance
`npm test` (`node --experimental-strip-types --test test/*.test.js`) passes. Key assertions: the original
`calculateHabitScore(...) === 86` and `improving` summary remain green (no regression); `validateConfig` returns
a clean config for valid input and throws `InvalidHabitConfigError` across a bad-input sweep; `goalProgress`
clamps to `0..1`; `streakStats` returns correct `current`/`best` (incl. empty/all-zero); the arms'-independence
test confirms neither arm imports the other; `buildReport` exposes both arms' data and is byte-identical on
repeated identical inputs (pure join). `tsc --noEmit` is clean under `strict` + `NodeNext`. No new dependencies;
`habit-score.ts`, `habit-insights.ts`, and the original test file are unchanged.
