import { describe, expect, it } from "vitest";
import { HARD_TASK_WAIT_DIFFICULTY_THRESHOLD, shouldWaitForBestModel } from "../../../src/core/hard-task-wait";

describe("shouldWaitForBestModel (§5.AB wait-vs-attempt gate)", () => {
	it("waits ONLY under wait_for_best × hard difficulty × all-qualified-busy", () => {
		expect(shouldWaitForBestModel({ mode: "wait_for_best", difficulty: 60, busyFallback: true })).toBe(true);
		// Any single leg missing ⇒ attempt now (today's behavior).
		expect(shouldWaitForBestModel({ mode: "attempt_with_available", difficulty: 60, busyFallback: true })).toBe(
			false,
		);
		expect(shouldWaitForBestModel({ mode: "wait_for_best", difficulty: 40, busyFallback: true })).toBe(false);
		expect(shouldWaitForBestModel({ mode: "wait_for_best", difficulty: 60, busyFallback: false })).toBe(false);
	});

	it("honors the threshold boundary and a caller override", () => {
		expect(
			shouldWaitForBestModel({
				mode: "wait_for_best",
				difficulty: HARD_TASK_WAIT_DIFFICULTY_THRESHOLD,
				busyFallback: true,
			}),
		).toBe(true);
		expect(shouldWaitForBestModel({ mode: "wait_for_best", difficulty: 30, busyFallback: true, threshold: 30 })).toBe(
			true,
		);
	});
});
