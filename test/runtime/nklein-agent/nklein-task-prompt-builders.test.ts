import { describe, expect, it } from "vitest";
import {
	appendSystemPrompt,
	buildNKleinStartPromptParts,
	formatAutoDecompositionDepthGuidance,
} from "../../../src/nklein-agent/nklein-task-prompt-builders";

describe("buildNKleinStartPromptParts (§5.U)", () => {
	it("plan mode yields a planning system prompt + the decompose workflow command, preserving the user prompt", () => {
		const parts = buildNKleinStartPromptParts("Build a habit tracker CLI", true);
		expect(parts.userPrompt).toBe("Build a habit tracker CLI");
		expect(parts.systemPrompt).toContain("decompose_project"); // decomposition instruction is always present in plan mode
		expect(parts.systemWorkflowCommand).toBe("/kanban-decompose");
	});

	it("a refinable work card (not plan mode) gets the Planning/Refinement preamble and no workflow command", () => {
		const parts = buildNKleinStartPromptParts("card prompt", false, true);
		expect(parts.systemPrompt).toContain("Refinement");
		expect(parts.systemPrompt).toContain("begin_implementation");
		expect(parts.systemWorkflowCommand).toBeNull();
	});

	it("a plain started card (neither plan mode nor refinable) gets no system prompt or command", () => {
		const parts = buildNKleinStartPromptParts("card prompt", false, false);
		expect(parts.systemPrompt).toBeNull();
		expect(parts.systemWorkflowCommand).toBeNull();
	});

	describe("F4.38 AUTO decomposition-depth guidance", () => {
		const decomposePrompt = "Decompose: build a habit tracker CLI into dependent cards";

		it("omitting the depth decision is byte-identical (no AUTO-depth line)", () => {
			const parts = buildNKleinStartPromptParts(decomposePrompt, true);
			expect(parts.systemPrompt).not.toContain("Decomposition depth (AUTO)");
		});

		it("a depth ≥ 1 decision adds the nested-breakdown guidance line", () => {
			const parts = buildNKleinStartPromptParts(decomposePrompt, true, false, { depth: 2, reason: "hard base 2" });
			expect(parts.systemPrompt).toContain("Decomposition depth (AUTO)");
			expect(parts.systemPrompt).toContain("2 level(s)");
		});

		it("a depth 0 decision advises a shallow breakdown", () => {
			const parts = buildNKleinStartPromptParts(decomposePrompt, true, false, {
				depth: 0,
				reason: "trivial base 0",
			});
			expect(parts.systemPrompt).toContain("keep the breakdown SHALLOW");
		});

		it("the depth line is only added in plan mode (a null decision or non-plan card never shows it)", () => {
			expect(buildNKleinStartPromptParts(decomposePrompt, true, false, null).systemPrompt).not.toContain(
				"Decomposition depth (AUTO)",
			);
			// non-plan refinable card ignores the depth arg entirely
			expect(buildNKleinStartPromptParts("card", false, true, { depth: 3, reason: "x" }).systemPrompt).not.toContain(
				"Decomposition depth",
			);
		});
	});
});

describe("formatAutoDecompositionDepthGuidance (F4.38)", () => {
	it("depth 0 → shallow advice; depth ≥ 1 → N nested levels", () => {
		expect(formatAutoDecompositionDepthGuidance({ depth: 0, reason: "r" })).toContain("SHALLOW");
		const deep = formatAutoDecompositionDepthGuidance({ depth: 3, reason: "r" });
		expect(deep).toContain("3 level(s)");
		expect(deep).toContain("effective context");
	});
});

describe("appendSystemPrompt", () => {
	it("appends a non-empty prompt after a blank-line separator", () => {
		expect(appendSystemPrompt("BASE", "extra")).toBe("BASE\n\nextra");
	});

	it("returns the base unchanged for a null/empty/whitespace prompt", () => {
		expect(appendSystemPrompt("BASE", null)).toBe("BASE");
		expect(appendSystemPrompt("BASE", "   ")).toBe("BASE");
	});
});
