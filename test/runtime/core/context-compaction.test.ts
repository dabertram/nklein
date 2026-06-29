import { describe, expect, it } from "vitest";
import {
	type CompactableMessage,
	type CompactionPlan,
	planCompaction,
	shouldCompact,
} from "../../../src/core/context-compaction";

function msg(role: CompactableMessage["role"], tokens: number, pinned?: boolean): CompactableMessage {
	return pinned === undefined ? { role, tokens } : { role, tokens, pinned };
}

/** Re-collect every index across the three buckets, sorted — used to assert the partition invariant. */
function allIndices(plan: CompactionPlan): number[] {
	return [...plan.keepVerbatim, ...plan.summarize, ...plan.drop].sort((a, b) => a - b);
}

describe("shouldCompact", () => {
	it("does not fire below the threshold and fires above it", () => {
		expect(shouldCompact({ usedTokens: 7900, windowTokens: 10000 })).toBe(false);
		expect(shouldCompact({ usedTokens: 8100, windowTokens: 10000 })).toBe(true);
	});

	it("fires at the EXACT 80% boundary (used == 0.8 * window → true)", () => {
		expect(shouldCompact({ usedTokens: 8000, windowTokens: 10000 })).toBe(true);
	});

	it("honors a custom thresholdFraction", () => {
		expect(shouldCompact({ usedTokens: 5000, windowTokens: 10000, thresholdFraction: 0.5 })).toBe(true);
		expect(shouldCompact({ usedTokens: 4999, windowTokens: 10000, thresholdFraction: 0.5 })).toBe(false);
	});

	it("never compacts when windowTokens <= 0 (guard)", () => {
		expect(shouldCompact({ usedTokens: 999999, windowTokens: 0 })).toBe(false);
		expect(shouldCompact({ usedTokens: 999999, windowTokens: -10 })).toBe(false);
	});
});

describe("planCompaction", () => {
	it("keeps system + pinned + the recent-within-budget slice verbatim", () => {
		const messages: CompactableMessage[] = [
			msg("system", 50), // 0 — system → always verbatim
			msg("user", 100, true), // 1 — pinned → always verbatim
			msg("assistant", 100), // 2 — old, non-pinned → summarize
			msg("user", 30), // 3 — recent (within budget)
			msg("assistant", 40), // 4 — recent (within budget)
		];
		const plan = planCompaction({ messages, keepRecentTokens: 100 });
		// recency from the end: 40 (idx4) + 30 (idx3) = 70 <= 100; idx2 would push to 170 > 100 → stops.
		expect(plan.keepVerbatim).toEqual([0, 1, 3, 4]);
		expect(plan.summarize).toEqual([2]);
		expect(plan.drop).toEqual([]);
	});

	it("DROPS an old tool message (raw tool output is the safest to clear)", () => {
		const messages: CompactableMessage[] = [
			msg("tool", 500), // 0 — old tool output → drop
			msg("user", 10), // 1 — recent
		];
		const plan = planCompaction({ messages, keepRecentTokens: 50 });
		expect(plan.drop).toEqual([0]);
		expect(plan.keepVerbatim).toEqual([1]);
		expect(plan.summarize).toEqual([]);
	});

	it("SUMMARIZES an old user/assistant message (may carry decisions/bugs/state)", () => {
		const messages: CompactableMessage[] = [
			msg("user", 200), // 0 — old user → summarize
			msg("assistant", 200), // 1 — old assistant → summarize
			msg("user", 5), // 2 — recent
		];
		const plan = planCompaction({ messages, keepRecentTokens: 10 });
		expect(plan.summarize).toEqual([0, 1]);
		expect(plan.keepVerbatim).toEqual([2]);
		expect(plan.drop).toEqual([]);
	});

	it("keeps a message sitting EXACTLY at the recency budget edge (cumulative == budget → verbatim)", () => {
		const messages: CompactableMessage[] = [
			msg("assistant", 60), // 0 — older → summarize
			msg("user", 40), // 1 — brings cumulative to exactly 100 → kept
			msg("assistant", 60), // 2 — recent (60 <= 100)
		];
		// from end: 60 (idx2) → then +40 (idx1) = 100 == budget → kept; +60 (idx0) = 160 > 100 → stops.
		const plan = planCompaction({ messages, keepRecentTokens: 100 });
		expect(plan.keepVerbatim).toEqual([1, 2]);
		expect(plan.summarize).toEqual([0]);
	});

	it("does NOT keep a message that would push cumulative one token over the budget", () => {
		const messages: CompactableMessage[] = [
			msg("user", 41), // 0 — would push 60+41 = 101 > 100 → excluded → summarize
			msg("assistant", 60), // 1 — recent
		];
		const plan = planCompaction({ messages, keepRecentTokens: 100 });
		expect(plan.keepVerbatim).toEqual([1]);
		expect(plan.summarize).toEqual([0]);
	});

	it("partitions every index into exactly one bucket, ascending within each", () => {
		const messages: CompactableMessage[] = [
			msg("system", 20), // 0 → verbatim (system)
			msg("user", 300), // 1 → summarize (old)
			msg("tool", 400), // 2 → drop (old tool)
			msg("assistant", 300, true), // 3 → verbatim (pinned)
			msg("tool", 500), // 4 → drop (old tool)
			msg("user", 10), // 5 → verbatim (recent)
			msg("assistant", 15), // 6 → verbatim (recent)
		];
		const plan = planCompaction({ messages, keepRecentTokens: 30 });
		// Union covers all indices exactly once.
		expect(allIndices(plan)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		const total = plan.keepVerbatim.length + plan.summarize.length + plan.drop.length;
		expect(total).toBe(messages.length);
		// No index shared across buckets.
		const seen = new Set<number>();
		for (const index of allIndices(plan)) {
			expect(seen.has(index)).toBe(false);
			seen.add(index);
		}
		// Each bucket ascending.
		for (const bucket of [plan.keepVerbatim, plan.summarize, plan.drop]) {
			expect(bucket).toEqual([...bucket].sort((a, b) => a - b));
		}
		expect(plan.keepVerbatim).toEqual([0, 3, 5, 6]);
		expect(plan.summarize).toEqual([1]);
		expect(plan.drop).toEqual([2, 4]);
	});

	it("returns an empty plan for empty messages", () => {
		const plan = planCompaction({ messages: [], keepRecentTokens: 100 });
		expect(plan).toEqual({ keepVerbatim: [], summarize: [], drop: [] });
	});

	it("keeps a pinned tool message verbatim instead of dropping it (pin wins over role)", () => {
		const messages: CompactableMessage[] = [
			msg("tool", 500, true), // 0 — pinned tool → verbatim, NOT dropped
			msg("user", 5), // 1 — recent
		];
		const plan = planCompaction({ messages, keepRecentTokens: 10 });
		expect(plan.keepVerbatim).toEqual([0, 1]);
		expect(plan.drop).toEqual([]);
		expect(plan.summarize).toEqual([]);
	});
});
