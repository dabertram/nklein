import { describe, expect, it } from "vitest";
import { type CurrencyEvidence, summarizeEvidenceCurrency } from "../../../src/core/evidence-currency-status.js";

/** F4.3 — sanitized "is this current?" evidence status (no raw content leaked). */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;
const ev = (over: Partial<CurrencyEvidence> & { id: string }): CurrencyEvidence => ({
	sourceDateMs: NOW - 5 * DAY,
	trust: "high",
	supports: true,
	conflictsWithIds: [],
	...over,
});

describe("summarizeEvidenceCurrency", () => {
	it("current: fresh, supported, conflict-free high-trust evidence", () => {
		const s = summarizeEvidenceCurrency([ev({ id: "a" }), ev({ id: "b", sourceDateMs: NOW - 2 * DAY })], NOW);
		expect(s.status).toBe("current");
		expect(s.supportCount).toBe(2);
		expect(s.highTrustSupportCount).toBe(2);
	});

	it("aging then stale as the newest supporting source ages", () => {
		expect(summarizeEvidenceCurrency([ev({ id: "a", sourceDateMs: NOW - 90 * DAY })], NOW).status).toBe("aging");
		expect(summarizeEvidenceCurrency([ev({ id: "a", sourceDateMs: NOW - 300 * DAY })], NOW).status).toBe("stale");
	});

	it("conflicted takes precedence over recency", () => {
		const s = summarizeEvidenceCurrency(
			[ev({ id: "a", conflictsWithIds: ["b"] }), ev({ id: "b", conflictsWithIds: ["a"] })],
			NOW,
		);
		expect(s.status).toBe("conflicted");
		expect(s.conflictCount).toBe(1); // the a↔b pair counted once
	});

	it("unsupported when nothing supports, unknown when supported but undated", () => {
		expect(summarizeEvidenceCurrency([ev({ id: "a", supports: false })], NOW).status).toBe("unsupported");
		expect(summarizeEvidenceCurrency([ev({ id: "a", sourceDateMs: null })], NOW).status).toBe("unknown");
	});

	it("annotation is sanitized: only counts/ages/status, never raw evidence text", () => {
		const s = summarizeEvidenceCurrency([ev({ id: "secret-injection-payload" })], NOW);
		expect(s.annotation).not.toContain("secret-injection-payload");
		expect(s.annotation).toMatch(/Evidence: 1 supporting .* — current\./);
	});
});
