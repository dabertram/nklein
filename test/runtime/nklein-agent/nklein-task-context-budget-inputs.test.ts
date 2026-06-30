import { describe, expect, it } from "vitest";

import { TaskContextBudgetInputs } from "../../../src/nklein-agent/nklein-task-context-budget-inputs";

describe("TaskContextBudgetInputs", () => {
	it("records and reads back the system prompt and tool-schema tokens", () => {
		const inputs = new TaskContextBudgetInputs();
		inputs.record("t1", "You are a careful assistant.", 350);
		expect(inputs.getSystemPrompt("t1")).toBe("You are a careful assistant.");
		expect(inputs.getToolSchemaTokens("t1")).toBe(350);
	});

	it("defaults an unknown task's system prompt to null and tokens to 0", () => {
		const inputs = new TaskContextBudgetInputs();
		expect(inputs.getSystemPrompt("missing")).toBeNull();
		expect(inputs.getToolSchemaTokens("missing")).toBe(0);
	});

	it("keeps per-task inputs independent", () => {
		const inputs = new TaskContextBudgetInputs();
		inputs.record("t1", "prompt one", 100);
		inputs.record("t2", "prompt two", 200);
		expect(inputs.getSystemPrompt("t1")).toBe("prompt one");
		expect(inputs.getToolSchemaTokens("t2")).toBe(200);
	});

	it("a later record overwrites the prior stash for a task", () => {
		const inputs = new TaskContextBudgetInputs();
		inputs.record("t1", "first", 10);
		inputs.record("t1", "second", 20);
		expect(inputs.getSystemPrompt("t1")).toBe("second");
		expect(inputs.getToolSchemaTokens("t1")).toBe(20);
	});

	it("preserves an empty-string system prompt distinctly from an absent one", () => {
		const inputs = new TaskContextBudgetInputs();
		inputs.record("t1", "", 0);
		// An explicitly-recorded empty prompt reads back as "" (not the null default).
		expect(inputs.getSystemPrompt("t1")).toBe("");
		expect(inputs.getSystemPrompt("other")).toBeNull();
	});
});
