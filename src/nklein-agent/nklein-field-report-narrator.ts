import type { DraftClaim } from "../core/field-report-grounding";
import type { NarrativeModelPort } from "../core/field-report-narrative-pass";
import type { LocalLlmClient } from "./nklein-local-llm-client";

/**
 * P16.6b — the EFFECTFUL half: a real `NarrativeModelPort` over the local LLM client.
 *
 * ── WHY STRUCTURED OUTPUT AND NOT FREE PROSE ──
 * P16.6b warns that a reasoning model answers a FREE-TEXT call with empty `message.content`, putting its thinking
 * in `reasoning_content` where a naive caller finds nothing. Asking for structured claims sidesteps that entirely:
 * the client's `reasoning_content` fallback is gated on `request.format`, so a schema-constrained call recovers a
 * JSON body from either channel.
 *
 * It is also the better shape on its own merits. Grounding needs CLAIMS WITH CITATIONS, and a free-text narrative
 * has to be parsed back into that — a parse that fails silently and yields "no claims", which reads identically to
 * a model that had nothing to say. Asking for the structure directly makes the citation requirement part of the
 * request instead of a hope about the prose.
 *
 * The narrative guard upstream still applies: an empty body from either channel degrades to Layer A rather than
 * publishing a blank section.
 */

/** One evidence record as offered to the model — id plus kind, never the underlying content. */
export interface NarratorEvidenceOffer {
	readonly id: string;
	readonly kind: string;
	/** A short, already-redacted description. The model never sees raw telemetry. */
	readonly summary: string;
}

/**
 * `additionalProperties: false` on EVERY object is required, not stylistic: !Klein's client validates the schema
 * before dispatch and rejects a strict `json_schema` request without it (`strict_missing_additional_properties`,
 * caught on the first live run). It is also what stops a model padding each claim with invented fields that the
 * parser would then silently ignore.
 */
const CLAIMS_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		claims: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					text: { type: "string" },
					citedEvidenceIds: { type: "array", items: { type: "string" } },
				},
				required: ["text", "citedEvidenceIds"],
			},
		},
	},
	required: ["claims"],
} as const;

export function buildNarratorPrompt(evidence: readonly NarratorEvidenceOffer[]): string {
	const lines = evidence.map((record) => `- ${record.id} (${record.kind}): ${record.summary}`);
	return [
		"You are writing the narrative section of a field report about an autonomous coding run.",
		"",
		"EVIDENCE (the only facts you may assert):",
		...lines,
		"",
		"Write short factual claims about what happened. Every claim MUST cite at least one evidence id from the",
		"list above, exactly as written. A claim you cannot cite is one you must not make — it will be discarded.",
		"Do not speculate about causes that the evidence does not show. Do not restate counts; they are already",
		"reported elsewhere.",
	].join("\n");
}

/** Extract `reasoning_content` from the raw response so the caller can tell thinking-only from silence. */
function reasoningFromRaw(raw: unknown): string | null {
	const choice = (raw as { choices?: Array<{ message?: { reasoning_content?: unknown } }> })?.choices?.[0];
	const reasoning = choice?.message?.reasoning_content;
	return typeof reasoning === "string" && reasoning.trim().length > 0 ? reasoning : null;
}

/** A `NarrativeModelPort` backed by a real local model. */
export function createLocalNarrativeModelPort(input: {
	readonly client: LocalLlmClient;
	readonly evidence: readonly NarratorEvidenceOffer[];
	readonly signal?: AbortSignal;
}): NarrativeModelPort {
	return async () => {
		const completion = await input.client.complete({
			messages: [{ role: "user", content: buildNarratorPrompt(input.evidence) }],
			format: {
				jsonSchema: { name: "field_report_claims", schema: CLAIMS_SCHEMA as unknown as Record<string, unknown> },
			},
			...(input.signal ? { signal: input.signal } : {}),
		});
		return { content: completion.content, reasoningContent: reasoningFromRaw(completion.raw) };
	};
}

/**
 * Parse the schema-constrained reply into claims.
 *
 * Returns NO claims on malformed output rather than throwing or salvaging fragments: the orchestrator already
 * treats "no claims" as a degradation to Layer A with a stated reason, and a half-parsed claim would carry
 * citations that were never really asserted.
 */
export function parseNarratorClaims(completion: string): readonly DraftClaim[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(completion);
	} catch {
		return [];
	}
	const claims = (parsed as { claims?: unknown })?.claims;
	if (!Array.isArray(claims)) {
		return [];
	}
	return claims.flatMap((entry) => {
		const text = (entry as { text?: unknown })?.text;
		const cited = (entry as { citedEvidenceIds?: unknown })?.citedEvidenceIds;
		if (typeof text !== "string" || text.trim().length === 0) {
			return [];
		}
		const ids = Array.isArray(cited) ? cited.filter((id): id is string => typeof id === "string") : [];
		return [{ text: text.trim(), citedEvidenceIds: ids }];
	});
}
