import { describe, expect, it } from "vitest";
import { appendSystemPrompt, buildNKleinStartPromptParts } from "../../../src/nklein-agent/nklein-task-prompt-builders";

/**
 * §5.B — the Planning/Refinement lane prompt selection. A started WORK card gets the refinement preamble (re-validate
 * against current project state, then call `begin_implementation`); a decompose/plan card keeps the decomposition
 * prompt; a home/chat session (not a refinable work card) gets neither.
 */
describe("buildNKleinStartPromptParts (§5.B refinement-lane prompt selection)", () => {
	it("gives a work card the refinement preamble + begin_implementation directive", () => {
		const parts = buildNKleinStartPromptParts("Build the widget", false, true);
		expect(parts.systemPrompt).toBeTruthy();
		expect(parts.systemPrompt).toMatch(/Refinement/i);
		expect(parts.systemPrompt).toMatch(/begin_implementation/);
		expect(parts.systemWorkflowCommand).toBeNull();
	});

	it("gives a home/chat session (not a work card) no planning/refinement prompt", () => {
		const parts = buildNKleinStartPromptParts("hi", false, false);
		expect(parts.systemPrompt).toBeNull();
		expect(parts.systemWorkflowCommand).toBeNull();
	});

	it("gives a decompose/plan card the decomposition prompt, not the refinement one", () => {
		const parts = buildNKleinStartPromptParts("Decompose this project into cards", true, false);
		expect(parts.systemPrompt).toBeTruthy();
		expect(parts.systemPrompt).not.toMatch(/begin_implementation/);
		expect(parts.systemWorkflowCommand).toBe("/kanban-decompose");
	});

	it("never leaks the refinement preamble into a plan-mode card even if the work-card flag is set", () => {
		// startInPlanMode wins: a plan-mode card is never a refinable work card.
		const parts = buildNKleinStartPromptParts("Plan it", true, true);
		expect(parts.systemPrompt).not.toMatch(/begin_implementation/);
		expect(parts.systemWorkflowCommand).toBe("/kanban-decompose");
	});
});

describe("appendSystemPrompt", () => {
	it("appends a non-empty system prompt after a blank-line separator", () => {
		expect(appendSystemPrompt("base", "extra")).toBe("base\n\nextra");
	});

	it("trims surrounding whitespace off the appended prompt", () => {
		expect(appendSystemPrompt("base", "  extra  ")).toBe("base\n\nextra");
	});

	it("returns the base unchanged when the appended prompt is null, empty, or whitespace-only", () => {
		expect(appendSystemPrompt("base", null)).toBe("base");
		expect(appendSystemPrompt("base", "")).toBe("base");
		expect(appendSystemPrompt("base", "   \n\t ")).toBe("base");
	});
});
