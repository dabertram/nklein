/**
 * §5.AA model thinking-control — the per-model soft-switch that turns a reasoning model's hidden reasoning channel OFF
 * for a turn. Reasoning models (Qwen3, …) ruminate even on trivial/tool tasks, burning the token budget on
 * `reasoning_content` (live-confirmed: qwen3-8b spent ~500–965 tokens reasoning a one-tool task / a "reply READY"), which
 * wastes wall-time and can TRUNCATE the turn before the tool call lands. When the task is simple — or as a §5.AA recovery
 * rung after a truncation — disabling thinking makes the model act directly.
 *
 * IMPORTANT (live-verified 2026-06-29 against LM Studio's OpenAI-compat endpoint): the `chat_template_kwargs.enable_thinking`
 * request field is IGNORED there, but Qwen3's `/no_think` soft switch in the message WORKS — reasoning dropped 965 → 2
 * chars and the tool call still emitted. So this control is applied as a message-appended token, not a request param.
 * Pure + data-driven (a small matcher table); extend it with each model family's verified switch.
 */

export interface ThinkingControl {
	/** The soft-switch token that DISABLES the reasoning channel for the turn (appended to the user message). */
	disableToken: string;
	/** The token that RE-ENABLES thinking (default-on for these models; here for an explicit "think hard" rung). */
	enableToken: string;
}

/** Model-family → verified thinking-control switches. ONLY add a family whose switch is live-verified (conservative). */
const THINKING_CONTROL_MATCHERS: readonly { pattern: RegExp; control: ThinkingControl }[] = [
	// Qwen3 (NOT qwen2.5/coder — those aren't reasoning models): `/no_think` ↔ `/think` soft switches. Live-verified.
	{ pattern: /qwen-?3/i, control: { disableToken: "/no_think", enableToken: "/think" } },
];

/** The thinking-control switches for a model id, or null when the model has no known soft switch (most models). */
export function getThinkingControl(modelId: string): ThinkingControl | null {
	for (const { pattern, control } of THINKING_CONTROL_MATCHERS) {
		if (pattern.test(modelId)) {
			return control;
		}
	}
	return null;
}

/** Whether the model exposes a thinking soft-switch we can drive. */
export function supportsThinkingControl(modelId: string): boolean {
	return getThinkingControl(modelId) !== null;
}

/**
 * Append the disable-thinking soft switch to a prompt for a model that supports it (pure). No-op when the model has no
 * known switch (returns the text unchanged) or the switch is already present, so it is always safe to call.
 */
export function applyThinkingDisable(text: string, modelId: string): string {
	const control = getThinkingControl(modelId);
	if (!control || text.includes(control.disableToken)) {
		return text;
	}
	return `${text.trimEnd()} ${control.disableToken}`;
}
