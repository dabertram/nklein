import { describe, expect, it } from "vitest";
import { reviewSpec } from "../../src/core/spec-review-pipeline";

/**
 * F12.8 wire — the honest composition of F12.9's lint and F12.8's clarification sequencer.
 *
 * The one piece with real logic is which topics are treated as answered, and the trap is over-claiming: guessing
 * `problem`/`core_actions`/`out_of_scope` from keyword presence would drop real questions. These pin that the
 * pipeline claims ONLY what it can actually detect.
 */

const CHECKABLE = "Acceptance: run `npm test x` — it passes.";

describe("reviewSpec", () => {
	it("marks success_criteria answered ONLY when the lint finds a checkable success", () => {
		const withCheck = reviewSpec({ spec: CHECKABLE });
		expect(withCheck.detectedAnswered).toContain("success_criteria");

		const withoutCheck = reviewSpec({ spec: "It should be fast." });
		expect(withoutCheck.detectedAnswered).not.toContain("success_criteria");
		// And the lint independently agrees — the two cores must not contradict each other about the same fact.
		expect(withoutCheck.lintFindings.some((f) => f.kind === "missing_acceptance")).toBe(true);
	});

	it("does NOT infer problem / core_actions / out_of_scope from the text — they stay undetermined", () => {
		// A spec that literally contains all three words has still not necessarily STATED them. Inferring from
		// keyword presence is the confident-nonsense heuristic; the pipeline refuses it.
		const review = reviewSpec({ spec: `${CHECKABLE} problem core actions out of scope` });
		expect(review.undetermined).toEqual(["problem", "core_actions", "out_of_scope"]);
	});

	it("respects caller-asserted answers, removing them from the open set", () => {
		const review = reviewSpec({ spec: CHECKABLE, callerAnswered: ["problem", "core_actions", "out_of_scope"] });
		expect(review.next).toBeNull();
		expect(review.openQuestions).toHaveLength(0);
		expect(review.undetermined).toHaveLength(0);
	});

	it("asks the highest-priority open question first, one at a time", () => {
		const review = reviewSpec({ spec: CHECKABLE });
		// success_criteria detected → the first STRUCTURAL gap is problem.
		expect(review.next?.topic).toBe("problem");
		expect(review.openQuestions[0]?.topic).toBe("problem");
	});

	it("reports the spec ready when nothing is open", () => {
		const review = reviewSpec({
			spec: CHECKABLE,
			callerAnswered: ["problem", "core_actions", "out_of_scope"],
		});
		expect(review.summary).toContain("All structural topics accounted for");
		expect(review.next).toBeNull();
	});

	it("keeps success_criteria open AND lint-flagged when absent — not double-counted away", () => {
		// The overlap point: missing_acceptance (lint) and success_criteria (clarification) are the same gap seen
		// twice. It must appear as an open clarification, not be silently satisfied by the lint having named it.
		const review = reviewSpec({ spec: "Build the thing." });
		expect(review.openQuestions.some((q) => q.topic === "success_criteria")).toBe(true);
	});

	it("lets authoritative structured input keep a topic open despite a free-form acceptance hint", () => {
		const review = reviewSpec({ spec: CHECKABLE, callerUnanswered: ["success_criteria"] });
		expect(review.detectedAnswered).not.toContain("success_criteria");
		expect(review.openQuestions.some((question) => question.topic === "success_criteria")).toBe(true);
	});
});
