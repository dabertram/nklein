/**
 * P0.REVRANK — capability-RANKED reviewer / escalation candidate ordering (pure, deterministic, evidence-gated).
 *
 * ── THE DEFECT THIS REPLACES ──
 * `buildReviewerCandidates` ranked the loaded models by catalog CLASS fit alone (kind × tool-use, `role-model-class`).
 * A class score carries no strength: every model of one class ties, and an UNCATALOGUED family lands on the neutral
 * `unknown`/`UNKNOWN` score (42 for the reviewer role) — BELOW any catalogued mid-tier model. Live 2026-09-03: the
 * catalogued 9B (`ornith-1.0-9b`: code/TOOL_CAPABLE → 72) outranked the uncatalogued 27B (`qwen3.8` family → 42) on
 * every review pick, and the stuck-review escalation — which reuses the same list to replace the card's WORKER —
 * "escalated" a 27B's review to the very 9B whose three no-verdict sessions had caused the loop. The evidence that
 * tells the two apart (registry capability, ledger success rates, sweep fitness, runtime verdict) already drove the
 * WORKER router (`createCapabilityBlender` in start-task-session) and never reached this seam.
 *
 * ── THE CONTRACT ──
 *  · **Class fit GATES.** A role-ineligible model (tool-unsuitable for a tool-requiring role) is dropped, never ranked.
 *  · **Capability RANKS.** Candidates with capability evidence order by that blended 0–100 score — the router's own
 *    scale (registry × ledger/fitness × verdict), so a diversity/warmth margin here means what it means for workers.
 *  · **Missing evidence is NEVER a score.** A model that is uncatalogued AND unobserved has `capability: null`; it ranks
 *    AFTER every evidence-ranked candidate (ordered among unknowns by class fit, then serving tie-breaks) and this core
 *    never invents a number for it. `rankable`/`unrankable` are exposed so callers keep margin math on ONE scale — a
 *    flat prior standing in for a measurement is the green-signal substitution (§4A) that "ranked" the 9B.
 *  · **An ESCALATION pick must be STRICTLY stronger** than the model it takes over from, proven on evidence: strictly
 *    higher capability, or equal capability with a strictly better SERVING (lighter quantization, then a larger loaded
 *    context — live 2026-09-05: three instances of one 27B differed only there). An unknown baseline or an unknown
 *    candidate can never be proven stronger, so the escalation is refused with the reason instead of guessed.
 */

export type ReviewerCapabilityBasis = "observed" | "prior";

/** A model's capability claim, with the provenance that keeps a prior from being read as a measurement. */
export interface ReviewerCapabilityEvidence {
	/** 0–100 blended capability (registry × ledger/fitness × runtime verdict — the worker router's scale). */
	score: number;
	/** `observed` when real-run / sweep / eval evidence reached the number; `prior` when only the curated catalog did. */
	basis: ReviewerCapabilityBasis;
	/** Observation count behind the score (0 for a pure prior). */
	samples: number;
	/** One-line provenance for the observation record (e.g. `reviewer ledger 5 samples (60% ok) on prior 50`). */
	detail: string;
}

export interface ReviewerRankingCandidate {
	/** The SERVABLE id (what the launch config needs). */
	modelKey: string;
	/** The REAL publisher key (lineage + catalog identity). */
	modelId: string;
	/** Role class fit (0–100) and eligibility from `scoreModelClassFitForRole`. */
	classFit: { score: number; eligible: boolean };
	/** Capability evidence, or null when nothing is known — never a default. */
	capability: ReviewerCapabilityEvidence | null;
	/** Loaded (else advertised) context length; 0 when unknown. */
	contextLength: number;
	/** 2 for ≤2-bit quants, 1 for 3-bit, 0 otherwise (`quantizationPenalty`). */
	quantPenalty: number;
}

export interface RankedReviewerCandidate {
	modelKey: string;
	modelId: string;
	/**
	 * The ranking score the margin cores (`applyDiversityPreference` / `applyWarmthPreference`) compare: the blended
	 * capability when known, else the class fit. `scoreBasis` names which — the two are different quantities, and this
	 * core's order never compares one against the other (evidence-ranked candidates always precede unrankable ones).
	 */
	score: number;
	scoreBasis: "capability" | "class_fit";
	/** Role class fit (0–100) — the gate signal and the tie-break among equal capabilities. */
	classFit: number;
	capability: ReviewerCapabilityEvidence | null;
	contextLength: number;
	quantPenalty: number;
}

export interface ReviewerRanking {
	/** Best-first: every evidence-ranked candidate, then the unrankable tail. */
	ranked: RankedReviewerCandidate[];
	/** The evidence-ranked subset (capability known). Margin math belongs on this set whenever it is non-empty. */
	rankable: RankedReviewerCandidate[];
	/** Candidates with no capability claim (uncatalogued + unobserved), in their class-fit fallback order. */
	unrankable: RankedReviewerCandidate[];
	/** Class-gate exclusions (role-ineligible), for the observation line. */
	excluded: { modelKey: string; modelId: string; reason: string }[];
}

/** Strength order among the serving facts alone: lighter quantization first, then the larger loaded context. */
function compareServing(a: { quantPenalty: number; contextLength: number }, b: typeof a): number {
	return a.quantPenalty - b.quantPenalty || b.contextLength - a.contextLength;
}

/**
 * The total order: evidence-ranked before unrankable · capability desc · class fit desc · lighter quant · larger
 * context · modelKey. Total (never mixes a capability with a class fit), so the sort is stable and transitive.
 */
function compareRanked(a: RankedReviewerCandidate, b: RankedReviewerCandidate): number {
	const aKnown = a.capability !== null;
	const bKnown = b.capability !== null;
	if (aKnown !== bKnown) {
		return aKnown ? -1 : 1;
	}
	if (a.capability && b.capability && a.capability.score !== b.capability.score) {
		return b.capability.score - a.capability.score;
	}
	return b.classFit - a.classFit || compareServing(a, b) || a.modelKey.localeCompare(b.modelKey);
}

/** Pure: gate by class eligibility, then rank per the module contract. */
export function rankReviewerCandidates(candidates: readonly ReviewerRankingCandidate[]): ReviewerRanking {
	const excluded: ReviewerRanking["excluded"] = [];
	const ranked: RankedReviewerCandidate[] = [];
	for (const candidate of candidates) {
		if (!candidate.classFit.eligible) {
			excluded.push({
				modelKey: candidate.modelKey,
				modelId: candidate.modelId,
				reason: "class-ineligible for the role (tool-unsuitable where the role requires tool use)",
			});
			continue;
		}
		ranked.push({
			modelKey: candidate.modelKey,
			modelId: candidate.modelId,
			score: candidate.capability ? candidate.capability.score : candidate.classFit.score,
			scoreBasis: candidate.capability ? "capability" : "class_fit",
			classFit: candidate.classFit.score,
			capability: candidate.capability,
			contextLength: candidate.contextLength,
			quantPenalty: candidate.quantPenalty,
		});
	}
	ranked.sort(compareRanked);
	return {
		ranked,
		rankable: ranked.filter((candidate) => candidate.capability !== null),
		unrankable: ranked.filter((candidate) => candidate.capability === null),
		excluded,
	};
}

/** The model an escalation takes over from, described on the same facts as the candidates. */
export interface StrictlyStrongerBaseline {
	modelKey: string;
	capability: ReviewerCapabilityEvidence | null;
	contextLength: number;
	quantPenalty: number;
}

export type StrictlyStrongerVerdict =
	| "stronger_capability"
	| "stronger_serving"
	| "not_stronger"
	| "no_evidence"
	| "baseline_unknown";

export interface StrictlyStrongerSelection {
	/** The candidates proven strictly stronger, in ranking order (empty ⇒ refuse, see `refusedReason`). */
	qualified: RankedReviewerCandidate[];
	/** Non-null exactly when `qualified` is empty — the surfaced reason the escalation must not proceed. */
	refusedReason: string | null;
	/** Per-candidate verdicts, ranking order, for the observation record. */
	verdicts: { modelKey: string; verdict: StrictlyStrongerVerdict }[];
}

function judgeStrictlyStronger(
	candidate: RankedReviewerCandidate,
	baseline: StrictlyStrongerBaseline & { capability: ReviewerCapabilityEvidence },
): StrictlyStrongerVerdict {
	if (!candidate.capability) {
		return "no_evidence";
	}
	if (candidate.capability.score > baseline.capability.score) {
		return "stronger_capability";
	}
	if (candidate.capability.score === baseline.capability.score && compareServing(candidate, baseline) < 0) {
		return "stronger_serving";
	}
	return "not_stronger";
}

/**
 * Pure: keep only the candidates PROVEN strictly stronger than `baseline` (see the module contract). The ranking
 * order is preserved, so the first qualified candidate is the strongest available escalation target.
 */
export function selectStrictlyStrongerCandidates(
	ranked: readonly RankedReviewerCandidate[],
	baseline: StrictlyStrongerBaseline,
): StrictlyStrongerSelection {
	const baselineCapability = baseline.capability;
	if (!baselineCapability) {
		return {
			qualified: [],
			refusedReason: `the model being replaced (${baseline.modelKey}) has no capability evidence and no catalog prior — nothing can be proven stronger than an unknown`,
			verdicts: ranked.map((candidate) => ({ modelKey: candidate.modelKey, verdict: "baseline_unknown" })),
		};
	}
	const verdicts = ranked.map((candidate) => ({
		modelKey: candidate.modelKey,
		verdict: judgeStrictlyStronger(candidate, { ...baseline, capability: baselineCapability }),
	}));
	const qualified = ranked.filter(
		(_candidate, index) =>
			verdicts[index]?.verdict === "stronger_capability" || verdicts[index]?.verdict === "stronger_serving",
	);
	return {
		qualified,
		refusedReason:
			qualified.length > 0
				? null
				: `no loaded candidate is strictly stronger than ${baseline.modelKey} (capability ${formatScore(baselineCapability.score)}, ${baselineCapability.basis}${baselineCapability.samples > 0 ? `, ${baselineCapability.samples} samples` : ""}): ${
						verdicts.length > 0
							? verdicts.map((entry) => `${entry.modelKey} ${entry.verdict.replace(/_/g, " ")}`).join("; ")
							: "no other routable model is loaded"
					}`,
		verdicts,
	};
}

function formatScore(score: number): string {
	return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** One-line description of a ranked candidate for observation records: id, score + basis, class fit, serving facts. */
export function describeRankedCandidate(candidate: RankedReviewerCandidate): string {
	const capability = candidate.capability
		? `capability ${formatScore(candidate.capability.score)} (${candidate.capability.basis}${
				candidate.capability.samples > 0 ? `, ${candidate.capability.samples} samples` : ""
			})`
		: "capability unknown";
	const serving = [
		candidate.quantPenalty > 0 ? `quant penalty ${candidate.quantPenalty}` : null,
		candidate.contextLength > 0 ? `ctx ${candidate.contextLength}` : null,
	]
		.filter((part): part is string => part !== null)
		.join(", ");
	return `${candidate.modelKey}: ${capability}, class fit ${candidate.classFit}${serving ? ` [${serving}]` : ""}`;
}
