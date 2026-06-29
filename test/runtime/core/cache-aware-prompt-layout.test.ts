import { describe, expect, it } from "vitest";
import {
	assembleCacheAwarePrompt,
	detectVolatilePrefixContent,
	hasVolatilePrefixContent,
	prefixesAreCacheEquivalent,
} from "../../../src/core/cache-aware-prompt-layout";

describe("detectVolatilePrefixContent", () => {
	it("flags an explicit current-time label (the openclaw #19892 cache-killer)", () => {
		const findings = detectVolatilePrefixContent("You are an agent.\nCurrent time: 14:32. Be helpful.");
		const kinds = findings.map((f) => f.kind);
		expect(kinds).toContain("explicit_now_label");
		expect(kinds).toContain("clock_time");
	});

	it("flags an ISO date and only a real one", () => {
		expect(detectVolatilePrefixContent("Today is 2026-06-29.").some((f) => f.kind === "iso_date")).toBe(true);
		// 2026-13-40 is not a valid month/day → not matched as a date.
		expect(detectVolatilePrefixContent("ticket 2026-13-40").some((f) => f.kind === "iso_date")).toBe(false);
	});

	it("flags a UUID and a millisecond epoch timestamp", () => {
		const uuid = detectVolatilePrefixContent("session 550e8400-e29b-41d4-a716-446655440000 active");
		expect(uuid.some((f) => f.kind === "uuid")).toBe(true);
		const epoch = detectVolatilePrefixContent("started at 1719600000000 ms");
		expect(epoch.some((f) => f.kind === "epoch_timestamp")).toBe(true);
	});

	it("flags session/request id labels and relative-time phrases", () => {
		expect(
			detectVolatilePrefixContent("Your session_id is fixed").some((f) => f.kind === "session_or_request_id"),
		).toBe(true);
		expect(detectVolatilePrefixContent("Respond as of now").some((f) => f.kind === "relative_time_word")).toBe(true);
	});

	it("returns nothing for a clean, cache-stable system prompt", () => {
		const clean =
			"You are !Klein, a local coding agent. Follow the task. Use the provided tools. Keep responses concise.";
		expect(detectVolatilePrefixContent(clean)).toEqual([]);
		expect(hasVolatilePrefixContent(clean)).toBe(false);
	});

	it("returns findings sorted by position", () => {
		const findings = detectVolatilePrefixContent("Date 2026-06-29 then time 09:15 then id request-id");
		const indices = findings.map((f) => f.index);
		const sorted = [...indices].sort((a, b) => a - b);
		expect(indices).toEqual(sorted);
		expect(findings.length).toBeGreaterThanOrEqual(3);
	});
});

describe("hasVolatilePrefixContent", () => {
	it("is the boolean form of the detector", () => {
		expect(hasVolatilePrefixContent("Current date: 2026-06-29")).toBe(true);
		expect(hasVolatilePrefixContent("Stable instructions only.")).toBe(false);
	});
});

describe("prefixesAreCacheEquivalent", () => {
	it("is strict byte-equality (a single changed byte breaks the cache)", () => {
		expect(prefixesAreCacheEquivalent("system prompt", "system prompt")).toBe(true);
		expect(prefixesAreCacheEquivalent("system prompt", "system prompt ")).toBe(false);
		expect(prefixesAreCacheEquivalent("system prompt", "System prompt")).toBe(false);
	});
});

describe("assembleCacheAwarePrompt", () => {
	it("puts the stable prefix first and the volatile suffix after", () => {
		const out = assembleCacheAwarePrompt({ stablePrefix: "STABLE", volatileSuffix: "today is 2026-06-29" });
		expect(out.startsWith("STABLE")).toBe(true);
		expect(out.indexOf("STABLE")).toBeLessThan(out.indexOf("today is"));
		// And the assembled prefix portion stays clean.
		expect(hasVolatilePrefixContent("STABLE")).toBe(false);
	});

	it("returns just the prefix when there is no volatile suffix", () => {
		expect(assembleCacheAwarePrompt({ stablePrefix: "STABLE" })).toBe("STABLE");
		expect(assembleCacheAwarePrompt({ stablePrefix: "STABLE", volatileSuffix: "   " })).toBe("STABLE");
	});
});
