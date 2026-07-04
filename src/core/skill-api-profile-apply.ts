/**
 * §5.AE skill apiProfile → chat model-call reconcile — DRAFT (David decision-7: SESSION-SCOPED), held for approval.
 *
 * David decided apiProfile should apply SESSION-SCOPED, reconciled with the chat adapter's EXISTING reasoning /
 * force-tool logic so nothing double-applies. This module is the pure, decidable HALF of that: fold a session's merged
 * {@link SkillApiProfile} into the turn's model-call config idempotently. Idempotency IS the no-double-apply guarantee
 * — applying it once or twice yields the same config, so "apply once per session" and "apply per call" agree.
 *
 * PRECURSOR (flagged, NOT built here — needs a policy decision): the chat path resolves NO skill set today, so nothing
 * produces the `SkillApiProfile` to feed this. WHICH skills apply to a chat session (by scope? by the message? always
 * the chat/planning bundle?) is an undecided policy. Once that's decided + resolveApiProfileForSkills is called on the
 * chat path, this fold applies its result to the model call. Wiring this without the resolution would be a dark seam,
 * so it's held here as the ready reconcile core + a proposal.
 *
 * Reconcile rules (proposed): the profile's intent takes precedence where set, but NEVER LOOSENS a stricter existing
 * setting — `forceToolCall`/`structuredOutput` are OR-combined (an already-forced turn stays forced); `temperature`
 * and an explicit `reasoning` override the base; `reasoning: "inherit"` (or unset) leaves the base untouched.
 */

import type { SkillApiProfile } from "./skill-registry";

/** The subset of a chat model-call config the apiProfile can influence (already resolved by the adapter's env logic). */
export interface ChatModelCallProfile {
	temperature?: number;
	/** Reasoning intent for the turn (from the model's capability + the adapter's reasoning-budget logic). */
	reasoning?: "off" | "low" | "high" | "inherit";
	forceToolCall?: boolean;
	structuredOutput?: boolean;
}

/**
 * Fold a merged skill apiProfile into a chat model-call config, reconciled + IDEMPOTENT. Pure; never mutates inputs.
 * A `null`/empty profile returns the base unchanged (byte-identical), so this is inert until the skill-resolution
 * precursor feeds it a real profile.
 */
export function applySkillApiProfileToChatCall(
	base: ChatModelCallProfile,
	apiProfile: SkillApiProfile | null | undefined,
): ChatModelCallProfile {
	if (!apiProfile) {
		return { ...base };
	}
	return {
		// The profile's explicit override wins; else keep the base (adapter-resolved) value.
		temperature: apiProfile.temperature ?? base.temperature,
		// An explicit reasoning intent wins; `inherit`/unset leaves the base reasoning untouched.
		reasoning: apiProfile.reasoning && apiProfile.reasoning !== "inherit" ? apiProfile.reasoning : base.reasoning,
		// Stricter-wins: OR-combine so a turn the adapter already forced/constrained is never loosened by the profile.
		forceToolCall: Boolean(base.forceToolCall) || Boolean(apiProfile.forceToolCall),
		structuredOutput: Boolean(base.structuredOutput) || Boolean(apiProfile.structuredOutput),
	};
}
