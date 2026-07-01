import { describe, expect, it } from "vitest";
import {
	type AssumptionMode,
	assumptionRisk,
	type CandidateAssumption,
	clarifyOrAssume,
	decideAssumptionSafety,
	MODE_RISK_GATES,
	REVERSIBILITY_WEIGHTS,
} from "../../../src/core/assumption-safety";

function candidate(overrides: Partial<CandidateAssumption> = {}): CandidateAssumption {
	return {
		reversibility: "reversible",
		confidence: 0.9,
		impact: 0.2,
		...overrides,
	};
}

const MODES: AssumptionMode[] = ["cautious", "balanced", "autonomous"];

describe("assumptionRisk", () => {
	it("is (1 - confidence) * impact * reversibilityWeight", () => {
		// (1 - 0.5) * 0.4 * 0.6(costly) = 0.12
		expect(assumptionRisk(candidate({ reversibility: "costly", confidence: 0.5, impact: 0.4 }))).toBeCloseTo(0.12, 6);
	});

	it("is 0 at full confidence regardless of impact / reversibility", () => {
		expect(assumptionRisk(candidate({ reversibility: "irreversible", confidence: 1, impact: 1 }))).toBe(0);
	});

	it("is maximal (1) for a wrong, maximally-impactful, irreversible guess", () => {
		expect(assumptionRisk(candidate({ reversibility: "irreversible", confidence: 0, impact: 1 }))).toBe(1);
	});

	it("is 0 when impact is 0 (a harmless wrong guess) even at low confidence", () => {
		expect(assumptionRisk(candidate({ reversibility: "irreversible", confidence: 0, impact: 0 }))).toBe(0);
	});

	it("increases monotonically as reversibility gets harder", () => {
		const base = { confidence: 0.4, impact: 0.7 } as const;
		const r = assumptionRisk(candidate({ ...base, reversibility: "reversible" }));
		const c = assumptionRisk(candidate({ ...base, reversibility: "costly" }));
		const i = assumptionRisk(candidate({ ...base, reversibility: "irreversible" }));
		expect(r).toBeLessThan(c);
		expect(c).toBeLessThan(i);
	});

	it("clamps an out-of-range / NaN confidence to the safe extreme (treats missing as 0 = might be wrong)", () => {
		expect(assumptionRisk(candidate({ reversibility: "costly", confidence: Number.NaN, impact: 1 }))).toBeCloseTo(
			REVERSIBILITY_WEIGHTS.costly,
			6,
		);
		// confidence > 1 clamps to 1 → zero risk
		expect(assumptionRisk(candidate({ confidence: 5, impact: 1, reversibility: "irreversible" }))).toBe(0);
	});

	it("clamps a NaN impact to the worst case (1) so dirty inputs fail safe toward asking", () => {
		expect(assumptionRisk(candidate({ reversibility: "reversible", confidence: 0, impact: Number.NaN }))).toBeCloseTo(
			REVERSIBILITY_WEIGHTS.reversible,
			6,
		);
	});

	it("clamps a negative impact to 0", () => {
		expect(assumptionRisk(candidate({ confidence: 0, impact: -3, reversibility: "irreversible" }))).toBe(0);
	});
});

describe("decideAssumptionSafety", () => {
	it("assumes-and-logs a reversible, confident, low-impact default (balanced)", () => {
		const decision = decideAssumptionSafety(candidate(), "balanced");
		expect(decision.action).toBe("assume_and_log");
		expect(decision.mode).toBe("balanced");
		expect(decision.reason).toMatch(/assume and log/i);
	});

	it("asks when an irreversible, low-confidence, high-impact default is on the table", () => {
		const decision = decideAssumptionSafety(
			candidate({ reversibility: "irreversible", confidence: 0.1, impact: 0.9 }),
			"balanced",
		);
		expect(decision.action).toBe("ask");
		expect(decision.risk).toBeGreaterThanOrEqual(MODE_RISK_GATES.balanced.ask);
	});

	it("flags (not silent, not ask) a mid-risk default", () => {
		// costly, conf 0.5, impact 0.9 → (0.5 * 0.9 * 0.6) = 0.27 → in [flag=0.25, ask=0.55)
		const decision = decideAssumptionSafety(
			candidate({ reversibility: "costly", confidence: 0.5, impact: 0.9 }),
			"balanced",
		);
		expect(decision.action).toBe("assume_but_flag");
		expect(decision.risk).toBeCloseTo(0.27, 6);
	});

	it("NEVER adopts an irreversible assumption silently, even at near-zero risk (safety floor)", () => {
		// irreversible but very confident + tiny impact → risk well below the flag gate…
		const decision = decideAssumptionSafety(
			candidate({ reversibility: "irreversible", confidence: 0.99, impact: 0.05 }),
			"autonomous",
		);
		expect(decision.risk).toBeLessThan(MODE_RISK_GATES.autonomous.flag);
		// …yet the floor promotes assume_and_log → assume_but_flag.
		expect(decision.action).toBe("assume_but_flag");
		expect(decision.reason).toMatch(/irreversible/i);
	});

	it("is monotonic in autonomy: a mode never asks MORE than a stricter mode for the same candidate", () => {
		// A fixed mid-risk candidate: cautious asks, balanced flags/asks, autonomous is the most permissive.
		const c = candidate({ reversibility: "costly", confidence: 0.4, impact: 0.9 });
		const rank: Record<string, number> = { assume_and_log: 0, assume_but_flag: 1, ask: 2 };
		const cautious = rank[decideAssumptionSafety(c, "cautious").action];
		const balanced = rank[decideAssumptionSafety(c, "balanced").action];
		const autonomous = rank[decideAssumptionSafety(c, "autonomous").action];
		expect(cautious).toBeGreaterThanOrEqual(balanced);
		expect(balanced).toBeGreaterThanOrEqual(autonomous);
	});

	it("cautious asks about a default that balanced would only flag", () => {
		// reversible, conf 0.4, impact 0.8 → 0.6 * 0.8 * 0.25 = 0.12
		const c = candidate({ reversibility: "reversible", confidence: 0.4, impact: 0.8 });
		expect(decideAssumptionSafety(c, "cautious").action).toBe("assume_but_flag"); // 0.12 ∈ [0.1, 0.3)
		expect(decideAssumptionSafety(c, "balanced").action).toBe("assume_and_log"); // 0.12 < 0.25
	});

	it("defaults to balanced mode when none is passed", () => {
		expect(decideAssumptionSafety(candidate()).mode).toBe("balanced");
	});

	it("embeds the summary note in the rationale when provided", () => {
		const decision = decideAssumptionSafety(candidate({ summary: "default to SQLite" }));
		expect(decision.reason).toContain("default to SQLite");
	});

	it("treats a NaN confidence as worst-case and asks in a strict mode", () => {
		const decision = decideAssumptionSafety(
			candidate({ reversibility: "costly", confidence: Number.NaN, impact: 1 }),
			"cautious",
		);
		// risk = 1 * 1 * 0.6 = 0.6 ≥ cautious ask gate 0.3
		expect(decision.action).toBe("ask");
	});

	it("returns the same risk value that assumptionRisk computes", () => {
		const c = candidate({ reversibility: "costly", confidence: 0.3, impact: 0.6 });
		expect(decideAssumptionSafety(c).risk).toBeCloseTo(assumptionRisk(c), 12);
	});
});

describe("MODE_RISK_GATES invariants", () => {
	it("keeps flag ≤ ask within every mode", () => {
		for (const mode of MODES) {
			expect(MODE_RISK_GATES[mode].flag).toBeLessThanOrEqual(MODE_RISK_GATES[mode].ask);
		}
	});

	it("gets more permissive (higher gates) from cautious → balanced → autonomous", () => {
		expect(MODE_RISK_GATES.cautious.ask).toBeLessThan(MODE_RISK_GATES.balanced.ask);
		expect(MODE_RISK_GATES.balanced.ask).toBeLessThan(MODE_RISK_GATES.autonomous.ask);
		expect(MODE_RISK_GATES.cautious.flag).toBeLessThan(MODE_RISK_GATES.balanced.flag);
		expect(MODE_RISK_GATES.balanced.flag).toBeLessThan(MODE_RISK_GATES.autonomous.flag);
	});
});

describe("clarifyOrAssume (composition with clarification-need)", () => {
	it("proceeds on the default without asking when the request is NOT ambiguous", () => {
		// A well-specified request → clarification-need says no question needed → default stands, even if risky.
		const decision = clarifyOrAssume(
			"Refactor the parseConfig function in src/config.ts to return a typed result.",
			candidate({ reversibility: "irreversible", confidence: 0.1, impact: 0.9 }),
			"balanced",
		);
		expect(decision.requestNeedsClarification).toBe(false);
		expect(decision.action).toBe("assume_and_log");
		expect(decision.reason).toMatch(/not ambiguous/i);
	});

	it("weighs the default and ASKS when the request IS ambiguous and the default is risky", () => {
		// Empty request → ambiguous in every mode; risky irreversible default → ask.
		const decision = clarifyOrAssume(
			"",
			candidate({ reversibility: "irreversible", confidence: 0.1, impact: 0.9 }),
			"balanced",
		);
		expect(decision.requestNeedsClarification).toBe(true);
		expect(decision.action).toBe("ask");
	});

	it("proceeds on a SAFE default even when the request is ambiguous (only risky defaults force a pause)", () => {
		// "fix it" is ambiguous, but the specific default is reversible + confident + low-impact → just proceed.
		const decision = clarifyOrAssume(
			"fix it",
			candidate({ reversibility: "reversible", confidence: 0.95, impact: 0.1 }),
			"balanced",
		);
		expect(decision.requestNeedsClarification).toBe(true);
		expect(decision.action).toBe("assume_and_log");
	});

	it("still applies the irreversible safety floor through the composed path", () => {
		// An empty request is ambiguous in every mode (incl. autonomous), so the candidate is weighed…
		const decision = clarifyOrAssume(
			"",
			candidate({ reversibility: "irreversible", confidence: 0.99, impact: 0.02 }),
			"autonomous",
		);
		expect(decision.requestNeedsClarification).toBe(true);
		// …and the irreversible floor promotes what would be assume_and_log up to assume_but_flag.
		expect(decision.action).toBe("assume_but_flag");
	});

	it("is deterministic — identical inputs yield identical decisions", () => {
		const args = [
			"maybe update it?",
			candidate({ reversibility: "costly", confidence: 0.4, impact: 0.7 }),
			"balanced",
		] as const;
		expect(clarifyOrAssume(...args)).toEqual(clarifyOrAssume(...args));
	});
});
