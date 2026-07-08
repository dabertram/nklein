/**
 * Auto-resume-after-boot selection (§ desktop app #13.4). PURE decision — given the projects the user flagged for
 * auto-resume + a concurrency limit, decide WHICH to resume when !Klein starts on login. The effectful boot hook (resume
 * each selected project's work via the runtime) rides the runtime-state channel and is wired separately; this is the
 * testable policy it consults.
 *
 * Policy (per the todo's "start with 1, later potentially more"): only flagged projects are eligible; ties broken by
 * most-recently-active first (resume what you were last working on); capped at `maxConcurrent` (default 1).
 */

export interface AutoResumeCandidate {
	projectId: string;
	/** Did the user enable auto-resume-after-boot for this project? */
	autoResumeEnabled: boolean;
	/** Epoch ms of the project's last activity, for ordering; missing ⇒ treated as oldest. */
	lastActiveAt?: number;
}

/**
 * Select the project ids to auto-resume on boot (pure). Filters to `autoResumeEnabled`, orders most-recently-active
 * first (stable for equal/absent timestamps via the input order), and caps at `maxConcurrent` (clamped to ≥ 0; default 1).
 */
export function selectAutoResumeProjects(
	candidates: readonly AutoResumeCandidate[],
	maxConcurrent = 1,
): string[] {
	const limit = Number.isFinite(maxConcurrent) ? Math.max(0, Math.trunc(maxConcurrent)) : 1;
	if (limit === 0) {
		return [];
	}
	return candidates
		.map((candidate, index) => ({ candidate, index })) // carry original index for a stable tiebreak
		.filter(({ candidate }) => candidate.autoResumeEnabled)
		.sort((a, b) => {
			const byRecency = (b.candidate.lastActiveAt ?? 0) - (a.candidate.lastActiveAt ?? 0);
			return byRecency !== 0 ? byRecency : a.index - b.index; // stable: preserve input order on ties
		})
		.slice(0, limit)
		.map(({ candidate }) => candidate.projectId);
}
