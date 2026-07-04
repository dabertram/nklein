import { describe, expect, it } from "vitest";
import { estimateTaskDifficulty } from "../../../src/core/task-difficulty-estimate";

const base = {
	objectiveText: "fix a typo",
	expectedFileCount: 1,
	hasAcceptanceTests: false,
	bounceCount: 0,
};

describe("estimateTaskDifficulty", () => {
	it("a tiny single-file no-test card is easy", () => {
		const { tier, score } = estimateTaskDifficulty(base);
		expect(tier).toBe("easy");
		expect(score).toBeLessThan(0.33);
	});

	it("a broad, test-backed, long-spec card is harder", () => {
		const longSpec = `${"design ".repeat(120)}`; // ~120 words
		const easy = estimateTaskDifficulty(base).score;
		const hard = estimateTaskDifficulty({
			objectiveText: longSpec,
			expectedFileCount: 8,
			hasAcceptanceTests: true,
			bounceCount: 0,
		}).score;
		expect(hard).toBeGreaterThan(easy);
	});

	it("authored complexity is the intrinsic prior when present", () => {
		const low = estimateTaskDifficulty({ ...base, authoredComplexity: 10 });
		const high = estimateTaskDifficulty({ ...base, authoredComplexity: 90 });
		expect(low.tier).toBe("easy");
		expect(high.tier).toBe("hard");
		expect(high.reasons.some((r) => r.includes("authored complexity 90"))).toBe(true);
	});

	it("bounces ESCALATE difficulty (a failed-review card needs a more capable model)", () => {
		const first = estimateTaskDifficulty({ ...base, authoredComplexity: 40 });
		const bounced = estimateTaskDifficulty({ ...base, authoredComplexity: 40, bounceCount: 2 });
		expect(bounced.score).toBeGreaterThan(first.score);
		expect(bounced.tier).not.toBe("easy");
		expect(bounced.reasons.some((r) => /bounced 2/.test(r))).toBe(true);
	});

	it("is fail-safe: garbage / negative inputs never over-escalate", () => {
		const est = estimateTaskDifficulty({
			objectiveText: "",
			expectedFileCount: -5,
			hasAcceptanceTests: false,
			bounceCount: -3,
			authoredComplexity: Number.NaN,
		});
		expect(est.score).toBe(0);
		expect(est.tier).toBe("easy");
	});

	it("score is always within [0,1] even with extreme inputs", () => {
		const est = estimateTaskDifficulty({
			objectiveText: "word ".repeat(1000),
			expectedFileCount: 999,
			hasAcceptanceTests: true,
			bounceCount: 99,
			authoredComplexity: 100,
		});
		expect(est.score).toBeLessThanOrEqual(1);
		expect(est.score).toBeGreaterThanOrEqual(0);
		expect(est.tier).toBe("hard");
	});
});
