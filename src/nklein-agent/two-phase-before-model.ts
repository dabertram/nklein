/**
 * §5.O two-phase tool narrowing for the SDK `beforeModel` seam. Given the tools a turn would offer + the current step
 * text + an injected phase-1 model caller, run the two-phase pick and return the tools NARROWED to the pick (so the
 * `beforeModel` hook can return `{ tools }` and the model sees exactly one tool that turn). Pure over the injected caller,
 * so the whole narrowing decision is unit-testable with a fake; the session runtime supplies a real completion caller.
 *
 * Conservative by construction: with fewer than 2 tools there's nothing to narrow (returned unchanged, no model call);
 * and a `none`/`plan_needed`/truncated pick leaves the full set unchanged (only a confident single pick narrows).
 */

import { kanbanTaskToolCardByName } from "../core/task-tool-cards";
import type { ToolCard } from "../core/tool-card";
import { narrowToolsToPick } from "../core/two-phase-tool-pick";
import { runTwoPhaseToolPick, type TwoPhasePickModelCaller } from "./two-phase-tool-runner";

/** A card per offered tool: its authored kanban card, or a terse name-only fallback for a tool we haven't carded. */
function cardsForTools(tools: readonly { name: string }[]): ToolCard[] {
	return tools.map(
		(tool) =>
			kanbanTaskToolCardByName(tool.name) ?? { name: tool.name, purpose: tool.name, useWhen: `Use ${tool.name}.` },
	);
}

/**
 * Narrow a turn's offered tools to the two-phase pick for `step`. Returns the narrowed list (or the original when there's
 * nothing to narrow / no confident single pick). Only `name` is read from each tool, so it couples to no SDK tool type.
 */
export async function narrowToolsForStep<T extends { name: string }>(input: {
	tools: readonly T[];
	step: string;
	callModel: TwoPhasePickModelCaller;
}): Promise<readonly T[]> {
	if (input.tools.length < 2) {
		return input.tools; // nothing to narrow — skip the phase-1 call entirely
	}
	const cards = cardsForTools(input.tools);
	const { decision } = await runTwoPhaseToolPick({ task: input.step, callModel: input.callModel, cards });
	return narrowToolsToPick(input.tools, decision);
}
