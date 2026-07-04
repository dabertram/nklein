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
import type { RetrievalEvidence } from "./retrieval-loop-driver";

/** The injected model completion the synthesis adapter drives: a prompt in, the model's text out. */
export type SynthesisComplete = (prompt: string, signal?: AbortSignal) => Promise<string>;

/** Max characters of a single evidence excerpt embedded in the prompt (keeps the synthesis prompt bounded). */
const MAX_EVIDENCE_CHARS = 1200;

/**
 * Build the synthesis prompt: the QUESTION plus each evidence excerpt tagged with its stable id, and an instruction to
 * answer using ONLY the evidence and to cite the id(s) each claim relies on as a JSON array of `{claim, cite}`.
 * Deterministic (pure) so it is unit-testable without a model.
 */
export function buildSynthesisPrompt(task: string, evidence: readonly RetrievalEvidence[]): string {
	const blocks = evidence.map((item) => {
		const excerpt = item.text.length > MAX_EVIDENCE_CHARS ? `${item.text.slice(0, MAX_EVIDENCE_CHARS)}…` : item.text;
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
 * Parse the model's response into {@link SynthesisClaim}s, fail-soft. Extracts the first JSON array in the text (models
 * often wrap it in prose / ```json fences), keeps only well-formed `{claim:string, cite:string[]}` entries, and drops
 * cited ids not in `knownIds`. Any parse failure ⇒ `[]` (the caller then falls back to the raw text).
 */
export function parseSynthesisClaims(raw: string, knownIds: ReadonlySet<string>): SynthesisClaim[] {
	const start = raw.indexOf("[");
	const end = raw.lastIndexOf("]");
	if (start === -1 || end <= start) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
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

/** Render the cited answer plus a numbered sources list (only cited-and-resolved sources appear). */
function renderCitedAnswer(
	answer: string,
	sources: readonly { marker: number; url?: string; evidenceId: string }[],
): string {
	if (sources.length === 0) {
		return answer;
	}
	const list = sources.map((source) => `[${source.marker}] ${source.url ?? source.evidenceId}`).join("\n");
	return `${answer}\n\nSources:\n${list}`;
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
		return renderCitedAnswer(cited.answer, cited.sources);
	};
}
