import type { RuntimeAgentId } from "../../core/api-contract";
import { toSlug } from "../../core/slugify";
import type { TaskWorktreeAutoMergeColumn } from "../../workspace/task-worktree-auto-merge";

/**
 * Pure CLI argument parsers for the task command (§5.U-extracted from task.ts): slug normalization + the option
 * validators (auto-merge column, auto-review mode, agent id, optional-or-"default" strings). Each throws a clear error
 * on an invalid value so the command surface fails fast with a helpful message.
 */

export function slugifyPlanTaskId(input: string): string {
	return toSlug(input) || "task";
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

export function parseAgentId(value: string | undefined): RuntimeAgentId | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "default") {
		return null;
	}
	// Strict on purpose: the schema's parse-time legacy migration (unknown → "nklein") must not make the CLI
	// silently accept a typo'd --agent value.
	if (value === "nklein") {
		return "nklein";
	}
	throw new Error(`Invalid agent ID "${value}". Expected one of: nklein, default.`);
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
