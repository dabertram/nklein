/**
 * Once-per-episode memo for the model-turn admission breadcrumbs. PURE core.
 *
 * A capacity-queued card re-runs its admission every few seconds, and each run walks the SAME phases (evaluating →
 * config loaded → ps snapshot → registry snapshot). A gate that compares only against the PREVIOUS phase never
 * suppresses a cycle: 2026-09-14, three waiting cards wrote 7,628 `model_turn_admission` rows in 104 minutes (one
 * every 0.8 s), and every read-limited evidence reader saw its window filled with them.
 *
 * This memo stamps each phase ONCE per waiting episode. `settle` ends the episode (admission granted or the task
 * gone) so a future wait narrates itself afresh — the queued-on-capacity INFORMATION stays, the repetition goes.
 */
export interface AdmissionPhaseMemo {
	/** True when `phase` has not been stamped for `taskId` in the current episode (and marks it stamped). */
	stamp(taskId: string, phase: string): boolean;
	/** End the task's episode: the next `stamp` of any phase records again. */
	settle(taskId: string): void;
	/** Phases stamped in the current episode (for tests and diagnostics). */
	stamped(taskId: string): readonly string[];
}

export function createAdmissionPhaseMemo(): AdmissionPhaseMemo {
	const byTask = new Map<string, Set<string>>();
	return {
		stamp(taskId, phase) {
			const phases = byTask.get(taskId) ?? new Set<string>();
			if (phases.has(phase)) return false;
			phases.add(phase);
			byTask.set(taskId, phases);
			return true;
		},
		settle(taskId) {
			byTask.delete(taskId);
		},
		stamped(taskId) {
			return [...(byTask.get(taskId) ?? [])];
		},
	};
}
