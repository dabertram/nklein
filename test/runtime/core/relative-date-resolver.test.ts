import { describe, expect, it } from "vitest";
import { resolveRelativeDate, resolveRelativeDatesInText } from "../../../src/core/relative-date-resolver";
import { judgeRetrievedFreshness } from "../../../src/core/retrieval-freshness";

// Fixed reference "now" for determinism — 2026-06-24 is a WEDNESDAY (UTC). Every expectation below is computed by hand
// against this anchor; nothing reads `new Date()` unmocked.
const NOW = new Date("2026-06-24T14:30:00.000Z");

describe("resolveRelativeDate — named single-day phrases", () => {
	it("resolves today/tonight/tomorrow/yesterday against the injected now", () => {
		expect(resolveRelativeDate("today", NOW)?.dateIso).toBe("2026-06-24");
		expect(resolveRelativeDate("tonight", NOW)?.dateIso).toBe("2026-06-24");
		expect(resolveRelativeDate("tomorrow", NOW)?.dateIso).toBe("2026-06-25");
		expect(resolveRelativeDate("yesterday", NOW)?.dateIso).toBe("2026-06-23");
	});

	it("prefers the more specific compound over the bare word (day before/after)", () => {
		expect(resolveRelativeDate("the day before yesterday", NOW)?.dateIso).toBe("2026-06-22");
		expect(resolveRelativeDate("the day after tomorrow", NOW)?.dateIso).toBe("2026-06-26");
	});

	it("reports unit=day and the correct signed direction", () => {
		expect(resolveRelativeDate("today", NOW)?.direction).toBe(0);
		expect(resolveRelativeDate("yesterday", NOW)?.direction).toBe(-1);
		const t = resolveRelativeDate("tomorrow", NOW);
		expect(t?.direction).toBe(1);
		expect(t?.unit).toBe("day");
	});
});

describe("resolveRelativeDate — N-unit offsets", () => {
	it('resolves "N <unit> ago" for day/week/month/year', () => {
		expect(resolveRelativeDate("3 days ago", NOW)?.dateIso).toBe("2026-06-21");
		expect(resolveRelativeDate("2 weeks ago", NOW)?.dateIso).toBe("2026-06-10");
		expect(resolveRelativeDate("1 month ago", NOW)?.dateIso).toBe("2026-05-24");
		expect(resolveRelativeDate("1 year ago", NOW)?.dateIso).toBe("2025-06-24");
	});

	it('resolves "in N <unit>" into the future', () => {
		expect(resolveRelativeDate("due in 5 days", NOW)?.dateIso).toBe("2026-06-29");
		expect(resolveRelativeDate("in 2 weeks", NOW)?.dateIso).toBe("2026-07-08");
		expect(resolveRelativeDate("in 3 months", NOW)?.dateIso).toBe("2026-09-24");
	});

	it('treats "a"/"an" as 1', () => {
		expect(resolveRelativeDate("a week ago", NOW)?.dateIso).toBe("2026-06-17");
		expect(resolveRelativeDate("in an hour is not a date but a day is", NOW)).toBeNull(); // "hour" is not a supported unit
		expect(resolveRelativeDate("a month ago", NOW)?.dateIso).toBe("2026-05-24");
	});

	it("carries the coarsest named unit + past/future direction", () => {
		const monthAgo = resolveRelativeDate("2 months ago", NOW);
		expect(monthAgo?.unit).toBe("month");
		expect(monthAgo?.direction).toBe(-1);
		const inWeeks = resolveRelativeDate("in 2 weeks", NOW);
		expect(inWeeks?.unit).toBe("week");
		expect(inWeeks?.direction).toBe(1);
	});

	it("N-unit wins over a stray period word in the same phrase", () => {
		// "in 2 weeks" must beat the bare "week" period anchor.
		expect(resolveRelativeDate("in 2 weeks this week", NOW)?.dateIso).toBe("2026-07-08");
	});
});

describe("resolveRelativeDate — last/next weekday", () => {
	it('"last Tuesday" is the most recent PAST Tuesday (strictly before today)', () => {
		// today is Wed 2026-06-24 → last Tuesday is the day before, 2026-06-23.
		const r = resolveRelativeDate("last Tuesday", NOW);
		expect(r?.dateIso).toBe("2026-06-23");
		expect(r?.direction).toBe(-1);
	});

	it('"next Friday" is the soonest FUTURE Friday (strictly after today)', () => {
		// today is Wed 2026-06-24 → the coming Friday is +2 days = 2026-06-26 (a Friday).
		expect(resolveRelativeDate("next Friday", NOW)?.dateIso).toBe("2026-06-26");
	});

	it("a same-weekday last/next resolves a full week away, never today", () => {
		// today IS Wednesday — last/next Wednesday must be ±7 days, not 0.
		expect(resolveRelativeDate("last Wednesday", NOW)?.dateIso).toBe("2026-06-17");
		expect(resolveRelativeDate("next Wednesday", NOW)?.dateIso).toBe("2026-07-01");
	});
});

describe("resolveRelativeDate — period anchors resolve to the period START", () => {
	it("this/last/next week (Monday-based)", () => {
		// Wed 2026-06-24 → this week (Mon) = 2026-06-22.
		expect(resolveRelativeDate("this week", NOW)?.dateIso).toBe("2026-06-22");
		expect(resolveRelativeDate("last week", NOW)?.dateIso).toBe("2026-06-15");
		expect(resolveRelativeDate("next week", NOW)?.dateIso).toBe("2026-06-29");
	});

	it("this/last/next month", () => {
		expect(resolveRelativeDate("this month", NOW)?.dateIso).toBe("2026-06-01");
		expect(resolveRelativeDate("last month", NOW)?.dateIso).toBe("2026-05-01");
		expect(resolveRelativeDate("next month", NOW)?.dateIso).toBe("2026-07-01");
	});

	it("this/last/next year", () => {
		expect(resolveRelativeDate("this year", NOW)?.dateIso).toBe("2026-01-01");
		expect(resolveRelativeDate("last year", NOW)?.dateIso).toBe("2025-01-01");
		expect(resolveRelativeDate("next year", NOW)?.dateIso).toBe("2027-01-01");
	});

	it("carries the period unit + direction", () => {
		expect(resolveRelativeDate("last month", NOW)?.unit).toBe("month");
		expect(resolveRelativeDate("this year", NOW)?.direction).toBe(0);
		expect(resolveRelativeDate("next week", NOW)?.direction).toBe(1);
	});
});

describe("resolveRelativeDate — edge cases + conservatism", () => {
	it("returns null for a phrase with no relative-date cue (never fabricates a date)", () => {
		expect(resolveRelativeDate("implement a binary search", NOW)).toBeNull();
		expect(resolveRelativeDate("the current implementation", NOW)).toBeNull(); // "current" alone is not a cue
		expect(resolveRelativeDate("", NOW)).toBeNull();
	});

	it("is case-insensitive and tolerates extra whitespace", () => {
		expect(resolveRelativeDate("LAST   TUESDAY", NOW)?.dateIso).toBe("2026-06-23");
		expect(resolveRelativeDate("Yesterday", NOW)?.dateIso).toBe("2026-06-23");
	});

	it("clamps month arithmetic to the last valid day (Jan 31 + 1 month → Feb 28)", () => {
		const jan31 = new Date("2027-01-31T12:00:00.000Z");
		expect(resolveRelativeDate("in 1 month", jan31)?.dateIso).toBe("2027-02-28");
	});

	it("computes in UTC regardless of the wall-clock time within the day", () => {
		// Any instant on 2026-06-24 UTC resolves "today" identically.
		expect(resolveRelativeDate("today", new Date("2026-06-24T00:00:00.000Z"))?.dateIso).toBe("2026-06-24");
		expect(resolveRelativeDate("today", new Date("2026-06-24T23:59:59.000Z"))?.dateIso).toBe("2026-06-24");
	});

	it("crosses year boundaries correctly", () => {
		const dec31 = new Date("2026-12-31T12:00:00.000Z");
		expect(resolveRelativeDate("tomorrow", dec31)?.dateIso).toBe("2027-01-01");
		expect(resolveRelativeDate("next year", dec31)?.dateIso).toBe("2027-01-01");
	});
});

describe("resolveRelativeDatesInText — free-text sweep", () => {
	it("finds every distinct relative-date phrase in a retrieved snippet, in order", () => {
		const snippet = "Updated 3 days ago. See also yesterday's note and the plan for next week.";
		const hits = resolveRelativeDatesInText(snippet, NOW);
		const byText = new Map(hits.map((h) => [h.matchedText, h.dateIso]));
		expect(byText.get("3 days ago")).toBe("2026-06-21");
		expect(byText.get("yesterday")).toBe("2026-06-23");
		expect(byText.get("next week")).toBe("2026-06-29");
		expect(hits.length).toBe(3);
	});

	it("deduplicates a phrase that appears twice", () => {
		const hits = resolveRelativeDatesInText("posted yesterday, edited yesterday", NOW);
		expect(hits.filter((h) => h.matchedText === "yesterday").length).toBe(1);
	});

	it("does not double-count a bare word already inside a compound phrase", () => {
		// "the day after tomorrow" is one hit; a separate bare "tomorrow" should NOT also appear.
		const hits = resolveRelativeDatesInText("ships the day after tomorrow", NOW);
		expect(hits.length).toBe(1);
		expect(hits[0]?.dateIso).toBe("2026-06-26");
	});

	it("returns an empty array when there is nothing to resolve", () => {
		expect(resolveRelativeDatesInText("refactor the parser and add tests", NOW)).toEqual([]);
	});
});

describe("integration with the §5.AC freshness judge", () => {
	// The resolver anchors to UTC midnight; judge against a midnight now so the whole-day age is exact (not a
	// rounding artifact of the wall-clock time). This is the real use: resolve a relative date in a snippet → feed it
	// as an absolute publishedAt to judgeRetrievedFreshness.
	const midnight = new Date("2026-06-24T00:00:00.000Z");

	it('a resolved "3 days ago" feeds judgeRetrievedFreshness as an absolute publishedAt → current', () => {
		const resolved = resolveRelativeDate("3 days ago", midnight);
		expect(resolved).not.toBeNull();
		const judgment = judgeRetrievedFreshness({ publishedAt: resolved?.dateIso }, midnight);
		expect(judgment.publishedIso).toBe("2026-06-21");
		expect(judgment.ageDays).toBe(3);
		expect(judgment.verdict).toBe("current");
	});

	it('a resolved "2 years ago" pins an absolute date the judge bands as stale', () => {
		const resolved = resolveRelativeDate("2 years ago", midnight);
		const judgment = judgeRetrievedFreshness({ publishedAt: resolved?.dateIso }, midnight);
		expect(judgment.verdict).toBe("stale");
	});
});
