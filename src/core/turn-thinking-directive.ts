/**
 * §5.AA — bridge the reasoning-control POLICY ({@link ./reasoning-control.decideReasoningControl}) to the model-specific
 * thinking SWITCH ({@link ./model-thinking-control}). The policy decides whether a turn should think (keep for hard +
 * deliberative turns, disable for simple/execution ones); this resolves that against a given model's actual switch and
 * applies it — a no-op for a model with no controllable switch (a non-reasoning model, or one whose switch isn't
 * live-verified). Pure: the effectful application (which prompt the directive rides on) is the caller's; this returns
 * the decision + the transformed text. Keeps the policy and the mechanism composable without either owning the other.
 */

import { applyThinkingDisable, supportsThinkingControl } from "./model-thinking-control.js";
import { decideReasoningControl, type ReasoningDifficultyTier, type ReasoningTurnKind } from "./reasoning-control.js";

export interface TurnThinkingResolution {
	/** Whether to disable thinking for this turn on THIS model (only true when the model has a switch AND policy says so). */
	disableThinking: boolean;
	reason: string;
}

/**
 * Resolve whether to disable thinking for a turn on a given model (pure). A model with no controllable switch always
 * returns `disableThinking: false` (nothing to toggle); otherwise the reasoning-control policy decides.
 */
export function resolveTurnThinkingControl(
	modelId: string,
	turnKind: ReasoningTurnKind,
	difficultyTier: ReasoningDifficultyTier,
): TurnThinkingResolution {
	if (!supportsThinkingControl(modelId)) {
		return { disableThinking: false, reason: "Model has no controllable thinking switch — nothing to toggle." };
	}
	const decision = decideReasoningControl(turnKind, difficultyTier);
	return { disableThinking: !decision.enableThinking, reason: decision.reason };
}

/**
 * Apply the resolved thinking control to a prompt: appends the model's disable token when the policy says to disable
 * thinking for this turn, else returns the text unchanged. Pure.
 */
export function applyTurnThinkingControl(
	text: string,
	modelId: string,
	turnKind: ReasoningTurnKind,
	difficultyTier: ReasoningDifficultyTier,
): string {
	return resolveTurnThinkingControl(modelId, turnKind, difficultyTier).disableThinking
		? applyThinkingDisable(text, modelId)
		: text;
}
