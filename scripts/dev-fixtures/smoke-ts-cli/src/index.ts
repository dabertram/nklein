import { summarizeHabitWeek } from "./habit-insights.ts";

const summary = summarizeHabitWeek({
	completedDays: 4,
	previousCompletedDays: 3,
	targetDays: 5,
	streakDays: 3,
});

console.log(`habit score: ${summary.score}`);
console.log(`trend: ${summary.trend}`);
