/**
 * §5.AC retrieval-loop SYNTHESIS adapter — maps an injected model completion into the loop's optional `synthesize` dep
 * ({@link runRetrievalLoop}). Like the search + fetch adapters, the MODEL call is INJECTED (prime directive #1: egress +
 * model live only in a caller-gated, opt-in adapter); this module only builds the prompt, drives the injected
 * completion, and renders a CITED answer over the tested {@link assembleCitedAnswer} core.
 *
 * Fail-soft everywhere: a completion that throws ⇒ `""` (the loop keeps its evidence, no answer); model output that
 * isn't the requested JSON ⇒ fall back to the raw text (an uncited answer beats none); a claim citing an unknown id ⇒
 * that citation is dropped by `assembleCitedAnswer`. So a low-quality or malformed synthesis degrades to the loop's
 * prior evidence-only behaviour, never worse.
 */

import { assembleCitedAnswer, type SynthesisClaim, type SynthesisEvidenceRef } from "./cited-synthesis";
import { extractRelevantSpans } from "./extraction-span";
import type { RetrievalEvidence } from "./retrieval-loop-driver";
import { tokenizeQuery } from "./retrieval-rerank";

/** The injected model completion the synthesis adapter drives: a prompt in, the model's text out. */
export type SynthesisComplete = (prompt: string, signal?: AbortSignal) => Promise<string>;

/** Max characters of a single evidence excerpt embedded in the prompt (keeps the synthesis prompt bounded). */
const MAX_EVIDENCE_CHARS = 1200;

/**
 * Trim ONE evidence text for the prompt. Short evidence is embedded whole. LONG evidence is narrowed to the query-
 * relevant windows via {@link extractRelevantSpans} (§5.AC extract core) so the model reads the parts that actually
 * bear on the question instead of an arbitrary head slice; if no query term appears in the text, fall back to a head
 * truncation (never drop the evidence entirely).
 */
function evidenceExcerpt(text: string, queryTerms: readonly string[]): string {
	if (text.length <= MAX_EVIDENCE_CHARS) {
		return text;
	}
	const spans = extractRelevantSpans(text, queryTerms, { windowChars: 400, maxSpans: 4 });
	if (spans.length > 0) {
		// Cap the joined spans too: 4 non-merging ~400-char windows can exceed MAX_EVIDENCE_CHARS, and the point of this
		// excerpt is to keep the synthesis prompt bounded (as the head-truncation branch below already does).
		const joined = spans.map((span) => span.text).join(" … ");
		return joined.length <= MAX_EVIDENCE_CHARS ? joined : `${joined.slice(0, MAX_EVIDENCE_CHARS)}…`;
	}
	return `${text.slice(0, MAX_EVIDENCE_CHARS)}…`;
}

/**
 * Build the synthesis prompt: the QUESTION plus each evidence excerpt tagged with its stable id, and an instruction to
 * answer using ONLY the evidence and to cite the id(s) each claim relies on as a JSON array of `{claim, cite}`.
 * Deterministic (pure) so it is unit-testable without a model. Long evidence is narrowed to query-relevant spans.
 */
export function buildSynthesisPrompt(task: string, evidence: readonly RetrievalEvidence[]): string {
	const queryTerms = tokenizeQuery(task);
	const blocks = evidence.map((item) => {
		const excerpt = evidenceExcerpt(item.text, queryTerms);
		return `[${item.id}]${item.url ? ` (${item.url})` : ""}\n${excerpt}`;
	});
	return [
		"Answer the QUESTION using ONLY the EVIDENCE below. Do not use outside knowledge.",
		'Respond with a JSON array of objects, each { "claim": string, "cite": string[] }, where every `cite`',
		"entry is an evidence id (the bracketed tag) that supports that claim. Make each claim a single sentence.",
		"If the evidence does not answer the question, return an empty array [].",
		"",
		`QUESTION: ${task}`,
		"",
		"EVIDENCE:",
		blocks.join("\n\n"),
	].join("\n");
}

/**
 * Find the first substring that is a balanced `[...]` and JSON-parses to an ARRAY, scanning each `[` in turn (string- and
 * nesting-aware). Robust to prose brackets BEFORE the array (e.g. a markdown "[docs]" link or a ```json fence preamble):
 * a plain `indexOf("[")..lastIndexOf("]")` grabs the OUTERMOST pair, which then fails to parse and silently discards
 * every cited claim. Returns null when no bracket-run parses to an array.
 */
function firstJsonArray(text: string): unknown[] | null {
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] !== "[") {
			continue;
		}
		let depth = 0;
		let inString: string | null = null;
		let escaped = false;
		for (let j = i; j < text.length; j += 1) {
			const ch = text[j];
			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (ch === "\\") {
					escaped = true;
				} else if (ch === inString) {
					inString = null;
				}
				continue;
			}
			if (ch === '"' || ch === "'") {
				inString = ch;
			} else if (ch === "[" || ch === "{") {
				depth += 1;
			} else if (ch === "]" || ch === "}") {
				depth -= 1;
				if (depth === 0) {
					try {
						const value: unknown = JSON.parse(text.slice(i, j + 1));
						if (Array.isArray(value)) {
							return value;
						}
					} catch {
						// This `[` didn't open a valid JSON array — try the next one.
					}
					break;
				}
			}
		}
	}
	return null;
}

/**
 * Parse the model's response into {@link SynthesisClaim}s, fail-soft. Extracts the first JSON array in the text (models
 * often wrap it in prose / ```json fences), keeps only well-formed `{claim:string, cite:string[]}` entries, and drops
 * cited ids not in `knownIds`. Any parse failure ⇒ `[]` (the caller then falls back to the raw text).
 */
export function parseSynthesisClaims(raw: string, knownIds: ReadonlySet<string>): SynthesisClaim[] {
	const parsed = firstJsonArray(raw);
	if (parsed === null) {
		return [];
	}
	const claims: SynthesisClaim[] = [];
	for (const entry of parsed) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		const record = entry as { claim?: unknown; cite?: unknown };
		if (typeof record.claim !== "string" || record.claim.trim().length === 0) {
			continue;
		}
		const cites = Array.isArray(record.cite)
			? record.cite.filter((id): id is string => typeof id === "string" && knownIds.has(id))
			: [];
		claims.push({ text: record.claim.trim(), citedEvidenceIds: cites });
	}
	return claims;
}

/** Render the cited answer plus a numbered sources list (only cited-and-resolved sources appear), flagging any
 *  claim that has NO supporting evidence — an unverified claim still renders (fail-soft) but is never presented
 *  with the same weight as a cited one (§5.AC citation verification at the render seam). */
function renderCitedAnswer(
	answer: string,
	sources: readonly { marker: number; url?: string; evidenceId: string }[],
	uncitedClaims: readonly string[] = [],
): string {
	const caveat =
		uncitedClaims.length > 0
			? `\n\n${uncitedClaims.map((claim) => `Unverified (no supporting source): ${claim}`).join("\n")}`
			: "";
	if (sources.length === 0) {
		return `${answer}${caveat}`;
	}
	const list = sources.map((source) => `[${source.marker}] ${source.url ?? source.evidenceId}`).join("\n");
	return `${answer}${caveat}\n\nSources:\n${list}`;
}

/**
 * Build the retrieval loop's `synthesize` dep from an injected model completion. Returns a cited answer string (claims
 * with `[n]` markers + a sources list). Fail-soft: a thrown completion or unparseable output degrades to `""` or the raw
 * text respectively, so enabling synthesis never makes the loop's result worse than evidence-only.
 */
export function citedSynthesisAdapter(
	complete: SynthesisComplete,
): (input: { task: string; evidence: readonly RetrievalEvidence[] }, signal?: AbortSignal) => Promise<string> {
	return async ({ task, evidence }, signal) => {
		if (evidence.length === 0) {
			return "";
		}
		let raw: string;
		try {
			raw = await complete(buildSynthesisPrompt(task, evidence), signal);
		} catch {
			return ""; // fail-soft: no answer, the loop keeps its gathered evidence
		}
		const knownIds = new Set(evidence.map((item) => item.id));
		const claims = parseSynthesisClaims(raw, knownIds);
		if (claims.length === 0) {
			return raw.trim(); // model ignored the JSON contract → an uncited answer beats none
		}
		const refs: SynthesisEvidenceRef[] = evidence.map((item) => ({
			id: item.id,
			...(item.url !== undefined ? { url: item.url } : {}),
		}));
		const cited = assembleCitedAnswer({ claims, evidence: refs });
		return renderCitedAnswer(cited.answer, cited.sources, cited.uncitedClaims);
	};
}
