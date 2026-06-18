export const KANBAN_DECOMPOSE_WORKFLOW_NAME = "kanban-decompose";

export const KANBAN_DECOMPOSE_PROMPT = `You are decomposing a project-scale idea for Kanban.

Use Kanban's decomposition workflow instead of editing Kanban internals directly:
- Do not manually create or edit \`.cline/kanban/plans/**\`, \`tasks.json\`, board state, workspace state, or dependency state.
- Before writing artifacts, inspect the idea for ambiguities, missing decisions, contradictions, risky defaults, and audience-facing product choices. Ask concise targeted questions when answers would change the plan; prefer concrete options with one recommended default and allow free-text.
- If the user does not answer, you may proceed only by recording an explicit assumption. Pass all answered questions and assumptions in \`decompose_project.questions\`; unresolved \`open\` questions are rejected.
- Prepare a concise spec, implementation plan, and task graph in your reasoning.
- Call the \`decompose_project\` tool with slug, spec, plan, title, tasks, and defaultAcceptanceCommand when useful. The tool wraps the tasks into the internal graph, validates dependencies/sizing, and persists the approved Kanban artifacts.
- If any proposed leaf is too broad, include a recursive \`expansions\` map in the same \`decompose_project\` call instead of calling \`expand_task\` and then trying again. Keys are oversized task ids; values are smaller replacement tasks. Kanban expands them before validation and rewrites dependencies to the terminal replacement leaves.
- After the tool succeeds, apply the generated graph through the command it returns whenever the Kanban runtime can continue autonomously. Only tell the user the exact \`kanban task decompose --slug <slug> --project-path <workspace_path>\` command when automation is unavailable or the task has explicitly opted out of automatic review/continuation.

Create reviewable Kanban tasks from the specification. For implementation leaves, use the workspace's provided acceptance command when one is available.

Each task in the tool's \`tasks\` input must include:
- id, title, prompt.
Add these fields when relevant:
- dependsOn[], complexity, suggestedRole, filesLikelyTouched[], acceptanceCommand, testFirst, acceptanceTestPrompt.
- A self-contained prompt with the relevant slice of the spec and exact acceptance criteria.
- Complexity <= 75.
- No more than 3 likely files.
- A machine-checkable acceptanceCommand.
- For suitable changes, set testFirst=true and include the exact acceptance test to write or update in acceptanceTestPrompt.

Each \`questions\` item must include id, question, status. Use status \`answered\` with answer, or \`assumed-default\` with assumption. Include options[] when you offered choices.

If you provide the lower-level \`taskGraph\` input instead of \`tasks\`, each task must include id, title, prompt, dependsOn[], complexity, suggestedRole, filesLikelyTouched[], acceptanceCommand, testFirst, and acceptanceTestPrompt.
Split or expand any leaf that cannot satisfy those limits before \`decompose_project\` validation finishes. If an atomic leaf still cannot fit the connected local models, stop and report the infeasible leaf and why it cannot be split further.
Do not modify implementation files, do not use write tools outside Kanban planning artifacts, and do not implement product code during decomposition.
`;

export const KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN = `---
name: ${KANBAN_DECOMPOSE_WORKFLOW_NAME}
description: Create Kanban decomposition artifacts for a project-scale idea.
---

${KANBAN_DECOMPOSE_PROMPT}`;
