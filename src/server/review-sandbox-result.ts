import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { isActiveWorkSessionState } from "../core/session-state-predicates";
import { isCurrentTaskResultHookEvent } from "../core/task-evidence-capture";

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
	return isCurrentTaskResultHookEvent(summary?.latestHookActivity?.hookEventName);
}

/** True when result capture failed and delivery must remain fail-closed. */
export function isFailedSandboxPatchSummary(summary: RuntimeTaskSessionSummary | null): boolean {
	return summary?.latestHookActivity?.hookEventName === "sandbox_patch_capture_failed";
}

export type ReviewSandboxResult =
	| { status: "result_branch"; resultCommit: string }
	| { status: "empty_patch"; resultCommit: null }
	| { status: "capture_failed"; resultCommit: null }
	| { status: "unknown"; resultCommit: null };

/** Only a verified result branch or an explicit no-change outcome is ready for reviewer/delivery judgment. */
export function isSettledReviewSandboxArtifact(
	result: ReviewSandboxResult,
): result is Extract<ReviewSandboxResult, { status: "result_branch" | "empty_patch" }> {
	return result.status === "result_branch" || result.status === "empty_patch";
}

export type SettledReviewSandboxDelivery<T> =
	| {
			delivered: false;
			result: Extract<ReviewSandboxResult, { status: "capture_failed" | "unknown" }>;
			value: null;
	  }
	| {
			delivered: true;
			result: Extract<ReviewSandboxResult, { status: "result_branch" | "empty_patch" }>;
			value: T;
	  };

/**
 * Produce the tested fail-closed token that guards the reviewer → acceptance → merge suffix. A later captured-marker
 * summary may invoke the runtime again; until then pending/failed capture cannot admit its guarded callback.
 */
export async function runWithSettledReviewSandboxArtifact<T>(
	result: ReviewSandboxResult,
	runDelivery: (result: Extract<ReviewSandboxResult, { status: "result_branch" | "empty_patch" }>) => Promise<T>,
): Promise<SettledReviewSandboxDelivery<T>> {
	if (!isSettledReviewSandboxArtifact(result)) {
		return { delivered: false, result, value: null };
	}
	return { delivered: true, result, value: await runDelivery(result) };
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
): Promise<ReviewSandboxResult> {
	const delaysMs = probe.delaysMs ?? SANDBOX_REVIEW_RESULT_POLL_DELAYS_MS;
	const sleep = probe.sleep ?? realSleep;
	for (const delayMs of [0, ...delaysMs]) {
		if (delayMs > 0) {
			await sleep(delayMs);
		}
		const summary = probe.getSummary(input.taskId);
		if (isFailedSandboxPatchSummary(summary)) {
			return { status: "capture_failed", resultCommit: null };
		}
		if (isEmptySandboxPatchSummary(summary)) {
			return { status: "empty_patch", resultCommit: null };
		}
		const resultCommit = await probe.resolveResultCommit({
			repoPath: input.repoPath,
			taskId: input.taskId,
		});
		// A bounced worker reuses the same result-branch ref. On its NEXT handoff that ref already resolves while the
		// new sandbox capture is still running; accepting it immediately reviews the previous round's artifact. While
		// the session is awaiting review, require the current capture marker. Null/non-review summaries are startup or
		// reconciliation probes where the existing durable branch is the best available evidence and remains valid.
		if (
			typeof resultCommit === "string" &&
			resultCommit.trim() &&
			!isActiveWorkSessionState(summary?.state) &&
			(summary?.state !== "awaiting_review" || isCapturedSandboxPatchSummary(summary))
		) {
			return { status: "result_branch", resultCommit: resultCommit.trim() };
		}
	}
	return { status: "unknown", resultCommit: null };
}
