import { type FocusChain, summarizeFocusChain } from "../core/focus-chain";
import type { ChatAgentLoopResult } from "./chat-agent-loop";
import {
	type AutonomousControlToolset,
	createAutonomousControlTools,
	interpretAutonomousTurnOutcome,
} from "./chat-autonomous-control-tools";
import type { AutonomousChatPlanProgress, AutonomousChatTurnOutcome } from "./chat-autonomous-loop";
import { readChatFocusChain } from "./chat-focus-chain";

/**
 * Live-wiring adapters that turn the pure `runAutonomousChatAgent` core (todo §5.0.1) into something runnable.
 *
 * `readAutonomousChatPlanProgress` is its `readPlanProgress`: the persisted focus-chain summary, counting `done +
 * skipped` as resolved so the driver's `done >= total` completion check matches the focus chain's own "complete"
 * (a skipped step is resolved, not outstanding).
 *
 * `buildAutonomousChatTurnRunner` is its `runTurn`: each turn it mints fresh control tools, builds a goal directive
 * (plan-then-execute on turn 0, "work the next step" after), hands both to the injected `runTurnWithControls` — the
 * chat-service owns that, merging the control tools into the gated executor + offering them to the model, then running
 * one `runChatAgentTurn` — and maps the finished loop result via `interpretAutonomousTurnOutcome`. The chat-service
 * coupling is injected, so this is unit-testable on its own.
 */

export async function readAutonomousChatPlanProgress(
	sessionId: string,
	deps: { readFocusChain?: (sessionId: string) => Promise<FocusChain | null> } = {},
): Promise<AutonomousChatPlanProgress> {
	const read = deps.readFocusChain ?? readChatFocusChain;
	const summary = summarizeFocusChain(await read(sessionId));
	return { total: summary.total, done: summary.done + summary.skipped };
}

export interface AutonomousTurnRunnerDeps {
	/** Run one tool-using chat turn with the control tools merged into the gated executor + offered to the model; the
	 *  chat-service supplies this (it owns the executor / model / work-tool assembly) and returns the finished loop. */
	runTurnWithControls: (input: {
		goalDirective: string;
		controls: AutonomousControlToolset;
		turnIndex: number;
	}) => Promise<{ loopResult: Pick<ChatAgentLoopResult, "finalText" | "steps"> }>;
}

export function buildAutonomousChatTurnRunner(
	deps: AutonomousTurnRunnerDeps,
): (input: { goal: string; turnIndex: number }) => Promise<AutonomousChatTurnOutcome> {
	return async ({ goal, turnIndex }) => {
		const controls = createAutonomousControlTools();
		const goalDirective =
			turnIndex === 0
				? `You are working AUTONOMOUSLY toward this goal:\n${goal}\n\nFirst lay out your plan with the update_focus_chain tool, then start executing it — use your tools to do real work. Call declare_goal_complete when the whole goal is done, or request_user_input ONLY if you genuinely cannot proceed without the user.`
				: `Continue working autonomously toward the goal:\n${goal}\n\nWork the next pending focus-chain step. Call declare_goal_complete when the whole goal is done, or request_user_input only if you are truly blocked on the user.`;
		const { loopResult } = await deps.runTurnWithControls({ goalDirective, controls, turnIndex });
		return interpretAutonomousTurnOutcome(loopResult, controls.signals, controls.controlToolNames);
	};
}
