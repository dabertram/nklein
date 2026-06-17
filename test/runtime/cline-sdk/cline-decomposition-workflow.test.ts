import { describe, expect, it } from "vitest";

import {
	KANBAN_DECOMPOSE_PROMPT,
	resolveKanbanDecomposePrompt,
} from "../../../src/cline-sdk/cline-decomposition-workflow";

describe("resolveKanbanDecomposePrompt", () => {
	it("expands the Kanban decomposition command as a built-in prompt", () => {
		const resolved = resolveKanbanDecomposePrompt(
			"/kanban-decompose\n\nProject-scale task to decompose:\nTitle: Complex dev scenario\n",
		);

		expect(resolved).toContain(KANBAN_DECOMPOSE_PROMPT.trimEnd());
		expect(resolved).toContain("Call the `decompose_project` tool");
		expect(resolved).toContain("Do not manually create or edit `.cline/kanban/plans/**`, `tasks.json`");
		expect(resolved).toContain("Project-scale task to decompose:");
		expect(resolved).toContain("Title: Complex dev scenario");
		expect(resolved).not.toContain("name: kanban-decompose");
	});

	it("keeps ordinary prompts unchanged", () => {
		const prompt = "Implement the next card without using a workflow command.";

		expect(resolveKanbanDecomposePrompt(prompt)).toBe(prompt);
	});
});
