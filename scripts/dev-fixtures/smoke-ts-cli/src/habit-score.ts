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
	return Math.round((completionRatio + streakBonus) * 100);
}
