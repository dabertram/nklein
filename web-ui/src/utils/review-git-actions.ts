import type { RuntimeTaskSessionSummary } from "@/runtime/types";

export type ReviewGitActionChangeState = "dirty" | "clean" | "unknown";

export function getReviewGitActionChangeState({
	changedFiles,
	summary,
}: {
	changedFiles: number | null | undefined;
	summary: RuntimeTaskSessionSummary | null | undefined;
}): ReviewGitActionChangeState {
	if (typeof changedFiles === "number") {
		return changedFiles > 0 ? "dirty" : "clean";
	}
	const hookEventName = summary?.latestHookActivity?.hookEventName ?? null;
	if (hookEventName === "sandbox_patch_captured") {
		return "dirty";
	}
	if (hookEventName === "sandbox_patch_empty") {
		return "clean";
	}
	return "unknown";
}

export function hasReviewGitActionChanges(input: {
	changedFiles: number | null | undefined;
	summary: RuntimeTaskSessionSummary | null | undefined;
}): boolean {
	return getReviewGitActionChangeState(input) === "dirty";
}
