import { describe, expect, it } from "vitest";
import { countActiveAgentSessions, countAttentionParkedSessions } from "../../../src/core/task-session-api-contract";

describe("countActiveAgentSessions", () => {
	it("counts running and queued states, ignoring the rest", () => {
		const counts = countActiveAgentSessions([
			{ state: "running" },
			{ state: "running" },
			{ state: "queued" },
			{ state: "awaiting_review" },
			{ state: "idle" },
		]);
		expect(counts).toEqual({ running: 2, queued: 1 });
	});

	it("is zero for an empty set", () => {
		expect(countActiveAgentSessions([])).toEqual({ running: 0, queued: 0 });
	});
});

describe("countAttentionParkedSessions", () => {
	it("counts ONLY awaiting_review sessions parked for operator attention", () => {
		const parked = countAttentionParkedSessions([
			{ state: "awaiting_review", reviewReason: "attention" }, // ✓ needs a human
			{ state: "awaiting_review", reviewReason: "attention" }, // ✓
			{ state: "awaiting_review", reviewReason: "exit" }, // ✗ not an operator question
			{ state: "awaiting_review", reviewReason: null }, // ✗
			{ state: "running", reviewReason: "attention" }, // ✗ not parked
		]);
		expect(parked).toBe(2);
	});

	it("is zero when nothing is parked for attention", () => {
		expect(countAttentionParkedSessions([{ state: "idle", reviewReason: null }])).toBe(0);
	});
});
