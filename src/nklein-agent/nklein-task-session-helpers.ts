import type { RuntimeModelPerformanceRole } from "../core/api-contract";
import { toErrorMessage as formatErrorMessage } from "../core/error-message";
import { AgentSandboxExecutionError } from "./nklein-agent-sandbox";

// Pure helpers extracted from `nklein-task-session-service.ts` (§5.U decomposition). No session
// state or closures — task-role resolution, error/warning formatting, and the benign-teardown
// classifier — so they unit-test in isolation.

/**
 * Resolve the model-performance role for a task from its id + decomposition flag: a `::review`
 * task is a reviewer, a decomposition is an architect, and everything else is a worker.
 */
export function resolveNKleinTaskRole(taskId: string, isDecomposition: boolean): RuntimeModelPerformanceRole {
	if (taskId.endsWith("::review")) {
		return "reviewer";
	}
	return isDecomposition ? "architect" : "worker";
}

/** Format an unknown thrown value into a human-readable message (falls back to "Unknown error"). */
export function toErrorMessage(error: unknown): string {
	return formatErrorMessage(error, "Unknown error");
}

/**
 * True when a sandbox patch-staging failure is the benign teardown race — the sandbox cwd vanished
 * mid-stage (worktree removed / not-a-git-repo) — which must not surface as a real error.
 */
export function isBenignSandboxPatchStagingTeardown(error: unknown): boolean {
	if (!(error instanceof AgentSandboxExecutionError)) {
		return false;
	}
	if (!error.message.startsWith("Could not stage sandbox workspace changes.")) {
		return false;
	}
	const output = `${error.result.stderr}\n${error.result.stdout}`.toLowerCase();
	return (
		output.includes("chdir to cwd") ||
		output.includes("unable to get current working directory") ||
		output.includes("no such file or directory") ||
		output.includes("not a git repository")
	);
}

/** Collapse MCP start-warnings into one user-facing line: `"<first> (+N more MCP warning(s))"`. */
export function formatStartWarnings(warnings: readonly string[] | undefined): string | null {
	if (!warnings) {
		return null;
	}
	const normalized = warnings.map((warning) => warning.trim()).filter((warning) => warning.length > 0);
	if (normalized.length === 0) {
		return null;
	}
	if (normalized.length === 1) {
		return normalized[0] ?? null;
	}
	return `${normalized[0]} (+${normalized.length - 1} more MCP warning${normalized.length === 2 ? "" : "s"})`;
}
