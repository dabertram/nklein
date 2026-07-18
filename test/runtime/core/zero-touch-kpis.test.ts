import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import { computeZeroTouchKpis } from "../../../src/core/zero-touch-kpis";

let seq = 0;
const transition = (taskId: string, to: string, reason: string | null = null): AgentLedgerEvent =>
	({
		schemaVersion: 1,
		eventId: `e${seq}`,
		kind: "transition",
		taskId,
		workflowId: taskId,
		workspacePathHash: "h",
		recordedAt: 1000 + seq++,
		from: null,
		to,
		reason,
		controllerDecision: null,
	}) as unknown as AgentLedgerEvent;

describe("computeZeroTouchKpis (F12.108)", () => {
	it("counts delivered vs zero-touch, tracks streaks, and buckets dev-test separately", () => {
		const events = [
			// clean production card: one start, delivered by merge
			transition("card-a", "running", "start_requested"),
			transition("card-a", "delivery_merge", null),
			// touched production card: reopened then delivered
			transition("card-b", "running", "start_requested"),
			transition("card-b", "idle", "reopened"),
			transition("card-b", "delivery_commit", null),
			// clean again — streak resets around card-b
			transition("card-c", "running", "start_requested"),
			transition("card-c", "delivery_open_pr", null),
			// dev-test card must not inflate production
			transition("devtest-x", "running", "start_requested"),
			transition("devtest-x", "delivery_merge", null),
			// failed card, never delivered
			transition("card-d", "wf:failed", null),
		];
		const kpis = computeZeroTouchKpis(events);
		const production = kpis.buckets.find((bucket) => bucket.bucket === "production");
		const devTest = kpis.buckets.find((bucket) => bucket.bucket === "dev_test");
		expect(production).toMatchObject({
			tasksDelivered: 3,
			zeroTouch: 2,
			reopens: 1,
			failed: 1,
			longestZeroTouchStreak: 1,
		});
		expect(production?.zeroTouchRate).toBeCloseTo(2 / 3);
		expect(devTest).toMatchObject({ tasksDelivered: 1, zeroTouch: 1 });
		expect(kpis.captureGaps.length).toBeGreaterThan(0);
	});

	it("reports restarts separately and never counts them as touches; quality_scan is not a delivery", () => {
		const events = [
			transition("card-r", "running", "start_requested"),
			transition("card-r", "running", "start_requested"),
			transition("card-r", "delivery_quality_scan", null),
			transition("card-r", "delivery_merge", null),
		];
		const production = computeZeroTouchKpis(events).buckets.find((bucket) => bucket.bucket === "production");
		expect(production).toMatchObject({ tasksDelivered: 1, zeroTouch: 1, restarts: 1 });
	});
});
