import { describe, expect, it } from "vitest";
import { decideTaskSizing, requiredSplitCount, type TaskSizingInput } from "../../src/core/task-sizing-invariant";

function sizing(overrides: Partial<TaskSizingInput> = {}): TaskSizingInput {
	return {
		modelContextTokens: 32_000,
		estimatedTaskTokens: 8_000,
		reviewCapacityLines: 400,
		estimatedDiffLines: 120,
		...overrides,
	};
}

describe("decideTaskSizing", () => {
	it("fits when both ceilings have room", () => {
		const verdict = decideTaskSizing(sizing());
		expect(verdict.fits).toBe(true);
		expect(verdict.binding).toBe("neither");
	});

	it("names REVIEW CAPACITY when it binds, and refuses the model remedy", () => {
		// The remedy differs completely, and the wrong lever here is the one that is always available.
		const verdict = decideTaskSizing(sizing({ estimatedDiffLines: 1_200 }));
		expect(verdict.binding).toBe("review_capacity");
		expect(verdict.mustSplit).toBe(true);
		expect(verdict.reason).toContain("cannot be fixed with a bigger model");
	});

	it("names MODEL CONTEXT when it binds, and allows the model remedies", () => {
		const verdict = decideTaskSizing(sizing({ estimatedTaskTokens: 90_000 }));
		expect(verdict.binding).toBe("model_context");
		expect(verdict.reason).toContain("larger-context model");
	});

	it("tells you to split FIRST when both are exceeded", () => {
		// A larger model fixes only the half the system already complains about, and leaves the silent half.
		const verdict = decideTaskSizing(sizing({ estimatedTaskTokens: 90_000, estimatedDiffLines: 1_200 }));
		expect(verdict.binding).toBe("both");
		expect(verdict.reason).toContain("silent half");
	});

	it("a huge model context does NOT rescue an over-review-budget task", () => {
		// The invariant's whole point: every context increase loosens one ceiling and leaves the other where it was.
		const verdict = decideTaskSizing(sizing({ modelContextTokens: 2_000_000, estimatedDiffLines: 5_000 }));
		expect(verdict.fits).toBe(false);
		expect(verdict.binding).toBe("review_capacity");
	});

	it("flags a task that fits but leaves no headroom", () => {
		const verdict = decideTaskSizing(sizing({ estimatedDiffLines: 380 }));
		expect(verdict.fits).toBe(true);
		expect(verdict.reason).toContain("tight against review capacity");
	});

	it("treats an UNKNOWN ceiling as no room rather than infinite room", () => {
		const verdict = decideTaskSizing(sizing({ reviewCapacityLines: 0 }));
		expect(verdict.fits).toBe(false);
		expect(Number.isFinite(verdict.overshoot)).toBe(false);
	});

	it("does not throw on nonsense input", () => {
		expect(() =>
			decideTaskSizing({
				modelContextTokens: Number.NaN,
				estimatedTaskTokens: -5,
				reviewCapacityLines: -1,
				estimatedDiffLines: Number.NaN,
			}),
		).not.toThrow();
	});
});

describe("requiredSplitCount", () => {
	it("returns 1 for a task that already fits — never 0", () => {
		// 0 would read as 'no pieces needed' and could be mistaken for 'do not do it'.
		expect(requiredSplitCount(decideTaskSizing(sizing()))).toBe(1);
	});

	it("rounds up from the tighter ratio", () => {
		const verdict = decideTaskSizing(sizing({ estimatedDiffLines: 1_000 })); // 2.5x review
		expect(requiredSplitCount(verdict)).toBe(3);
	});

	it("asks for the honest minimum of 2 when a ceiling is unknown", () => {
		// Fabricating a split count from an unknown ceiling would look precise and mean nothing.
		const verdict = decideTaskSizing(sizing({ reviewCapacityLines: 0 }));
		expect(requiredSplitCount(verdict)).toBe(2);
	});
});
