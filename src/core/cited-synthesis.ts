/**
 * Cited-answer assembly for the §5.AC retrieval loop — the "synthesize → CITE" step. Given the model's drafted claims
 * (each tagged with the evidence ids it relies on) and the retrieved evidence, produce a rendered answer with numbered
 * `[n]` citation markers + a deduplicated sources list, and surface any claim that cites nothing usable (vacuous
 * grounding is not grounding — cf. `verifyCitations` in retrieved-evidence.ts, which buckets support; this module renders
 * the final cited text). Pure + deterministic — no I/O, no model call.
 *
 * Markers are assigned in order of FIRST citation across the claims, so the same evidence id always reuses its marker.
 */

/** One drafted claim and the evidence ids it cites. */
export interface SynthesisClaim {
	text: string;
	citedEvidenceIds: readonly string[];
}

/** A reference to a retrieved source (the subset needed to render a sources entry). */
export interface SynthesisEvidenceRef {
	id: string;
	title?: string;
	url?: string;
}

/** One entry in the rendered sources list. */
export interface CitedSource {
	marker: number;
	evidenceId: string;
	title?: string;
	url?: string;
}

export interface CitedAnswer {
	/** The claims rendered in order, each suffixed with its `[n]` markers (only for citations that resolve to evidence). */
	answer: string;
	/** The deduplicated sources list, marker-ordered; only evidence that was actually cited AND exists appears. */
	sources: CitedSource[];
	/** Claims whose every cited id was missing/empty — i.e. ungrounded (the texts, in order). */
	uncitedClaims: string[];
}

/**
 * Assemble a cited answer from drafted claims + retrieved evidence. A cited id that does not match any evidence is
 * ignored (it cannot be a source); a claim left with NO resolvable citation is reported in `uncitedClaims`. Inputs are
 * never mutated.
 */
export function assembleCitedAnswer(input: {
	claims: readonly SynthesisClaim[];
	evidence: readonly SynthesisEvidenceRef[];
}): CitedAnswer {
	const evidenceById = new Map<string, SynthesisEvidenceRef>();
	for (const ref of input.evidence) {
		if (!evidenceById.has(ref.id)) {
			evidenceById.set(ref.id, ref);
		}
	}

	const markerByEvidenceId = new Map<string, number>();
	const sources: CitedSource[] = [];
	const renderedClaims: string[] = [];
	const uncitedClaims: string[] = [];

	for (const claim of input.claims) {
		const markers: number[] = [];
		for (const citedId of claim.citedEvidenceIds) {
			const ref = evidenceById.get(citedId);
			if (!ref) {
				continue; // citation to non-existent evidence — not a source.
			}
			let marker = markerByEvidenceId.get(citedId);
			if (marker === undefined) {
				marker = sources.length + 1;
				markerByEvidenceId.set(citedId, marker);
				sources.push({ marker, evidenceId: ref.id, title: ref.title, url: ref.url });
			}
			if (!markers.includes(marker)) {
				markers.push(marker);
			}
		}
		if (markers.length === 0) {
			uncitedClaims.push(claim.text);
			renderedClaims.push(claim.text);
			continue;
		}
		const markerText = markers.map((m) => `[${m}]`).join("");
		renderedClaims.push(`${claim.text} ${markerText}`);
	}

	return { answer: renderedClaims.join("\n"), sources, uncitedClaims };
}
