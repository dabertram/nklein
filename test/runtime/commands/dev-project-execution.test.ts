import { describe, expect, it } from "vitest";
import {
	boardHoldsNonTerminalCards,
	countPendingAutoReviews,
	findSandboxPatchCaptureFailure,
} from "../../../src/commands/dev-project-execution";

describe("boardHoldsNonTerminalCards (P23.5 resume-mode)", () => {
	it("holds work when any card sits outside completed/trash — the surviving board IS the seed", () => {
		expect(
			boardHoldsNonTerminalCards({
				columns: [
					{ id: "completed", cards: [{}, {}] },
					{ id: "planning", cards: [{}] },
				],
			}),
		).toBe(true);
	});

	it("an exhausted board (completed/trash only, or empty) does NOT hold work — resume falls through to a fresh seed", () => {
		expect(
			boardHoldsNonTerminalCards({
				columns: [
					{ id: "completed", cards: [{}] },
					{ id: "trash", cards: [{}] },
					{ id: "planning", cards: [] },
				],
			}),
		).toBe(false);
		expect(boardHoldsNonTerminalCards({ columns: [] })).toBe(false);
	});
});

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

	it("counts by BOARD LANE, which is what makes a parked terminal distinguishable from live work", () => {
		// The counterpart to the regression above, learned the expensive way. A first attempt at the v17 fix ALSO
		// added an `awaiting_review` SESSION term to activeSessionCount. That state conflates a review in flight
		// with a card parked after failing: G6.8a v18's dead decompose seed sat `awaiting_review` with
		// `reviewReason: "error"` (so not attention-parked either), which pinned the counter at 1 on a board where
		// nothing could progress — the run burned 12 hours instead of settling in six minutes. Lane membership
		// carries the distinction that session state loses: a card that failed out is NOT in the review lane.
		expect(countPendingAutoReviews({ columns: [{ id: "planning", cards: [{ autoReviewEnabled: true }] }] })).toBe(0);
	});

	it("EXCLUDES an attention-parked review-lane card — parked for the operator is not pending work", () => {
		// Live 20260811-001402 (runs 11+13): a review-loop park left the card in the review lane with
		// autoReviewEnabled forever; counting it pinned activeSessionCount ≥ 1, the stagnation settle never
		// fired, and the rig stall-killed an unclassified run after 7 idle minutes. The exclusion set derives
		// from the SAME rule as the needs_attention outcome, so "parked" has exactly one definition.
		const board = {
			columns: [
				{
					id: "review",
					cards: [
						{ id: "parked-card", autoReviewEnabled: true },
						{ id: "live-card", autoReviewEnabled: true },
					],
				},
			],
		};
		expect(countPendingAutoReviews(board, new Set(["parked-card"]))).toBe(1);
		expect(countPendingAutoReviews(board, new Set())).toBe(2);
		expect(countPendingAutoReviews(board)).toBe(2);
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
