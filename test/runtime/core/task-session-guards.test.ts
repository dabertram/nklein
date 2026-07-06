import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/task-session-api-contract";
import {
	isEnteringAwaitingReview,
	isReviewableNKleinSummary,
	shouldCaptureReviewCheckpoint,
} from "../../../src/core/task-session-guards";

function summary(over: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary {
	return {
		taskId: "t",
		state: "awaiting_review",
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 0,
		lastOutputAt: null,
		reviewReason: "hook",
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...over,
	};
}

describe("isReviewableNKleinSummary", () => {
	it("is true for awaiting_review with an actionable review reason", () => {
		for (const reviewReason of ["hook", "exit", "attention", "error"] as const) {
			expect(isReviewableNKleinSummary(summary({ reviewReason }))).toBe(true);
		}
	});

	it("is false when not awaiting review, even with an actionable reason", () => {
		expect(isReviewableNKleinSummary(summary({ state: "running", reviewReason: "hook" }))).toBe(false);
		expect(isReviewableNKleinSummary(summary({ state: "failed", reviewReason: "error" }))).toBe(false);
	});

	it("is false for awaiting_review with a non-actionable reason (interrupted / null)", () => {
		expect(isReviewableNKleinSummary(summary({ reviewReason: "interrupted" }))).toBe(false);
		expect(isReviewableNKleinSummary(summary({ reviewReason: null }))).toBe(false);
	});
});

describe("isEnteringAwaitingReview", () => {
	it("is true when the task transitions into awaiting_review", () => {
		expect(isEnteringAwaitingReview(summary({ state: "running" }), summary({ state: "awaiting_review" }))).toBe(true);
	});

	it("is false when it was already awaiting_review (not a fresh transition)", () => {
		expect(
			isEnteringAwaitingReview(summary({ state: "awaiting_review" }), summary({ state: "awaiting_review" })),
		).toBe(false);
	});

	it("is false when the next summary is null or not awaiting_review", () => {
		expect(isEnteringAwaitingReview(summary({ state: "running" }), null)).toBe(false);
		expect(isEnteringAwaitingReview(summary({ state: "running" }), summary({ state: "running" }))).toBe(false);
	});
});

describe("shouldCaptureReviewCheckpoint", () => {
	const running = summary({ state: "running", workspacePath: "/repo" });

	it("is true for a workspace-backed task entering awaiting_review", () => {
		expect(
			shouldCaptureReviewCheckpoint(running, summary({ state: "awaiting_review", workspacePath: "/repo" })),
		).toBe(true);
	});

	it("is false when it was already awaiting_review (not a fresh transition)", () => {
		expect(
			shouldCaptureReviewCheckpoint(
				summary({ state: "awaiting_review", workspacePath: "/repo" }),
				summary({ state: "awaiting_review", workspacePath: "/repo" }),
			),
		).toBe(false);
	});

	it("is false without a workspace path (nothing to checkpoint)", () => {
		expect(shouldCaptureReviewCheckpoint(running, summary({ state: "awaiting_review", workspacePath: null }))).toBe(
			false,
		);
	});

	it("is false for a home-agent session", () => {
		expect(
			shouldCaptureReviewCheckpoint(
				running,
				summary({ taskId: "__home_agent__:ws:nklein", state: "awaiting_review", workspacePath: "/repo" }),
			),
		).toBe(false);
	});

	it("is false when the next summary is null", () => {
		expect(shouldCaptureReviewCheckpoint(running, null)).toBe(false);
	});
});
