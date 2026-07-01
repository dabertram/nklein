/**
 * §5.O two-phase tool-pick ORCHESTRATOR — the reusable brain the eventual model-seam wiring needs, built as pure logic
 * over an INJECTED model caller so it is fully unit-testable (feed a fake caller) and transport-independent (the caller
 * owns the endpoint, model id, and — critically — a reasoning-sized token budget; live-validated that a small reasoning
 * model needs ~1024 tokens before the pick appears, else empty content + `finish:length`).
 *
 * Flow: build the phase-1 card menu → call the model with (menu, task) → interpret truncation-aware. Returns the typed
 * {@link PhaseOneDecision} plus the menu and raw response for inspection. Phase-2 schema reveal is left to the caller,
 * which holds the actual tool schemas. Consumed live by `nklein dev tool-pick`.
 */

import { KANBAN_TASK_TOOL_CARDS } from "../core/task-tool-cards";
import type { ToolCard } from "../core/tool-card";
import {
	buildPhaseOneToolMenu,
	interpretPhaseOneResponse,
	type PhaseOneDecision,
	type PhaseOneRawResponse,
} from "../core/two-phase-tool-pick";

/** Calls the model with the phase-1 menu (as the instruction) + the task, returning its raw response. Injected = testable. */
export type TwoPhasePickModelCaller = (input: { menu: string; task: string }) => Promise<PhaseOneRawResponse>;

export interface TwoPhasePickResult {
	/** The typed phase-1 decision (truncation-aware). */
	decision: PhaseOneDecision;
	/** The phase-1 menu the model was shown (for inspection). */
	menu: string;
	/** The model's raw response (content + finishReason). */
	raw: PhaseOneRawResponse;
}

/**
 * Run the phase-1 pick for a task against an injected model caller. Defaults to the authored kanban tool cards. Pure
 * except for the injected `callModel`, so the decision logic is testable without a live model.
 */
export async function runTwoPhaseToolPick(input: {
	task: string;
	callModel: TwoPhasePickModelCaller;
	cards?: readonly ToolCard[];
}): Promise<TwoPhasePickResult> {
	const cards = input.cards ?? KANBAN_TASK_TOOL_CARDS;
	const menu = buildPhaseOneToolMenu(cards);
	const raw = await input.callModel({ menu, task: input.task });
	return { decision: interpretPhaseOneResponse(raw, cards), menu, raw };
}
