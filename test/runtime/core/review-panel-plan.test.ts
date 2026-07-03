import { describe, expect, it } from "vitest";
import { planReviewPanel } from "../../../src/core/review-panel-plan";

/**
 * §5.AW — the complexity→eyes→lenses bridge. The panel gains DEPTH with complexity but never exceeds what the
 * reviewer TIER can back: the two axes stay decoupled, which is the whole point of routing lens assignment through
 * `assignReviewLenses` rather than baking a fixed panel into the ladder.
 */
describe("planReviewPanel (complexity → eyes → tier-gated lenses)", () => {
	// (a) CENTERPIECE / ADVERSARIAL: high risk must not conjure a verdict the reviewer cannot substantiate.
	it("complex + WEAK yields only weak-backable lenses and NEVER a security lens", () => {
		const plan = planReviewPanel({ complexity: "complex", reviewerTier: "weak" });
		const ids = plan.lenses.map((lens) => lens.id);

		// The full panel was REQUESTED (eyes not capped by the ladder for a complex card)...
		expect(plan.eyes).toBe(Number.POSITIVE_INFINITY);
		// ...but the tier gate trims to exactly the three lenses a weak reviewer can back, in failure-mass order.
		expect(ids).toEqual(["spec_fit", "correctness", "simplicity"]);
		expect(ids).not.toContain("security");
		// Every granted lens is genuinely weak-eligible — no lens smuggled in above the tier.
		for (const lens of plan.lenses) {
			expect(lens.minReviewerTier).toBe("weak");
		}
	});

	// (b) trivial → exactly 1 eye = the single minimal lens (spec-fit — "is this what was asked?").
	it("trivial → 1 eye = spec_fit only", () => {
		const plan = planReviewPanel({ complexity: "trivial", reviewerTier: "strong" });
		expect(plan.eyes).toBe(1);
		expect(plan.lenses.map((lens) => lens.id)).toEqual(["spec_fit"]);
	});

	it("trivial gives one eye regardless of tier (depth is set by complexity, not capability)", () => {
		for (const tier of ["weak", "mid", "strong"] as const) {
			const plan = planReviewPanel({ complexity: "trivial", reviewerTier: tier });
			expect(plan.lenses.map((lens) => lens.id)).toEqual(["spec_fit"]);
		}
	});

	// (c) complex + strong → the FULL ordered panel (every lens, in failure-mass order).
	it("complex + strong → the full ordered panel", () => {
		const plan = planReviewPanel({ complexity: "complex", reviewerTier: "strong" });
		expect(plan.eyes).toBe(Number.POSITIVE_INFINITY);
		expect(plan.lenses.map((lens) => lens.id)).toEqual([
			"spec_fit",
			"integration",
			"test_quality",
			"correctness",
			"security",
			"performance",
			"simplicity",
		]);
	});

	it("standard → 2 eyes = the first two failure-mass lenses for a capable tier", () => {
		const plan = planReviewPanel({ complexity: "standard", reviewerTier: "strong" });
		expect(plan.eyes).toBe(2);
		expect(plan.lenses.map((lens) => lens.id)).toEqual(["spec_fit", "integration"]);
	});

	it("standard + weak drops the mid-tier 'integration' lens (falls through to the next backable one)", () => {
		// Two eyes requested, but a weak reviewer can't back 'integration' (mid): it gets its first two eligible lenses.
		const plan = planReviewPanel({ complexity: "standard", reviewerTier: "weak" });
		expect(plan.eyes).toBe(2);
		expect(plan.lenses.map((lens) => lens.id)).toEqual(["spec_fit", "correctness"]);
		expect(plan.lenses.map((lens) => lens.id)).not.toContain("integration");
	});

	// novel is the deepest band — same full-panel request as complex; the tier gate still governs the grant.
	it("novel + mid → all mid-backable lenses, never a strong-only security lens", () => {
		const plan = planReviewPanel({ complexity: "novel", reviewerTier: "mid" });
		expect(plan.eyes).toBe(Number.POSITIVE_INFINITY);
		const ids = plan.lenses.map((lens) => lens.id);
		expect(ids).toEqual(["spec_fit", "integration", "test_quality", "correctness", "performance", "simplicity"]);
		expect(ids).not.toContain("security");
	});

	it("is pure/deterministic — identical inputs yield identical plans", () => {
		const a = planReviewPanel({ complexity: "complex", reviewerTier: "strong" });
		const b = planReviewPanel({ complexity: "complex", reviewerTier: "strong" });
		expect(a).toEqual(b);
	});
});
