import { describe, expect, it } from "vitest";
import { decideEnforcedReasoning, type EnforcedReasoningInput } from "../../../src/core/enforced-reasoning-gate";
import {
	emptyModelBehaviorProfile,
	type ModelAttemptOutcome,
	type ModelBehaviorProfile,
	recordModelBehaviorOutcome,
} from "../../../src/core/model-behavior-profile";

/** Build a profile with `samples` outcomes of the given kind, so `successRate` + dominant failure mode are populated. */
function profileWith(kind: ModelAttemptOutcome["kind"], samples: number): ModelBehaviorProfile {
	let p = emptyModelBehaviorProfile("m");
	for (let i = 0; i < samples; i += 1) {
		p = recordModelBehaviorOutcome(p, { kind });
	}
	return p;
}

/** A profile with a high, trusted success rate (many successes) — a robust, reliable model. */
function reliableProfile(samples = 8): ModelBehaviorProfile {
	return profileWith("success", samples);
}

const HARD = 0.8;
const EASY = 0.2;

describe("decideEnforcedReasoning — the difficulty gate", () => {
	it("does NOT enforce on an easy task even with an observed failure (below difficulty threshold)", () => {
		const d = decideEnforcedReasoning({ difficulty: EASY, observedFailure: true });
		expect(d.enforce).toBe(false);
		expect(d.kind).toBe("none");
		expect(d.rounds).toBe(0);
		expect(d.reason).toContain("threshold");
	});

	it("does NOT enforce on a hard task with NO struggle signal (no failure, no low-reliability profile)", () => {
		const d = decideEnforcedReasoning({ difficulty: HARD, observedFailure: false });
		expect(d.enforce).toBe(false);
		expect(d.kind).toBe("none");
		expect(d.rounds).toBe(0);
		expect(d.reason.toLowerCase()).toContain("no struggle signal");
	});

	it("does NOT enforce on a hard task for a RELIABLE model with no fresh failure (robust model, easy-for-it)", () => {
		const d = decideEnforcedReasoning({ difficulty: HARD, profile: reliableProfile() });
		expect(d.enforce).toBe(false);
		expect(d.kind).toBe("none");
	});

	it("ENFORCES on a hard task once a failure has been observed this task", () => {
		const d = decideEnforcedReasoning({ difficulty: HARD, observedFailure: true });
		expect(d.enforce).toBe(true);
		expect(d.kind).not.toBe("none");
		expect(d.rounds).toBeGreaterThanOrEqual(1);
		expect(d.reason).toContain("observed failure");
	});

	it("ENFORCES on a hard task when the model's learned reliability is at/below the floor (no fresh failure needed)", () => {
		// 5 timeouts ⇒ successRate 0, samples ≥ minSamples ⇒ trusted struggle signal.
		const d = decideEnforcedReasoning({ difficulty: HARD, profile: profileWith("timeout", 5) });
		expect(d.enforce).toBe(true);
		expect(d.reason).toContain("low learned reliability");
	});

	it("respects a custom difficultyThreshold", () => {
		const base = { difficulty: 0.5, observedFailure: true } satisfies EnforcedReasoningInput;
		expect(decideEnforcedReasoning({ ...base, difficultyThreshold: 0.4 }).enforce).toBe(true);
		expect(decideEnforcedReasoning({ ...base, difficultyThreshold: 0.6 }).enforce).toBe(false);
	});
});

describe("decideEnforcedReasoning — cold-start reliability handling", () => {
	it("does NOT treat a near-cold profile (below minSamples) as a struggle signal", () => {
		// 2 timeouts: successRate is 0 but samples (2) < default minSamples (3) ⇒ not trusted.
		const d = decideEnforcedReasoning({ difficulty: HARD, profile: profileWith("timeout", 2) });
		expect(d.enforce).toBe(false);
		expect(d.kind).toBe("none");
	});

	it("honors a custom minSamplesForReliability", () => {
		const d = decideEnforcedReasoning({
			difficulty: HARD,
			profile: profileWith("timeout", 2),
			minSamplesForReliability: 2,
		});
		expect(d.enforce).toBe(true);
	});

	it("honors a custom reliabilityFloor (a mid-reliability model can be gated in or out)", () => {
		// Mixed record ⇒ a middling success rate; pick floors on either side of it.
		let p = emptyModelBehaviorProfile("m");
		for (let i = 0; i < 5; i += 1) {
			p = recordModelBehaviorOutcome(p, { kind: i % 2 === 0 ? "success" : "timeout" });
		}
		const rate = p.successRate;
		const above = decideEnforcedReasoning({ difficulty: HARD, profile: p, reliabilityFloor: rate + 0.1 });
		const below = decideEnforcedReasoning({ difficulty: HARD, profile: p, reliabilityFloor: rate - 0.1 });
		expect(above.enforce).toBe(true); // floor above the rate ⇒ counts as struggling
		expect(below.enforce).toBe(false); // floor below the rate ⇒ not struggling, no fresh failure
	});
});

describe("decideEnforcedReasoning — kind selection (external-signal-first)", () => {
	it("prefers cross_model_carry whenever a stronger peer is available", () => {
		const d = decideEnforcedReasoning({ difficulty: HARD, observedFailure: true, strongerPeerAvailable: true });
		expect(d.kind).toBe("cross_model_carry");
	});

	it("cross_model_carry wins even for a flaky model (peer signal is strongest)", () => {
		const d = decideEnforcedReasoning({
			difficulty: HARD,
			profile: profileWith("loop", 5),
			strongerPeerAvailable: true,
		});
		expect(d.kind).toBe("cross_model_carry");
	});

	it("falls to self_consistency for a flaky model with NO peer (low reliability)", () => {
		const d = decideEnforcedReasoning({ difficulty: HARD, profile: profileWith("timeout", 5) });
		expect(d.enforce).toBe(true);
		expect(d.kind).toBe("self_consistency");
	});

	it("falls to self_consistency when the dominant failure mode is stochastic (loop), even via a fresh failure trigger", () => {
		// 2 loop samples: below minSamples so reliability isn't trusted, but observedFailure opens the gate; the
		// stochastic dominant failure mode still routes to self_consistency.
		const d = decideEnforcedReasoning({
			difficulty: HARD,
			observedFailure: true,
			profile: profileWith("loop", 2),
		});
		expect(d.enforce).toBe(true);
		expect(d.kind).toBe("self_consistency");
	});

	it("falls to self_bounce_varied for a deterministic-but-weak model (no peer, no stochastic signal)", () => {
		// Gate opened by an observed failure; no profile ⇒ no stochastic mode, no reliability struggle ⇒ self-bounce.
		const d = decideEnforcedReasoning({ difficulty: HARD, observedFailure: true });
		expect(d.enforce).toBe(true);
		expect(d.kind).toBe("self_bounce_varied");
	});

	it("routes a malformed-dominant (non-stochastic) low-reliability model to self_consistency via the reliability path", () => {
		// `malformed` is NOT in the stochastic set, but a trusted low success rate still counts as struggling ⇒
		// self_consistency (variance-washing) rather than self-bounce.
		const d = decideEnforcedReasoning({ difficulty: HARD, profile: profileWith("malformed", 5) });
		expect(d.enforce).toBe(true);
		expect(d.kind).toBe("self_consistency");
	});
});

describe("decideEnforcedReasoning — rounds are bounded and always terminate", () => {
	it("scales rounds with difficulty up to the ceiling", () => {
		const mid = decideEnforcedReasoning({ difficulty: 0.65, observedFailure: true, maxRounds: 4 });
		const max = decideEnforcedReasoning({ difficulty: 1.0, observedFailure: true, maxRounds: 4 });
		expect(mid.rounds).toBeGreaterThanOrEqual(1);
		expect(mid.rounds).toBeLessThanOrEqual(4);
		expect(max.rounds).toBe(4);
		expect(max.rounds).toBeGreaterThanOrEqual(mid.rounds);
	});

	it("always allows at least 1 round when enforcing (never a no-op loop)", () => {
		const d = decideEnforcedReasoning({ difficulty: 0.6, observedFailure: true, maxRounds: 3 });
		expect(d.enforce).toBe(true);
		expect(d.rounds).toBeGreaterThanOrEqual(1);
	});

	it("clamps a non-positive maxRounds up to 1 (loop always terminates but can still run)", () => {
		const d = decideEnforcedReasoning({ difficulty: HARD, observedFailure: true, maxRounds: 0 });
		expect(d.rounds).toBe(1);
	});

	it("never exceeds the ceiling regardless of difficulty", () => {
		const d = decideEnforcedReasoning({ difficulty: 1.0, observedFailure: true, maxRounds: 2 });
		expect(d.rounds).toBe(2);
	});

	it("returns 0 rounds whenever it does not enforce", () => {
		expect(decideEnforcedReasoning({ difficulty: EASY, observedFailure: true }).rounds).toBe(0);
		expect(decideEnforcedReasoning({ difficulty: HARD, observedFailure: false }).rounds).toBe(0);
	});
});

describe("decideEnforcedReasoning — invariants + edge inputs", () => {
	it("kind is 'none' iff enforce is false (they never disagree)", () => {
		const cases: EnforcedReasoningInput[] = [
			{ difficulty: EASY, observedFailure: true },
			{ difficulty: HARD, observedFailure: false },
			{ difficulty: HARD, observedFailure: true },
			{ difficulty: HARD, profile: profileWith("timeout", 5) },
			{ difficulty: HARD, observedFailure: true, strongerPeerAvailable: true },
		];
		for (const c of cases) {
			const d = decideEnforcedReasoning(c);
			expect(d.kind === "none").toBe(!d.enforce);
		}
	});

	it("clamps an out-of-range difficulty (>1 treated as hard, <0 as easy)", () => {
		expect(decideEnforcedReasoning({ difficulty: 5, observedFailure: true }).enforce).toBe(true);
		expect(decideEnforcedReasoning({ difficulty: -5, observedFailure: true }).enforce).toBe(false);
	});

	it("treats a NaN difficulty as 0 (never enforces on garbage input)", () => {
		const d = decideEnforcedReasoning({ difficulty: Number.NaN, observedFailure: true });
		expect(d.enforce).toBe(false);
		expect(d.rounds).toBe(0);
	});

	it("is deterministic — same input yields identical decisions", () => {
		const input: EnforcedReasoningInput = { difficulty: HARD, profile: profileWith("timeout", 5) };
		expect(decideEnforcedReasoning(input)).toStrictEqual(decideEnforcedReasoning(input));
	});

	it("always produces a non-empty, inspectable reason", () => {
		const cases: EnforcedReasoningInput[] = [
			{ difficulty: EASY, observedFailure: true },
			{ difficulty: HARD, observedFailure: false },
			{ difficulty: HARD, observedFailure: true },
		];
		for (const c of cases) {
			expect(decideEnforcedReasoning(c).reason.length).toBeGreaterThan(0);
		}
	});
});
