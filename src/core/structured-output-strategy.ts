/**
 * Reasoning-aware STRUCTURED-OUTPUT strategy (todo §5.AN) — the PURE decision of *how* to coax a JSON object out of a
 * given model: with a content-channel grammar (`response_format:json_schema`), via a native TOOL call, or by extracting
 * it from prose.
 *
 * GROUNDING — TWO live probes (127.0.0.1:1234, 2026-07-01; full detail in §4A / §5.AN):
 *
 *  (1) json_schema DEAD-ENDS on reasoning models. On qwen3.5-9b AND the capable qwopus3.6-27b,
 *      `response_format:{type:"json_schema",strict:true}` returns `finish_reason:stop` with EMPTY `content` at max_tokens
 *      200/800/2000 alike — the grammar constrains the CONTENT channel and conflicts with the reasoning channel (~16–20
 *      reasoning tokens land in `reasoning_content`, no JSON in `content`). It reproduces on the 27B ⇒ reasoning FAMILY,
 *      not size. On NON-reasoning models (qwen2.5-coder-14b, phi-4-mini-instruct) json_schema WORKS and is the STRONGER
 *      (grammar-GUARANTEED) path for a pure JSON blob.
 *
 *  (2) native TOOL-CALLING WORKS on those SAME reasoning models. A request with `tools` + `tool_choice:"required"` (also
 *      `"auto"`) returns `finish_reason:tool_calls` with a VALID, schema-valid tool_call (e.g. `{"city":"Paris"}`) after
 *      only ~55–171 reasoning tokens — fast (4–12 s). The call is emitted in the SEPARATE tool_calls channel, so there is
 *      NO grammar-vs-reasoning-channel conflict. It worked on EVERY model probed (reasoning + non-reasoning).
 *
 * ⇒ THREE strategies, chosen by a CONSERVATIVE contract grounded in those findings + the asymmetric failure cost
 * (json_schema on a reasoning model fails SILENTLY — empty content, `finish:stop`, looks like a short answer, no error —
 * = costly & hard to detect; native tool-call + prose-extract both work on reasoning models):
 *   - REASONING model            → `native_tool_call` (PRIMARY: live-verified to work, fast, guaranteed args). Wrap the
 *                                  target schema as a single tool's `parameters` with `tool_choice:"required"`.
 *                                  `prose_extract` is only a last-resort note if a model/host has no tool support.
 *   - CONFIDENTLY NON-reasoning  → `json_schema_grammar` (strongest guarantee for a pure JSON blob; live-verified on
 *                                  coder-14b / phi-4-mini). native_tool_call also works there, but grammar is stronger.
 *   - UNKNOWN / unrecognized     → `native_tool_call` (safe UNIVERSAL default — it worked on every model probed).
 *
 * Pure + deterministic (a predicate over the model id); no LLM, no network, no I/O. This module owns ONLY the strategy
 * DECISION — it does NOT execute the request, does NOT build the `response_format` envelope
 * ([lmstudio-response-format.ts](./lmstudio-response-format.ts) does that), does NOT build a tool-call schema
 * ([nklein-constrained-tool-call.ts](../nklein-agent/nklein-constrained-tool-call.ts) does that), and does NOT extract JSON.
 *
 * PROSE→JSON EXTRACTOR — composition point (grep-confirmed reusable, NOT wired here): the `prose_extract` fallback needs a
 * lenient prose→JSON parser. One already exists and is the intended seam:
 * [`repairJsonValue`](../nklein-agent/nklein-tool-argument-repair.ts) — the shared, well-tested recovery
 * (passthrough → direct parse → code-fence unwrap → first balanced `{…}` extraction → structural repairs), documented as
 * "the single, shared, well-tested recovery used by every !Klein tool parser". `nklein-constrained-tool-call.ts` also has
 * a private `extractFirstJsonObject`, but it is tool-call-shaped (`{tool,arguments}`) and unexported;
 * `core/extraction-span.ts` is a TEXT-window extractor for retrieval, NOT JSON. So no NEW extractor is owed — the runtime
 * `prose_extract` path should reuse `repairJsonValue`. Wiring the selector + the tool-call schema + the extractor into the
 * model-call seam is separate hot-path work (see the §5.AN owed-wiring note); this core stops at the decision.
 */

import { isReasoningModel, isRecognizedModelFamily } from "./model-thinking-control";

/**
 * How to obtain structured (JSON) output from a model.
 * - `json_schema_grammar`: send `response_format:{type:"json_schema",strict:true,…}` and read the guaranteed-valid JSON
 *   from `content`. Strongest guarantee for a pure JSON blob — but it DEAD-ENDS to empty content on reasoning models, so
 *   it is chosen only when confidently non-reasoning.
 * - `native_tool_call`: wrap the target schema as a single tool's `parameters` and send `tools` + `tool_choice:"required"`;
 *   read the arguments from the `tool_calls` channel. Live-verified to work (fast, schema-valid) on reasoning AND
 *   non-reasoning models — the reasoning-safe path and the universal default.
 * - `prose_extract`: send NO grammar + a large token budget and PARSE the JSON object out of the post-reasoning `content`
 *   (via the shared `repairJsonValue`). Works everywhere; the LAST-RESORT fallback when tools are unavailable.
 */
export type StructuredOutputStrategy = "json_schema_grammar" | "native_tool_call" | "prose_extract";

/** The strategy decision plus WHY, and whether it rests on a recognized family (vs a conservative fallback). */
export interface StructuredOutputStrategyDecision {
	/** The chosen strategy. */
	strategy: StructuredOutputStrategy;
	/** Human-readable rationale (for logs / telemetry / debugging a surprising pick). */
	reason: string;
	/**
	 * `true` when the decision rests on a RECOGNIZED family (a known reasoning family ⇒ confident `native_tool_call`, or a
	 * known non-reasoning family ⇒ confident `json_schema_grammar`). `false` when the model is UNKNOWN and we fell back to
	 * the safe universal `native_tool_call` default — a signal that a capability probe / catalog lookup could firm it up.
	 */
	confident: boolean;
}

/** Options for {@link selectStructuredOutputStrategy}. */
export interface SelectStructuredOutputStrategyOptions {
	/**
	 * Force `prose_extract` regardless of the model id. ESCAPE HATCH for a caller that KNOWS the target model/host has NO
	 * tool support AND (if reasoning) that json_schema dead-ends here — i.e. neither structured path is available, so parse
	 * from prose. Takes precedence over every other branch. Default `false`.
	 */
	forceProseExtract?: boolean;
}

/**
 * Choose the structured-output strategy for `modelId` (pure, deterministic).
 *
 * CONTRACT (conservative, grounded in the two §4A/§5.AN live findings + the asymmetric failure cost):
 * 1. `forceProseExtract` ⇒ `prose_extract` (confident — caller-asserted no-tools/no-grammar host).
 * 2. REASONING model ({@link isReasoningModel}) ⇒ `native_tool_call` (confident) — json_schema dead-ends to empty content
 *    on these; the tool_calls channel works (fast, guaranteed args).
 * 3. RECOGNIZED NON-reasoning family (not reasoning AND {@link isRecognizedModelFamily}) ⇒ `json_schema_grammar`
 *    (confident) — the strongest grammar-guaranteed path, live-verified on coder-14b / phi-4-mini.
 * 4. UNKNOWN model (neither) ⇒ `native_tool_call` (NOT confident) — the safe universal default (worked on every model
 *    probed, reasoning + non-reasoning); avoids a possible silent empty-content json_schema dead-end.
 *
 * @param modelId the model identifier (matched case-insensitively by the composed matchers).
 * @param opts    optional overrides; see {@link SelectStructuredOutputStrategyOptions}.
 */
export function selectStructuredOutputStrategy(
	modelId: string,
	opts?: SelectStructuredOutputStrategyOptions,
): StructuredOutputStrategyDecision {
	if (opts?.forceProseExtract) {
		return {
			strategy: "prose_extract",
			reason: "caller forced prose_extract (host has neither tool support nor a working json_schema grammar)",
			confident: true,
		};
	}

	if (isReasoningModel(modelId)) {
		return {
			strategy: "native_tool_call",
			reason:
				"reasoning model — response_format:json_schema dead-ends to empty content (grammar vs reasoning channel, live-probed 2026-07-01); native tool_call (tool_choice:required) works: fast + schema-valid args in the separate tool_calls channel",
			confident: true,
		};
	}

	if (isRecognizedModelFamily(modelId)) {
		return {
			strategy: "json_schema_grammar",
			reason:
				"recognized non-reasoning family — json_schema grammar is the strongest guaranteed-valid path (live-verified on qwen2.5-coder-14b / phi-4-mini-instruct)",
			confident: true,
		};
	}

	return {
		strategy: "native_tool_call",
		reason:
			"unknown/unrecognized model — safe universal default: native tool_call worked on every model probed (reasoning + non-reasoning); avoids a possible silent empty-content json_schema dead-end",
		confident: false,
	};
}
