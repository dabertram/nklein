# Reference Solution — small-model-smoke

## Task
Fix a scoring bug in `src/habit-score.ts`: when a user completes every day and has a long streak, the streak bonus pushes the returned score above 100. Cap the final score at 100 (it is already floored at 0), and add an acceptance test asserting the perfect-week-capped case. Touch only `src/habit-score.ts` and `test/habit-score.test.js`; add no dependencies; keep existing tests green.

## Reference implementation

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
	const score = Math.round((completionRatio + streakBonus) * 100);
	return Math.max(0, Math.min(100, score));
}
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

test("caps a perfect week with a long streak at 100", () => {
	assert.equal(
		calculateHabitScore({
			completedDays: 5,
			targetDays: 5,
			streakDays: 30,
		}),
		100,
	);
});

test("clamps the score to the 0-100 range for all inputs", () => {
	const cases = [
		{ completedDays: 0, targetDays: 0, streakDays: 0 },
		{ completedDays: 5, targetDays: 5, streakDays: 100 },
		{ completedDays: 7, targetDays: 5, streakDays: 50 },
		{ completedDays: -3, targetDays: 5, streakDays: -10 },
		{ completedDays: 4, targetDays: 5, streakDays: 3 },
	];
	for (const input of cases) {
		const score = calculateHabitScore(input);
		assert.ok(score >= 0 && score <= 100, `score ${score} out of range for ${JSON.stringify(input)}`);
		assert.ok(Number.isInteger(score), `score ${score} not an integer for ${JSON.stringify(input)}`);
	}
});

test("returns 0 for a zero or negative target", () => {
	assert.equal(calculateHabitScore({ completedDays: 4, targetDays: 0, streakDays: 3 }), 0);
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
```

## Why this is correct
- **`0 <= score <= 100` for every input** — the final `Math.max(0, Math.min(100, score))` clamps the rounded result into range. `completionRatio` is already clamped to `[0,1]` and `streakBonus` to `[0,0.2]`, so the only escape was the perfect-week-plus-streak case exceeding 1.0; the final clamp closes it. The "clamps the score to the 0-100 range" test exercises a representative spread (zero target, perfect week + huge streak, over-completion, negative inputs, ordinary case) and asserts both bounds and integerness.
- **Perfect week returns exactly 100, never more** — for `completedDays === targetDays`, `completionRatio === 1`; any `streakBonus >= 0` would yield `round((1 + bonus) * 100) >= 100`, and the clamp forces exactly 100. Enforced by the "caps a perfect week with a long streak at 100" test (`streakDays: 30`, raw would be 120).
- **`targetDays <= 0` returns 0** — the early-return guard is preserved unchanged; covered by the "returns 0 for a zero or negative target" test and the zero-target entry in the range test.
- **Existing tests stay green** — the `86` case (`ratio 0.8 + bonus 0.06 → 86`, below the cap) and the `summarizeHabitWeek` deep-equal case are unchanged and unaffected by the clamp. Only `src/habit-score.ts` and `test/habit-score.test.js` change; `habit-insights.ts`, `index.ts`, configs, and `package.json` are untouched. No dependencies added.

## Quality rubric (for judging a model's output)
Must-pass invariants:
- `calculateHabitScore` returns an integer in `[0, 100]` for all inputs, including negatives and over-completion.
- Perfect week (`completedDays === targetDays`) with any `streakDays` returns exactly `100`.
- `targetDays <= 0` still returns `0` (early guard kept).
- Both original tests still pass (the `86` assertion and the `summarizeHabitWeek` deep-equal).
- A new test asserts the perfect-week cap; ideally a bounds test asserting `0 <= score <= 100` across multiple inputs (the spec literally says the test must assert the invariant).
- Only `src/habit-score.ts` and `test/habit-score.test.js` are modified; no new dependencies.

EXCELLENT: minimal single-line fix via a final `Math.max(0, Math.min(100, score))` (or equivalent clamp on the rounded value); preserves the existing structure and the early guard; adds a precise perfect-week-capped test plus a property-style range/integer assertion; no edits outside the two allowed files.

MEDIOCRE: caps correctly but with redundant or awkward logic (e.g. duplicating the clamp, `if (score > 100) score = 100` without a lower bound, capping the bonus instead of the result so other paths can still drift); adds only a single narrow test; leaves a stray import or formatting churn but stays within the two files.

FAILING: score can still exceed 100 (no final cap, or only the bonus is reduced but `completionRatio + bonus` can still round above 1.0 in some path); breaks an existing test (e.g. changes the `86` value); removes/weakens the `targetDays <= 0` guard so it no longer returns 0; edits out-of-scope files (`habit-insights.ts`, `index.ts`, `package.json`, tsconfig); adds a dependency; or adds no assertion of the invariant.

Common small-model pitfalls:
- Capping `streakBonus` but not the final score, leaving rounding above 100 possible.
- Adding an upper clamp but dropping the lower bound (negative inputs).
- Rounding after clamping vs clamping after rounding — both work here, but clamping the un-rounded value to `[0,1]*100` then rounding is also acceptable as long as the result is `<= 100`.
- Hardcoding `return 100` only when `completedDays === targetDays`, missing the general over-100 case (e.g. `completedDays > targetDays`).
- Editing `habit-insights.ts` or `index.ts` "to be safe", or touching `package.json`.
- Changing the existing `86` expectation instead of adding a new test.

## Acceptance
`npm test` (`node --experimental-strip-types --test test/*.test.js`) passes. Key assertions: `calculateHabitScore({4,5,3}) === 86` (unchanged), `calculateHabitScore({5,5,30}) === 100` (new cap), every case in the range test satisfies `0 <= score <= 100` and `Number.isInteger(score)`, `calculateHabitScore({4,0,3}) === 0`, and the `summarizeHabitWeek` deep-equal is unchanged.
