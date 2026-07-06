import { describe, expect, it } from "vitest";
import { resolveSpeculativeDeliveryTarget } from "../../../src/core/speculative-delivery-target";

const t = (over: Partial<Parameters<typeof resolveSpeculativeDeliveryTarget>[0]> = {}) =>
	resolveSpeculativeDeliveryTarget({
		reviewDelivered: true,
		reviewPreferred: null,
		persistedPreferred: null,
		taskId: "task-1",
		...over,
	});

describe("resolveSpeculativeDeliveryTarget (§5.AW arbitration)", () => {
	it("delivers the ::spec branch when the reviewer preferred speculative", () => {
		expect(t({ reviewPreferred: "speculative" })).toEqual({
			preferredSpeculative: true,
			deliveredBranchTaskId: "task-1::spec",
		});
	});

	it("delivers the primary (card id) branch when the reviewer preferred primary or nothing", () => {
		expect(t({ reviewPreferred: "primary" })).toEqual({
			preferredSpeculative: false,
			deliveredBranchTaskId: "task-1",
		});
		expect(t({ reviewPreferred: null })).toEqual({ preferredSpeculative: false, deliveredBranchTaskId: "task-1" });
	});

	it("the in-process reviewPreferred is AUTHORITATIVE over the persisted fallback", () => {
		// in-process says primary → primary, even though the durable persisted value says speculative.
		expect(t({ reviewPreferred: "primary", persistedPreferred: "speculative" }).preferredSpeculative).toBe(false);
	});

	it("falls back to the persisted preferred when there is no in-process value (restart between verdict + delivery)", () => {
		expect(t({ reviewPreferred: null, persistedPreferred: "speculative" }).preferredSpeculative).toBe(true);
		expect(t({ reviewPreferred: undefined, persistedPreferred: "speculative" }).deliveredBranchTaskId).toBe(
			"task-1::spec",
		);
	});

	it("only a `delivered` outcome can pick speculative (a non-delivered outcome never does)", () => {
		expect(t({ reviewDelivered: false, reviewPreferred: "speculative", persistedPreferred: "speculative" })).toEqual({
			preferredSpeculative: false,
			deliveredBranchTaskId: "task-1",
		});
	});
});
