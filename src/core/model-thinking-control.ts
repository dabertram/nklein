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
/**
 * The Qwen3-family matcher (`qwen3`, `qwen-3`, and qwen3-arch distills). Extracted to a named constant so it is the
 * SINGLE SOURCE OF TRUTH shared by the thinking-control switch below AND `isReasoningModel` — both must agree on "what
 * looks like a qwen3". NOTE it also matches qwen3.5 by name (`/qwen-?3/` is a prefix); the reasoning-family test WANTS
 * that (qwen3.5 IS a reasoning model), while the thinking-switch path deliberately EXCLUDES qwen3.5 via
 * {@link ALWAYS_REASONING_EXCLUDE} (it ignores `/no_think`). Keep the two behaviours distinct but the regex singular.
 */
const QWEN3_FAMILY = /qwen-?3/i;

const THINKING_CONTROL_MATCHERS: readonly { pattern: RegExp; control: ThinkingControl }[] = [
	// Qwen3 (NOT qwen2.5/coder — those aren't reasoning models): `/no_think` ↔ `/think` soft switches. Live-verified.
	{ pattern: QWEN3_FAMILY, control: { disableToken: "/no_think", enableToken: "/think" } },
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

/**
 * The Qwen3.x reasoning LINE — the `qw…3.5` / `qw…3.6` families (arch `qwen3_5` / `qwen3_6`), covering both the upstream
 * `qwen3.5` / `qwen3.6` ids AND the local `qwopus3.5` / `qwopus3.6` rebrands (`qw[a-z]*` matches the `qwen`/`qwopus`
 * prefix). ALL of these ALWAYS reason: json_schema DEAD-ENDS on them and `/no_think` is ignored (live-probed 2026-07-01
 * on qwen3.5-9b AND qwopus3.6-27b — it's the reasoning FAMILY, not size). The `[._]` before the minor version keeps this
 * from matching qwen2.5 (`3` gate) or plain `qwen3-8b` (no dotted minor — that's the switchable qwen3, caught separately
 * by {@link QWEN3_FAMILY}). CONSERVATIVE by design: the `qwopus3.5-*-coder` variants are swept as coder models but are
 * still this reasoning line, so they resolve to the reasoning-safe structured-output path (native tool-call), which also
 * works on non-reasoning models — the asymmetric cost favours over- not under-detecting reasoning here.
 *
 * DETECTION-ONLY (used by {@link isReasoningModel}); NOT added to {@link ALWAYS_REASONING_EXCLUDE} so `getThinkingControl`
 * stays byte-identical for existing callers (e.g. `getThinkingControl("qwen3.6-…")` keeps its current value — this module
 * does not claim a verified soft switch for the 3.6 line).
 */
const QWEN3X_REASONING_LINE = /qw[a-z]*-?3[._][56]/i;

/**
 * OTHER reasoning families recognized BY NAME (beyond the qwen3 / deepseek-r1 / qwen3.5 patterns reused above): an
 * explicit `-reasoning`/`-thinking` variant tag (Phi-4 ships both `phi-4-mini-instruct` NON-reasoning AND
 * `phi-4-mini-reasoning`/`phi-4-reasoning` reasoning — the tag is what distinguishes them, so match the tag, not `phi`),
 * **qwq** (qwen2-arch reasoner), and **magistral** (Mistral's reasoning model — a DISTINCT token from plain `mistral`, so
 * this must NOT be a substring of `mistral`; `magistral` starts with "mag", `mistral` with "mis", no collision). The
 * separator class `[-_/ ]` before the tag prevents matching an unrelated substring mid-word.
 *
 * These are the reasoning-DETECTION matcher only (used by {@link isReasoningModel}); they are NOT thinking-control
 * switches — most reasoning families here have NO working soft switch (qwq/magistral/phi-4-reasoning unverified or known
 * to ignore `/no_think`), so they intentionally do not appear in {@link THINKING_CONTROL_MATCHERS}.
 */
const OTHER_REASONING_FAMILIES = /(?:^|[-_/ ])(?:reasoning|thinking)\b|\bqwq\b|magistral/i;

/**
 * Non-reasoning families recognized BY NAME. These are the "confidently NOT a reasoning model" cases — used to decide a
 * model is a RECOGNIZED non-reasoning family (vs merely UNKNOWN). Deliberately EXCLUDES any `-reasoning`/`-thinking`
 * variant (a `phi-4-mini-reasoning` must NOT be swallowed by the `phi` alternative), which is why {@link isReasoningModel}
 * checks the reasoning matchers FIRST and this is consulted only by the family-recognition helper, never to force `false`.
 *
 * Members (all live-noted NON-reasoning in §5.AN / §4A): qwen2.5-coder + plain qwen2.5 (arch qwen2, no reasoning channel),
 * phi-4 (…-instruct; the reasoning tag is filtered upstream), gemma, mistral/ministral (magistral filtered upstream),
 * llama. Order/spacing chosen so none is a prefix trap: `mistral` also matches `ministral`? no — separate alternatives.
 */
const KNOWN_NON_REASONING_FAMILIES = /qwen-?2|phi-?4|phi-?3|gemma|mistral|ministral|llama/i;

/**
 * Whether `modelId` names a REASONING model — one whose hidden chain-of-thought channel is always (or by default) active.
 * ADDITIVE to this module (does NOT alter the thinking-control exports/behaviour); it composes the SAME regexes so there
 * is a single source of truth for "what looks like a reasoning family".
 *
 * TRUE for: the switchable {@link QWEN3_FAMILY} (qwen3 / qwen3-arch distills), the {@link QWEN3X_REASONING_LINE}
 * (`qwen3.5` / `qwen3.6` / `qwopus3.5` / `qwopus3.6`), the always-reason {@link ALWAYS_REASONING_EXCLUDE} set (deepseek /
 * r1 distills / qwen3.5), and {@link OTHER_REASONING_FAMILIES} recognized by name (`-reasoning` / `-thinking` tags, `qwq`,
 * `magistral`). FALSE for everything else — including recognized non-reasoning families (qwen2.5-coder, plain qwen2.5,
 * phi-4-mini-instruct, gemma, mistral/ministral non-magistral, llama) AND unknown ids (a plain heuristic, not an
 * allowlist — callers needing "unknown ⇒ conservative" combine this with a family-recognition check; see
 * `structured-output-strategy.ts`).
 *
 * Grounds the 2026-07-01 live finding (§4A / §5.AN): on REASONING models `response_format:json_schema` dead-ends
 * (`finish_reason:stop`, EMPTY content, grammar vs the reasoning channel) at any budget — so a reasoning-aware structured
 * output strategy must branch on exactly this predicate (json_schema is safe only OFF a reasoning model).
 *
 * @param modelId the model identifier (e.g. `qwen3.5-9b-mlx`, `qwen/qwen2.5-coder-14b`); matched case-insensitively.
 */
export function isReasoningModel(modelId: string): boolean {
	return (
		ALWAYS_REASONING_EXCLUDE.test(modelId) ||
		QWEN3X_REASONING_LINE.test(modelId) ||
		QWEN3_FAMILY.test(modelId) ||
		OTHER_REASONING_FAMILIES.test(modelId)
	);
}

/**
 * Whether `modelId` matches a family this module RECOGNIZES at all — either a known reasoning family (via
 * {@link isReasoningModel}) or a known non-reasoning family (via {@link KNOWN_NON_REASONING_FAMILIES}). An id matching
 * NEITHER is UNKNOWN, for which conservative callers pick their safe default. Additive; used by
 * `structured-output-strategy.ts` to separate "confidently non-reasoning" from "unknown".
 */
export function isRecognizedModelFamily(modelId: string): boolean {
	return isReasoningModel(modelId) || KNOWN_NON_REASONING_FAMILIES.test(modelId);
}

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
