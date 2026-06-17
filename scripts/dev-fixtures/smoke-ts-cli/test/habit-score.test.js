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
