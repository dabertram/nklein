import { describe, expect, it } from "vitest";
import { buildDecisionHandoff } from "../../../src/core/decision-handoff";

describe("buildDecisionHandoff (F12.38)", () => {
	it("renders steps, files, and the shaping review constraint in one compact block", () => {
		const brief = buildDecisionHandoff({
			taskId: "card-a",
			title: "Build the parser",
			completedSteps: ["Chose a recursive-descent parser over regex", "Added the token stream"],
			filesTouched: ["src/parser.ts", "src/tokens.ts"],
			shapingReviewFeedback: "Keep parse errors recoverable — no throws across the module boundary.",
			workerNotes: null,
		});
		expect(brief).toContain('[Handoff from the dependency "Build the parser" (card-a)]');
		expect(brief).toContain("- Chose a recursive-descent parser over regex");
		expect(brief).toContain("src/parser.ts, src/tokens.ts");
		expect(brief).toContain("still binding on follow-up work");
	});

	it("caps long lists and reports the remainder honestly", () => {
		const brief = buildDecisionHandoff({
			taskId: "a",
			title: "T",
			completedSteps: Array.from({ length: 9 }, (_, i) => `step ${i}`),
			filesTouched: Array.from({ length: 14 }, (_, i) => `f${i}.ts`),
			shapingReviewFeedback: null,
			workerNotes: null,
		});
		expect(brief).toContain("…and 3 more step(s)");
		expect(brief).toContain("(+4 more)");
	});

	it("returns null when there is nothing to hand off — no boilerplate", () => {
		expect(
			buildDecisionHandoff({
				taskId: "a",
				title: "T",
				completedSteps: [],
				filesTouched: [],
				shapingReviewFeedback: null,
				workerNotes: null,
			}),
		).toBeNull();
	});
});
