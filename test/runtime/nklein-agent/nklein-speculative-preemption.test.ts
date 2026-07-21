import { describe, expect, it } from "vitest";
import {
	hasDeliverySessionWaitingForModelTurn,
	stopPrimaryAttemptForRedrive,
} from "../../../src/nklein-agent/nklein-speculative-preemption";

const waitingActivity = {
	activityText: "Waiting for model capacity",
	finalMessage: null,
	hookEventName: "model_turn_admission_wait",
	notificationType: null,
	recordedAt: 1,
	source: "nklein" as const,
	toolInputSummary: null,
	toolName: null,
};

describe("hasDeliverySessionWaitingForModelTurn", () => {
	it("treats an admitted real session waiting behind speculation as delivery work", () => {
		expect(
			hasDeliverySessionWaitingForModelTurn([
				{ taskId: "real-review", state: "running", latestHookActivity: waitingActivity },
			]),
		).toBe(true);
	});

	it("does not let a speculative mirror preempt itself", () => {
		expect(
			hasDeliverySessionWaitingForModelTurn([
				{ taskId: "real-review::spec", state: "running", latestHookActivity: waitingActivity },
			]),
		).toBe(false);
	});

	it("ignores terminal sessions and unrelated activity", () => {
		expect(
			hasDeliverySessionWaitingForModelTurn([
				{ taskId: "finished", state: "failed", latestHookActivity: waitingActivity },
				{ taskId: "working", state: "running", latestHookActivity: null },
			]),
		).toBe(false);
	});
});

describe("stopPrimaryAttemptForRedrive", () => {
	it("cancels attempt-owned speculation before stopping the primary", async () => {
		const calls: string[] = [];
		let stopOptions: { abortActiveTurn?: boolean } | undefined;
		await stopPrimaryAttemptForRedrive(
			{
				cancelSpeculativeMirror: async () => void calls.push("cancel-spec"),
				stopTaskSession: async (_taskId, options) => {
					stopOptions = options;
					calls.push("stop-primary");
				},
			},
			"task-1",
		);
		expect(calls).toEqual(["cancel-spec", "stop-primary"]);
		expect(stopOptions).toEqual({ abortActiveTurn: true });
	});

	it("still stops the primary if speculative cancellation fails", async () => {
		const calls: string[] = [];
		await expect(
			stopPrimaryAttemptForRedrive(
				{
					cancelSpeculativeMirror: async () => {
						calls.push("cancel-spec");
						throw new Error("cancel failed");
					},
					stopTaskSession: async () => void calls.push("stop-primary"),
				},
				"task-1",
			),
		).rejects.toThrow("cancel failed");
		expect(calls).toEqual(["cancel-spec", "stop-primary"]);
	});
});
