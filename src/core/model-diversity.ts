import { type ModelLineage, resolveLineage } from "./model-lineage";

/**
 * §5.AB reasoning-diversity re-ranking for DECISION roles (audit 2026-07-02 W0.4). Given a fit-ranked candidate
 * list for a reviewer/verifier/judge pick, prefer a candidate whose lineage differs from the models whose work is
 * being judged (`avoidLineages` — typically the author/architect lineages), so the second opinion is UNCORRELATED.
 *
 * DECIDED 2026-07-02: margin-bounded HARD preference — a diverse candidate is promoted over a same-lineage one
 * whenever it is within `marginPts` fit points of the top candidate (default 15), so diversity never forces a badly
 * unfit reviewer (research: diverse-but-below-floor = negative synergy). When no diverse candidate clears the
 * margin, the original order stands and `diversityWaivedReason` says why — the waiver is a SURFACED signal (ledger/
 * operator), never silent. Applies to decision roles only; workers/generation keep pure fit ranking (Self-MoA).
 */

export interface DiversityCandidate {
	/** The routing key (registry key) — opaque here. */
	modelKey: string;
	/** The REAL model id (used for lineage resolution — not a per-machine alias). */
	modelId: string;
	/** Fit score, higher is better (same scale as the input ranking). */
	score: number;
}

export interface DiversityPreferenceResult {
	/** The (possibly re-ordered) ranking, best-first. */
	ranked: readonly DiversityCandidate[];
	/** True when the top pick's lineage is known and outside `avoidLineages`. */
	diversityAchieved: boolean;
	/** Non-null when diversity could not be achieved — the surfaced waiver reason. */
	diversityWaivedReason: string | null;
	/** One-line rationale for the decision (for model-selection-reason / the ledger). */
	rationale: string;
}

const DEFAULT_MARGIN_PTS = 15;

/** Is this candidate a guaranteed-diverse pick (KNOWN lineage, not in the avoid set)? Unknown is non-diverse-safe. */
function isDiverse(candidate: DiversityCandidate, avoid: ReadonlySet<ModelLineage>): boolean {
	const lineage = resolveLineage(candidate.modelId);
	return lineage !== "unknown" && !avoid.has(lineage);
}

export function applyDiversityPreference(input: {
	/** Fit-ranked candidates, best-first. */
	ranked: readonly DiversityCandidate[];
	/** Lineages whose judgment would be correlated with the work under review (author/architect lineages). */
	avoidLineages: readonly ModelLineage[];
	/** Max fit-point deficit a diverse candidate may have vs the top pick and still be promoted. */
	marginPts?: number;
}): DiversityPreferenceResult {
	const margin = input.marginPts ?? DEFAULT_MARGIN_PTS;
	// `unknown` in the avoid set carries no information — drop it so it can't block everything.
	const avoid = new Set(input.avoidLineages.filter((lineage) => lineage !== "unknown"));
	const top = input.ranked[0];
	if (!top) {
		return {
			ranked: input.ranked,
			diversityAchieved: false,
			diversityWaivedReason: "no candidates",
			rationale: "No candidates to rank.",
		};
	}
	if (avoid.size === 0) {
		return {
			ranked: input.ranked,
			diversityAchieved: isDiverse(top, avoid),
			diversityWaivedReason: null,
			rationale: "No lineages to avoid — fit ranking stands.",
		};
	}
	if (isDiverse(top, avoid)) {
		return {
			ranked: input.ranked,
			diversityAchieved: true,
			diversityWaivedReason: null,
			rationale: `Top candidate ${top.modelId} (${resolveLineage(top.modelId)}) is already lineage-diverse.`,
		};
	}
	const promoted = input.ranked.find(
		(candidate) => isDiverse(candidate, avoid) && top.score - candidate.score <= margin,
	);
	if (promoted) {
		return {
			ranked: [promoted, ...input.ranked.filter((candidate) => candidate !== promoted)],
			diversityAchieved: true,
			diversityWaivedReason: null,
			rationale:
				`Promoted ${promoted.modelId} (${resolveLineage(promoted.modelId)}) over ${top.modelId} ` +
				`(${resolveLineage(top.modelId)}) for lineage diversity (${(top.score - promoted.score).toFixed(1)} pts ≤ margin ${margin}).`,
		};
	}
	const anyDiverse = input.ranked.some((candidate) => isDiverse(candidate, avoid));
	return {
		ranked: input.ranked,
		diversityAchieved: false,
		diversityWaivedReason: anyDiverse
			? `no lineage-diverse candidate within ${margin} fit points of ${top.modelId}`
			: "no lineage-diverse candidate available (single-lineage fleet)",
		rationale: `Diversity waived — same-lineage top pick ${top.modelId} stands (surface this to the operator/ledger).`,
	};
}
