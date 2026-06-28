import { type FocusChain, summarizeFocusChain } from "../core/focus-chain";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatAgentLoopResult, ChatAgentStep } from "./chat-agent-loop";
import {
	type AutonomousControlToolset,
	createAutonomousControlTools,
	interpretAutonomousTurnOutcome,
} from "./chat-autonomous-control-tools";
import {
	type AutonomousChatAgentBudget,
	type AutonomousChatAgentResult,
	type AutonomousChatPlanProgress,
	type AutonomousChatTurnOutcome,
	runAutonomousChatAgent,
} from "./chat-autonomous-loop";
import { readChatFocusChain } from "./chat-focus-chain";
import type { ChatAgentToolDeps } from "./chat-service";
import type { ChatTool } from "./chat-tool-executor";

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
): (input: {
	goal: string;
	turnIndex: number;
	rejectedPrematureCompletion?: boolean;
}) => Promise<AutonomousChatTurnOutcome> {
	return async ({ goal, turnIndex, rejectedPrematureCompletion }) => {
		const controls = createAutonomousControlTools();
		// §5.AA evidence-gate: the driver rejected a prior premature declare_goal_complete (focus-chain steps still
		// pending) — tell the model plainly so it finishes the work instead of re-declaring done.
		const completionNudge = rejectedPrematureCompletion
			? "\n\nIMPORTANT: you called declare_goal_complete, but your focus chain still has PENDING steps — the goal is NOT done. Do NOT declare complete again until every step is actually finished; work the next pending step now."
			: "";
		const goalDirective =
			(turnIndex === 0
				? `You are working AUTONOMOUSLY toward this goal:\n${goal}\n\nFirst lay out your plan with the update_focus_chain tool, then start executing it — use your tools to do real work. Call declare_goal_complete when the whole goal is done, or request_user_input ONLY if you genuinely cannot proceed without the user.`
				: `Continue working autonomously toward the goal:\n${goal}\n\nWork the next pending focus-chain step. Call declare_goal_complete when the whole goal is done, or request_user_input only if you are truly blocked on the user.`) +
			completionNudge;
		const { loopResult } = await deps.runTurnWithControls({ goalDirective, controls, turnIndex });
		return interpretAutonomousTurnOutcome(loopResult, controls.signals, controls.controlToolNames);
	};
}

export interface AutonomousChatSessionDeps {
	/** Build the per-turn agent tool deps with the control tools merged in (live: the runtime-api chat assembly +
	 *  these extras). Returns null when there is no active workspace / loaded local model. */
	assembleTurnDeps: (extra: {
		tools: ChatTool[];
		definitions: LocalLlmToolDefinition[];
	}) => Promise<ChatAgentToolDeps | null>;
	/** Run one tool-using chat turn (live: `runChatAgentTurn` bound to the session + token budget). */
	runAgentTurn: (
		input: { userMessage: string; maxIterations?: number },
		toolDeps: ChatAgentToolDeps,
	) => Promise<{ finalText: string; steps: ChatAgentStep[] }>;
	/** Read the focus-chain plan progress (live: `readAutonomousChatPlanProgress(session.id)`). */
	readPlanProgress: () => Promise<AutonomousChatPlanProgress>;
	budget: AutonomousChatAgentBudget;
	/** Per-turn inner-loop iteration cap, distinct from the driver's turn budget. */
	maxIterationsPerTurn?: number;
}

/**
 * The runnable autonomous chat run: composes the pure driver (`runAutonomousChatAgent`) with the control-tool turn
 * runner and the injected chat machinery. Each turn assembles the gated tool deps WITH the control tools merged, runs
 * one `runChatAgentTurn` against the goal directive, and maps the result; if the model/workspace is unavailable the
 * turn pauses for the user (reusing the needs_user path) rather than spinning through the budget.
 */
export async function runAutonomousChatSession(
	goal: string,
	deps: AutonomousChatSessionDeps,
): Promise<AutonomousChatAgentResult> {
	const runTurn = buildAutonomousChatTurnRunner({
		runTurnWithControls: async ({ goalDirective, controls }) => {
			const toolDeps = await deps.assembleTurnDeps({ tools: controls.tools, definitions: controls.definitions });
			if (!toolDeps) {
				controls.signals.userQuestion =
					"Autonomous work paused: no active workspace or loaded local model. Open a project / load a model, then resume.";
				return { loopResult: { finalText: "", steps: [] } };
			}
			const turn = await deps.runAgentTurn(
				{
					userMessage: goalDirective,
					...(deps.maxIterationsPerTurn ? { maxIterations: deps.maxIterationsPerTurn } : {}),
				},
				toolDeps,
			);
			return { loopResult: turn };
		},
	});
	return runAutonomousChatAgent({ goal, budget: deps.budget }, { runTurn, readPlanProgress: deps.readPlanProgress });
}
