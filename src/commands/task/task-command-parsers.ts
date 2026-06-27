import { type RuntimeAgentId, runtimeAgentIdSchema } from "../../core/api-contract";
import type { TaskWorktreeAutoMergeColumn } from "../../workspace/task-worktree-auto-merge";

/**
 * Pure CLI argument parsers for the task command (§5.U-extracted from task.ts): slug normalization + the option
 * validators (auto-merge column, auto-review mode, agent id, optional-or-"default" strings). Each throws a clear error
 * on an invalid value so the command surface fails fast with a helpful message.
 */

export function slugifyPlanTaskId(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "task";
}

export function parseAutoMergeColumn(value: string | undefined): TaskWorktreeAutoMergeColumn {
	if (value === undefined || value === "review") {
		return "review";
	}
	if (value === "completed" || value === "done") {
		return "completed";
	}
	throw new Error('Invalid merge column. Expected "review" or "completed".');
}

export function parseAutoReviewMode(value: string | undefined): "commit" | "pr" | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "commit" || value === "pr") {
		return value;
	}
	throw new Error(`Invalid auto review mode "${value}". Expected: commit, pr.`);
}

const VALID_AGENT_IDS = runtimeAgentIdSchema.options;

export function parseAgentId(value: string | undefined): RuntimeAgentId | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "default") {
		return null;
	}
	const result = runtimeAgentIdSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	throw new Error(`Invalid agent ID "${value}". Expected one of: ${VALID_AGENT_IDS.join(", ")}, default.`);
}

export function parseOptionalStringOrDefault(value: string | undefined): string | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "default") {
		return null;
	}
	return value;
}
