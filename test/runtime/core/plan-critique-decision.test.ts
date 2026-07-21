import { describe, expect, it } from "vitest";
import { decidePlanCritique } from "../../../src/core/plan-critique-decision";

const base = {
	taskCount: 6,
	dependencyCount: 4,
	qualityWarningCount: 2,
	diverseCriticAvailable: true,
	critiqueBudgetRemaining: 2,
	alreadyCritiqued: false,
};

describe("decidePlanCritique (W4.3)", () => {
	it("critiques a big, coupled, warning-bearing plan when a diverse critic is loaded", () => {
		const decision = decidePlanCritique(base);
		expect(decision.deliberate).toBe(true);
	});

	it("critiques a small flat plan because structural simplicity does not prove semantic coverage", () => {
		const decision = decidePlanCritique({ ...base, taskCount: 2, dependencyCount: 1 });
		expect(decision.deliberate).toBe(true);
	});

	it("critiques a warning-free graph because structural checks cannot catch invented or omitted scope", () => {
		const decision = decidePlanCritique({ ...base, qualityWarningCount: 0 });
		expect(decision.deliberate).toBe(true);
	});

	it("surfaces the diversity waiver instead of faking a same-family debate", () => {
		const decision = decidePlanCritique({ ...base, diverseCriticAvailable: false });
		expect(decision.deliberate).toBe(false);
		if (!decision.deliberate) {
			expect(decision.diversityWaived).toBe(true);
		}
	});

	it("critiques each plan slug at most once (revisions apply feedback, not re-debate)", () => {
		const decision = decidePlanCritique({ ...base, alreadyCritiqued: true });
		expect(decision.deliberate).toBe(false);
		if (!decision.deliberate) {
			expect(decision.reason).toContain("one critique round");
		}
	});

	it("respects the per-run count budget", () => {
		const decision = decidePlanCritique({ ...base, critiqueBudgetRemaining: 0 });
		expect(decision.deliberate).toBe(false);
	});

	it("dependency-heavy plans also receive the mandatory pre-apply critique", () => {
		const decision = decidePlanCritique({ ...base, taskCount: 3, dependencyCount: 3 });
		expect(decision.deliberate).toBe(true);
	});
});
