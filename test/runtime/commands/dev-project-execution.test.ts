import { describe, expect, it } from "vitest";
import { countPendingAutoReviews, findSandboxPatchCaptureFailure } from "../../../src/commands/dev-project-execution";

describe("countPendingAutoReviews", () => {
	it("keeps an unattended run active until its synthetic reviewer records a result", () => {
		expect(
			countPendingAutoReviews({
				columns: [
					{
						id: "review",
						cards: [
							{ autoReviewEnabled: true },
							{ autoReviewEnabled: true, review: { rounds: [] } },
							{ autoReviewEnabled: false },
						],
					},
				],
			}),
		).toBe(1);
	});
});

describe("findSandboxPatchCaptureFailure", () => {
	it("recognizes the terminal hook and carries its diagnostic", () => {
		expect(
			findSandboxPatchCaptureFailure([
				{
					taskId: "task-1",
					latestHookActivity: {
						activityText: "docker container vanished",
						toolName: null,
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "sandbox_patch_capture_failed",
						notificationType: null,
						source: "nklein-sdk",
					},
					warningMessage: null,
				},
			]),
		).toBe("Sandbox patch capture failed for task-1: docker container vanished");
	});

	it("does not reclassify an ordinary failed model session as infrastructure", () => {
		expect(
			findSandboxPatchCaptureFailure([
				{ taskId: "task-2", latestHookActivity: null, warningMessage: "model returned malformed tool input" },
			]),
		).toBeNull();
	});

	it("recognizes the durable warning when the latest hook detail is unavailable", () => {
		expect(
			findSandboxPatchCaptureFailure([
				{
					taskId: "task-3",
					latestHookActivity: null,
					warningMessage: "Could not capture sandbox task result patch: workspace missing",
				},
			]),
		).toContain("workspace missing");
	});
});
