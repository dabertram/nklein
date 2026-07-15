import { describe, expect, it } from "vitest";
import {
	resolveClaimConflictByAuthority,
	resolveClaimConflictsByAuthorityBatch,
} from "../../../src/core/citation-conflict-authority";
import type { RankableSource } from "../../../src/core/retrieval-freshness-authority-rank";

const NOW = new Date("2026-07-15T00:00:00Z");

describe("resolveClaimConflictByAuthority (F4.5)", () => {
	it("prefers the newer, more-authoritative source; retains the minority as superseded", () => {
		const sources: RankableSource[] = [
			{ id: "blog-old", url: "https://randomblog.example", publishedAt: "2023-01-01" },
			{ id: "official-new", url: "https://nodejs.org/en/blog", publishedAt: "2026-06-01" },
		];
		const result = resolveClaimConflictByAuthority(sources, NOW);
		expect(result.winnerId).toBe("official-new");
		expect(result.supersededIds).toEqual(["blog-old"]); // minority retained, not discarded
		expect(result.unresolved).toBe(false);
	});

	it("marks the conflict UNRESOLVED when no source beats the runner-up by the margin", () => {
		// Two comparably-fresh, comparably-authoritative official sources → no clear winner.
		const sources: RankableSource[] = [
			{ id: "a", url: "https://nodejs.org/a", publishedAt: "2026-06-01" },
			{ id: "b", url: "https://nodejs.org/b", publishedAt: "2026-06-02" },
		];
		const result = resolveClaimConflictByAuthority(sources, NOW, { minMargin: 0.2 });
		expect(result.winnerId).toBeNull();
		expect(result.unresolved).toBe(true);
		expect(result.supersededIds).toEqual(["a", "b"]); // everything retained
	});

	it("a single source wins trivially; an empty group is a no-op non-conflict", () => {
		expect(resolveClaimConflictByAuthority([{ id: "only" }], NOW)).toMatchObject({
			winnerId: "only",
			unresolved: false,
		});
		expect(resolveClaimConflictByAuthority([], NOW)).toMatchObject({ winnerId: null, unresolved: false });
	});

	it("batch resolves each group independently, index-aligned (a winner never leaks across groups)", () => {
		const groups: RankableSource[][] = [
			[
				{ id: "g0-old", publishedAt: "2020-01-01" },
				{ id: "g0-new", url: "https://docs.python.org", publishedAt: "2026-01-01" },
			],
			[{ id: "g1-solo", url: "https://go.dev" }],
		];
		const results = resolveClaimConflictsByAuthorityBatch(groups, NOW);
		expect(results).toHaveLength(2);
		expect(results[0]?.winnerId).toBe("g0-new");
		expect(results[1]?.winnerId).toBe("g1-solo");
		// g0's winner does not appear in g1's superseded set.
		expect(results[1]?.supersededIds).not.toContain("g0-new");
	});
});
