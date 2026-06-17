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
