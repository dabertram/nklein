import { describe, expect, it } from "vitest";
import { type AdmissibleClaim, resolveClaimAdmissibility } from "../../../src/core/claim-admissibility";

// Fixed authoritative "now" so every assertion is deterministic (UTC).
const now = new Date("2026-06-27T12:00:00.000Z");
const daysFromNow = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

// Source builders mirroring the corroboration core's tests: the trust scorer supplies tier + host/independence key.
const gov = (path = "/x") => ({ url: `https://www.nasa.gov${path}` }); // authoritative, citable ALONE
const standards = (path = "/x") => ({ url: `https://www.w3.org${path}` }); // authoritative, citable ALONE
const forum = (host: string, path = "/x") => ({ url: `https://${host}${path}` }); // community (open site)

describe("resolveClaimAdmissibility — composition of the corroboration AND temporal gates", () => {
	// (a) CENTERPIECE: two impeccable authoritative sources CANNOT rescue a future-dated claim.
	it("is INADMISSIBLE when corroborated but temporally anachronistic (future-dated) — two good sources can't rescue it", () => {
		const claim: AdmissibleClaim = {
			id: "centerpiece",
			loadBearing: true,
			// Two independent authoritative origins — corroboration is unimpeachable.
			sources: [gov(), standards()],
			// Dated 45 days in the FUTURE relative to now → anachronistic.
			asOf: daysFromNow(45),
		};

		const result = resolveClaimAdmissibility(claim, now);

		// The corroboration gate passes on its own...
		expect(result.corroboration.status).toBe("assertable");
		// ...but the temporal gate fails: the state has not happened yet.
		expect(result.temporal.status).toBe("anachronistic");
		// The AND is therefore false — two good sources do not rescue a future-dated claim.
		expect(result.admissible).toBe(false);
		// The reason names the TEMPORAL gate as the failure, not corroboration.
		expect(result.reason).toMatch(/TEMPORAL gate failed/);
		expect(result.reason).not.toMatch(/CORROBORATION gate failed/);
	});

	// (b) Both gates pass → admissible.
	it("is ADMISSIBLE when assertable (current) AND corroborated", () => {
		const claim: AdmissibleClaim = {
			id: "good",
			loadBearing: true,
			sources: [gov()], // authoritative → citable alone
			asOf: daysFromNow(-30), // 30 days in the past, no expiry → current
		};

		const result = resolveClaimAdmissibility(claim, now);

		expect(result.corroboration.status).toBe("assertable");
		expect(result.temporal.status).toBe("current");
		expect(result.admissible).toBe(true);
		expect(result.reason).toMatch(/Admissible/);
		expect(result.reason).toMatch(/both gates pass/);
	});

	// (c) Corroborated but STALE (expired horizon) → inadmissible on the temporal axis.
	it("is INADMISSIBLE when corroborated but temporally stale (validity horizon expired)", () => {
		const claim: AdmissibleClaim = {
			id: "expired",
			loadBearing: true,
			sources: [gov()], // corroboration is fine
			asOf: daysFromNow(-100),
			validUntil: daysFromNow(-10), // horizon passed 10 days ago → stale
		};

		const result = resolveClaimAdmissibility(claim, now);

		expect(result.corroboration.status).toBe("assertable");
		expect(result.temporal.status).toBe("stale");
		expect(result.admissible).toBe(false);
		expect(result.reason).toMatch(/TEMPORAL gate failed/);
	});

	// (d) Undated (temporally assertable) but under-corroborated (one origin) → inadmissible on the corroboration axis.
	it("is INADMISSIBLE when undated (assertable) but only ONE origin for a load-bearing claim", () => {
		const claim: AdmissibleClaim = {
			id: "single-source",
			loadBearing: true,
			sources: [forum("forum.example")], // one community origin — below the floor of 2
			// no asOf → undated, which the temporal gate treats as assertable
		};

		const result = resolveClaimAdmissibility(claim, now);

		// Temporal axis does NOT block an undated claim.
		expect(result.temporal.status).toBe("undated");
		// Corroboration axis blocks: a single community origin is not enough for a load-bearing claim.
		expect(result.corroboration.status).toBe("needs_corroboration");
		expect(result.corroboration.distinctOrigins).toBe(1);
		expect(result.admissible).toBe(false);
		expect(result.reason).toMatch(/CORROBORATION gate failed/);
		expect(result.reason).not.toMatch(/TEMPORAL gate failed/);
	});

	// (e) Two independent origins AND current → admissible on both axes.
	it("is ADMISSIBLE with two independent community origins AND a current date", () => {
		const claim: AdmissibleClaim = {
			id: "two-origins-current",
			loadBearing: true,
			// Two DIFFERENT hosts → two independent origins → clears the floor of 2.
			sources: [forum("forumA.example"), forum("forumB.example")],
			asOf: daysFromNow(-5), // recent past → current
		};

		const result = resolveClaimAdmissibility(claim, now);

		expect(result.corroboration.status).toBe("assertable");
		expect(result.corroboration.distinctOrigins).toBe(2);
		expect(result.temporal.status).toBe("current");
		expect(result.admissible).toBe(true);
		expect(result.reason).toMatch(/Admissible/);
	});

	// Both gates failing at once → the reason names BOTH.
	it("names BOTH gates when corroboration AND temporal both fail", () => {
		const claim: AdmissibleClaim = {
			id: "double-fail",
			loadBearing: true,
			sources: [forum("lonely.example")], // one origin → needs_corroboration
			asOf: daysFromNow(30), // future → anachronistic
		};

		const result = resolveClaimAdmissibility(claim, now);

		expect(result.admissible).toBe(false);
		expect(result.reason).toMatch(/CORROBORATION gate failed/);
		expect(result.reason).toMatch(/TEMPORAL gate failed/);
	});

	// Determinism: the same claim + same now yields an identical verdict.
	it("is deterministic — same claim and now produce the same verdict", () => {
		const claim: AdmissibleClaim = {
			id: "det",
			loadBearing: true,
			sources: [gov(), standards()],
			asOf: daysFromNow(-1),
		};

		const a = resolveClaimAdmissibility(claim, now);
		const b = resolveClaimAdmissibility(claim, now);
		expect(a).toEqual(b);
	});

	// The temporal grace-day option is forwarded to the temporal gate.
	it("forwards temporal options (graceDays) so a slightly-future claim can be tolerated", () => {
		const claim: AdmissibleClaim = {
			id: "grace",
			loadBearing: true,
			sources: [gov()],
			asOf: daysFromNow(1), // 1 day ahead — anachronistic at grace 0, tolerated at grace 2
		};

		const strict = resolveClaimAdmissibility(claim, now);
		expect(strict.temporal.status).toBe("anachronistic");
		expect(strict.admissible).toBe(false);

		const lenient = resolveClaimAdmissibility(claim, now, { temporal: { graceDays: 2 } });
		expect(lenient.temporal.status).toBe("current");
		expect(lenient.admissible).toBe(true);
	});

	// The corroboration floor option is forwarded to the corroboration gate.
	it("forwards corroboration options (requiredIndependentSources) to the corroboration gate", () => {
		const claim: AdmissibleClaim = {
			id: "floor",
			loadBearing: true,
			sources: [forum("only.example")], // one origin
			asOf: daysFromNow(-3), // current
		};

		// Default floor is 2 → one origin is not enough.
		expect(resolveClaimAdmissibility(claim, now).admissible).toBe(false);
		// Lower the floor to 1 → one origin now suffices, and the date is current → admissible.
		const lowered = resolveClaimAdmissibility(claim, now, {
			corroboration: { requiredIndependentSources: 1 },
		});
		expect(lowered.corroboration.status).toBe("assertable");
		expect(lowered.admissible).toBe(true);
	});
});
