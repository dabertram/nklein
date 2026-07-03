import { describe, expect, it } from "vitest";
import { resolveClaimConflictsBatch } from "../../../src/core/citation-conflict-batch";

const NOW = new Date("2026-07-03T00:00:00.000Z");

describe("resolveClaimConflictsBatch (§5.AC batch recency tie-break)", () => {
	it("CENTERPIECE: resolves two independent groups in isolation — no cross-group supersession", () => {
		const groupA = [
			{ id: "a-old", publishedAt: "2024-01-01T00:00:00.000Z" },
			{ id: "a-new", publishedAt: "2026-05-01T00:00:00.000Z" },
		];
		const groupB = [
			{ id: "b-old", publishedAt: "2023-01-01T00:00:00.000Z" },
			{ id: "b-new", publishedAt: "2025-12-01T00:00:00.000Z" },
		];
		const results = resolveClaimConflictsBatch([groupA, groupB], NOW);

		// One resolution per group, index-aligned.
		expect(results).toHaveLength(2);

		// Each group elects its own winner from its own members only.
		expect(results[0]?.winnerId).toBe("a-new");
		expect(results[1]?.winnerId).toBe("b-new");

		// ISOLATION: group A's winner never appears in group B's supersededIds and vice-versa,
		// and no group ever supersedes an id that belongs to the other group.
		const groupAIds = groupA.map((c) => c.id);
		const groupBIds = groupB.map((c) => c.id);
		expect(results[0]?.supersededIds).toEqual(["a-old"]);
		expect(results[1]?.supersededIds).toEqual(["b-old"]);
		for (const superseded of results[0]?.supersededIds ?? []) {
			expect(groupBIds).not.toContain(superseded);
			expect(groupAIds).toContain(superseded);
		}
		for (const superseded of results[1]?.supersededIds ?? []) {
			expect(groupAIds).not.toContain(superseded);
			expect(groupBIds).toContain(superseded);
		}
		// The winner of A is not touched by B's resolution, and vice-versa.
		expect(results[1]?.supersededIds).not.toContain("a-new");
		expect(results[0]?.supersededIds).not.toContain("b-new");
	});

	it("returns [] for an empty group list", () => {
		expect(resolveClaimConflictsBatch([], NOW)).toEqual([]);
	});

	it("clamps a future-dated newest claim per the single resolver rule (clock skew can't win)", () => {
		// Group's newest raw date is ahead of NOW → clamps to NOW; a claim exactly at NOW ties and
		// stable input order keeps the future-dated one (it came first), mirroring resolveConflictByRecency.
		const results = resolveClaimConflictsBatch(
			[
				[
					{ id: "future", publishedAt: "2027-01-01T00:00:00.000Z" },
					{ id: "today", publishedAt: NOW },
					{ id: "old", publishedAt: "2020-01-01T00:00:00.000Z" },
				],
			],
			NOW,
		);
		expect(results[0]?.winnerId).toBe("future");
		expect(results[0]?.winnerPublishedIso).toBe(NOW.toISOString());
		expect(results[0]?.supersededIds).toEqual(["today", "old"]);
	});

	it("handles an empty inner group gracefully (mirrors the single resolver's empty-group result)", () => {
		const results = resolveClaimConflictsBatch([[], [{ id: "solo", publishedAt: "2025-01-01T00:00:00.000Z" }]], NOW);
		expect(results).toHaveLength(2);
		// Empty inner group → null winner, no supersession, no fabricated date (same shape as the single resolver).
		expect(results[0]).toMatchObject({ winnerId: null, supersededIds: [], winnerPublishedIso: null });
		// The non-empty group alongside it still resolves normally — the empty group doesn't perturb its neighbor.
		expect(results[1]).toMatchObject({ winnerId: "solo", supersededIds: [] });
	});

	it("is index-aligned and order-preserving across a mixed batch", () => {
		const results = resolveClaimConflictsBatch(
			[
				[{ id: "g0", publishedAt: "2025-01-01T00:00:00.000Z" }],
				[
					{ id: "g1-a", publishedAt: "2021-01-01T00:00:00.000Z" },
					{ id: "g1-b", publishedAt: "2022-01-01T00:00:00.000Z" },
				],
				[{ id: "g2-undated" }],
			],
			NOW,
		);
		expect(results.map((r) => r.winnerId)).toEqual(["g0", "g1-b", "g2-undated"]);
	});
});
