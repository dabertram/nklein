/**
 * §5.AD reason-THEN-act — the pure orchestration transform for the two-phase turn that converts a reasoning model into
 * a tool-caller. Phase (a) (the `reason_then_act` prompt-variant) has the model THINK about which tool + arguments;
 * phase (b) FORCES that call via constrained decoding. This module owns the pure glue BETWEEN the phases:
 *   - {@link extractDecidedTool}: read phase (a)'s free-text reasoning and infer which OFFERED tool it settled on;
 *   - {@link buildReasonThenActPhaseB}: assemble phase (b)'s instruction, carrying the reasoning forward and pinning
 *     the decided tool so the constrained rung produces exactly that call.
 *
 * Pure + total + deterministic — the effectful runner drives the two model calls (phase (a) generate → phase (b)
 * constrained emit); these transforms are unit-provable without a model. Composes nothing by import (stays decoupled).
 */

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Infer which offered tool phase (a)'s reasoning DECIDED on: the LAST offered tool name mentioned in the text (a
 * step-by-step reasoning concludes with its choice, so the final mention is the decision). Matched case-insensitively on
 * word boundaries so `write_file` isn't matched inside `overwrite_files`. Returns null when no offered tool is named.
 */
export function extractDecidedTool(phaseAText: string, offeredToolNames: readonly string[]): string | null {
	let decided: string | null = null;
	let decidedAt = -1;
	for (const name of offeredToolNames) {
		if (!name) {
			continue;
		}
		const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "giu");
		let match: RegExpExecArray | null = pattern.exec(phaseAText);
		let lastIndex = -1;
		while (match !== null) {
			lastIndex = match.index;
			match = pattern.exec(phaseAText);
		}
		// The tool whose LAST mention appears latest in the text is the concluded decision.
		if (lastIndex > decidedAt) {
			decided = name;
			decidedAt = lastIndex;
		}
	}
	return decided;
}

export interface ReasonThenActPhaseBInput {
	/** The original task instruction (preserved verbatim). */
	instruction: string;
	/** Phase (a)'s reasoning text (the model's step-by-step decision), carried forward as context. */
	phaseAReasoning: string;
	/** The tool phase (a) decided on (e.g. from {@link extractDecidedTool}); pins phase (b)'s forced call when known. */
	decidedToolName?: string | null;
}

/**
 * Build phase (b)'s instruction: carry phase (a)'s reasoning forward and demand a SINGLE tool call now — pinned to the
 * decided tool when one was inferred, else any single call. Pairs with the constrained-decoding rung (which enforces a
 * parseable call); this instruction gives the model the "you already decided — now emit it" framing that makes the
 * forced call coherent rather than a cold constrained emit.
 */
export function buildReasonThenActPhaseB(input: ReasonThenActPhaseBInput): string {
	const reasoning = input.phaseAReasoning.trim();
	const reasoningLine = reasoning.length > 0 ? `Your reasoning so far:\n${reasoning}\n\n` : "";
	const tool = input.decidedToolName?.trim();
	const demand = tool
		? `Now make that decision concrete: produce a SINGLE \`${tool}\` tool call and nothing else — no explanation.`
		: "Now make that decision concrete: produce a SINGLE tool call and nothing else — no explanation.";
	return `${reasoningLine}${demand}\nTask: ${input.instruction}`;
}
