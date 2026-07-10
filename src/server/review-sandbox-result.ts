import type { RuntimeTaskSessionSummary } from "../core/api-contract";

/**
 * §5.U — the review sandbox-result probe extracted from `runtime-server`. After a sandboxed review run, the outcome
 * (a pushed result branch vs an empty patch) can land slightly after the session goes terminal, so we poll a short
 * backoff schedule before giving up. The two I/O probes (session summary + result-branch lookup) and the sleep are
 * injected, so the poll-until control flow is deterministically testable without real timers, git, or a live service.
 */

/** The backoff schedule (ms) for polling a review's sandbox result — a leading `0` (immediate) is prepended internally. */
export const SANDBOX_REVIEW_RESULT_POLL_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

/** True when the session's latest hook activity reports an empty sandbox patch (no file changes). */
export function isEmptySandboxPatchSummary(summary: RuntimeTaskSessionSummary | null): boolean {
	return summary?.latestHookActivity?.hookEventName === "sandbox_patch_empty";
}

/** True once the current awaiting-review handoff has finished writing its patch onto the result branch. */
export function isCapturedSandboxPatchSummary(summary: RuntimeTaskSessionSummary | null): boolean {
	return summary?.latestHookActivity?.hookEventName === "sandbox_patch_captured";
}

export interface ReviewSandboxResultProbe {
	/** The current session summary for a task (in-memory read). */
	getSummary: (taskId: string) => RuntimeTaskSessionSummary | null;
	/** Look up the result-branch commit for a task; truthy ⇒ a result branch exists. */
	resolveResultCommit: (input: { repoPath: string; taskId: string }) => Promise<unknown>;
	/** Injectable sleep (tests pass a no-op); defaults to a real `setTimeout` delay. */
	sleep?: (ms: number) => Promise<void>;
	/** The backoff schedule; defaults to {@link SANDBOX_REVIEW_RESULT_POLL_DELAYS_MS}. */
	delaysMs?: readonly number[];
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll for a review's sandbox result: `empty_patch` as soon as the summary reports one, else `result_branch` once the
 * result commit resolves, else `unknown` after the schedule is exhausted. The first pass is immediate (no sleep).
 */
export async function resolveReviewSandboxResult(
	input: { repoPath: string; taskId: string },
	probe: ReviewSandboxResultProbe,
): Promise<"result_branch" | "empty_patch" | "unknown"> {
	const delaysMs = probe.delaysMs ?? SANDBOX_REVIEW_RESULT_POLL_DELAYS_MS;
	const sleep = probe.sleep ?? realSleep;
	for (const delayMs of [0, ...delaysMs]) {
		if (delayMs > 0) {
			await sleep(delayMs);
		}
		const summary = probe.getSummary(input.taskId);
		if (isEmptySandboxPatchSummary(summary)) {
			return "empty_patch";
		}
		const resultCommit = await probe.resolveResultCommit({
			repoPath: input.repoPath,
			taskId: input.taskId,
		});
		// A bounced worker reuses the same result-branch ref. On its NEXT handoff that ref already resolves while the
		// new sandbox capture is still running; accepting it immediately reviews the previous round's artifact. While
		// the session is awaiting review, require the current capture marker. Null/non-review summaries are startup or
		// reconciliation probes where the existing durable branch is the best available evidence and remains valid.
		if (resultCommit && (summary?.state !== "awaiting_review" || isCapturedSandboxPatchSummary(summary))) {
			return "result_branch";
		}
	}
	return "unknown";
}
