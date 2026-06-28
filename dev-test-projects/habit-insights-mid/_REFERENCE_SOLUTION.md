# Reference solution — habit-insights-mid

## Task
Extend the existing TypeScript habit CLI so `calculateHabitScore` clamps to an integer 0–100 (a perfect week with a long streak returns exactly 100), `summarizeHabitWeek` classifies `trend` (`improving`/`declining`/`steady`) from the completion delta and returns a deterministic `recommendation` keyed off that trend, and `index.ts` prints score, trend, and recommendation. Existing tests stay green; new deterministic invariant assertions are added. No new dependencies.

## Reference implementation

The starting fixture is already close: `summarizeHabitWeek` and its recommendation text are correct as-is. The only behavioral bug is that `calculateHabitScore` can exceed 100 (a perfect week yields `round((1 + 0.2) * 100) = 120`). The minimal correct change is a final clamp in `calculateHabitScore`; `habit-insights.ts` is left unchanged; `index.ts` gains the recommendation line; the test file gains invariant assertions.

### src/habit-score.ts
```ts
export interface HabitScoreInput {
	completedDays: number;
	targetDays: number;
	streakDays: number;
}

export function calculateHabitScore(input: HabitScoreInput): number {
	if (input.targetDays <= 0) {
		return 0;
	}
	const completionRatio = Math.max(0, Math.min(1, input.completedDays / input.targetDays));
	const streakBonus = Math.min(0.2, Math.max(0, input.streakDays) * 0.02);
	const raw = Math.round((completionRatio + streakBonus) * 100);
	return Math.max(0, Math.min(100, raw));
}
```

### src/habit-insights.ts
```ts
import { calculateHabitScore, type HabitScoreInput } from "./habit-score.ts";

export interface WeeklyHabitInput extends HabitScoreInput {
	previousCompletedDays: number;
}

export interface HabitInsightSummary {
	score: number;
	trend: "improving" | "declining" | "steady";
	recommendation: string;
}

export function summarizeHabitWeek(input: WeeklyHabitInput): HabitInsightSummary {
	const score = calculateHabitScore(input);
	const delta = input.completedDays - input.previousCompletedDays;
	const trend = delta > 0 ? "improving" : delta < 0 ? "declining" : "steady";
	const recommendation =
		trend === "improving"
			? "Keep the streak visible and protect the next habit window."
			: trend === "declining"
				? "Reduce the target for one week and recover consistency."
				: "Maintain the current routine and watch for missed days.";
	return {
		score,
		trend,
		recommendation,
	};
}
```

### src/index.ts
```ts
import { summarizeHabitWeek } from "./habit-insights.ts";

const summary = summarizeHabitWeek({
	completedDays: 4,
	previousCompletedDays: 3,
	targetDays: 5,
	streakDays: 3,
});

console.log(`habit score: ${summary.score}`);
console.log(`trend: ${summary.trend}`);
console.log(`recommendation: ${summary.recommendation}`);
```

### test/habit-score.test.js
```js
import test from "node:test";
import assert from "node:assert/strict";
import { calculateHabitScore } from "../src/habit-score.ts";
import { summarizeHabitWeek } from "../src/habit-insights.ts";

test("calculates a bounded habit score with a small streak bonus", () => {
	assert.equal(
		calculateHabitScore({
			completedDays: 4,
			targetDays: 5,
			streakDays: 3,
		}),
		86,
	);
});

test("clamps a perfect week with a long streak to exactly 100", () => {
	assert.equal(
		calculateHabitScore({
			completedDays: 7,
			targetDays: 7,
			streakDays: 30,
		}),
		100,
	);
});

test("never produces a score outside 0..100", () => {
	const cases = [
		{ completedDays: 0, targetDays: 0, streakDays: 0 },
		{ completedDays: -5, targetDays: 5, streakDays: -3 },
		{ completedDays: 99, targetDays: 5, streakDays: 99 },
		{ completedDays: 5, targetDays: 5, streakDays: 0 },
	];
	for (const input of cases) {
		const score = calculateHabitScore(input);
		assert.ok(Number.isInteger(score), `score is an integer for ${JSON.stringify(input)}`);
		assert.ok(score >= 0 && score <= 100, `0 <= ${score} <= 100 for ${JSON.stringify(input)}`);
	}
});

test("summarizes weekly habit direction", () => {
	assert.deepEqual(
		summarizeHabitWeek({
			completedDays: 4,
			previousCompletedDays: 2,
			targetDays: 5,
			streakDays: 3,
		}),
		{
			score: 86,
			trend: "improving",
			recommendation: "Keep the streak visible and protect the next habit window.",
		},
	);
});

test("trend matches the sign of the completion delta", () => {
	const base = { targetDays: 5, streakDays: 2 };
	assert.equal(
		summarizeHabitWeek({ ...base, completedDays: 4, previousCompletedDays: 2 }).trend,
		"improving",
	);
	assert.equal(
		summarizeHabitWeek({ ...base, completedDays: 1, previousCompletedDays: 4 }).trend,
		"declining",
	);
	assert.equal(
		summarizeHabitWeek({ ...base, completedDays: 3, previousCompletedDays: 3 }).trend,
		"steady",
	);
});

test("is deterministic: same input yields an identical summary", () => {
	const input = {
		completedDays: 4,
		previousCompletedDays: 2,
		targetDays: 5,
		streakDays: 3,
	};
	assert.deepEqual(summarizeHabitWeek(input), summarizeHabitWeek(input));
});
```

## Why this is correct
- **Score clamp (0 ≤ score ≤ 100, perfect week = 100):** `calculateHabitScore` wraps the rounded value in `Math.max(0, Math.min(100, raw))`. Without it, `completionRatio` is already capped at 1 but `streakBonus` adds up to 0.2, so a perfect week rounds to 120; the final clamp pins it to 100. The lower bound and the `targetDays <= 0 → 0` guard cover degenerate/negative inputs. Enforced by the `clamps a perfect week...` and `never produces a score outside 0..100` tests.
- **Trend sign:** `delta = completedDays - previousCompletedDays`; `trend = delta > 0 ? improving : delta < 0 ? declining : steady`. This is exactly the sign of the delta, with zero mapped to `steady`. Enforced by `trend matches the sign of the completion delta`.
- **Determinism / purity:** both functions are pure — output depends only on the typed input, no `Date`, `Math.random`, I/O, or mutation. The `recommendation` is a fixed string per trend branch (no interpolation of variable data), so identical input always yields an identical summary. Enforced by `is deterministic: same input yields an identical summary` and by the exact-string `deepEqual` in `summarizes weekly habit direction`.
- **CLI output:** `index.ts` prints `score`, `trend`, and `recommendation` in a compact `label: value` form, satisfying the "update the CLI output" requirement without altering the library contract.
- **Existing test preserved:** the original `86` and `improving` summary assertions remain valid (4/5 = 0.8 ratio + min(0.2, 0.06) bonus → round(0.86·100) = 86), so no regression.

## Quality rubric (for judging a model's output)

**Must-pass invariants (any failure = FAILING):**
- `npm test` passes (all assertions green, no TS/type errors under the strict config).
- `calculateHabitScore` returns an integer in `[0, 100]` for all inputs; perfect week (`completedDays === targetDays`, large `streakDays`) returns exactly `100`.
- `trend` ∈ `{improving, declining, steady}` and equals the sign of `completedDays - previousCompletedDays` (zero → `steady`).
- `recommendation` is a deterministic fixed string per trend; identical input ⇒ identical summary.
- `index.ts` prints score, trend, AND recommendation.
- No new dependencies; only `src/habit-score.ts`, `src/habit-insights.ts`, `src/index.ts`, `test/habit-score.test.js` touched.

**EXCELLENT:** Minimal diff — clamp added with `Math.min/max` (or equivalent), unchanged correct trend logic, CLI prints all three fields, tests add genuine invariant coverage (perfect-week clamp, out-of-range sweep, trend-sign cases, determinism) while keeping the original two assertions. Functions stay pure and fully typed (interfaces reused, literal union for trend). Clean, no dead code.

**MEDIOCRE:** Works but over- or under-done — clamp implemented redundantly or only on the upper bound; recommendation made non-deterministic-looking (e.g. embeds the score/delta in the string) yet still stable; tests added but weak (re-asserts only the existing `86` case, no perfect-week or range coverage); CLI output present but cluttered; minor type looseness (`string` literal widened, `any`).

**FAILING:** Score can exceed 100 (no clamp) or perfect week ≠ 100; trend sign inverted or zero mis-mapped; non-deterministic recommendation (random/date/`Math.random`); original tests broken; recommendation or trend dropped; CLI omits recommendation; new dependency added; files outside scope modified; type errors under `strict`.

**Common small-model pitfalls:**
- Forgetting the upper clamp because `completionRatio` already caps at 1 — missing that the streak bonus pushes past 100.
- Clamping before adding the bonus (still overflows) instead of clamping the final value.
- Rewriting the already-correct `summarizeHabitWeek` and accidentally changing the recommendation strings, breaking the exact-string `deepEqual`.
- Inverting the ternary (`delta < 0 → improving`) or using `>=`/`<=` so the steady case is never reached.
- Making recommendation dynamic (template-stringing the score) and calling it "deterministic".
- Adding a formatting/CLI dependency (chalk, etc.) — spec forbids new deps.
- Returning a non-integer score (dropping `Math.round`) or letting negative inputs produce a negative score.

## Acceptance
`npm test` (`node --experimental-strip-types --test test/*.test.js`) passes. Key assertions: original score `86` and the `improving` summary remain green; `calculateHabitScore({7,7,30}) === 100` proves the clamp; the range-sweep proves `0 ≤ integer score ≤ 100` for negative/zero/extreme inputs; the trend-sign test proves the delta-sign mapping including `steady`; the determinism test proves stable, pure output. No new dependencies; only the four in-scope files change.
