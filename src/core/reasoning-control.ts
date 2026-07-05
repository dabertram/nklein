/**
 * §5.AA — reasoning control as a first-class lever (pure core). Native "thinking" (a reasoning model's chain-of-thought
 * pass) is worth its cost on HARD, open-ended turns but is pure overhead on SIMPLE/execution turns — it adds latency,
 * burns the token budget, and raises truncation risk (the reasoning channel can eat the whole `max_tokens`). This
 * decides, per turn, whether to enable thinking: keep it for hard tasks + deliberative turns (planning/review), disable
 * it for simple/execution turns. The effectful application (the §5.AA thinking directive on the request) is at the call
 * site; this is the policy. Only meaningful for reasoning-capable models — a non-reasoning model has nothing to toggle.
 */

export type ReasoningTurnKind = "planning" | "review" | "execution" | "simple" | "chat";
export type ReasoningDifficultyTier = "easy" | "medium" | "hard";

/** Turn kinds where thinking is pure overhead unless the task is hard (short, mechanical, or single-step). */
const LOW_REASONING_TURNS: ReadonlySet<ReasoningTurnKind> = new Set<ReasoningTurnKind>(["execution", "simple"]);

export interface ReasoningControlDecision {
	/** Whether the turn should run with native thinking enabled (for a reasoning-capable model). */
	enableThinking: boolean;
	reason: string;
}

/**
 * Decide whether to enable thinking for a turn (pure). HARD tasks always keep reasoning; otherwise SIMPLE/execution
 * turns disable it (kill the overhead/latency/truncation risk), while deliberative turns (planning/review/chat) keep it.
 */
export function decideReasoningControl(
	turnKind: ReasoningTurnKind,
	difficultyTier: ReasoningDifficultyTier,
): ReasoningControlDecision {
	if (difficultyTier === "hard") {
		return { enableThinking: true, reason: "Hard task — keep reasoning." };
	}
	if (LOW_REASONING_TURNS.has(turnKind)) {
		return {
			enableThinking: false,
			reason: `${turnKind} turn on a ${difficultyTier} task — disable thinking (overhead / latency / truncation risk).`,
		};
	}
	return { enableThinking: true, reason: `${turnKind} turn is deliberative — keep reasoning.` };
}
