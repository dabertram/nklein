import { describe, expect, it } from "vitest";
import { buildNKleinStartPromptParts, formatResumedDecompositionGuidance } from "./nklein-task-prompt-builders";

// P0.DSTALL: a plan-mode session that RESTARTED resumes its durable decompose construction. The start prompt now
// names the already-declared task ids so a slow local model does not re-declare them into duplicate_node
// rejections (run-4 wasted three such 48-248s turns before the reactive orientation recovered it).

const DECOMPOSE_PROMPT = "Decompose this project into dependent implementation cards.";

describe("formatResumedDecompositionGuidance", () => {
	it("returns [] for no held ids (fresh start ⇒ byte-identical prompt)", () => {
		expect(formatResumedDecompositionGuidance([])).toEqual([]);
	});

	it("drops blank ids and returns [] when nothing real remains", () => {
		expect(formatResumedDecompositionGuidance(["  ", ""])).toEqual([]);
	});

	it("names the held ids and the finish move, warning against re-declaration", () => {
		const [line, ...rest] = formatResumedDecompositionGuidance(["scaffolding", "domain-model"]);
		expect(rest).toEqual([]);
		expect(line).toContain("scaffolding");
		expect(line).toContain("domain-model");
		expect(line).toContain("duplicate_node");
		expect(line).toContain("decompose_project with NO arguments");
	});

	it("caps the listing at 40 ids with an ellipsis", () => {
		const ids = Array.from({ length: 50 }, (_unused, index) => `task-${index}`);
		const [line] = formatResumedDecompositionGuidance(ids);
		expect(line).toContain("50 task(s)");
		expect(line).toContain("…");
		expect(line).not.toContain("task-45"); // beyond the 40-id cap
	});
});

describe("buildNKleinStartPromptParts — resumed decomposition guidance", () => {
	it("injects the held-node brief into a plan-mode decomposition system prompt", () => {
		const parts = buildNKleinStartPromptParts(
			DECOMPOSE_PROMPT,
			true, // startInPlanMode
			false, // isRefinableWorkCard
			null, // autoDepth
			undefined, // frameworkPreamble
			null, // fleetGuidance
			null, // specDeliberationGuidance
			formatResumedDecompositionGuidance(["scaffolding"]),
		);
		expect(parts.systemPrompt).toContain("scaffolding");
		expect(parts.systemPrompt).toContain("already declared");
	});

	it("omitting the guidance leaves the prompt byte-identical (no resumed brief)", () => {
		const withNull = buildNKleinStartPromptParts(DECOMPOSE_PROMPT, true, false, null, undefined, null, null, null);
		const withoutArg = buildNKleinStartPromptParts(DECOMPOSE_PROMPT, true, false, null, undefined, null, null);
		expect(withNull.systemPrompt).toBe(withoutArg.systemPrompt);
		expect(withNull.systemPrompt).not.toContain("already declared");
	});
});
