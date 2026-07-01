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

/**
 * Model-family → verified thinking-control switches. ONLY add a family whose switch is live-verified (conservative).
 * Live-verified NEGATIVES (do NOT add — they ignore `/no_think`): **phi-4-mini-reasoning (Phi-3)** reasons regardless
 * (reasoning_content stayed ~1100–1800 chars with or without `/no_think`, 2026-06-29) — it has no soft switch and is a
 * high TRUNCATION risk (reasons ~1100+ tokens even for "2+2"). The `/qwen-?3/i` matcher also covers qwen3-arch distills
 * (e.g. deepseek-r1-0528-qwen3-8b) but NOT qwen2-arch reasoners (qwq) — verify those before adding.
 */
const THINKING_CONTROL_MATCHERS: readonly { pattern: RegExp; control: ThinkingControl }[] = [
	// Qwen3 (NOT qwen2.5/coder — those aren't reasoning models): `/no_think` ↔ `/think` soft switches. Live-verified.
	{ pattern: /qwen-?3/i, control: { disableToken: "/no_think", enableToken: "/think" } },
];

/**
 * Models that LOOK like a switch-capable family by name but ALWAYS reason (ignore the soft switch) — live-verified
 * exclusions. `deepseek-r1-0528-qwen3-8b` is qwen3-arch (so the qwen3 matcher would catch it) but is an R1 distill
 * trained to always reason: `/no_think` had ZERO effect (reasoning_content ~1950 chars either way, 2026-06-29).
 * **qwen3.5 (arch `qwen3_5`)** also matches `/qwen-?3/` by name but IGNORES `/no_think` — live-verified 2026-07-01 against
 * qwen3.5-9b-mlx: `/no_think` appended to the user message left reasoning identical to baseline (249 reasoning tokens,
 * empty content, `finish:length` at temp 0 either way). So the qwen3 soft switch is a qwen3-ONLY behavior, not qwen3.x;
 * exclude qwen3.5 and let the caller budget for reasoning instead (the §4A truncation-recovery approach).
 */
const ALWAYS_REASONING_EXCLUDE = /deepseek|[-_/]r1\b|r1[-_]|qwen-?3[._]?5/i;

/** The thinking-control switches for a model id, or null when the model has no known soft switch (most models). */
export function getThinkingControl(modelId: string): ThinkingControl | null {
	if (ALWAYS_REASONING_EXCLUDE.test(modelId)) {
		return null;
	}
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
