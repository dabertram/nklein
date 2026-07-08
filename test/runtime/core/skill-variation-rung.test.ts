import { describe, expect, it } from "vitest";
import { nextSkillVariation } from "../../../src/core/skill-variation-rung";

const AVAILABLE = ["code_editing", "planning", "review", "web_retrieval"];

describe("nextSkillVariation (§5.AE stuck-task skill-mix escalation — no circles)", () => {
	it("walks the escalation order: add planning → add retrieval → minimal core, skipping tried mixes", () => {
		const first = nextSkillVariation({
			currentSkillIds: ["code_editing", "review"],
			triedMixes: [["code_editing", "review"]],
			availableSkillIds: AVAILABLE,
		});
		expect(first.variation).toBe("add_planning");
		expect(first.nextSkillIds).toEqual(["code_editing", "review", "planning"]);

		const second = nextSkillVariation({
			currentSkillIds: ["code_editing", "review"],
			triedMixes: [
				["code_editing", "review"],
				["code_editing", "review", "planning"],
			],
			availableSkillIds: AVAILABLE,
		});
		expect(second.variation).toBe("add_web_retrieval");

		const third = nextSkillVariation({
			currentSkillIds: ["code_editing", "review"],
			triedMixes: [
				["code_editing", "review"],
				["planning", "code_editing", "review"], // order-insensitive dedup
				["code_editing", "review", "web_retrieval"],
			],
			availableSkillIds: AVAILABLE,
		});
		expect(third.variation).toBe("minimal_core");
		expect(third.nextSkillIds).toEqual(["code_editing"]);
	});

	it("returns null when the variation space is exhausted, and never proposes an unavailable skill", () => {
		const exhausted = nextSkillVariation({
			currentSkillIds: ["code_editing"],
			triedMixes: [["code_editing"], ["code_editing", "planning"], ["code_editing", "web_retrieval"]],
			availableSkillIds: AVAILABLE,
		});
		expect(exhausted).toEqual({ nextSkillIds: null, variation: null });

		const noRetrievalRegistry = nextSkillVariation({
			currentSkillIds: ["code_editing", "planning"],
			triedMixes: [["code_editing", "planning"]],
			availableSkillIds: ["code_editing", "planning"],
		});
		// Retrieval unavailable ⇒ jumps straight to minimal core.
		expect(noRetrievalRegistry.variation).toBe("minimal_core");
	});
});
