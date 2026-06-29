import { describe, expect, it } from "vitest";
import {
	buildTemporalAwarenessPrompt,
	isTemporalContextRelevant,
	resolveTemporalAwareness,
} from "../../../src/core/temporal-awareness";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

describe("resolveTemporalAwareness", () => {
	it("distils the authoritative date facts (UTC)", () => {
		const t = resolveTemporalAwareness(new Date("2026-06-26T21:05:00Z"));
		expect(t.iso).toBe("2026-06-26T21:05:00.000Z");
		expect(t.todayIso).toBe("2026-06-26");
		expect(t.tomorrowIso).toBe("2026-06-27");
		expect(t.yesterdayIso).toBe("2026-06-25");
		expect(t.year).toBe(2026);
		expect(WEEKDAYS).toContain(t.weekday);
		expect(t.human).toContain("26 June 2026");
		expect(t.human).toContain("21:05 UTC");
	});

	it("maps the weekday correctly (the Unix epoch 1970-01-01 was a Thursday)", () => {
		expect(resolveTemporalAwareness(new Date("1970-01-01T00:00:00Z")).weekday).toBe("Thursday");
	});

	it("rolls tomorrow/yesterday across month and year boundaries", () => {
		expect(resolveTemporalAwareness(new Date("2026-12-31T12:00:00Z")).tomorrowIso).toBe("2027-01-01");
		expect(resolveTemporalAwareness(new Date("2026-01-01T12:00:00Z")).yesterdayIso).toBe("2025-12-31");
	});
});

describe("buildTemporalAwarenessPrompt", () => {
	it("defaults to a DATE-ONLY block (cache-stable to the day — §5.AQ-D) with the override framing", () => {
		const block = buildTemporalAwarenessPrompt(new Date("2026-06-26T21:05:00Z"));
		expect(block).toContain("<current_date>");
		expect(block).toContain("</current_date>");
		expect(block).toContain("2026-06-26");
		expect(block).toContain("tomorrow is 2026-06-27");
		// The crux: frame the date as ground truth that overrides the model's stale training-cutoff date priors.
		expect(block).toContain("cutoff in the PAST");
		expect(block).toContain("ground truth");
		expect(block.toLowerCase()).toContain("freshness");
		// Cache-crucial: NO wall-clock time in the default block (a minute-level timestamp would churn the cache every turn).
		expect(block).not.toContain("21:05");
		expect(block).not.toContain("<current_datetime>");
	});

	it('includes the wall-clock time only when granularity:"datetime" is requested', () => {
		const block = buildTemporalAwarenessPrompt(new Date("2026-06-26T21:05:00Z"), { granularity: "datetime" });
		expect(block).toContain("<current_datetime>");
		expect(block).toContain("21:05 UTC");
		expect(block).toContain("2026-06-26");
		expect(block).toContain("ground truth");
	});
});

describe("isTemporalContextRelevant (§5.AE)", () => {
	it("is true for temporal/freshness markers in the text", () => {
		for (const text of [
			"what is the latest version of React?",
			"is this library deprecated?",
			"summarize the news today",
			"what changed recently in the API",
			"give me the newest release notes",
			"is package X up to date?",
			"what happened at WWDC 2026",
			"plan the work for next month",
		]) {
			expect(isTemporalContextRelevant({ text })).toBe(true);
		}
	});

	it("is false for a plain coding task with no temporal signal", () => {
		for (const text of [
			"implement a binary search function",
			"fix the null check in the parser",
			"add a unit test for the focus chain",
			"refactor the current implementation into smaller modules", // "current" alone is not a trigger
		]) {
			expect(isTemporalContextRelevant({ text })).toBe(false);
		}
	});

	it("is true for a temporally-relevant role regardless of text", () => {
		expect(isTemporalContextRelevant({ text: "do the thing", role: "retriever" })).toBe(true);
		expect(isTemporalContextRelevant({ text: "do the thing", role: "researcher" })).toBe(true);
		expect(isTemporalContextRelevant({ text: "do the thing", role: "worker" })).toBe(false);
	});

	it("is false for empty/absent input", () => {
		expect(isTemporalContextRelevant({})).toBe(false);
		expect(isTemporalContextRelevant({ text: "   " })).toBe(false);
		expect(isTemporalContextRelevant({ text: null })).toBe(false);
	});
});
