export const KANBAN_DECOMPOSE_WORKFLOW_NAME = "kanban-decompose";

export const KANBAN_DECOMPOSE_PROMPT = `You are decomposing a project-scale idea for Kanban.

Use Kanban's decomposition workflow instead of editing Kanban internals directly:
- Do not manually create or edit \`.cline/kanban/plans/**\`, \`tasks.json\`, board state, workspace state, or dependency state.
- Prepare a concise spec, implementation plan, and task graph in your reasoning.
- Call the \`decompose_project\` tool with slug, spec, plan, title, tasks, and defaultAcceptanceCommand when useful. The tool wraps the tasks into the internal graph, validates dependencies/sizing, and persists the approved Kanban artifacts.
- After the tool succeeds, use the command it returns, or tell the user the exact \`kanban task decompose --slug <slug> --project-path <workspace_path>\` command to apply the task graph.

Each task in the tool's \`tasks\` input must include id, title, and prompt. Add these fields when relevant:
- dependsOn[], complexity, suggestedRole, filesLikelyTouched[], acceptanceCommand, testFirst, acceptanceTestPrompt.
- A self-contained prompt with the relevant slice of the spec and exact acceptance criteria.
- Complexity <= 75.
- No more than 3 likely files.
- A machine-checkable acceptanceCommand.
- For suitable changes, set testFirst=true and include the exact acceptance test to write or update in acceptanceTestPrompt.

Split or expand any leaf that cannot satisfy those limits before calling \`decompose_project\`.
`;

export const KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN = `---
name: ${KANBAN_DECOMPOSE_WORKFLOW_NAME}
description: Create Kanban decomposition artifacts for a project-scale idea.
---

${KANBAN_DECOMPOSE_PROMPT}`;

const KANBAN_DECOMPOSE_COMMAND_PATTERN = /^\/kanban-decompose(?:\s+.*)?$/;

export function resolveKanbanDecomposePrompt(prompt: string): string {
	const normalizedPrompt = prompt.replace(/\r\n/g, "\n");
	const [firstLine = "", ...restLines] = normalizedPrompt.split("\n");
	if (!KANBAN_DECOMPOSE_COMMAND_PATTERN.test(firstLine.trim())) {
		return prompt;
	}

	const taskPrompt = restLines.join("\n").trimStart();
	const builtInPrompt = KANBAN_DECOMPOSE_PROMPT.trimEnd();
	return taskPrompt ? `${builtInPrompt}\n\n${taskPrompt}` : builtInPrompt;
}
