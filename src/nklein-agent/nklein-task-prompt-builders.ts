/**
 * NKlein start / planning / refinement system-prompt builders (§5.U-extracted from the oversized
 * `nklein-task-session-service.ts`). Pure string construction: given a user prompt + the start mode, produce the
 * planning-, refinement-, or null system prompt and assemble the `NKleinStartPromptParts`. No session state.
 */

import type { AutoDecompositionDepthDecision } from "../core/auto-decomposition-depth";
import {
	isDecompositionPlanningPrompt,
	parseAcceptanceCommand,
	parseRequestedMinimumTaskCount,
} from "./nklein-task-prompt-parsing";

export interface NKleinStartPromptParts {
	userPrompt: string;
	systemPrompt: string | null;
	systemWorkflowCommand: string | null;
}

/**
 * F4.38 — render the AUTO decomposition-depth decision (from `resolveAutoDecompositionDepth`: difficulty × the model's
 * quality-effective context) as one guidance line for the decompose prompt. Depth 0 ⇒ keep it shallow; depth ≥ 1 ⇒ aim
 * for that many nested levels so each leaf fits the executor's real context. Advisory only — the model still decides;
 * this steers granularity toward what the task hardness + model capacity actually warrant.
 */
export function formatAutoDecompositionDepthGuidance(decision: AutoDecompositionDepthDecision): string {
	if (decision.depth <= 0) {
		return "Decomposition depth (AUTO): keep the breakdown SHALLOW — a flat set of leaves is enough for this task; only nest a further split when a leaf is genuinely its own multi-step workstream.";
	}
	return `Decomposition depth (AUTO): aim for roughly ${decision.depth} level(s) of nested breakdown so each leaf fits the executor model's effective context — split a leaf further only when it clearly exceeds one focused unit of work.`;
}

function buildNKleinPlanningSystemPrompt(
	prompt: string,
	startInPlanMode?: boolean,
	autoDepth?: AutoDecompositionDepthDecision | null,
): string | null {
	if (!startInPlanMode) {
		return null;
	}
	const trimmedPrompt = prompt.trim();
	const isDecompositionTask = isDecompositionPlanningPrompt(trimmedPrompt);
	const minimumTaskCount = parseRequestedMinimumTaskCount(trimmedPrompt);
	const acceptanceCommand = parseAcceptanceCommand(trimmedPrompt);
	// Decomposition / board / plan tools are trusted control-plane and remain available even under strict
	// Docker isolation (they touch only !Klein-owned state, never the user's working tree). The overridable
	// workflow is loaded separately; avoid surfacing slash-command syntax because local models may try to call
	// it as an unavailable tool.
	const decompositionInstruction =
		"!Klein decomposition workflow rules are applied by the runtime. Do not call workflow names or slash commands as tools. When the task should be split into dependent cards, call the `decompose_project` tool directly.";
	if (isDecompositionTask) {
		return [
			"Inspect the codebase only as needed for one focused planning pass, then call the `decompose_project` tool.",
			"Keep your thinking and any prose brief: a short focused pass, then the tool call. Do not write a long analysis, reasoning dump, or running commentary before calling `decompose_project` — long output wastes the context budget and can crash a local model host.",
			"Reasoning or thinking alone is not an answer and does not make progress. After your brief think, you MUST emit a tool call in your output — never end your turn with only reasoning and no tool call. The decomposition is delivered by calling `decompose_project`, not by describing it.",
			decompositionInstruction,
			minimumTaskCount !== null
				? `When calling decompose_project, pass \`minimumTaskCount: ${minimumTaskCount}\`.`
				: null,
			// F4.38 — advisory AUTO depth guidance (omitted ⇒ byte-identical to the prior prompt).
			autoDepth ? formatAutoDecompositionDepthGuidance(autoDepth) : null,
			acceptanceCommand
				? `Use \`defaultAcceptanceCommand: "${acceptanceCommand}"\` unless a generated leaf needs a narrower objective check.`
				: null,
			"Do not answer with a chat-only markdown plan, current-codebase report, or domain analysis; put the summary, assumptions, plan, and task graph in the `decompose_project` tool arguments.",
			"If a duplicate read/list/size request is blocked because content is already available, do not retry that discovery step; continue directly to `decompose_project` from the existing context.",
			"Use workspace-relative paths such as `specification.md` and treat that file as the authoritative product specification.",
			"Do not invent replacement requirements or alternate input fields that are not in the specification or existing code.",
			"If a generated leaf uses `testFirst: true`, include a concrete `acceptanceTestPrompt`; otherwise set `testFirst: false`.",
			"Do not modify implementation files, do not use write tools outside !Klein planning artifacts, and do not implement product code yet.",
			"Continue autonomously through the planning workflow when the task can be completed with !Klein-managed tools.",
		]
			.filter((line): line is string => line !== null)
			.join("\n");
	}
	return [
		"First, inspect the codebase and produce a clear implementation plan only.",
		decompositionInstruction,
		"Do not modify implementation files, do not use write tools outside !Klein planning artifacts, and do not implement product code yet.",
		"Continue autonomously through the planning workflow when the task can be completed with !Klein-managed tools.",
		"If the task is unclear, ask the user what they want planned.",
	].join("\n");
}

/**
 * The work-card Planning/Refinement preamble (todo §5.B). A started WORK card (not a decompose/plan card, not a
 * home/chat session) lands in the Planning lane and runs a refinement pass BEFORE implementing: re-validate the card
 * against the current project state, pick the depth by what actually changed, then call `begin_implementation` to
 * advance to In Progress and build it (or `decompose_project` if it must be split). This keeps small models from
 * working an out-of-date plan; the explicit promotion tool is the robust transition against weak models.
 */
function buildNKleinRefinementSystemPrompt(): string {
	return [
		"This card is in the Planning / Refinement phase — its card sits in the Planning lane, not yet In Progress.",
		"Before writing any implementation, do a brief REFINEMENT pass: re-check this card against the CURRENT state of the project (what has been merged or changed since it was planned). Confirm the card's objective and its acceptance check still hold and are not already satisfied.",
		"Pick the refinement depth by what actually changed: if nothing relevant moved, a quick confirmation is enough; if the direction or merged work shifted, adjust your approach; if the card is badly out of date or too large to do as one card, call `decompose_project` to split it into smaller cards instead of building it.",
		"When the card is confirmed (or you have updated the plan) and ready to build, call the `begin_implementation` tool — that moves the card from Planning to In Progress. THEN implement it: make the changes the card calls for, run its acceptance check, and finish per the workflow.",
		"Do not edit implementation files before calling `begin_implementation`; you are still refining until then. Keep the refinement brief — do not dump a long analysis before acting.",
	].join("\n");
}

export function buildNKleinStartPromptParts(
	prompt: string,
	startInPlanMode?: boolean,
	isRefinableWorkCard?: boolean,
	autoDepth?: AutoDecompositionDepthDecision | null,
): NKleinStartPromptParts {
	return {
		userPrompt: prompt,
		systemPrompt: startInPlanMode
			? buildNKleinPlanningSystemPrompt(prompt, startInPlanMode, autoDepth)
			: isRefinableWorkCard
				? buildNKleinRefinementSystemPrompt()
				: null,
		systemWorkflowCommand: startInPlanMode ? "/kanban-decompose" : null,
	};
}

export function appendSystemPrompt(baseSystemPrompt: string, systemPrompt: string | null): string {
	const trimmed = systemPrompt?.trim();
	return trimmed ? `${baseSystemPrompt}\n\n${trimmed}` : baseSystemPrompt;
}
