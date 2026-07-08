/**
 * §5.AE → §5.AN bridge (pure): translate a resolved {@link SkillApiProfile} (the abstract per-skill INTENT —
 * reasoning intensity, structured output, force-a-call, temperature) into the CONCRETE, model-capability-gated
 * request hints the model-call seam will apply. The catalog of which levers a model actually supports lives in
 * {@link ./model-thinking-control.ts} (the live-verified reasoning soft-switches); this module consults it so a
 * lever is only emitted when the chosen model can honor it — otherwise it's recorded as a skipped note (with WHY),
 * never silently forced. Pure + testable; the effectful application (appending the directive, setting
 * `response_format`, dispatching the constrained rung) stays at the call seam.
 */

import { getThinkingControl } from "./model-thinking-control.js";
import type { SkillApiProfile } from "./skill-registry.js";
import { type StructuredOutputStrategy, selectStructuredOutputStrategy } from "./structured-output-strategy.js";

export interface ResolvedApiProfileRequest {
	/** A reasoning soft-switch directive to append to the prompt (e.g. `/no_think` or `/think`), or null if none applies. */
	thinkingDirective: string | null;
	/** Prefer constrained structured output for this turn's result. See {@link structuredOutputStrategy} for the mechanism. */
	preferStructuredOutput: boolean;
	/**
	 * The reasoning-SAFE structured-output mechanism for THIS model when {@link preferStructuredOutput} — resolved via
	 * {@link selectStructuredOutputStrategy}. `null` when structured output is not preferred. This is what closes the §5.AN
	 * caveat: json_schema forcing dead-ends to empty content on reasoning models, so a reasoning model resolves to
	 * `native_tool_call` here (NOT `json_schema_grammar`), and the seam can apply the lever without regressing it.
	 */
	structuredOutputStrategy: StructuredOutputStrategy | null;
	/** Proactively force a tool call (the §5.AA constrained rung) when the model won't call on its own. */
	forceToolCall: boolean;
	/** Sampling temperature override, or null when the profile doesn't opine. */
	temperature: number | null;
	/** Operator-readable trace of what was applied and what was SKIPPED (and why) — for §5.AG surfaces / debugging. */
	notes: string[];
}

/**
 * Resolve an `apiProfile` against a concrete model (pure). The structured-output / force-tool-call / temperature levers
 * are model-agnostic (they ride the request, not the model's training), so they pass through directly. The REASONING
 * lever is gated: `off`/`high` only emit a soft-switch directive when {@link getThinkingControl} knows one for the model
 * (e.g. Qwen3's `/no_think` ↔ `/think`); for a model with no known switch the intent is recorded as a skipped note
 * (we rely on the model default rather than injecting a token it ignores). `low`/`inherit`/absent emit no directive.
 */
export function resolveApiProfileRequest(
	profile: SkillApiProfile | undefined,
	modelId: string,
): ResolvedApiProfileRequest {
	const notes: string[] = [];
	const resolved: ResolvedApiProfileRequest = {
		thinkingDirective: null,
		preferStructuredOutput: profile?.structuredOutput === true,
		structuredOutputStrategy: null,
		forceToolCall: profile?.forceToolCall === true,
		temperature: typeof profile?.temperature === "number" ? profile.temperature : null,
		notes,
	};

	const reasoning = profile?.reasoning;
	if (reasoning === "off" || reasoning === "high") {
		const control = getThinkingControl(modelId);
		if (control) {
			resolved.thinkingDirective = reasoning === "off" ? control.disableToken : control.enableToken;
			notes.push(`reasoning ${reasoning} → ${resolved.thinkingDirective} (${modelId} has a soft switch)`);
		} else {
			notes.push(
				`reasoning ${reasoning} requested but ${modelId} has no known thinking switch — using model default`,
			);
		}
	}
	if (resolved.preferStructuredOutput) {
		// Resolve the reasoning-SAFE mechanism: json_schema dead-ends on reasoning models, so consult the strategy rather
		// than blindly claiming response_format:json_schema (the §5.AN caveat that previously blocked wiring this lever).
		const decision = selectStructuredOutputStrategy(modelId);
		resolved.structuredOutputStrategy = decision.strategy;
		const mechanism =
			decision.strategy === "json_schema_grammar"
				? "response_format json_schema"
				: decision.strategy === "native_tool_call"
					? "native tool_call (tool_choice:required)"
					: "prose extraction";
		notes.push(`structured output preferred → ${mechanism} (${decision.reason})`);
	}
	if (resolved.forceToolCall) {
		notes.push("force-tool-call rung enabled");
	}
	if (resolved.temperature !== null) {
		notes.push(`temperature ${resolved.temperature}`);
	}
	return resolved;
}
