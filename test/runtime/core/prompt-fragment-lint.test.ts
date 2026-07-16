import { describe, expect, it } from "vitest";
import {
	extractInstructionUnits,
	instructionCapForModel,
	lintInstructionBudget,
	lintProhibitions,
	lintPromptFragment,
} from "../../../src/core/prompt-fragment-lint";

describe("extractInstructionUnits", () => {
	it("counts bullets, imperative-lead, and modal sentences while ignoring plain prose", () => {
		const text = [
			"Use the shared apiClient for all network calls.",
			"The project uses TypeScript and Vitest.", // prose, no directive → ignored
			"You must validate every input.",
			"- Always run tsc before committing.",
			"- Prefer small focused diffs.",
		].join("\n");
		const units = extractInstructionUnits(text);
		expect(units.map((u) => u.text)).toEqual([
			"Use the shared apiClient for all network calls.",
			"You must validate every input.",
			"Always run tsc before committing.",
			"Prefer small focused diffs.",
		]);
	});

	it("splits a non-bullet line into multiple directives on sentence boundaries", () => {
		const units = extractInstructionUnits("Use the broker. Never call fetch directly.");
		expect(units).toHaveLength(2);
		expect(units[1]?.markers).toContain("never");
	});

	it("records the modal markers and imperative-lead flag per unit", () => {
		const [unit] = extractInstructionUnits("You must always sanitize output.");
		expect(unit?.imperativeLead).toBe(false); // starts with "you"
		expect(unit?.markers).toEqual(expect.arrayContaining(["must", "always"]));
	});

	it("does not match a marker embedded in a longer word (mustard is not must)", () => {
		expect(extractInstructionUnits("The mustard is yellow.")).toEqual([]);
	});
});

describe("instructionCapForModel", () => {
	it("scales ~5 per B, clamped to [20,150]", () => {
		expect(instructionCapForModel(4)).toBe(20); // floor
		expect(instructionCapForModel(7)).toBe(35);
		expect(instructionCapForModel(14)).toBe(70);
		expect(instructionCapForModel(32)).toBe(150); // ceiling (160 → clamped)
		expect(instructionCapForModel(70)).toBe(150);
	});

	it("uses a conservative middle for unknown size", () => {
		expect(instructionCapForModel()).toBe(60);
		expect(instructionCapForModel(0)).toBe(60);
	});
});

describe("lintInstructionBudget", () => {
	it("flags over-budget with the overshoot count and advice", () => {
		const text = ["- Use A.", "- Add B.", "- Remove C.", "- Verify D."].join("\n"); // 4 directives
		const lint = lintInstructionBudget(text, { cap: 2 });
		expect(lint.count).toBe(4);
		expect(lint.cap).toBe(2);
		expect(lint.overBudget).toBe(true);
		expect(lint.overBy).toBe(2);
		expect(lint.advice).toContain("exceed");
	});

	it("passes when within a model-size-derived budget", () => {
		const lint = lintInstructionBudget("- Use A.\n- Add B.", { modelSizeB: 7 }); // cap 35, count 2
		expect(lint.overBudget).toBe(false);
		expect(lint.overBy).toBe(0);
		expect(lint.advice).toContain("within budget");
	});
});

describe("lintProhibitions", () => {
	it("flags bare prohibitions but not ones paired with a concrete alternative", () => {
		const text = [
			"- Never call fetch directly; use the broker instead.", // paired → not bare
			"- Do not hardcode paths.", // bare
			"- Avoid mutable global state.", // bare
			"- Always use the shared client.", // positive, not a prohibition
		].join("\n");
		const lint = lintProhibitions(text);
		expect(lint.findings).toHaveLength(3);
		expect(lint.bareCount).toBe(2);
		const paired = lint.findings.find((f) => f.text.includes("broker"));
		expect(paired?.hasAlternative).toBe(true);
		expect(lint.advice).toContain("bare prohibition");
	});

	it("reports all-clear when every negative is paired with an alternative", () => {
		const lint = lintProhibitions("- Don't mutate props; use local state instead.");
		expect(lint.findings).toHaveLength(1);
		expect(lint.bareCount).toBe(0);
		expect(lint.advice).toContain("no bare prohibitions");
	});
});

describe("lintPromptFragment", () => {
	it("combines both checks and reports whether anything is actionable", () => {
		const clean = lintPromptFragment("- Use the shared client.\n- Prefer small diffs.", { modelSizeB: 32 });
		expect(clean.hasWarnings).toBe(false);

		const dirty = lintPromptFragment("- Do not hardcode paths.", { cap: 100 });
		expect(dirty.hasWarnings).toBe(true); // bare prohibition, even though within budget
		expect(dirty.prohibitions.bareCount).toBe(1);
	});
});
