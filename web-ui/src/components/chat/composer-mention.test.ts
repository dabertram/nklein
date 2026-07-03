import { describe, expect, it } from "vitest";
import {
	applyMention,
	filterMentionCandidates,
	getActiveMention,
	type MentionCandidate,
} from "@/components/chat/composer-mention";

const CANDIDATES: readonly MentionCandidate[] = [
	{ kind: "card", id: "habit-classify-trends", title: "Classify trends" },
	{ kind: "card", id: "habit-trend-tests", title: "Expand trend tests" },
	{ kind: "stream", id: "habit-insights", title: "habit insights" },
];

describe("composer @-mentions (§5.BB)", () => {
	it("detects a mention at start, after whitespace, and tracks the typed query", () => {
		expect(getActiveMention("@", 1)).toEqual({ start: 0, query: "" });
		expect(getActiveMention("fix @tre", 8)).toEqual({ start: 4, query: "tre" });
		// caret mid-draft: only the text before the caret counts
		expect(getActiveMention("@tre later words", 4)).toEqual({ start: 0, query: "tre" });
	});

	it("stays closed for emails, whitespace after @, and drafts without @", () => {
		expect(getActiveMention("mail user@host", 14)).toBeNull();
		expect(getActiveMention("@card done", 10)).toBeNull();
		expect(getActiveMention("no mention", 10)).toBeNull();
	});

	it("ranks title-prefix over title-substring over id-substring and caps output", () => {
		expect(filterMentionCandidates("trend", CANDIDATES).map((c) => c.id)).toEqual([
			// "Expand trend tests" contains, "Classify trends" contains — both substring rank, alpha by title;
			// none title-prefix; the stream matches only via id? ("habit insights" has no "trend") — excluded.
			"habit-classify-trends",
			"habit-trend-tests",
		]);
		expect(filterMentionCandidates("habit", CANDIDATES).map((c) => c.id)).toEqual([
			"habit-insights", // title prefix
			"habit-classify-trends", // id substring
			"habit-trend-tests",
		]);
		expect(filterMentionCandidates("", CANDIDATES)).toHaveLength(3);
		expect(filterMentionCandidates("zzz", CANDIDATES)).toEqual([]);
	});

	it("applyMention swaps the token for the explicit handle and re-places the caret", () => {
		const mention = { start: 4, query: "tre" };
		const applied = applyMention("fix @tre now", mention, 8, {
			kind: "card",
			id: "habit-trend-tests",
			title: "Expand trend tests",
		});
		expect(applied.next).toBe("fix @card:habit-trend-tests  now");
		expect(applied.caret).toBe("fix @card:habit-trend-tests ".length);
	});
});
