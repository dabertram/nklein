import { describe, expect, it } from "vitest";
import { mapTaskSessionStateToDurableRunReaction } from "../../../src/core/durable-run-reaction";

describe("mapTaskSessionStateToDurableRunReaction", () => {
	it("awaiting_review (agent finished) → report succeeded", () => {
		expect(mapTaskSessionStateToDurableRunReaction("awaiting_review")).toEqual({
			type: "report",
			outcome: "succeeded",
			error: null,
		});
	});

	it("failed / interrupted → report failed, carrying the error text for transient classification", () => {
		expect(mapTaskSessionStateToDurableRunReaction("failed", "Body Timeout Error")).toEqual({
			type: "report",
			outcome: "failed",
			error: "Body Timeout Error",
		});
		expect(mapTaskSessionStateToDurableRunReaction("interrupted")).toEqual({
			type: "report",
			outcome: "failed",
			error: null,
		});
	});

	it("running → heartbeat (keep the lease alive)", () => {
		expect(mapTaskSessionStateToDurableRunReaction("running")).toEqual({ type: "heartbeat" });
	});

	it("non-actionable states map to none", () => {
		for (const state of ["idle", "queued", "paused"] as const) {
			expect(mapTaskSessionStateToDurableRunReaction(state)).toEqual({ type: "none" });
		}
	});
});
