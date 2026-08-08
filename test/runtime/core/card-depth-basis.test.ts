import { describe, expect, it } from "vitest";
import { canSteerOnDepth, deriveCardDepth } from "../../../src/core/card-depth-basis";
import { DEEP_DEPTH_MIN_TOKENS, SHALLOW_DEPTH_MAX_TOKENS } from "../../../src/core/model-fitness-freshness";

/**
 * P25.3 phase 4 — the depth derivation the wire needs.
 *
 * The point of this module is that it returns depth WITH ITS BASIS, so the tests are organised around the basis
 * rather than around the buckets. `fitnessDepthMismatch` treats `neededDepth` as a fact — a card declared `deep`
 * accepts only deep-measured evidence — so a guess passed silently becomes a manufactured requirement in one
 * direction and a manufactured permission in the other.
 *
 * The `unknown` case is the one that earns most of the tests, because it is the case a normal implementation
 * would quietly remove by picking a default. Both defaults are expensive and the tests say why.
 */
describe("a prior attempt is a MEASUREMENT, not an estimate", () => {
	it("classifies from what the card actually used", () => {
		const estimate = deriveCardDepth({ priorAttempts: [{ usedContextTokens: DEEP_DEPTH_MIN_TOKENS + 1 }] });

		expect(estimate).toMatchObject({ depth: "deep", basis: "measured" });
		expect(estimate.detail).toMatch(/prior attempt/);
	});

	it("takes the DEEPEST prior attempt, not the latest or the shallowest", () => {
		// A card that once needed 20k tokens can need them again. Reading the most recent attempt would let one
		// cheap retry understate a card that has already proven otherwise — and understating is the direction that
		// hands a deep card to a model validated only on shallow work.
		const estimate = deriveCardDepth({
			priorAttempts: [{ usedContextTokens: 20_000 }, { usedContextTokens: 500 }],
		});

		expect(estimate.depth).toBe("deep");
	});

	it("ignores attempts recorded before depth tracking rather than reading them as zero", () => {
		// A missing `usedContextTokens` is absence of a measurement. Treating it as 0 would classify the card
		// shallow on the strength of a field that was never written — the depth-blind projection bug, re-created
		// one layer up.
		const estimate = deriveCardDepth({
			priorAttempts: [{ usedContextTokens: null }, { usedContextTokens: undefined }, { usedContextTokens: 20_000 }],
		});

		expect(estimate).toMatchObject({ depth: "deep", basis: "measured" });
	});

	it("falls through to the seed when EVERY prior attempt is unmeasured", () => {
		const estimate = deriveCardDepth({
			priorAttempts: [{ usedContextTokens: null }, { usedContextTokens: 0 }],
			seedPromptTokens: DEEP_DEPTH_MIN_TOKENS,
		});

		expect(estimate.basis).toBe("lower_bound");
	});

	it("rejects a non-finite token count instead of classifying on it", () => {
		const estimate = deriveCardDepth({
			priorAttempts: [{ usedContextTokens: Number.NaN }, { usedContextTokens: Number.POSITIVE_INFINITY }],
		});

		expect(estimate.basis).toBe("unknown");
	});
});

describe("the seed prompt is a FLOOR, and only a floor", () => {
	it("settles the band from below when the seed alone crosses a boundary", () => {
		// Arithmetic, not prediction: a session's context includes its seed and only grows, so a 20k-token seed
		// cannot produce a shallow session.
		const estimate = deriveCardDepth({ seedPromptTokens: DEEP_DEPTH_MIN_TOKENS + 1 });

		expect(estimate).toMatchObject({ depth: "deep", basis: "lower_bound" });
		expect(estimate.detail).toMatch(/cannot be shallower/);
	});

	it("gives MEDIUM for a seed between the bands", () => {
		expect(deriveCardDepth({ seedPromptTokens: SHALLOW_DEPTH_MAX_TOKENS }).depth).toBe("medium");
	});

	it("can never rule a card SHALLOW — a small seed says nothing about where the session ends up", () => {
		// The asymmetry that makes this a lower bound rather than an estimate. Reporting `shallow` here would be
		// the manufactured permission: it lets a shallow-measured model take a card that may run deep.
		for (const seedPromptTokens of [0, 1, SHALLOW_DEPTH_MAX_TOKENS - 1]) {
			const estimate = deriveCardDepth({ seedPromptTokens });
			expect(estimate.depth, `seed ${seedPromptTokens}`).toBeNull();
			expect(estimate.basis).toBe("unknown");
		}
	});

	it("is used only when no attempt was measured — a measurement outranks a bound", () => {
		// A card whose one attempt ran shallow, with a large seed, is a contradiction worth resolving toward the
		// measurement: the seed bound is derived, the attempt is observed.
		const estimate = deriveCardDepth({
			priorAttempts: [{ usedContextTokens: 100 }],
			seedPromptTokens: DEEP_DEPTH_MIN_TOKENS + 1,
		});

		expect(estimate).toMatchObject({ depth: "shallow", basis: "measured" });
	});

	it("treats a negative or non-finite seed as no seed at all", () => {
		for (const seedPromptTokens of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(deriveCardDepth({ seedPromptTokens }).basis, String(seedPromptTokens)).toBe("unknown");
		}
	});
});

describe("UNKNOWN is reported, not defaulted away", () => {
	it("returns a null depth for a first attempt with a small seed", () => {
		// The case a normal implementation removes by picking a default. There is genuinely nothing to go on.
		const estimate = deriveCardDepth({});

		expect(estimate.depth).toBeNull();
		expect(estimate.basis).toBe("unknown");
	});

	it("does not default to SHALLOW — that is a manufactured permission", () => {
		// Defaulting shallow lets a model measured only on shallow work take a card that runs deep, which is
		// exactly the expensive error P22.2 names and `fitnessDepthMismatch` exists to refuse.
		expect(deriveCardDepth({}).depth).not.toBe("shallow");
	});

	it("does not default to DEEP either — that is a manufactured requirement", () => {
		// Defaulting deep silently demands deep-measured evidence the fitness store rarely has, so every
		// assignment abstains for a reason that reads as missing data rather than as an invented constraint.
		expect(deriveCardDepth({}).depth).not.toBe("deep");
	});

	it("says WHY it is unknown, in terms a routing log can record", () => {
		expect(deriveCardDepth({}).detail).toMatch(/first attempt/i);
		expect(deriveCardDepth({}).detail).toMatch(/stays shallow or grows deep/i);
	});

	it("treats an empty prior-attempt list the same as none at all", () => {
		expect(deriveCardDepth({ priorAttempts: [] }).basis).toBe("unknown");
	});
});

describe("canSteerOnDepth gates the decider", () => {
	it("permits a measured or lower-bounded depth", () => {
		expect(canSteerOnDepth(deriveCardDepth({ priorAttempts: [{ usedContextTokens: 100 }] }))).toBe(true);
		expect(canSteerOnDepth(deriveCardDepth({ seedPromptTokens: DEEP_DEPTH_MIN_TOKENS }))).toBe(true);
	});

	it("REFUSES an unknown depth, so the caller abstains instead of picking a bucket", () => {
		// The whole reason basis is separate from depth. Without this gate a caller reading `depth` alone would
		// have to invent one, which is the substitution the split exists to prevent.
		expect(canSteerOnDepth(deriveCardDepth({}))).toBe(false);
	});

	it("narrows the type so a caller cannot pass a null depth to the decider", () => {
		// A compile-time guarantee as much as a runtime one: inside the guard, `depth` is a bucket.
		const estimate = deriveCardDepth({ priorAttempts: [{ usedContextTokens: 20_000 }] });
		if (!canSteerOnDepth(estimate)) {
			throw new Error("expected a steerable estimate");
		}
		const depth: "shallow" | "medium" | "deep" = estimate.depth;

		expect(depth).toBe("deep");
	});
});
