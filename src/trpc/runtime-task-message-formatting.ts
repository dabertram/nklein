/**
 * Pure user-facing message formatters for runtime task actions, extracted from runtime-api. Both
 * take a fully structural input (no router/state coupling), so they are trivially unit-testable and
 * behavior-preserving relative to their inline definitions.
 */

/** Phrase the result of an acceptance-check verification for a task card's action message. */
export function formatAcceptanceVerifyMessage(input: {
	present: boolean;
	passed: boolean | null;
	command: string | null;
	exitCode: number | null;
}): string {
	if (!input.present) {
		return "No Acceptance check line was found on this card.";
	}
	if (input.passed) {
		return `Acceptance check passed: ${input.command ?? "command"}.`;
	}
	return `Acceptance check failed${input.exitCode === null ? "" : ` with exit ${input.exitCode}`}: ${input.command ?? "command"}.`;
}

/** Phrase the result of a task-worktree auto-merge: conflict and blocked take precedence over the merged/skipped tally. */
export function formatMergeMessage(input: {
	ok: boolean;
	mergedTaskIds: readonly string[];
	skippedTaskIds: readonly string[];
	conflict?: { taskId: string; conflictedPaths: readonly string[] } | null;
	blocked?: { reason: string } | null;
}): string {
	if (input.conflict) {
		const paths =
			input.conflict.conflictedPaths.length > 0 ? ` Conflicts: ${input.conflict.conflictedPaths.join(", ")}.` : "";
		return `Merge conflict while merging ${input.conflict.taskId}.${paths}`;
	}
	if (input.blocked) {
		return `Merge blocked: ${input.blocked.reason}`;
	}
	return `Merged ${input.mergedTaskIds.length} task results; skipped ${input.skippedTaskIds.length}.`;
}
