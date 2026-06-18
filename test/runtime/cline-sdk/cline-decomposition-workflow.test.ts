import { describe, expect, it } from "vitest";

import {
	KANBAN_DECOMPOSE_PROMPT,
	KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN,
	KANBAN_DECOMPOSE_WORKFLOW_NAME,
} from "../../../src/cline-sdk/cline-decomposition-workflow";

describe("Kanban decomposition workflow defaults", () => {
	it("defines an overridable workflow with the built-in decomposition instructions", () => {
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain(`name: ${KANBAN_DECOMPOSE_WORKFLOW_NAME}`);
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain(KANBAN_DECOMPOSE_PROMPT.trimEnd());
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain("Call the `decompose_project` tool");
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain("title, tasks, and defaultAcceptanceCommand");
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain("apply the generated graph through the command it returns");
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain("Only tell the user the exact `nklein task decompose");
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain("id, title, prompt, dependsOn[], complexity");
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain("Create reviewable !Klein tasks from the specification");
		expect(KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN).toContain(
			"Do not manually create or edit `.cline/nklein/plans/**`, `tasks.json`",
		);
	});
});
