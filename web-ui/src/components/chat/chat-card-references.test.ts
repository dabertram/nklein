import { describe, expect, it } from "vitest";
import { segmentChatMessage } from "@/components/chat/chat-card-references";

const CARDS = [
	{ id: "habit-insights-classify-trends", title: "Classify trends" },
	{ id: "habit-insights-trend-tests", title: "Expand trend tests" },
	{ id: "cli", title: "CLI" }, // too short to title-match; id still matches exactly
];

describe("segmentChatMessage (§5.BB chat↔board chips)", () => {
	it("chips a card title (case-insensitive, word-bounded) inside prose", () => {
		const segments = segmentChatMessage("I bounced classify trends back to the worker.", CARDS);
		expect(segments).toEqual([
			{ kind: "text", text: "I bounced " },
			{ kind: "card", cardId: "habit-insights-classify-trends", label: "classify trends" },
			{ kind: "text", text: " back to the worker." },
		]);
	});

	it("prefers the longest title on overlap and chips exact card ids", () => {
		const segments = segmentChatMessage("Expand trend tests depends on habit-insights-classify-trends.", CARDS);
		expect(segments[0]).toEqual({ kind: "card", cardId: "habit-insights-trend-tests", label: "Expand trend tests" });
		expect(segments.some((s) => s.kind === "card" && s.cardId === "habit-insights-classify-trends")).toBe(true);
	});

	it("does not title-match too-short titles, and passes plain text through untouched", () => {
		expect(segmentChatMessage("the CLI prints a summary", CARDS)).toEqual([
			{ kind: "text", text: "the CLI prints a summary" },
		]);
		expect(segmentChatMessage("nothing to see", [])).toEqual([{ kind: "text", text: "nothing to see" }]);
	});

	it("does not match inside larger words", () => {
		const segments = segmentChatMessage("reclassify trendsetters", CARDS);
		expect(segments).toEqual([{ kind: "text", text: "reclassify trendsetters" }]);
	});
});
