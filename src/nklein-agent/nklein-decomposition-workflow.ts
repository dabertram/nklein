export const KANBAN_DECOMPOSE_WORKFLOW_NAME = "kanban-decompose";

export const KANBAN_DECOMPOSE_PROMPT = `You are decomposing a project-scale idea for !Klein.

Use !Klein's decomposition workflow instead of editing !Klein internals directly:
- Do not manually create or edit \`.nklein/nklein/plans/**\`, \`tasks.json\`, board state, workspace state, or dependency state.
- Before writing artifacts, inspect the idea for ambiguities, missing decisions, contradictions, risky defaults, and audience-facing product choices. Ask concise targeted questions when answers would change the plan; prefer concrete options with one recommended default and allow free-text.
- If the user does not answer, you may proceed only by recording an explicit assumption. Pass all answered questions and assumptions in \`decompose_project.questions\`; unresolved \`open\` questions are rejected.
- Prepare a short plain-language \`summary\` for non-technical review: what will be built, how many implementation steps/cards there are, and which assumptions remain.

Domain knowledge & scope pressure (mandatory for unfamiliar or domain-heavy work such as audio/DSP, cryptography, hardware, ML, or anything outside ordinary CRUD software):
- First spend a bounded knowledge-acquisition phase BEFORE finalizing the graph. Use the local code index, repo map, and architecture-knowledge tools to learn the existing codebase, and request sanctioned external lookups through the available tools when the domain is genuinely unfamiliar. Do not guess at domain constraints (e.g. psytrance kick/bass phase, four-on-the-floor timing, transient clarity) from first instinct.
- Explicitly identify what you do NOT know. For each card whose correctness depends on a risky assumption, set its \`knowledgeDebt\` to a short note of what is still unverified and which later card should verify it.
- Run a second "scope pressure" pass on your own graph: ask whether a serious implementation of this domain is under-decomposed by 10x or 100x. A broad domain rendered as a handful of tiny TypeScript cards is almost always a massive underestimate. Justify, in the \`plan\`, why the chosen granularity is sufficient, or split further.

- Prepare a concise spec, implementation plan, and task graph in your reasoning.
- Build the candidate graph with the incremental protocol by default: call \`add_task\` once per card, then call \`add_dependency\` for every edge. Each small call is validated immediately and avoids fragile nested JSON. After all cards and edges are accepted, call \`decompose_project\` WITHOUT \`tasks\`, passing slug, spec, plan, title, summary, questions, and defaultAcceptanceCommand when useful. The accumulated graph is then validated and sent to independent critique before any board graph is materialized.
- Use a one-shot \`decompose_project\` call with a full \`tasks\` array only when you can reliably encode the complete nested JSON. If that call is malformed or empty, do not retry the full payload: switch immediately to \`add_task\`/\`add_dependency\`.
- If any proposed leaf is too broad, split it into smaller cards before adding it. The one-shot fallback may instead include a recursive \`expansions\` map; !Klein expands it before validation and rewrites dependencies to terminal replacement leaves.
- After the tool succeeds, apply the generated graph through the command it returns whenever the !Klein runtime can continue autonomously. Only tell the user the exact \`nklein task decompose --slug <slug> --project-path <workspace_path>\` command when automation is unavailable or the task has explicitly opted out of automatic review/continuation.

Create reviewable !Klein tasks from the specification. For implementation leaves, use the workspace's provided acceptance command when one is available; pass it as defaultAcceptanceCommand and do not invent brittle per-card shell probes such as grep/tail wrappers around test output.

Each task passed to \`add_task\` (or to the one-shot \`tasks\` input) must include:
- id, title, prompt.
Add these fields when relevant:
- dependsOn[], complexity, suggestedRole, filesLikelyTouched[], acceptanceCommand, testFirst, acceptanceTestPrompt, knowledgeDebt.
- A self-contained prompt with the relevant slice of the spec and exact acceptance criteria.
- Complexity <= 75.
- No more than 3 likely files.
- A machine-checkable acceptanceCommand.
- For suitable changes, set testFirst=true and include the exact acceptance test to write or update in acceptanceTestPrompt.

Dependency coherence (the graph is validated for this; missing edges are rejected):
- A test/acceptance card must \`dependsOn\` the implementation card(s) it verifies. Tests depend on implementation, never the reverse.
- A documentation/README card must \`dependsOn\` the feature/API card(s) it documents.
- A UI card should \`dependsOn\` the core domain/control-metadata card(s) it renders.
- Do not emit a flat list of independent cards for work that has a real build order; add the ordering edges.

Each \`questions\` item must include id, question, status. Prefer status \`open\` with a sensible \`assumption\` (the default you are planning against) so the question stays open for clarification — do not invent a hard answer just to proceed. Use \`answered\` (with answer) only if the spec already settles it, or \`assumed-default\` (with assumption) for a default you are explicitly locking in. Include options[] when you offered choices.

If you provide the lower-level \`taskGraph\` input instead of \`tasks\`, each task must include id, title, prompt, dependsOn[], complexity, suggestedRole, filesLikelyTouched[], acceptanceCommand, testFirst, and acceptanceTestPrompt.
Split or expand any leaf that cannot satisfy those limits before \`decompose_project\` validation finishes. If an atomic leaf still cannot fit the connected local models, stop and report the infeasible leaf and why it cannot be split further.
Do not modify implementation files, do not use write tools outside !Klein planning artifacts, and do not implement product code during decomposition.
`;

export const KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN = `---
name: ${KANBAN_DECOMPOSE_WORKFLOW_NAME}
description: Create !Klein decomposition artifacts for a project-scale idea.
---

${KANBAN_DECOMPOSE_PROMPT}`;
