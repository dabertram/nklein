/**
 * Autonomous chat-agent driver loop (todo §5.0.1 / §5.M) — the goal-driven layer ON TOP of `runChatAgentLoop`.
 *
 * `runChatAgentLoop` answers a single user message (model → tools → repeat *until it answers*). This driver runs the
 * agent **turn after turn** toward a high-level goal — each turn works the next focus-chain step — until the goal is
 * done, it needs the user, or a budget / no-progress guard trips. It is pure orchestration: the per-turn agent run and
 * the focus-chain progress read are injected, so it is fully unit-testable; the live wiring backs `runTurn` with
 * `runChatAgentLoop` (goal + plan + gated tools) and `readPlanProgress` with the focus-chain store summary.
 *
 * The budget mirrors the swarm guardrails (`RUNTIME_SWARM_GUARDRAIL_BOUNDS`) so an autonomous *chat* run is bounded
 * exactly like an autonomous *task*: a turn cap, a wall-time cap, and a repeated-no-tool-progress park (the chat
 * analogue of the task no-diff-checkpoint guard). It never blocks: a genuine clarifying question ends the run with
 * `paused_needs_user` so the caller can collect the answer and resume with a fresh run.
 */

export type AutonomousChatTurnStatus = "progressed" | "needs_user" | "goal_complete";

export interface AutonomousChatTurnOutcome {
	status: AutonomousChatTurnStatus;
	/** The turn's natural-language result — its progress note, final answer, or clarifying question. */
	text: string;
	/** True when the turn executed at least one NEW tool call; drives the no-progress (stall) guard. */
	madeToolProgress: boolean;
}

export interface AutonomousChatAgentBudget {
	/** Hard cap on driver turns (← `guardrails.maxAutonomousTurnsPerTask`). */
	maxTurns: number;
	/** Hard wall-time cap in ms (← `guardrails.maxAutonomousWallTimeMs`). */
	maxWallTimeMs: number;
	/** Park after this many consecutive turns that make no tool progress (← `guardrails.maxRepeatedNoDiffCheckpoints`). */
	maxNoProgressTurns: number;
}

export interface AutonomousChatPlanProgress {
	total: number;
	done: number;
}

export interface AutonomousChatAgentDeps {
	/** Run one autonomous turn toward the goal (live: `runChatAgentLoop` with goal + plan + gated tools). */
	runTurn: (input: { goal: string; turnIndex: number }) => Promise<AutonomousChatTurnOutcome>;
	/** Read the focus-chain plan progress so the driver can stop once every step is done/skipped. */
	readPlanProgress: () => Promise<AutonomousChatPlanProgress>;
	/** Injected clock for the wall-time budget (defaults to `Date.now`). */
	now?: () => number;
}

export type AutonomousChatAgentStopReason =
	| "completed"
	| "paused_needs_user"
	| "budget_turns_exhausted"
	| "budget_wall_time_exhausted"
	| "stalled_no_progress";

export interface AutonomousChatAgentResult {
	stopReason: AutonomousChatAgentStopReason;
	/** How many driver turns actually ran. */
	turns: number;
	/** The last turn's text (answer / question / progress note). */
	finalText: string;
	planProgress: AutonomousChatPlanProgress;
}

export async function runAutonomousChatAgent(
	input: { goal: string; budget: AutonomousChatAgentBudget },
	deps: AutonomousChatAgentDeps,
): Promise<AutonomousChatAgentResult> {
	const now = deps.now ?? Date.now;
	const startedAt = now();
	const maxTurns = Math.max(1, input.budget.maxTurns);
	const maxNoProgressTurns = Math.max(1, input.budget.maxNoProgressTurns);
	let finalText = "";
	let noProgressStreak = 0;
	let planProgress: AutonomousChatPlanProgress = { total: 0, done: 0 };

	for (let turnIndex = 0; turnIndex < maxTurns; turnIndex++) {
		// Wall-time guard checked up-front each turn (the loop is cooperative — a turn already in flight isn't
		// interrupted, but the next one won't start once the budget is blown).
		if (now() - startedAt > input.budget.maxWallTimeMs) {
			return { stopReason: "budget_wall_time_exhausted", turns: turnIndex, finalText, planProgress };
		}

		const outcome = await deps.runTurn({ goal: input.goal, turnIndex });
		finalText = outcome.text;

		if (outcome.status === "goal_complete") {
			planProgress = await deps.readPlanProgress();
			return { stopReason: "completed", turns: turnIndex + 1, finalText, planProgress };
		}
		if (outcome.status === "needs_user") {
			planProgress = await deps.readPlanProgress();
			return { stopReason: "paused_needs_user", turns: turnIndex + 1, finalText, planProgress };
		}

		// progressed — update the stall streak, then check whether the plan itself is now complete.
		noProgressStreak = outcome.madeToolProgress ? 0 : noProgressStreak + 1;
		if (noProgressStreak >= maxNoProgressTurns) {
			planProgress = await deps.readPlanProgress();
			return { stopReason: "stalled_no_progress", turns: turnIndex + 1, finalText, planProgress };
		}
		planProgress = await deps.readPlanProgress();
		if (planProgress.total > 0 && planProgress.done >= planProgress.total) {
			return { stopReason: "completed", turns: turnIndex + 1, finalText, planProgress };
		}
	}

	return { stopReason: "budget_turns_exhausted", turns: maxTurns, finalText, planProgress };
}
