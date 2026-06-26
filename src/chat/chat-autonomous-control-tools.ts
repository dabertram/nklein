import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatAgentLoopResult } from "./chat-agent-loop";
import type { AutonomousChatTurnOutcome } from "./chat-autonomous-loop";
import type { ChatTool } from "./chat-tool-executor";

/**
 * The two "control" tools the autonomous chat driver (todo §5.0.1) gives the agent so it can signal *flow* (not do
 * work): `request_user_input` (pause and ask the user) and `declare_goal_complete` (the goal is fully done, end the
 * run). They have no host/sandbox side effects — pure signals — so they use the always-allowed `sandbox_read` action
 * kind and simply record into a per-turn `signals` object the driver reads after `runChatAgentLoop` returns.
 *
 * `interpretAutonomousTurnOutcome` then maps a finished loop turn + its captured signals to the driver's
 * `AutonomousChatTurnOutcome`: a question → `needs_user`, a completion → `goal_complete`, else `progressed`. "Made
 * tool progress" counts only NON-control tool steps, so a turn that merely asks/declares (or spins on the focus chain)
 * still trips the driver's no-progress stall guard.
 */

export interface AutonomousControlSignals {
	userQuestion: string | null;
	goalCompleteSummary: string | null;
}

export interface AutonomousControlToolset {
	tools: ChatTool[];
	definitions: LocalLlmToolDefinition[];
	/** Mutated by the tools when the agent signals; read after the loop to map the turn outcome. */
	signals: AutonomousControlSignals;
	/** Names of the control tools, excluded from the "made tool progress" stall check. */
	controlToolNames: ReadonlySet<string>;
}

const REQUEST_USER_INPUT = "request_user_input";
const DECLARE_GOAL_COMPLETE = "declare_goal_complete";

export function createAutonomousControlTools(): AutonomousControlToolset {
	const signals: AutonomousControlSignals = { userQuestion: null, goalCompleteSummary: null };
	const tools: ChatTool[] = [
		{
			name: REQUEST_USER_INPUT,
			actionKind: "sandbox_read",
			run: async (args) => {
				const question = typeof args.question === "string" ? args.question.trim() : "";
				if (!question) {
					return "Provide a non-empty `question` stating exactly what you need from the user.";
				}
				signals.userQuestion = question;
				return "Recorded — the run will pause and surface this question to the user, then resume with their answer.";
			},
		},
		{
			name: DECLARE_GOAL_COMPLETE,
			actionKind: "sandbox_read",
			run: async (args) => {
				const summary = typeof args.summary === "string" ? args.summary.trim() : "";
				signals.goalCompleteSummary = summary || "Goal complete.";
				return "Recorded — the autonomous run will finish.";
			},
		},
	];
	const definitions: LocalLlmToolDefinition[] = [
		{
			name: REQUEST_USER_INPUT,
			description:
				"Pause autonomous work and ask the user a question — ONLY when you genuinely cannot proceed without their decision or input. The run stops, surfaces your question, and resumes once they answer. Do not use it for things you can decide or discover yourself.",
			parameters: {
				type: "object",
				properties: { question: { type: "string", description: "The specific question for the user." } },
				required: ["question"],
			},
		},
		{
			name: DECLARE_GOAL_COMPLETE,
			description:
				"Call this only when the whole goal is achieved and no further steps remain — it ends the autonomous run. If steps are still pending, keep working instead.",
			parameters: {
				type: "object",
				properties: { summary: { type: "string", description: "A brief summary of what was accomplished." } },
				required: ["summary"],
			},
		},
	];
	return { tools, definitions, signals, controlToolNames: new Set([REQUEST_USER_INPUT, DECLARE_GOAL_COMPLETE]) };
}

export function interpretAutonomousTurnOutcome(
	loopResult: Pick<ChatAgentLoopResult, "finalText" | "steps">,
	signals: AutonomousControlSignals,
	controlToolNames: ReadonlySet<string>,
): AutonomousChatTurnOutcome {
	const madeToolProgress = loopResult.steps.some((step) => !controlToolNames.has(step.toolCall.name));
	if (signals.userQuestion) {
		return { status: "needs_user", text: signals.userQuestion, madeToolProgress };
	}
	if (signals.goalCompleteSummary) {
		return { status: "goal_complete", text: signals.goalCompleteSummary, madeToolProgress };
	}
	return { status: "progressed", text: loopResult.finalText, madeToolProgress };
}
