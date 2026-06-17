export const KANBAN_DECOMPOSE_WORKFLOW_NAME = "kanban-decompose";

export const KANBAN_DECOMPOSE_PROMPT = `You are decomposing a project-scale idea for Kanban.

Write these artifacts under \`.cline/kanban/plans/<slug>/\`:
- \`spec.md\`: concise requirements, constraints, non-goals, and acceptance criteria.
- \`plan.md\`: implementation approach and dependency ordering.
- \`tasks.json\`: schemaVersion 1, slug, title, and tasks.

Each task in \`tasks.json\` must include:
- id, title, prompt, dependsOn[], complexity, suggestedRole, filesLikelyTouched[], acceptanceCommand, testFirst, acceptanceTestPrompt.
- A self-contained prompt with the relevant slice of the spec and exact acceptance criteria.
- Complexity <= 75.
- No more than 3 likely files.
- A machine-checkable acceptanceCommand.
- For suitable changes, set testFirst=true and include the exact acceptance test to write or update in acceptanceTestPrompt.

Split or expand any leaf that cannot satisfy those limits. When artifacts are ready, tell the user to run:

\`kanban task decompose --slug <slug> --project-path <workspace_path>\`
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
