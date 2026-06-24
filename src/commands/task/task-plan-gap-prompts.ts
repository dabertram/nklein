import type { PlanGapKind } from "../../core/plan-gap";
import type { TaskWorktreeAutoMergeConflict } from "../../workspace/task-worktree-auto-merge";

/**
 * Pure prompt / revision builders for the plan-gap and merge-integration cards the `nklein task` CLI adds to the board,
 * extracted from the oversized `task.ts` (todo §5.U). Each function turns a structured plan-gap (kind, description,
 * evidence, task ids) into the card prompt text or the plan-revision record. No board I/O — the `add*CardToBoard`
 * mutators in `task.ts` consume these — so they stay trivially unit-testable string builders.
 */

export function buildIntegrationCardPrompt(conflict: TaskWorktreeAutoMergeConflict): string {
	const paths =
		conflict.conflictedPaths.length > 0
			? conflict.conflictedPaths.map((path) => `- ${path}`).join("\n")
			: "- No conflicted paths were reported by Git; inspect the aborted merge output.";
	return [
		`Resolve the merge conflict from task "${conflict.taskId}".`,
		`Task head: ${conflict.headCommit}`,
		"Conflicting paths:",
		paths,
		"Re-run the task result merge after resolving the integration changes.",
		`Git message: ${conflict.message}`,
	].join("\n\n");
}

export function buildPlanGapIntegrationCardPrompt(input: {
	taskId: string;
	description: string;
	evidence?: string | null;
}): string {
	const lines = [
		`Add the missing integration step reported by task "${input.taskId}".`,
		"",
		input.description.trim() || "An execution task reported that the plan needs an integration step.",
	];
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	lines.push(
		"",
		"Review the completed and in-progress plan work, implement only the missing integration glue, and keep the acceptance contract explicit.",
	);
	return lines.join("\n");
}

export function buildPlanGapDecisionCardPrompt(input: {
	taskId: string;
	kind: Extract<PlanGapKind, "missing_decision" | "contradictory_requirement">;
	description: string;
	evidence?: string | null;
}): string {
	const label = input.kind === "contradictory_requirement" ? "contradiction" : "missing decision";
	const lines = [
		`Resolve the ${label} reported by task "${input.taskId}".`,
		"",
		input.description.trim() || "Execution found a plan decision that must be answered before work continues.",
	];
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	lines.push(
		"",
		"Ask the user for the smallest decision that unblocks the plan, record the answer in the plan decisions/revisions artifacts when available, and update affected cards before implementation continues.",
	);
	return lines.join("\n");
}

export function buildPlanGapScopeCardPrompt(input: {
	taskId: string;
	description: string;
	evidence?: string | null;
}): string {
	const lines = [
		`Split the oversized task reported by "${input.taskId}".`,
		"",
		input.description.trim() || "Execution found this card is too large for one autonomous task.",
	];
	if (input.evidence?.trim()) {
		lines.push("", `Evidence: ${input.evidence.trim()}`);
	}
	lines.push(
		"",
		"Inspect the source card and produce bounded replacement leaves. Prefer the existing decomposition workflow with recursive expansions so dependencies can be re-linked through the saved task graph instead of broadening the source card.",
	);
	return lines.join("\n");
}

export function buildPlanGapIntegrationRevision(input: {
	taskId: string;
	integrationTaskId: string;
	description: string;
	evidence?: string | null;
}): {
	kind: string;
	description: string;
	evidence: string | null;
} {
	const evidence = input.evidence?.trim() ? input.evidence.trim() : null;
	return {
		kind: "integration_card_added",
		description: `Added Planning integration card "${input.integrationTaskId}" for plan gap reported by task "${input.taskId}": ${
			input.description.trim() || "missing integration work"
		}`,
		evidence,
	};
}

export function buildPlanGapAdaptationRevision(input: {
	taskId: string;
	adaptationTaskId: string;
	kind: Extract<PlanGapKind, "missing_decision" | "contradictory_requirement" | "scope_too_large">;
	description: string;
	evidence?: string | null;
}): {
	kind: string;
	description: string;
	evidence: string | null;
} {
	const evidence = input.evidence?.trim() ? input.evidence.trim() : null;
	const revisionKind = input.kind === "scope_too_large" ? "scope_split_card_added" : "decision_card_added";
	const label =
		input.kind === "scope_too_large"
			? "Planning split card"
			: input.kind === "contradictory_requirement"
				? "Planning contradiction card"
				: "Planning decision card";
	return {
		kind: revisionKind,
		description: `Added ${label} "${input.adaptationTaskId}" for plan gap reported by task "${input.taskId}": ${
			input.description.trim() || input.kind
		}`,
		evidence,
	};
}
