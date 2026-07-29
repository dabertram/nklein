import { describe, expect, it } from "vitest";
import { countPendingAutoReviews, findSandboxPatchCaptureFailure } from "../../../src/commands/dev-project-execution";

describe("countPendingAutoReviews", () => {
	it("counts every auto-reviewed review-lane card, INCLUDING ones that already have a verdict", () => {
		// Changed 2026-07-29 with live evidence: this previously required `review === undefined`, so a card
		// stopped counting at its FIRST verdict — even though bounce → re-review → delivery → acceptance all
		// happen after it. G6.8a v17 settled as "stagnant" at ~80 minutes with BOTH review cards holding
		// `autoReviewEnabled: true` plus a verdict (counted 0), while telemetry showed a review model request
		// finishing 100s earlier and a decomposition turn continuing at the final second. The old expectation
		// (1) encoded that truncation as the contract.
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
		).toBe(2);
	});

	it("still ignores cards that are not auto-reviewed, and boards with no review lane", () => {
		// A human-reviewed card must not keep an unattended run alive forever; the parked-for-a-human case is
		// tracked separately as attentionCardCount with its own terminal outcome.
		expect(countPendingAutoReviews({ columns: [{ id: "review", cards: [{ autoReviewEnabled: false }] }] })).toBe(0);
		expect(countPendingAutoReviews({ columns: [{ id: "in_progress", cards: [{ autoReviewEnabled: true }] }] })).toBe(
			0,
		);
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
