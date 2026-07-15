import { describe, expect, it } from "vitest";
import { appendSystemPrompt, buildNKleinStartPromptParts } from "../../../src/nklein-agent/nklein-task-prompt-builders";

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
