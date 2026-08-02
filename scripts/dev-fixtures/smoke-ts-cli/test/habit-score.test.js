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


	test('perfect week clamps to 100', () => {
		assert.equal(
			calculateHabitScore({
				completedDays: 7,
				targetDays: 7,
				streakDays: 30,
			}),
			100,
		);
	});

	test('score is always an integer in [0, 100]', () => {
		for (let completed = 0; completed <= 10; completed++) {
			for (let target = 1; target <= 10; target++) {
				for (let streak = 0; streak <= 50; streak++) {
					const result = calculateHabitScore({
						completedDays: completed,
						targetDays: target,
						streakDays: streak,
					});
					assert.ok(
						Number.isInteger(result),
						`score[${completed}/${target}/${streak}] is integer`,
					);
					assert.ok(
						rangeInclusive(result, 0, 100),
						`score[${completed}/${target}/${streak}] in [0, 100]`,
					);
				}
			}
		}
	});

	function rangeInclusive(value, min, max) {
		return value >= min && value <= max;
	}

	test('trend mapping includes steady (delta === 0)', () => {
		assert.equal(summarizeHabitWeek({ completedDays: 3, previousCompletedDays: 3, targetDays: 5, streakDays: 1 }).trend, 'steady');
	});