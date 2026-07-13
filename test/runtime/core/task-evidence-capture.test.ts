import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { runtimeTaskEvidenceCaptureSchema } from "../../../src/core/nklein-ops-api-contract";
import {
	resolveSettledTaskCaptureOutcome,
	resolveTaskEvidenceCapture,
	shouldUsePersistedTaskResultArtifact,
} from "../../../src/core/task-evidence-capture";

function summary(
	state: RuntimeTaskSessionSummary["state"],
	hookEventName: string | null = null,
	warningMessage: string | null = null,
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "nklein",
		workspacePath: "/repo",
		pid: null,
		startedAt: 1,
		updatedAt: 2,
		lastOutputAt: null,
		lastHookAt: null,
		latestHookActivity: hookEventName
			? {
					activityText: null,
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName,
					notificationType: null,
					source: "nklein",
				}
			: null,
		reviewReason: null,
		exitCode: null,
		warningMessage,
	} as RuntimeTaskSessionSummary;
}

describe("resolveTaskEvidenceCapture", () => {
	it("distinguishes a result-ref probe failure from an absent ref", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: null,
				resultCommit: null,
				resultProbeError: "git repository unavailable",
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({
			status: "evidence_failed",
			action: "retry_evidence",
			message: expect.stringContaining("git repository unavailable"),
		});
	});

	it("does not let a branch-probe error mask an explicit no-change outcome", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("awaiting_review", "sandbox_patch_empty"),
				resultCommit: null,
				resultProbeError: "transient git failure",
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({ status: "no_changes", action: "redrive_task" });
	});

	it("accepts a current captured result branch", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("awaiting_review", "sandbox_patch_captured"),
				resultCommit: "abc123",
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({ status: "result_branch", action: "inspect_result", resultCommit: "abc123" });
	});

	it("does not mistake an older bounce-round ref for the current pending capture", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("awaiting_review"),
				resultCommit: "stale",
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({
			status: "capture_pending",
			action: "wait_for_capture",
			resultCommit: null,
		});
	});

	it("keeps a marker-less review handoff pending without inventing a timeout failure", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("awaiting_review"),
				resultCommit: null,
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({
			status: "capture_pending",
			action: "wait_for_capture",
		});
	});

	it("does not package an older result ref while a bounced task is busy", () => {
		for (const state of ["queued", "running", "paused"] as const) {
			expect(
				resolveTaskEvidenceCapture({
					summary: summary(state, "sandbox_patch_captured"),
					resultCommit: "prior-round",
					resultBranchTaskId: "task-1",
				}),
			).toMatchObject({ status: "capture_pending", resultCommit: null });
		}
	});

	it("distinguishes a genuine no-change handoff from capture failure", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("awaiting_review", "sandbox_patch_empty"),
				resultCommit: null,
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({ status: "no_changes", action: "redrive_task" });
		expect(
			resolveTaskEvidenceCapture({
				summary: summary(
					"awaiting_review",
					"sandbox_patch_capture_failed",
					"Could not capture: workspace disappeared",
				),
				resultCommit: null,
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({
			status: "capture_failed",
			action: "inspect_failure_and_redrive",
			message: "Could not capture: workspace disappeared",
		});
	});

	it("makes missing and not-yet-settled artifacts actionable", () => {
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("running"),
				resultCommit: null,
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({
			status: "capture_pending",
			action: "wait_for_capture",
		});
		expect(
			resolveTaskEvidenceCapture({
				summary: summary("interrupted"),
				resultCommit: null,
				resultBranchTaskId: "task-1",
			}),
		).toMatchObject({
			status: "no_capture",
			action: "start_or_redrive_task",
		});
		expect(
			resolveTaskEvidenceCapture({ summary: null, resultCommit: null, resultBranchTaskId: "task-1" }),
		).toMatchObject({
			status: "no_capture",
			action: "start_or_redrive_task",
		});
	});

	it("accepts explicit interrupted-work rebounds as the current result", () => {
		for (const hook of ["interrupted_salvage_rebound", "interrupted_prior_work_rebound"]) {
			expect(
				resolveTaskEvidenceCapture({
					summary: summary("awaiting_review", hook),
					resultCommit: "recovered",
					resultBranchTaskId: "task-1",
				}),
			).toMatchObject({ status: "result_branch", resultCommit: "recovered" });
		}
	});
});

describe("shouldUsePersistedTaskResultArtifact", () => {
	it("ignores a prior receipt during a new busy, pending, failed, empty, or differently captured round", () => {
		for (const state of ["queued", "running", "paused"] as const) {
			expect(
				shouldUsePersistedTaskResultArtifact({
					summary: summary(state, "sandbox_patch_captured"),
					resultCommit: "old",
				}),
			).toBe(false);
		}
		for (const hook of ["agent_end", "sandbox_patch_capture_failed", "sandbox_patch_empty"]) {
			expect(
				shouldUsePersistedTaskResultArtifact({
					summary: summary("awaiting_review", hook),
					resultCommit: "old",
				}),
			).toBe(false);
		}
		const newer = summary("awaiting_review", "sandbox_patch_captured");
		if (newer.latestHookActivity) {
			newer.latestHookActivity.finalMessage = "new";
		}
		expect(shouldUsePersistedTaskResultArtifact({ summary: newer, resultCommit: "old" })).toBe(false);
	});

	it("uses a receipt when no newer capture generation supersedes it", () => {
		expect(shouldUsePersistedTaskResultArtifact({ summary: null, resultCommit: "old" })).toBe(true);
		const current = summary("awaiting_review", "sandbox_patch_captured");
		if (current.latestHookActivity) {
			current.latestHookActivity.finalMessage = "old";
		}
		expect(shouldUsePersistedTaskResultArtifact({ summary: current, resultCommit: "old" })).toBe(true);
	});
});

describe("resolveSettledTaskCaptureOutcome", () => {
	it("does not settle merely because a session reached review", () => {
		expect(resolveSettledTaskCaptureOutcome({ hookEventName: "agent_end", resultBranchExists: false })).toBeNull();
	});

	it("settles only on a branch, explicit no-change marker, or explicit capture failure", () => {
		expect(resolveSettledTaskCaptureOutcome({ hookEventName: null, resultBranchExists: true })).toBeNull();
		expect(
			resolveSettledTaskCaptureOutcome({
				hookEventName: "sandbox_patch_captured",
				resultBranchExists: true,
			}),
		).toBe("result_branch");
		expect(
			resolveSettledTaskCaptureOutcome({ hookEventName: "sandbox_patch_empty", resultBranchExists: false }),
		).toBe("no_changes");
		expect(
			resolveSettledTaskCaptureOutcome({ hookEventName: "sandbox_patch_capture_failed", resultBranchExists: false }),
		).toBe("capture_failed");
	});

	it("prioritizes the current explicit empty/failure marker over a stale branch", () => {
		expect(
			resolveSettledTaskCaptureOutcome({
				hookEventName: "sandbox_patch_empty",
				resultBranchExists: true,
			}),
		).toBe("no_changes");
		expect(
			resolveSettledTaskCaptureOutcome({
				hookEventName: "sandbox_patch_capture_failed",
				resultBranchExists: true,
			}),
		).toBe("capture_failed");
	});
});

describe("runtimeTaskEvidenceCaptureSchema", () => {
	const validResult = {
		status: "result_branch",
		action: "inspect_result",
		message: "Captured.",
		resultCommit: "abc123",
		resultBranchTaskId: "task-1",
	};

	it("accepts the coherent result variant", () => {
		expect(runtimeTaskEvidenceCaptureSchema.safeParse(validResult).success).toBe(true);
	});

	it("rejects impossible status/action/commit combinations", () => {
		expect(runtimeTaskEvidenceCaptureSchema.safeParse({ ...validResult, resultCommit: null }).success).toBe(false);
		expect(
			runtimeTaskEvidenceCaptureSchema.safeParse({
				...validResult,
				status: "capture_pending",
				action: "inspect_result",
			}).success,
		).toBe(false);
		expect(
			runtimeTaskEvidenceCaptureSchema.safeParse({
				...validResult,
				status: "no_changes",
				action: "redrive_task",
			}).success,
		).toBe(false);
	});
});
