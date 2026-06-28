# Reference Solution — habit-product-nklein-complex

## Task
Grow the tiny habit-scoring CLI into a typed habit-insights product slice. Add validated weekly `GoalSettings`, a reusable trend classifier with an `insufficient-data` outcome, a `ScoreBand` derived from the 0–100 score via non-overlapping thresholds, and `Recommendation` text that depends on (band, trend, goal). Update the CLI to print score/trend/recommendation and to support a dependency-free `--json` mode, then expand deterministic tests and the README. Every public function must be pure; text and JSON must describe the same underlying summary.

## Suggested decomposition
A strong agent decomposes this into ~12 independently reviewable cards. The real dependency edges:

1. **Document domain model** — JSDoc/README of `HabitScoreInput` + `calculateHabitScore` and extension points. *(no deps)*
2. **Parse `--goal` CLI arg** — pure `parseGoalArg(argv)` → raw `{weeklyTargetDays, minStreakForBonus}`. *(no deps)*
3. **Validate `GoalSettings`** — `validateGoalSettings(raw)` throws typed `GoalSettingsError`; never clamps. *(no deps)*
4. **Classify trend** — `classifyTrend(current, previous|null)` → `TrendClass`. *(no deps)*
5. **Integrate goals into insights** — `summarizeHabitWeek` consumes validated goal + trend. *(deps: 3, 4)*
6. **Classify score bands** — `classifyScoreBand(score)` → `ScoreBand`, partitioned thresholds. *(no deps)*
7. **Define recommendation inputs** — `RecommendationContext { band, trend, goal }` type. *(deps: 6)*
8. **Implement recommendations** — pure `recommend(ctx)` → `Recommendation`. *(deps: 6, 7)*
9. **Update text output** — CLI prints score, band, trend, recommendation. *(deps: 8)*
10. **Add `--json` output** — same summary serialized; no new deps. *(deps: 8)*
11. **Expand tests** — improving/declining/steady/insufficient-data/invalid-input/perfect-cap/band-partition/text≡json. *(deps: every impl card)*
12. **Update README** — text + JSON usage. *(deps: 9, 10)*

Cards 5/8/9/10 are the join points; 11 fans in from all of them. Collapsing capabilities into one card, or inventing edges (e.g. making band-classification depend on trend), is a decomposition smell.

## Reference implementation

### `src/habit-score.ts`
```ts
export interface HabitScoreInput {
	completedDays: number;
	targetDays: number;
	streakDays: number;
}

/**
 * Domain model: a habit week scored 0–100.
 * Score = completion ratio (clamped 0..1) + streak bonus (max +0.2),
 * rounded then capped to [0, 100]. A perfect week (completedDays >= targetDays)
 * with no streak still yields 100; the cap guarantees the bonus never exceeds 100.
 *
 * Extension points: `calculateHabitScore` is pure and total — wrap it (do not edit)
 * to add bands, trends, or recommendations on top of the raw score.
 */
export function calculateHabitScore(input: HabitScoreInput): number {
	if (input.targetDays <= 0) {
		return 0;
	}
	const completionRatio = Math.max(0, Math.min(1, input.completedDays / input.targetDays));
	const streakBonus = Math.min(0.2, Math.max(0, input.streakDays) * 0.02);
	const score = Math.round((completionRatio + streakBonus) * 100);
	return Math.max(0, Math.min(100, score));
}
```

### `src/goal-settings.ts` (new)
```ts
export interface GoalSettings {
	weeklyTargetDays: number;
	minStreakForBonus: number;
}

/** Typed error so callers can distinguish validation failures from other throws. */
export class GoalSettingsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GoalSettingsError";
	}
}

function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

/**
 * Validate user-supplied goal configuration. Never silently clamps:
 * out-of-range or non-integer values throw GoalSettingsError with a clear message.
 */
export function validateGoalSettings(raw: Partial<GoalSettings>): GoalSettings {
	const { weeklyTargetDays, minStreakForBonus } = raw;

	if (!isInteger(weeklyTargetDays) || weeklyTargetDays < 1 || weeklyTargetDays > 7) {
		throw new GoalSettingsError(
			`weeklyTargetDays must be an integer in 1..7, received ${String(weeklyTargetDays)}`,
		);
	}
	if (!isInteger(minStreakForBonus) || minStreakForBonus < 0) {
		throw new GoalSettingsError(
			`minStreakForBonus must be an integer >= 0, received ${String(minStreakForBonus)}`,
		);
	}

	return { weeklyTargetDays, minStreakForBonus };
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
	weeklyTargetDays: 5,
	minStreakForBonus: 3,
};
```

### `src/habit-insights.ts`
```ts
import { calculateHabitScore, type HabitScoreInput } from "./habit-score.ts";
import {
	DEFAULT_GOAL_SETTINGS,
	validateGoalSettings,
	type GoalSettings,
} from "./goal-settings.ts";

export type TrendClass = "improving" | "declining" | "steady" | "insufficient-data";
export type ScoreBand = "low" | "fair" | "good" | "excellent";

export interface WeeklyHabitInput extends HabitScoreInput {
	/** Prior-week completions, or null/undefined when no prior week exists. */
	previousCompletedDays?: number | null;
}

export interface Recommendation {
	text: string;
	reason: string;
}

export interface HabitInsightSummary {
	score: number;
	band: ScoreBand;
	trend: TrendClass;
	goal: GoalSettings;
	recommendation: Recommendation;
}

export interface RecommendationContext {
	band: ScoreBand;
	trend: TrendClass;
	goal: GoalSettings;
}

/**
 * Trend from the completion delta. `insufficient-data` is returned ONLY when there
 * is no prior week to compare (previous is null/undefined); otherwise improving/
 * declining/steady from sign(current - previous).
 */
export function classifyTrend(current: number, previous: number | null | undefined): TrendClass {
	if (previous === null || previous === undefined) {
		return "insufficient-data";
	}
	const delta = current - previous;
	if (delta > 0) return "improving";
	if (delta < 0) return "declining";
	return "steady";
}

/**
 * Partition of [0, 100] into four bands — no gaps, no overlaps:
 *   low [0,39] · fair [40,69] · good [70,89] · excellent [90,100].
 */
export function classifyScoreBand(score: number): ScoreBand {
	if (score < 40) return "low";
	if (score < 70) return "fair";
	if (score < 90) return "good";
	return "excellent";
}

/** Pure recommendation: identical context always yields identical text + reason. */
export function recommend(ctx: RecommendationContext): Recommendation {
	const { band, trend, goal } = ctx;

	if (trend === "declining") {
		return {
			text: `Reduce this week's target below ${goal.weeklyTargetDays} days and rebuild consistency.`,
			reason: `Completions fell (${trend}) while in the ${band} band.`,
		};
	}
	if (band === "excellent") {
		return {
			text: `Hold the ${goal.weeklyTargetDays}-day target and protect your streak past ${goal.minStreakForBonus} days.`,
			reason: `Strong result: ${band} band, trend ${trend}.`,
		};
	}
	if (trend === "improving") {
		return {
			text: `Keep momentum visible and aim for the full ${goal.weeklyTargetDays}-day target.`,
			reason: `Improving toward goal from the ${band} band.`,
		};
	}
	if (trend === "insufficient-data") {
		return {
			text: `Log another week to establish a trend against the ${goal.weeklyTargetDays}-day target.`,
			reason: `No prior week to compare; current band is ${band}.`,
		};
	}
	return {
		text: `Maintain the routine and watch for missed days before the streak resets.`,
		reason: `Steady at the ${band} band against a ${goal.weeklyTargetDays}-day goal.`,
	};
}

/**
 * Single source of truth for both text and JSON output. Validates the goal
 * (throwing on invalid settings) so no caller can build a summary from bad config.
 */
export function summarizeHabitWeek(
	input: WeeklyHabitInput,
	goal: GoalSettings = DEFAULT_GOAL_SETTINGS,
): HabitInsightSummary {
	const validatedGoal = validateGoalSettings(goal);
	const score = calculateHabitScore(input);
	const band = classifyScoreBand(score);
	const trend = classifyTrend(input.completedDays, input.previousCompletedDays);
	const recommendation = recommend({ band, trend, goal: validatedGoal });
	return { score, band, trend, goal: validatedGoal, recommendation };
}
```

### `src/index.ts`
```ts
import { summarizeHabitWeek, type WeeklyHabitInput } from "./habit-insights.ts";
import {
	DEFAULT_GOAL_SETTINGS,
	validateGoalSettings,
	type GoalSettings,
} from "./goal-settings.ts";

/** Parse `--goal=target,minStreak` (e.g. --goal=5,3). Returns null when absent. */
export function parseGoalArg(argv: readonly string[]): GoalSettings | null {
	const flag = argv.find((a) => a === "--goal" || a.startsWith("--goal="));
	if (!flag) return null;
	const raw = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : "";
	const [target, minStreak] = raw.split(",");
	return validateGoalSettings({
		weeklyTargetDays: Number(target),
		minStreakForBonus: Number(minStreak),
	});
}

function main(argv: readonly string[]): void {
	const input: WeeklyHabitInput = {
		completedDays: 4,
		previousCompletedDays: 3,
		targetDays: 5,
		streakDays: 3,
	};
	const goal = parseGoalArg(argv) ?? DEFAULT_GOAL_SETTINGS;
	const summary = summarizeHabitWeek(input, goal);

	if (argv.includes("--json")) {
		console.log(JSON.stringify(summary, null, 2));
		return;
	}

	console.log(`habit score: ${summary.score} (${summary.band})`);
	console.log(`trend: ${summary.trend}`);
	console.log(`recommendation: ${summary.recommendation.text}`);
	console.log(`  why: ${summary.recommendation.reason}`);
}

main(process.argv.slice(2));
```

### `test/habit-score.test.js`
```js
import test from "node:test";
import assert from "node:assert/strict";
import { calculateHabitScore } from "../src/habit-score.ts";
import {
	summarizeHabitWeek,
	classifyTrend,
	classifyScoreBand,
} from "../src/habit-insights.ts";
import {
	validateGoalSettings,
	GoalSettingsError,
	DEFAULT_GOAL_SETTINGS,
} from "../src/goal-settings.ts";

test("calculates a bounded habit score with a small streak bonus", () => {
	assert.equal(
		calculateHabitScore({ completedDays: 4, targetDays: 5, streakDays: 3 }),
		86,
	);
});

test("score is bounded 0..100 and a perfect week is capped at exactly 100", () => {
	for (const streak of [0, 3, 50]) {
		const s = calculateHabitScore({ completedDays: 7, targetDays: 7, streakDays: streak });
		assert.ok(s >= 0 && s <= 100);
	}
	assert.equal(
		calculateHabitScore({ completedDays: 7, targetDays: 7, streakDays: 0 }),
		100,
	);
	assert.equal(
		calculateHabitScore({ completedDays: 7, targetDays: 7, streakDays: 50 }),
		100,
	);
});

test("score bands partition 0..100 with no gaps or overlaps", () => {
	const expected = (n) =>
		n < 40 ? "low" : n < 70 ? "fair" : n < 90 ? "good" : "excellent";
	for (let n = 0; n <= 100; n++) {
		assert.equal(classifyScoreBand(n), expected(n));
	}
	assert.equal(classifyScoreBand(39), "low");
	assert.equal(classifyScoreBand(40), "fair");
	assert.equal(classifyScoreBand(69), "fair");
	assert.equal(classifyScoreBand(70), "good");
	assert.equal(classifyScoreBand(89), "good");
	assert.equal(classifyScoreBand(90), "excellent");
});

test("classifies improving, declining, steady, and insufficient-data trends", () => {
	assert.equal(classifyTrend(4, 2), "improving");
	assert.equal(classifyTrend(2, 4), "declining");
	assert.equal(classifyTrend(3, 3), "steady");
	assert.equal(classifyTrend(3, null), "insufficient-data");
	assert.equal(classifyTrend(3, undefined), "insufficient-data");
});

test("summarizes weekly habit direction (improving)", () => {
	const summary = summarizeHabitWeek({
		completedDays: 4,
		previousCompletedDays: 2,
		targetDays: 5,
		streakDays: 3,
	});
	assert.equal(summary.score, 86);
	assert.equal(summary.band, "good");
	assert.equal(summary.trend, "improving");
	assert.equal(typeof summary.recommendation.text, "string");
	assert.ok(summary.recommendation.text.length > 0);
});

test("declining and steady summaries are deterministic", () => {
	const declining = summarizeHabitWeek({
		completedDays: 1,
		previousCompletedDays: 4,
		targetDays: 5,
		streakDays: 0,
	});
	assert.equal(declining.trend, "declining");
	assert.deepEqual(
		declining.recommendation,
		summarizeHabitWeek({
			completedDays: 1,
			previousCompletedDays: 4,
			targetDays: 5,
			streakDays: 0,
		}).recommendation,
	);

	const steady = summarizeHabitWeek({
		completedDays: 3,
		previousCompletedDays: 3,
		targetDays: 5,
		streakDays: 1,
	});
	assert.equal(steady.trend, "steady");
});

test("invalid goal settings throw a typed error and never clamp", () => {
	for (const bad of [
		{ weeklyTargetDays: 0, minStreakForBonus: 0 },
		{ weeklyTargetDays: 8, minStreakForBonus: 0 },
		{ weeklyTargetDays: 3.5, minStreakForBonus: 0 },
		{ weeklyTargetDays: 5, minStreakForBonus: -1 },
		{ weeklyTargetDays: 5, minStreakForBonus: 2.5 },
	]) {
		assert.throws(() => validateGoalSettings(bad), GoalSettingsError);
	}
	assert.deepEqual(validateGoalSettings(DEFAULT_GOAL_SETTINGS), DEFAULT_GOAL_SETTINGS);
});

test("text and json output describe the same summary", () => {
	const input = {
		completedDays: 4,
		previousCompletedDays: 3,
		targetDays: 5,
		streakDays: 3,
	};
	const summary = summarizeHabitWeek(input);
	const roundTripped = JSON.parse(JSON.stringify(summary));
	assert.deepEqual(roundTripped, summary);
});
```

### `README.md` (new / appended)
```md
## Habit insights CLI

```bash
# Text output (default)
node --experimental-strip-types src/index.ts

# With a custom weekly goal: --goal=<weeklyTargetDays 1..7>,<minStreakForBonus >=0>
node --experimental-strip-types src/index.ts --goal=6,4

# JSON output (same summary, machine-readable, no extra dependencies)
node --experimental-strip-types src/index.ts --json
```

Text and `--json` describe the **same** summary: `score`, `band`
(`low`/`fair`/`good`/`excellent`), `trend`
(`improving`/`declining`/`steady`/`insufficient-data`), the validated `goal`,
and a `recommendation` (`text` + `reason`). Invalid `--goal` values throw a
`GoalSettingsError` instead of being silently clamped.
```

## Why this is correct
- **0 ≤ score ≤ 100; perfect week = 100** — `calculateHabitScore` ends in `Math.max(0, Math.min(100, score))`; with `completedDays >= targetDays` the ratio is clamped to 1 and the result floors/caps at 100. The added cap keeps the existing `86` assertion green (ratio 0.8 + bonus 0.06).
- **Bands partition 0..100, no gaps/overlaps** — `classifyScoreBand` uses strictly ascending half-open cutoffs `<40 / <70 / <90 / else`; every integer maps to exactly one band (asserted for all 0..100).
- **`insufficient-data` only with no prior week** — `classifyTrend` returns it *only* when `previous` is null/undefined; otherwise sign of the delta picks improving/declining/steady.
- **Validation throws, never clamps** — `validateGoalSettings` checks integer + range and throws `GoalSettingsError`; there is no clamping branch.
- **Recommendation depends on (band, trend, goal)** — `recommend(ctx)` branches on all three and interpolates goal fields; it is a pure function (no clock/random/IO), so text is stable.
- **Text ≡ JSON** — both `index.ts` paths render the single `HabitInsightSummary` returned by `summarizeHabitWeek`; the JSON path serializes that exact object, so they cannot diverge.
- **Purity** — every exported function is a deterministic pure function of its arguments; `main` is the only IO boundary.
- **No new deps** — JSON uses built-in `JSON.stringify`; package.json is unchanged.

## Quality rubric (for judging a model's output)

**Must-pass invariants**
- `npm test` passes; the two original assertions (`86`, improving summary) remain green.
- Score clamped to [0,100]; perfect week is exactly 100.
- Bands cover 0..100 with no gap/overlap; thresholds documented.
- `insufficient-data` emitted only when there is no prior week.
- Invalid `GoalSettings` throw a typed error; no clamping.
- Recommendation is a pure function of (band, trend, goal); stable text.
- Text and `--json` describe the same summary.
- No added runtime dependencies.

**EXCELLENT** — Clean typed entities matching the spec names (`GoalSettings`, `TrendClass`, `ScoreBand`, `Recommendation`); a single `summarizeHabitWeek` feeding both output modes; small pure helpers (`classifyTrend`, `classifyScoreBand`, `recommend`, `validateGoalSettings`); tests cover improving/declining/steady/insufficient-data/invalid/perfect-cap plus the band-partition and text≡json invariants; decomposition mirrors the real DAG (5←{3,4}, 8←{6,7}, 9/10←8, 11←all, 12←{9,10}).

**MEDIOCRE** — Works but blurs structure: trend/band logic inlined in the CLI, recommendation strings duplicated between text and JSON, `--json` reconstructed independently (divergence risk), validation present but clamps or throws a plain `Error`, tests cover only the happy path, decomposition lumps several capabilities per card.

**FAILING** — Any must-pass invariant broken: score can exceed 100, bands overlap/leave gaps, `insufficient-data` conflated with `steady`, invalid goals silently clamped, text and JSON diverge, recommendation depends on a clock/random, an external dependency added, or the original tests break.

**Common small-model pitfalls**
- Forgetting the `Math.min(100, …)` cap, so a perfect week with a streak yields >100.
- Off-by-one band boundaries (e.g. `<=`/`<` mix) that overlap at 40/70/90.
- Treating "no prior week" the same as a zero delta → wrongly returning `steady`.
- Clamping invalid goals (or returning defaults) instead of throwing.
- Rebuilding the JSON summary separately from the text path, letting them drift.
- Adding a CLI/JSON/validation library when stdlib suffices.
- Non-deterministic recommendation text (timestamps, `Math.random`, locale formatting).
- Editing `calculateHabitScore`'s core math and breaking the `86` assertion.

## Acceptance
`npm test` (= `node --experimental-strip-types --test test/*.test.js`) passes. Key assertions: original `86` score and improving summary remain green; score bounded 0..100 with perfect week = 100; band partition verified across all 0..100; the four trend classes including `insufficient-data`; typed `GoalSettingsError` on five invalid configs with no clamping; and text/JSON describing one identical summary (JSON round-trip `deepEqual`).
