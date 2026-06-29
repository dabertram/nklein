/**
 * First-class RetrievedEvidence objects + citation verification (todo §5.AC).
 *
 * Every piece of external content the agent retrieves — a web page, a repo file, an MCP resource, a doc — gets wrapped
 * in a `RetrievedEvidence` envelope before it enters the context window. The envelope carries:
 *   - provenance metadata (url/fileRef, author, publishedDate, fetchedAt)
 *   - a content hash so the caller can detect tampering or staleness between fetch and use
 *   - a `trustTier` that controls how aggressively the rail layer (§5.L) audits the payload for prompt-injection
 *   - extraction spans: the [start, end) byte offsets within the fetched content that were actually lifted into context
 *     (a claim is only considered supported if it cites evidence that contributed a span — un-extracted evidence cannot
 *     support a claim even if it exists in the registry)
 *   - `promptInjectionRiskFlags`: strings emitted by the §5.L taint scanner when the content contains patterns that
 *     look like embedded instructions, role-overrides, or data-exfiltration attempts
 *
 * Trust model (note for §5.L / prompt-injection / taint tracking):
 *   - "web" and "mcp" content is UNTRUSTED by default — it comes from outside the operator's control surface and must
 *     be treated as adversarial until the taint scanner clears it.
 *   - "repo" content is "community" by default (still tainted; a project-level allowlist can promote it to "trusted").
 *   - "doc" content sourced from the operator's own corpus may be "trusted", but the caller is responsible for
 *     asserting that; the schema does not auto-promote anything.
 *
 * Citation verification (`verifyCitations`) enforces that every claim in an LLM response is grounded: a claim is
 * `supported` only when every cited evidence id exists in the registry AND that evidence contributed at least one
 * extraction span to the context window. Citing evidence that was fetched but never extracted is treated the same as
 * citing a missing evidence id — both land in `unsupported`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema + inferred type
// ---------------------------------------------------------------------------

/**
 * Wire schema for one retrieved source. Keep in lockstep with `RetrievedEvidence` below.
 *
 * Web/MCP content is UNTRUSTED by default (see module doc + §5.L taint note).
 */
export const retrievedEvidenceSchema = z.object({
	/** The remote URL the content was fetched from (web or MCP resource). */
	url: z.string().optional(),
	/** The repo-relative or absolute file path when the source is a repo/doc file. */
	fileRef: z.string().optional(),
	/** Human-readable title of the source (page title, file name, doc section). */
	title: z.string().optional(),
	/**
	 * The class of source:
	 *   - "web"  — external HTTP/S page (UNTRUSTED by default, §5.L)
	 *   - "repo" — content from a source-code repository ("community" trust by default)
	 *   - "doc"  — operator-supplied documentation corpus ("trusted" when the operator asserts it)
	 *   - "mcp"  — content vended by an MCP tool/resource (UNTRUSTED by default, §5.L)
	 */
	sourceType: z.enum(["web", "repo", "doc", "mcp"]),
	/** Author or owner of the source content, if known. */
	author: z.string().optional(),
	/** ISO-8601 date string indicating when the source was originally published or last updated. */
	publishedDate: z.string().optional(),
	/** ISO-8601 timestamp at which the agent fetched/read this content. */
	fetchedAt: z.string(),
	/**
	 * SHA-256 (or equivalent) hex digest of the raw fetched content.  Used to detect tampering or unexpected mutation
	 * between fetch time and cite time.
	 */
	contentHash: z.string(),
	/**
	 * Trust tier for the §5.L prompt-injection / taint pipeline.
	 *
	 * NOTE: web and mcp sources MUST default to "untrusted" — callers that set a higher tier for those source types
	 * are responsible for demonstrating that the content was retrieved from an operator-controlled surface.
	 */
	trustTier: z.enum(["trusted", "community", "untrusted"]),
	/**
	 * Optional freshness verdict produced by the retrieval-freshness module (§5.X / todo §5.AC).
	 *   - "fresh"   — content is within its declared or heuristic TTL
	 *   - "stale"   — content has exceeded TTL or a newer version was detected
	 *   - "unknown" — TTL could not be determined
	 */
	freshnessVerdict: z.enum(["fresh", "stale", "unknown"]).optional(),
	/**
	 * The byte spans within the fetched content that were extracted into the context window.  A claim citing this
	 * evidence is only considered grounded when at least one span is present (an empty array means the evidence was
	 * fetched but not used — it cannot support any claim).
	 */
	extractionSpans: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })),
	/**
	 * The stable citation ids by which this evidence is referenced in LLM responses.  Populated by the citation
	 * registry before the evidence object enters the context window.
	 */
	citationIds: z.array(z.string()),
	/**
	 * Flags emitted by the §5.L taint scanner.  Each flag is a short token (e.g. "role-override", "exfil-attempt",
	 * "embedded-instruction") that describes the category of injection risk detected in the content.  An empty array
	 * means the scanner found nothing suspicious.
	 */
	promptInjectionRiskFlags: z.array(z.string()),
});

/** One retrieved source, fully annotated for provenance, trust, freshness, and taint. */
export type RetrievedEvidence = z.infer<typeof retrievedEvidenceSchema>;

// Compile-time drift guard: keep the wire schema in lockstep with the named type.
const _guard: z.ZodType<RetrievedEvidence> = retrievedEvidenceSchema;
void _guard;

// ---------------------------------------------------------------------------
// Citation verification
// ---------------------------------------------------------------------------

export interface VerifyCitationsInput {
	/**
	 * The claims to check — each carries an `id` (stable claim identifier, used in the return buckets) and a list of
	 * evidence ids the LLM cited to support it.
	 */
	claims: { id: string; citedEvidenceIds: string[] }[];
	/** The full set of `RetrievedEvidence` objects available in the current context window. */
	evidence: RetrievedEvidence[];
}

export interface VerifyCitationsResult {
	/** Claim ids for which EVERY cited evidence id exists and has at least one extraction span. */
	supported: string[];
	/**
	 * Claim ids for which at least one cited evidence id is missing from `evidence`, OR the evidence exists but has no
	 * extraction spans (fetched but not extracted → cannot ground a claim).
	 */
	unsupported: string[];
}

/**
 * Verify that every claim in an LLM response is grounded by real, extracted evidence.
 *
 * A claim is `supported` when:
 *   1. Every `citedEvidenceId` in the claim resolves to an entry in `evidence` (by `citationIds` membership).
 *   2. Each resolved evidence entry has at least one `extractionSpan` (i.e. it was actually read into context).
 *
 * A claim fails both tests — and lands in `unsupported` — when any cited id is absent, or when it cites evidence
 * that was fetched but never extracted.  Claims with an empty `citedEvidenceIds` array are considered unsupported
 * because they make no citations at all (vacuous grounding is not grounding).
 */
export function verifyCitations(input: VerifyCitationsInput): VerifyCitationsResult {
	// Build a lookup: citationId → RetrievedEvidence.  A single evidence object may carry multiple citation ids.
	const byId = new Map<string, RetrievedEvidence>();
	for (const ev of input.evidence) {
		for (const cid of ev.citationIds) {
			byId.set(cid, ev);
		}
	}

	const supported: string[] = [];
	const unsupported: string[] = [];

	for (const claim of input.claims) {
		// A claim with no citations cannot be supported.
		if (claim.citedEvidenceIds.length === 0) {
			unsupported.push(claim.id);
			continue;
		}

		const isFullyGrounded = claim.citedEvidenceIds.every((cid) => {
			const ev = byId.get(cid);
			// Missing evidence → not grounded.
			if (ev === undefined) {
				return false;
			}
			// Evidence fetched but never extracted → not grounded (§5.AC: spans are the grounding signal).
			return ev.extractionSpans.length > 0;
		});

		if (isFullyGrounded) {
			supported.push(claim.id);
		} else {
			unsupported.push(claim.id);
		}
	}

	return { supported, unsupported };
}
