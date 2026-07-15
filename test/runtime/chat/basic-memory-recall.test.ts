import { describe, expect, it } from "vitest";
import { rankBasicMemoryNotesForRecall } from "../../../src/chat/basic-memory-recall";
import type { BasicMemoryRecallSource } from "../../../src/core/basic-memory-note-reader";

const source = (permalink: string, title: string, body: string): BasicMemoryRecallSource => ({
	permalink,
	title,
	body,
});

describe("rankBasicMemoryNotesForRecall (F2.9b)", () => {
	const notes: BasicMemoryRecallSource[] = [
		source(
			"bugs/oauth-retry",
			"OAuth retry after auth",
			"The provider retries the request once after the OAuth flow completes.",
		),
		source("decisions/db-choice", "Database choice", "We picked SQLite for the local-only kanban board persistence."),
		source("gotchas/timezone", "Timezone parsing", "Dates must be parsed as UTC to avoid off-by-one day bugs."),
	];

	it("ranks by query relevance and returns the projectUnifiedMemory input shape", () => {
		const ranked = rankBasicMemoryNotesForRecall(notes, "oauth retry flow", 6);
		expect(ranked[0]?.permalink).toBe("bugs/oauth-retry");
		expect(ranked[0]?.title).toBe("OAuth retry after auth");
		expect(ranked[0]?.score).toBeGreaterThan(0);
		expect(ranked[0]?.excerpt).toContain("OAuth flow");
	});

	it("drops notes with no query overlap and caps the result", () => {
		const ranked = rankBasicMemoryNotesForRecall(notes, "database sqlite persistence", 1);
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.permalink).toBe("decisions/db-choice");
	});

	it("returns nothing when the query matches no note", () => {
		expect(rankBasicMemoryNotesForRecall(notes, "kubernetes helm chart deployment", 6)).toEqual([]);
	});

	it("truncates the excerpt and collapses whitespace", () => {
		const long = source("x/y", "Title", `word ${" filler".repeat(200)}`);
		const ranked = rankBasicMemoryNotesForRecall([long], "word filler", 6);
		expect(ranked[0]?.excerpt.length).toBeLessThanOrEqual(240);
		expect(ranked[0]?.excerpt).not.toContain("  ");
	});
});
