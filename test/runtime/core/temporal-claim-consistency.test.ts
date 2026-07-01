import { describe, expect, it } from "vitest";
import {
	type ClaimTemporalStatus,
	checkClaimsTemporalConsistency,
	checkClaimTemporalConsistency,
	isClaimAssertable,
} from "../../../src/core/temporal-claim-consistency";

// Fixed authoritative "now" so every assertion is deterministic (UTC).
const now = new Date("2026-06-27T12:00:00.000Z");
const daysFromNow = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

describe("checkClaimTemporalConsistency", () => {
	it("marks a past-dated claim with no expiry as current", () => {
		const result = checkClaimTemporalConsistency({ asOf: daysFromNow(-30) }, now);
		expect(result.status).toBe("current");
		expect(result.asOfAgeDays).toBe(30);
		expect(result.validForDays).toBeNull();
		expect(result.reason).toMatch(/safe to assert/i);
	});

	it("marks a claim dated today as current (as-of age 0)", () => {
		const result = checkClaimTemporalConsistency({ asOf: now }, now);
		expect(result.status).toBe("current");
		expect(result.asOfAgeDays).toBe(0);
	});

	it("flags a FUTURE-dated claim as anachronistic (the not-yet hallucination)", () => {
		const result = checkClaimTemporalConsistency({ asOf: daysFromNow(45) }, now);
		expect(result.status).toBe("anachronistic");
		// Negative age = future.
		expect(result.asOfAgeDays).toBe(-45);
		expect(result.reason).toMatch(/FUTURE/);
		expect(result.reason).toMatch(/45 days/);
	});

	it("flags a past-dated claim whose validity horizon has passed as stale (expired)", () => {
		const result = checkClaimTemporalConsistency({ asOf: daysFromNow(-100), validUntil: daysFromNow(-10) }, now);
		expect(result.status).toBe("stale");
		expect(result.validForDays).toBe(-10);
		expect(result.reason).toMatch(/EXPIRED/);
		expect(result.reason).toMatch(/10 days ago/);
	});

	it("keeps a past-dated claim current when its validity horizon is still ahead", () => {
		const result = checkClaimTemporalConsistency({ asOf: daysFromNow(-5), validUntil: daysFromNow(20) }, now);
		expect(result.status).toBe("current");
		expect(result.validForDays).toBe(20);
	});

	it("treats a validity horizon of exactly today as still valid (0 days = not yet negative)", () => {
		const result = checkClaimTemporalConsistency({ asOf: daysFromNow(-5), validUntil: now }, now);
		expect(result.validForDays).toBe(0);
		expect(result.status).toBe("current");
	});

	it("lets anachronism win over expiry: a future-dated claim past a horizon is anachronistic, not stale", () => {
		const result = checkClaimTemporalConsistency({ asOf: daysFromNow(10), validUntil: daysFromNow(-1) }, now);
		expect(result.status).toBe("anachronistic");
	});

	it("returns undated (with a caution rail) when there is no usable as-of date", () => {
		const absent = checkClaimTemporalConsistency({}, now);
		expect(absent.status).toBe("undated");
		expect(absent.asOfIso).toBeNull();
		expect(absent.asOfAgeDays).toBeNull();
		expect(absent.reason).toMatch(/unknown/i);

		expect(checkClaimTemporalConsistency({ asOf: null }, now).status).toBe("undated");
		expect(checkClaimTemporalConsistency({ asOf: "not a date" }, now).status).toBe("undated");
	});

	it("still resolves the validity horizon on an undated claim (so a caller can see it)", () => {
		const result = checkClaimTemporalConsistency({ validUntil: "2026-08-01" }, now);
		expect(result.status).toBe("undated");
		expect(result.validUntilIso).toBe("2026-08-01");
		expect(result.validForDays).not.toBeNull();
	});

	it("accepts ISO strings, epoch ms, and Date objects for the dates", () => {
		expect(checkClaimTemporalConsistency({ asOf: "2026-06-20" }, now).asOfIso).toBe("2026-06-20");
		expect(checkClaimTemporalConsistency({ asOf: daysFromNow(-7).getTime() }, now).status).toBe("current");
		expect(checkClaimTemporalConsistency({ asOf: daysFromNow(-1) }, now).status).toBe("current");
	});

	it("reports the parsed as-of/validUntil ISO days (UTC), independent of the time component", () => {
		const result = checkClaimTemporalConsistency(
			{ asOf: "2026-06-01T23:30:00.000Z", validUntil: "2026-07-15T01:00:00.000Z" },
			now,
		);
		expect(result.asOfIso).toBe("2026-06-01");
		expect(result.validUntilIso).toBe("2026-07-15");
	});

	describe("graceDays tolerance", () => {
		it("absorbs a small forward skew: a claim 2 days ahead is current under graceDays=3", () => {
			const result = checkClaimTemporalConsistency({ asOf: daysFromNow(2) }, now, { graceDays: 3 });
			expect(result.status).toBe("current");
		});

		it("still flags a claim beyond the grace window as anachronistic", () => {
			const result = checkClaimTemporalConsistency({ asOf: daysFromNow(5) }, now, { graceDays: 3 });
			expect(result.status).toBe("anachronistic");
		});

		it("clamps a negative graceDays to 0 (any strictly-future as-of is anachronistic)", () => {
			const result = checkClaimTemporalConsistency({ asOf: daysFromNow(1) }, now, { graceDays: -5 });
			expect(result.status).toBe("anachronistic");
		});
	});

	it("singularizes the day count in the reason (1 day, not 1 days)", () => {
		expect(checkClaimTemporalConsistency({ asOf: daysFromNow(1) }, now).reason).toMatch(/1 day in the FUTURE/);
		expect(
			checkClaimTemporalConsistency({ asOf: daysFromNow(-30), validUntil: daysFromNow(-1) }, now).reason,
		).toMatch(/1 day ago/);
	});
});

describe("checkClaimsTemporalConsistency (batch)", () => {
	const claims = [
		{ asOf: daysFromNow(-10) }, // 0: current
		{ asOf: daysFromNow(30) }, // 1: anachronistic
		{ asOf: daysFromNow(-200), validUntil: daysFromNow(-5) }, // 2: stale
		{}, // 3: undated
		{ asOf: daysFromNow(-1) }, // 4: current
	];

	it("judges every claim, preserving input order and index", () => {
		const report = checkClaimsTemporalConsistency(claims, now);
		expect(report.judged).toHaveLength(5);
		expect(report.judged.map((j) => j.index)).toEqual([0, 1, 2, 3, 4]);
		expect(report.judged.map((j) => j.consistency.status)).toEqual([
			"current",
			"anachronistic",
			"stale",
			"undated",
			"current",
		]);
	});

	it("buckets indices by status for downstream filtering", () => {
		const report = checkClaimsTemporalConsistency(claims, now);
		expect(report.anachronistic).toEqual([1]);
		expect(report.stale).toEqual([2]);
		expect(report.undated).toEqual([3]);
	});

	it("sets hasTemporalProblem when any claim is anachronistic or stale", () => {
		expect(checkClaimsTemporalConsistency(claims, now).hasTemporalProblem).toBe(true);
		const clean = checkClaimsTemporalConsistency([{ asOf: daysFromNow(-3) }, {}], now);
		expect(clean.hasTemporalProblem).toBe(false);
		expect(clean.anachronistic).toEqual([]);
		expect(clean.stale).toEqual([]);
	});

	it("returns empty buckets and no problem for an empty batch", () => {
		const report = checkClaimsTemporalConsistency([], now);
		expect(report.judged).toEqual([]);
		expect(report.hasTemporalProblem).toBe(false);
		expect(report.anachronistic).toEqual([]);
	});

	it("threads graceDays through to each claim", () => {
		const report = checkClaimsTemporalConsistency([{ asOf: daysFromNow(2) }], now, { graceDays: 3 });
		expect(report.judged[0].consistency.status).toBe("current");
		expect(report.hasTemporalProblem).toBe(false);
	});

	it("carries the original claim object through on each judged entry", () => {
		const report = checkClaimsTemporalConsistency(claims, now);
		expect(report.judged[2].claim).toBe(claims[2]);
	});
});

describe("isClaimAssertable", () => {
	it("blocks anachronistic and stale; allows current and undated", () => {
		const cases: [ClaimTemporalStatus, boolean][] = [
			["current", true],
			["undated", true],
			["anachronistic", false],
			["stale", false],
		];
		for (const [status, expected] of cases) {
			expect(isClaimAssertable(status)).toBe(expected);
		}
	});

	it("agrees with hasTemporalProblem: no assertable-blocking status ⇒ no temporal problem", () => {
		const report = checkClaimsTemporalConsistency([{ asOf: daysFromNow(-3) }, {}], now);
		const anyBlocked = report.judged.some((j) => !isClaimAssertable(j.consistency.status));
		expect(anyBlocked).toBe(report.hasTemporalProblem);
	});
});
