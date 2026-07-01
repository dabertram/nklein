/**
 * §5.AA — classify WHICH narrated-tool-call recovery dialect a stuck (no-structured-call) turn is in, so the runtime
 * can route to the right recovery family, know whether recovery is possible AT ALL, and record the model's dialect for
 * learning (pure).
 *
 * WHAT: when a tools-offered turn produces no structured tool call, the text may still CONTAIN a call the model
 * "narrated" as text — but in one of many family-specific dialects (Hermes/Qwen `<tool_call>`, Mistral `[TOOL_CALLS]`,
 * Phi `[TOOL_REQUEST]`, Llama `<|python_tag|>`, DeepSeek special-token, Functionary `<function=NAME>`, Gemma
 * `tool_code` Python, plain-prose `Tool call: name(args)`, or a bare/`json`-fenced object that only names an OFFERED
 * tool). `classifyNarrationDialect(text, offeredToolNames)` names that dialect (or `none` when nothing recoverable is
 * present) and reports whether a recovery family can actually pull a call out of it.
 *
 * WHY: today the recovery is a MONOLITHIC parse — {@link parseNarratedToolCalls} tries every family in sequence and
 * returns the calls it finds, but it never says WHICH dialect matched, and it can't see the offered-tool set that the
 * separate {@link parseToolValidatedNarration} needs. So a caller has:
 *   - no signal of which format THIS model narrates in (→ nothing to persist as
 *     `ModelBehaviorProfile.toolCallFormat` / drive the §5.AG "what happened" surface / pick a per-model pre-emptive
 *     recovery), and
 *   - no single "is this a recoverable narration, a genuine prose answer, or an unrecoverable stall?" verdict that the
 *     evidence-gate / adaptive-attempt loop can branch on WITHOUT guessing from raw markers.
 * grep-confirmed there is no dialect classifier: the family parsers exist, `completion-stop-reason` classifies the
 * STOP reason (a different axis — why generation ended, not what shape a narrated call took), and
 * `failure-signature` classifies a thrown ERROR value (not a narrated turn's text).
 *
 * EVIDENCE, NOT MARKER-GUESSING (the robustness property, mirroring AGENTS.md "observable, not the model's claim"):
 * a marker alone is not enough — a model can print `<tool_call>` with unparseable garbage, or mention "a tool call" in
 * prose. So the verdict is grounded on whether a recovery family actually PARSES a call: `recoverable` is true only
 * when a family yielded ≥1 call. This unifies the two recovery entry points — the marker/anchor families via
 * {@link parseNarratedToolCalls} and the offered-tool-gated bare-JSON family via {@link parseToolValidatedNarration} —
 * behind one classification, and picks the SPECIFIC dialect by re-checking each family's own signature on the text
 * (most-specific-first, so a `<tool_call>` block that also happens to contain the word `tool_code` classifies as the
 * marker family, not the Gemma-Python one).
 *
 * Pure + defensive: empty/whitespace/no-marker text ⇒ `{ dialect: "none", recoverable: false }` (never throws, never
 * guesses a call). Composes the existing recovery cores by import only (no edits to siblings).
 */

import {
	type NarratedToolCall,
	parseNarratedToolCalls,
	parseToolValidatedNarration,
} from "../nklein-agent/nklein-narrated-tool-call";

/**
 * The narrated-tool-call dialect a stuck turn is in. Each value maps to the recovery family
 * ({@link parseNarratedToolCalls} / {@link parseToolValidatedNarration}) that handles it; `none` = no recoverable
 * narration was found (a genuine prose answer, or an unrecoverable stall/empty turn).
 */
export enum NarrationDialect {
	/** Hermes / Qwen / Granite `<tool_call>` (and the pipe-delimited `<|tool_call|>` / `<function_call>`) marker. */
	HermesQwen = "hermes_qwen",
	/** Mistral / Mixtral `[TOOL_CALLS]` — a JSON ARRAY of calls. */
	Mistral = "mistral",
	/** Microsoft Phi `[TOOL_REQUEST]{…}[END_TOOL_REQUEST]`. */
	Phi = "phi",
	/** Llama 3.1 `<|python_tag|>` — a single JSON object follows. */
	LlamaPythonTag = "llama_python_tag",
	/** DeepSeek-V3 / R1 special-token `<｜tool▁call▁begin｜>…<｜tool▁sep｜>NAME ```json {…}``` <｜tool▁call▁end｜>`. */
	DeepSeek = "deepseek",
	/** Functionary / some Llama fine-tunes `<function=NAME>{args}</function>` — the name lives in the tag. */
	FunctionaryTag = "functionary_tag",
	/** Gemma `tool_code` Python narration — `tool_code = read_file(filename="…")`. */
	GemmaToolCode = "gemma_tool_code",
	/** Plain-prose narration — `Tool call: name(args)`, no structured marker. */
	PlainProse = "plain_prose",
	/**
	 * Bare / ```json-fenced object `{"tool":"…","parameters":{…}}` naming an OFFERED tool (no marker). Only recoverable
	 * WITH the offered-tool set (bare JSON is otherwise too easily a legit answer, §5.O), so it never classifies here
	 * when `offeredToolNames` is empty.
	 */
	ToolValidatedJson = "tool_validated_json",
	/** No recoverable narration — a genuine prose answer, or an unrecoverable stall/empty/garbled turn. */
	None = "none",
}

/** The verdict for a stuck turn: which narration dialect, whether a recovery family can pull a call out, and the calls. */
export interface NarrationDialectVerdict {
	/** The classified dialect (most-specific family first; {@link NarrationDialect.None} when nothing recoverable). */
	readonly dialect: NarrationDialect;
	/**
	 * True when a recovery family actually PARSED ≥1 tool call from the text — the evidence-grounded "we can recover
	 * this" signal (a marker with unparseable garbage ⇒ `false`, dialect `none`). When true the recovered calls are in
	 * {@link recoveredCalls}.
	 */
	readonly recoverable: boolean;
	/** The tool calls the matching recovery family recovered (empty ⇒ nothing recoverable). */
	readonly recoveredCalls: readonly NarratedToolCall[];
	/**
	 * Whether the dialect carries an explicit structured MARKER (`<tool_call>`, `[TOOL_REQUEST]`, DeepSeek tokens, …) —
	 * as opposed to the marker-LESS prose / Python / offered-tool-JSON families. Useful for the §5.AG surface + deciding
	 * whether the constrained-decoding rung (which forces a marker-shaped call) is likely to help.
	 */
	readonly hasStructuredMarker: boolean;
	/** A short human-readable reason, for the §5.AG "what happened" surface + tests. */
	readonly reason: string;
}

/**
 * Per-family signature probes, MOST-SPECIFIC-FIRST. Each is a cheap presence check on the raw text mirroring the exact
 * marker the corresponding parser in {@link parseNarratedToolCalls} keys on. Order matters: the structured-marker
 * families precede the Python/prose ones so a `<tool_call>` block that incidentally contains the substring `tool_code`
 * or `tool call:` classifies as the marker family (the parser resolves it via markers first, so the label must agree).
 * DeepSeek precedes Hermes because DeepSeek's `tool▁call` also matches a loose `tool[_▁]call`; the specific token
 * wrapper is checked first.
 */
const DIALECT_SIGNATURES: ReadonlyArray<{
	readonly dialect: NarrationDialect;
	readonly hasStructuredMarker: boolean;
	readonly test: (text: string) => boolean;
}> = [
	{
		// DeepSeek special-token wrapper — checked before the generic Hermes `tool_call` (its `tool▁call` also matches).
		dialect: NarrationDialect.DeepSeek,
		hasStructuredMarker: true,
		test: (text) => /<[｜|]\s*tool[▁_ ]calls?[▁_ ]begin\s*[｜|]>/i.test(text),
	},
	{
		dialect: NarrationDialect.Phi,
		hasStructuredMarker: true,
		test: (text) => /\[TOOL_REQUEST\]/i.test(text),
	},
	{
		dialect: NarrationDialect.Mistral,
		hasStructuredMarker: true,
		test: (text) => /\[TOOL_CALLS\]/i.test(text),
	},
	{
		dialect: NarrationDialect.LlamaPythonTag,
		hasStructuredMarker: true,
		test: (text) => /<\|?\s*python_tag\s*\|?>/i.test(text),
	},
	{
		dialect: NarrationDialect.FunctionaryTag,
		hasStructuredMarker: true,
		test: (text) => /<function\s*=\s*[A-Za-z0-9_.-]+\s*>/i.test(text),
	},
	{
		// Hermes / Qwen / Granite `<tool_call>` / `<|tool_call|>` / `<function_call>` — the broad marker family.
		dialect: NarrationDialect.HermesQwen,
		hasStructuredMarker: true,
		test: (text) => /<\|?\s*(?:tool_call|function_call)\s*\|?>/i.test(text),
	},
	{
		// Gemma `tool_code` Python narration — marker-less (an anchor word, not a wrapper token).
		dialect: NarrationDialect.GemmaToolCode,
		hasStructuredMarker: false,
		test: (text) => /tool_code/i.test(text),
	},
	{
		// Plain-prose `Tool call: name(args)` — marker-less; the same shape the strip/recover paths trust.
		dialect: NarrationDialect.PlainProse,
		hasStructuredMarker: false,
		test: (text) => /\btool\s+call\s*:\s*`?\s*[A-Za-z_][A-Za-z0-9_.-]*\s*\(/i.test(text),
	},
];

/** Pick the most-specific dialect whose marker signature matches the text; null when none of the family markers match. */
function matchDialectSignature(text: string): { dialect: NarrationDialect; hasStructuredMarker: boolean } | null {
	for (const signature of DIALECT_SIGNATURES) {
		if (signature.test(text)) {
			return { dialect: signature.dialect, hasStructuredMarker: signature.hasStructuredMarker };
		}
	}
	return null;
}

/** A verdict with no recovery — for a genuine prose answer / unrecoverable stall / empty turn. */
function noneVerdict(reason: string): NarrationDialectVerdict {
	return {
		dialect: NarrationDialect.None,
		recoverable: false,
		recoveredCalls: [],
		hasStructuredMarker: false,
		reason,
	};
}

/**
 * Classify the narrated-tool-call dialect of a stuck (no-structured-call) turn's text (pure).
 *
 * `text` = the turn's narratable text (content + reasoning concatenated, as the recovery hook reads it).
 * `offeredToolNames` = the tools offered this turn; enables the offered-tool-gated bare-JSON family
 * ({@link NarrationDialect.ToolValidatedJson}). Pass `[]` (default) when unknown — that family is then skipped (bare
 * JSON is never recovered without the offered set, §5.O), and only the marker/anchor families can classify.
 *
 * The verdict is EVIDENCE-GROUNDED: `recoverable` is true only when a family actually parsed ≥1 call. A text with a
 * marker but unparseable garbage ⇒ `{ dialect: "none", recoverable: false }` (honest: "looks like a call, but nothing
 * to run"). Preference order when BOTH a marker/anchor family and the offered-JSON family could match: the specific
 * marker/anchor family wins (it's the more precise signal); the offered-JSON family is the fallback for a truly
 * marker-less object.
 */
export function classifyNarrationDialect(
	text: string,
	offeredToolNames: readonly string[] = [],
): NarrationDialectVerdict {
	if (!text?.trim()) {
		return noneVerdict("Empty turn — no narrated tool call.");
	}

	// The marker/anchor families (everything except the offered-tool-gated bare JSON). One monolithic parse tells us
	// whether ANY of them recovered a call; a signature probe tells us WHICH one to label it.
	const markerCalls = parseNarratedToolCalls(text);
	const signature = matchDialectSignature(text);

	if (markerCalls.length > 0 && signature) {
		return {
			dialect: signature.dialect,
			recoverable: true,
			recoveredCalls: markerCalls,
			hasStructuredMarker: signature.hasStructuredMarker,
			reason: `Recovered ${markerCalls.length} call(s) from the ${signature.dialect} narration dialect.`,
		};
	}

	// The offered-tool-gated bare/`json`-fenced object family — only when the marker/anchor families didn't recover a
	// call (a marker family is the more precise signal and wins above). Safe only WITH the offered set (§5.O).
	if (offeredToolNames.length > 0) {
		const validatedCalls = parseToolValidatedNarration(text, offeredToolNames);
		if (validatedCalls.length > 0) {
			return {
				dialect: NarrationDialect.ToolValidatedJson,
				recoverable: true,
				recoveredCalls: validatedCalls,
				hasStructuredMarker: false,
				reason: `Recovered ${validatedCalls.length} bare-JSON call(s) naming an offered tool.`,
			};
		}
	}

	// A marker/anchor is present but NOTHING parsed — honest "unrecoverable narration", not a phantom call.
	if (signature) {
		return noneVerdict(
			`A ${signature.dialect} marker is present but no tool call could be parsed — unrecoverable narration.`,
		);
	}

	// No marker, no anchor, no offered-tool JSON — a genuine prose answer or an unrecoverable stall.
	return noneVerdict("No narrated-tool-call dialect detected — a genuine answer or an unrecoverable stall.");
}

/** Convenience: is this stuck turn a recoverable narration (a recovery family can pull a call out)? */
export function isRecoverableNarration(text: string, offeredToolNames: readonly string[] = []): boolean {
	return classifyNarrationDialect(text, offeredToolNames).recoverable;
}
