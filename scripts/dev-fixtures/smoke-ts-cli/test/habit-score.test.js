import test from "node:test";
import assert from "node:assert/strict";
import { calculateHabitScore } from "../src/habit-score.ts";

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
