import { describe, expect, it } from "vitest";
import { resolveConflictByRecency } from "../../../src/core/citation-conflict-recency";

const NOW = new Date("2026-07-03T00:00:00.000Z");

describe("resolveConflictByRecency (§5.AC recency tie-break)", () => {
	it("picks the newest-dated claim as the winner and supersedes the rest", () => {
		const result = resolveConflictByRecency(
			[
				{ id: "old", publishedAt: "2024-01-01T00:00:00.000Z" },
				{ id: "newest", publishedAt: "2026-05-01T00:00:00.000Z" },
				{ id: "mid", publishedAt: "2025-06-01T00:00:00.000Z" },
			],
			NOW,
		);
		expect(result.winnerId).toBe("newest");
		expect(result.supersededIds).toEqual(["old", "mid"]);
		expect(result.winnerPublishedIso).toBe("2026-05-01T00:00:00.000Z");
	});

	it("tolerates Date, epoch-ms, and ISO-string dates interchangeably", () => {
		const result = resolveConflictByRecency(
			[
				{ id: "a", publishedAt: new Date("2025-01-01T00:00:00.000Z") },
				{ id: "b", publishedAt: Date.parse("2025-06-01T00:00:00.000Z") },
				{ id: "c", publishedAt: "2025-03-01T00:00:00.000Z" },
			],
			NOW,
		);
		expect(result.winnerId).toBe("b");
	});

	it("future-clamps a dated-ahead claim to now so clock skew can't win over a genuinely-newer one", () => {
		const result = resolveConflictByRecency(
			[
				{ id: "future", publishedAt: "2027-01-01T00:00:00.000Z" }, // ahead of NOW → clamps to NOW
				{ id: "today", publishedAt: NOW },
			],
			NOW,
		);
		// Both effective-date to NOW; the tie keeps stable input order (future came first).
		expect(result.winnerId).toBe("future");
		expect(result.winnerPublishedIso).toBe(NOW.toISOString());
	});

	it("sorts undated claims last (a dated claim always beats an undated one)", () => {
		const result = resolveConflictByRecency(
			[
				{ id: "undated" },
				{ id: "dated", publishedAt: "2020-01-01T00:00:00.000Z" },
				{ id: "null-date", publishedAt: null },
			],
			NOW,
		);
		expect(result.winnerId).toBe("dated");
		expect(result.supersededIds).toEqual(["undated", "null-date"]);
	});

	it("breaks ties (equal or all-undated) by stable input order and never fabricates a date", () => {
		const equal = resolveConflictByRecency(
			[
				{ id: "first", publishedAt: "2025-01-01T00:00:00.000Z" },
				{ id: "second", publishedAt: "2025-01-01T00:00:00.000Z" },
			],
			NOW,
		);
		expect(equal.winnerId).toBe("first");

		const allUndated = resolveConflictByRecency([{ id: "x" }, { id: "y", publishedAt: "not a date" }], NOW);
		expect(allUndated.winnerId).toBe("x");
		expect(allUndated.winnerPublishedIso).toBeNull();
		expect(allUndated.reason).toContain("no claim");
	});

	it("handles a single claim and an empty group", () => {
		expect(resolveConflictByRecency([{ id: "only", publishedAt: "2025-01-01T00:00:00.000Z" }], NOW)).toMatchObject({
			winnerId: "only",
			supersededIds: [],
		});
		expect(resolveConflictByRecency([], NOW)).toMatchObject({ winnerId: null, supersededIds: [] });
	});
});
