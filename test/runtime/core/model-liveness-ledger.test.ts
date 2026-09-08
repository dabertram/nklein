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

	it("re-marks escalate the default TTL (15m -> 30m -> 60m, capped) and clear resets the escalation", () => {
		const first = markModelDead({ modelId: "m", endpoint: "e", reason: "listed_but_dead", nowMs: 0 });
		expect(first.expiresAtMs).toBe(15 * 60_000);
		// TTL expiry re-admits, but the next victim's re-mark doubles the window.
		const second = markModelDead({ modelId: "m", endpoint: "e", reason: "listed_but_dead", nowMs: 0 });
		expect(second.expiresAtMs).toBe(30 * 60_000);
		const third = markModelDead({ modelId: "m", endpoint: "e", reason: "listed_but_dead", nowMs: 0 });
		expect(third.expiresAtMs).toBe(60 * 60_000);
		// Escalation caps at 4h no matter how many strikes.
		for (let i = 0; i < 10; i += 1) {
			markModelDead({ modelId: "m", endpoint: "e", reason: "listed_but_dead", nowMs: 0 });
		}
		expect(getModelDeadMark("m", 1)?.expiresAtMs).toBe(4 * 60 * 60_000);
		// A proven-alive clear resets the strike history: the next mark is back to the base TTL.
		clearModelDeadMark("m");
		const fresh = markModelDead({ modelId: "m", endpoint: "e", reason: "absent_from_listing", nowMs: 0 });
		expect(fresh.expiresAtMs).toBe(15 * 60_000);
	});

	it("keys liveness by (model, ENDPOINT): a model proven dead on one host stays usable on another (P0.AUDIT0904 leg 8)", () => {
		const legion = "http://legion:1234/v1";
		const mini = "http://m4mini:1234/v1";
		markModelDead({ modelId: "dirk", endpoint: legion, reason: "listed_but_dead", nowMs: 0, ttlMs: 60_000 });
		// The host that was proven dead is dead…
		expect(isModelMarkedDead("dirk", { endpoint: legion, nowMs: 1 })).toBe(true);
		// …the same model id on another host is NOT (the bug: one dead relay excluded it fleet-wide).
		expect(isModelMarkedDead("dirk", { endpoint: mini, nowMs: 1 })).toBe(false);
		// A caller that cannot name its endpoint keeps the conservative reading.
		expect(isModelMarkedDead("dirk", 1)).toBe(true);
		expect(isModelMarkedDead("dirk", { nowMs: 1 })).toBe(true);
		expect(getModelDeadMark("dirk", { endpoint: legion, nowMs: 1 })?.endpoint).toBe(legion);
	});

	it("clears and escalates per endpoint, never fleet-wide by accident", () => {
		const a = "http://a/v1";
		const b = "http://b/v1";
		markModelDead({ modelId: "m", endpoint: a, reason: "listed_but_dead", nowMs: 0, ttlMs: 60_000 });
		markModelDead({ modelId: "m", endpoint: b, reason: "absent_from_listing", nowMs: 0, ttlMs: 60_000 });
		expect(listModelDeadMarks(1)).toHaveLength(2);
		// Re-admitting one host leaves the other marked.
		expect(clearModelDeadMark("m", a)).toBe(true);
		expect(isModelMarkedDead("m", { endpoint: a, nowMs: 1 })).toBe(false);
		expect(isModelMarkedDead("m", { endpoint: b, nowMs: 1 })).toBe(true);
		// TTL escalation is per endpoint: re-marking host A does not inherit host B's doubling.
		const reMarkedA = markModelDead({ modelId: "m", endpoint: a, reason: "listed_but_dead", nowMs: 10 });
		const reMarkedB = markModelDead({ modelId: "m", endpoint: b, reason: "listed_but_dead", nowMs: 10 });
		expect(reMarkedA.expiresAtMs - 10).toBeLessThan(reMarkedB.expiresAtMs - 10);
		// The endpoint-less clear still re-admits everything.
		expect(clearModelDeadMark("m")).toBe(true);
		expect(listModelDeadMarks(11)).toHaveLength(0);
	});
});
