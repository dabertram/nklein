import { describe, expect, it } from "vitest";
import { buildTemporalAwarenessPrompt, resolveTemporalAwareness } from "../../../src/core/temporal-awareness";

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
	it("emits an authoritative, override-the-training-prior block", () => {
		const block = buildTemporalAwarenessPrompt(new Date("2026-06-26T21:05:00Z"));
		expect(block).toContain("<current_datetime>");
		expect(block).toContain("</current_datetime>");
		expect(block).toContain("2026-06-26");
		expect(block).toContain("tomorrow is 2026-06-27");
		// The crux: frame the date as ground truth that overrides the model's stale training-cutoff date priors.
		expect(block).toContain("cutoff in the PAST");
		expect(block).toContain("ground truth");
		expect(block.toLowerCase()).toContain("freshness");
	});
});
