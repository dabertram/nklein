/**
 * F12.38 compacted decision-handoff between dependent cards — PURE core.
 *
 * When card B depends on card A, today's handoff is the diff + B's own prompt — none of A's DECISIONS survive
 * (which approach was chosen and why, which edge cases were found, what the reviewer demanded). Inter-agent
 * misalignment is ~37% of MAST failures, and this thin handoff invites exactly that. This composer builds a compact
 * handoff brief from A's LEDGERED FACTS — completed plan steps, files touched, review feedback that shaped the
 * result, salvage events — deterministically (no model call; an optional model-written summary can enrich the
 * `workerNotes` slot when the fleet is available). The brief rides dependent-card B's start prompt.
 */

export interface HandoffSourceFacts {
	readonly taskId: string;
	readonly title: string;
	/** Focus-chain steps A completed, in order (its own plan trace). */
	readonly completedSteps: readonly string[];
	/** Files A actually touched (the artifact anchor for B's reading list). */
	readonly filesTouched: readonly string[];
	/** The reviewer's LAST change-request feedback that shaped the accepted result (null when clean-approved). */
	readonly shapingReviewFeedback: string | null;
	/** Optional model-written decision notes (fleet-enriched); null in the deterministic-only path. */
	readonly workerNotes: string | null;
}

const MAX_STEPS = 6;
const MAX_FILES = 10;

/**
 * Render the handoff brief for a dependent card's prompt. Compact by contract: capped lists, one block, and only
 * sections with content — an empty handoff renders null (nothing to say beats boilerplate).
 */
export function buildDecisionHandoff(source: HandoffSourceFacts): string | null {
	const lines: string[] = [];
	if (source.completedSteps.length > 0) {
		lines.push(
			`What "${source.title}" actually did (its completed plan steps):`,
			...source.completedSteps.slice(0, MAX_STEPS).map((step) => `- ${step}`),
		);
		if (source.completedSteps.length > MAX_STEPS) {
			lines.push(`- …and ${source.completedSteps.length - MAX_STEPS} more step(s)`);
		}
	}
	if (source.filesTouched.length > 0) {
		lines.push(
			`Files it changed (read these before assuming their shape): ${source.filesTouched
				.slice(0, MAX_FILES)
				.join(
					", ",
				)}${source.filesTouched.length > MAX_FILES ? ` (+${source.filesTouched.length - MAX_FILES} more)` : ""}`,
		);
	}
	if (source.shapingReviewFeedback?.trim()) {
		lines.push(
			`Review constraint that SHAPED the accepted result (still binding on follow-up work): ${source.shapingReviewFeedback.trim().slice(0, 300)}`,
		);
	}
	if (source.workerNotes?.trim()) {
		lines.push(
			`Decisions and edge cases in the upstream worker's own words: ${source.workerNotes.trim().slice(0, 500)}`,
		);
	}
	if (lines.length === 0) {
		return null;
	}
	return [`[Handoff from the dependency "${source.title}" (${source.taskId})]`, ...lines].join("\n");
}
