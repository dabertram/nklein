import { describe, expect, it } from "vitest";
import {
	buildReanchorAbMessages,
	scoreReanchorRecall,
	summarizeReanchorAb,
} from "../../../src/core/reanchor-quality-ab";

describe("re-anchor quality A/B (F4.8b)", () => {
	it("changes only the treatment's final production re-anchor", () => {
		const baseline = buildReanchorAbMessages({ anchored: false, distractorChars: 2_000 });
		const anchored = buildReanchorAbMessages({ anchored: true, distractorChars: 2_000 });
		expect(anchored.slice(0, -1)).toEqual(baseline);
		expect(anchored.at(-1)?.content).toContain("<reanchor>");
		expect(anchored.at(-1)?.content).toContain("TREND-ALPHA");
		expect(anchored.at(-1)?.content).toContain("DECLINING-STABLE");
	});

	it("scores exact contract retention and penalizes decoys", () => {
		expect(scoreReanchorRecall("TREND-ALPHA LAST-SIX CAP-100 DECLINING-STABLE")).toMatchObject({
			score: 1,
			passed: true,
		});
		expect(scoreReanchorRecall("TREND-ALPHA LAST-SIX CAP-100 RISING-RANDOM")).toMatchObject({
			score: 0.5,
			passed: false,
		});
	});

	it("enables only on a no-regression fleet gain", () => {
		const full = scoreReanchorRecall("TREND-ALPHA LAST-SIX CAP-100 DECLINING-STABLE");
		const partial = scoreReanchorRecall("TREND-ALPHA LAST-SIX");
		expect(summarizeReanchorAb([{ modelId: "small", baseline: partial, anchored: full }]).decision).toBe("enable");
		expect(summarizeReanchorAb([{ modelId: "capable", baseline: full, anchored: partial }]).decision).toBe("reject");
		expect(summarizeReanchorAb([{ modelId: "same", baseline: full, anchored: full }]).decision).toBe("inconclusive");
	});
});
