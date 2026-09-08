import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearModelDeadMark,
	listModelDeadMarks,
	markModelDead,
	resetModelLivenessLedgerForTests,
} from "../../../src/core/model-liveness-ledger";
import {
	runtimeClearModelDeadMarkRequestSchema,
	runtimeClearModelDeadMarkResponseSchema,
	runtimeListModelDeadMarksResponseSchema,
} from "../../../src/core/nklein-ops-api-contract";

/**
 * P0.AUDIT0904 leg 11: a marked model is excluded from routing for up to four hours and nothing exposed that fact
 * or let an operator undo it — a model that recovered early sat out its whole TTL invisibly. These assert the
 * contract the tRPC handles are built on (the handles themselves are thin wrappers over the ledger).
 */
describe("model dead-mark operator handle", () => {
	beforeEach(() => resetModelLivenessLedgerForTests());

	it("lists every live mark in the response shape, endpoint included", () => {
		const legion = "http://legion:1234/v1";
		markModelDead({ modelId: "dirk", endpoint: legion, reason: "listed_but_dead", nowMs: 0, ttlMs: 60_000 });
		markModelDead({
			modelId: "dirk",
			endpoint: "http://m4mini:1234/v1",
			reason: "absent_from_listing",
			nowMs: 0,
			ttlMs: 60_000,
		});
		const response = runtimeListModelDeadMarksResponseSchema.parse({ marks: listModelDeadMarks(1) });
		expect(response.marks).toHaveLength(2);
		expect(response.marks.map((mark) => mark.endpoint).sort()).toEqual([legion, "http://m4mini:1234/v1"]);
		expect(response.marks.every((mark) => mark.expiresAtMs > mark.markedAtMs)).toBe(true);
	});

	it("clears one endpoint or every endpoint, and reports how many marks it actually removed", () => {
		const a = "http://a/v1";
		const b = "http://b/v1";
		markModelDead({ modelId: "m", endpoint: a, reason: "listed_but_dead", nowMs: 0, ttlMs: 60_000 });
		markModelDead({ modelId: "m", endpoint: b, reason: "listed_but_dead", nowMs: 0, ttlMs: 60_000 });

		// One host: the count is what the clear removes, not what was asked for.
		const single = runtimeClearModelDeadMarkRequestSchema.parse({ modelId: "m", endpoint: a });
		const removedSingle = listModelDeadMarks(1).filter(
			(mark) => mark.modelId === single.modelId && mark.endpoint === single.endpoint,
		);
		clearModelDeadMark(single.modelId, single.endpoint ?? undefined);
		expect(
			runtimeClearModelDeadMarkResponseSchema.parse({ ok: true, cleared: removedSingle.length, error: null })
				.cleared,
		).toBe(1);
		expect(listModelDeadMarks(1).map((mark) => mark.endpoint)).toEqual([b]);

		// Every endpoint: `endpoint` omitted is the documented "re-admit everywhere".
		const all = runtimeClearModelDeadMarkRequestSchema.parse({ modelId: "m" });
		expect(all.endpoint).toBeUndefined();
		clearModelDeadMark(all.modelId, all.endpoint ?? undefined);
		expect(listModelDeadMarks(1)).toHaveLength(0);
	});

	it("reports zero cleared when nothing was marked (never claims work it did not do)", () => {
		const removed = listModelDeadMarks(1).filter((mark) => mark.modelId === "never-marked");
		clearModelDeadMark("never-marked");
		expect(
			runtimeClearModelDeadMarkResponseSchema.parse({ ok: true, cleared: removed.length, error: null }).cleared,
		).toBe(0);
	});

	it("rejects a blank modelId at the schema boundary", () => {
		expect(() => runtimeClearModelDeadMarkRequestSchema.parse({ modelId: "" })).toThrow();
	});
});
