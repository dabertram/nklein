import { beforeEach, describe, expect, it } from "vitest";
import {
	clearModelDeadMark,
	getModelDeadMark,
	isModelMarkedDead,
	listModelDeadMarks,
	markModelDead,
	resetModelLivenessLedgerForTests,
} from "../../../src/core/model-liveness-ledger";

describe("model-liveness ledger (P0.POOLLOSS)", () => {
	beforeEach(() => {
		resetModelLivenessLedgerForTests();
	});

	it("marks a model dead and exposes it until the TTL expires", () => {
		const mark = markModelDead({
			modelId: "dirk-qwen3.8-27b",
			endpoint: "http://127.0.0.1:8081/v1",
			reason: "listed_but_dead",
			nowMs: 1_000,
			ttlMs: 60_000,
		});
		expect(mark.expiresAtMs).toBe(61_000);
		expect(isModelMarkedDead("dirk-qwen3.8-27b", 2_000)).toBe(true);
		expect(getModelDeadMark("dirk-qwen3.8-27b", 2_000)?.reason).toBe("listed_but_dead");
		// TTL boundary re-admits (and drops the mark on read).
		expect(isModelMarkedDead("dirk-qwen3.8-27b", 61_000)).toBe(false);
		expect(getModelDeadMark("dirk-qwen3.8-27b", 2_000)).toBeUndefined();
	});

	it("re-marking refreshes the TTL and reason", () => {
		markModelDead({ modelId: "m", endpoint: "e", reason: "absent_from_listing", nowMs: 0, ttlMs: 10 });
		markModelDead({ modelId: "m", endpoint: "e", reason: "listed_but_dead", nowMs: 5, ttlMs: 100 });
		expect(getModelDeadMark("m", 50)?.reason).toBe("listed_but_dead");
	});

	it("clearModelDeadMark re-admits immediately (recovery probe saw it serve)", () => {
		markModelDead({ modelId: "m", endpoint: "e", reason: "absent_from_listing", nowMs: 0, ttlMs: 60_000 });
		expect(clearModelDeadMark("m")).toBe(true);
		expect(isModelMarkedDead("m", 1)).toBe(false);
		expect(clearModelDeadMark("m")).toBe(false);
	});

	it("listModelDeadMarks returns only live marks and prunes expired ones", () => {
		markModelDead({ modelId: "a", endpoint: "e", reason: "absent_from_listing", nowMs: 0, ttlMs: 10 });
		markModelDead({ modelId: "b", endpoint: "e", reason: "listed_but_dead", nowMs: 0, ttlMs: 100 });
		const live = listModelDeadMarks(50);
		expect(live.map((mark) => mark.modelId)).toEqual(["b"]);
		expect(isModelMarkedDead("a", 50)).toBe(false);
	});

	it("an unmarked model is never dead", () => {
		expect(isModelMarkedDead("never-marked")).toBe(false);
	});
});
