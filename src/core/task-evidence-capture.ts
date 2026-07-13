import type { RuntimeTaskEvidenceCapture } from "./nklein-ops-api-contract";
import type { RuntimeTaskSessionSummary } from "./task-session-api-contract";

const BUSY_CAPTURE_STATES = new Set<RuntimeTaskSessionSummary["state"]>(["queued", "running", "paused"]);
const CURRENT_RESULT_HOOKS = new Set([
	"sandbox_patch_captured",
	"interrupted_salvage_rebound",
	"interrupted_prior_work_rebound",
]);

/** True when a summary marker proves that the current handoff owns the durable result ref. */
export function isCurrentTaskResultHookEvent(hookEventName: string | null | undefined): boolean {
	return CURRENT_RESULT_HOOKS.has(hookEventName ?? "");
}

/** A prior delivery receipt is superseded by any busy/new/pending/failed capture generation. */
export function shouldUsePersistedTaskResultArtifact(input: {
	summary: RuntimeTaskSessionSummary | null;
	resultCommit: string;
}): boolean {
	const hook = input.summary?.latestHookActivity?.hookEventName ?? null;
	if (
		(input.summary ? BUSY_CAPTURE_STATES.has(input.summary.state) : false) ||
		hook === "sandbox_patch_capture_failed" ||
		hook === "sandbox_patch_empty"
	) {
		return false;
	}
	if (input.summary?.state !== "awaiting_review") {
		return true;
	}
	if (!isCurrentTaskResultHookEvent(hook)) {
		return false;
	}
	const liveCaptureCommit = input.summary.latestHookActivity?.finalMessage?.trim() || null;
	return liveCaptureCommit === null || liveCaptureCommit === input.resultCommit;
}

export type SettledTaskCaptureOutcome = "result_branch" | "no_changes" | "capture_failed";

/** Return a settled capture outcome, or null while an awaiting-review handoff still has no artifact marker. */
export function resolveSettledTaskCaptureOutcome(input: {
	hookEventName: string | null;
	resultBranchExists: boolean;
}): SettledTaskCaptureOutcome | null {
	if (input.hookEventName === "sandbox_patch_capture_failed") {
		return "capture_failed";
	}
	if (input.hookEventName === "sandbox_patch_empty") {
		return "no_changes";
	}
	if (input.resultBranchExists && isCurrentTaskResultHookEvent(input.hookEventName)) {
		return "result_branch";
	}
	return null;
}

/**
 * Classify the task artifact that an evidence bundle can honestly contain. A result ref from an older bounce round is
 * not current evidence while a new awaiting-review capture is still settling, so that state requires the matching
 * `sandbox_patch_captured` marker before the ref is accepted.
 */
export function resolveTaskEvidenceCapture(input: {
	summary: RuntimeTaskSessionSummary | null;
	resultCommit: string | null;
	resultProbeError?: string | null;
	resultBranchTaskId: string;
}): RuntimeTaskEvidenceCapture {
	const resultBranchTaskId = input.resultBranchTaskId;
	const hookEventName = input.summary?.latestHookActivity?.hookEventName ?? null;
	if (hookEventName === "sandbox_patch_capture_failed") {
		return {
			status: "capture_failed",
			action: "inspect_failure_and_redrive",
			message:
				input.summary?.warningMessage?.trim() ||
				"The sandbox result could not be captured. Inspect the capture diagnostics, then redrive the task.",
			resultCommit: null,
			resultBranchTaskId,
		};
	}
	if (hookEventName === "sandbox_patch_empty") {
		return {
			status: "no_changes",
			action: "redrive_task",
			message: "The last sandbox handoff produced no file changes. Redrive the task if changes were expected.",
			resultCommit: null,
			resultBranchTaskId,
		};
	}
	// A bounced task reuses its result ref. While it is busy, that ref is necessarily prior-round evidence even if the
	// old captured marker is still the latest hook activity.
	if (input.summary && BUSY_CAPTURE_STATES.has(input.summary.state)) {
		return {
			status: "capture_pending",
			action: "wait_for_capture",
			message: "The task is still running. Wait for its result capture before diagnosing the diff.",
			resultCommit: null,
			resultBranchTaskId,
		};
	}
	if (input.summary?.state === "awaiting_review" && !isCurrentTaskResultHookEvent(hookEventName)) {
		return {
			status: "capture_pending",
			action: "wait_for_capture",
			message: "The task reached review and its result capture is still settling. Wait before diagnosing its diff.",
			resultCommit: null,
			resultBranchTaskId,
		};
	}
	if (input.resultProbeError) {
		return {
			status: "evidence_failed",
			action: "retry_evidence",
			message: `The task result branch could not be inspected while collecting evidence: ${input.resultProbeError}`,
			resultCommit: null,
			resultBranchTaskId,
		};
	}
	const resultIsCurrent =
		Boolean(input.resultCommit) &&
		(input.summary?.state !== "awaiting_review" || isCurrentTaskResultHookEvent(hookEventName));
	if (resultIsCurrent) {
		return {
			status: "result_branch",
			action: "inspect_result",
			message: "A task result branch was captured and is included in this evidence bundle.",
			resultCommit: input.resultCommit as string,
			resultBranchTaskId,
		};
	}
	if (isCurrentTaskResultHookEvent(hookEventName)) {
		return {
			status: "capture_failed",
			action: "inspect_failure_and_redrive",
			message:
				"The session reported a captured patch, but its task result branch is missing. Inspect capture diagnostics and redrive the task.",
			resultCommit: null,
			resultBranchTaskId,
		};
	}
	return {
		status: "no_capture",
		action: "start_or_redrive_task",
		message: input.summary
			? "No result branch or explicit no-change outcome was recorded. Redrive the task to produce recoverable evidence."
			: "This task has no live session or captured result. Start or redrive it before expecting diff evidence.",
		resultCommit: null,
		resultBranchTaskId,
	};
}
