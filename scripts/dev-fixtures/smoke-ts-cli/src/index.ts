import { calculateHabitScore } from "./habit-score.js";

const score = calculateHabitScore({
	completedDays: 4,
	targetDays: 5,
	streakDays: 3,
});

console.log(`habit score: ${score}`);
