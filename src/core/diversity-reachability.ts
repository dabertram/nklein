import { applyDiversityPreference, type DiversityCandidate, type DiversityPreferenceResult } from "./model-diversity";
import { type ModelLineage, resolveLineage } from "./model-lineage";

/**
 * §5.AB reasoning-diversity PRE-CHECK (audit 2026-07-02 follow-on): the self-review GUARD that answers a question
 * {@link applyDiversityPreference} does not — *is a diverse reviewer even reachable in this pool at all?* — BEFORE the
 * margin-bounded re-rank decides which one to pick. The re-ranker will happily "waive" diversity when the whole fleet
 * shares the author's lineage; that waiver reads as a soft signal. This core makes the HARD fact explicit: a qwen-only
 * pool asked to review qwen work has NO uncorrelated second opinion — the reviewer would be judging its own family.
 *
 * COMPOSES BY IMPORT ONLY (adds a reporting layer; re-implements nothing):
 * - {@link resolveLineage} to collapse each candidate's REAL model id to its coarse lineage.
 * - {@link applyDiversityPreference} for the actual ordered pick + waiver rationale (returned verbatim as `preference`).
 *
 * SEMANTICS (PRIME DIRECTIVE #1: pure/deterministic — no I/O, no clock, no randomness; input order preserved):
 * - `hasFullCoverage` — true when at least ONE candidate resolves to a lineage that is NOT in `avoidLineages` (and is
 *   not `unknown`, which is never counted as a guaranteed-diverse second opinion — a per-machine alias might be a
 *   same-family model in disguise). This is exactly "a diverse reviewer is reachable". False on an empty pool.
 * - `missingLineages` — the avoided lineages the pool CANNOT escape: each `avoidLineages` entry (excluding `unknown`,
 *   which carries no information) that is actually PRESENT among the candidates, reported ONLY when coverage failed.
 *   On the self-review centerpiece (a single-lineage pool whose lineage is avoided) this names that trapping lineage,
 *   proving the guard fired for a concrete reason. Empty whenever coverage succeeds (nothing is blocking).
 */

/** The pre-check verdict: reachability facts plus the delegated ordered pick. */
export interface DiversityReachabilityResult {
	/** True when at least one candidate has a known lineage outside `avoidLineages` — a diverse reviewer is reachable. */
	hasFullCoverage: boolean;
	/** Avoided lineages present in the pool that block coverage (names the trapping family); empty when covered. */
	missingLineages: ModelLineage[];
	/** The delegated margin-bounded re-rank result — the actual ordered pick + surfaced waiver reason. */
	preference: DiversityPreferenceResult;
}

/**
 * Report whether a lineage-diverse reviewer is REACHABLE in this candidate pool, then delegate the ordered pick to
 * {@link applyDiversityPreference}. Pure and deterministic. `unknown` lineages never count toward coverage and
 * `unknown` in the avoid set is dropped (it can neither be avoided meaningfully nor block a diverse pick).
 */
export function assessDiversityReachability(input: {
	/** The reviewer candidate pool (fit order is preserved and handed to the delegate as-is). */
	candidates: readonly DiversityCandidate[];
	/** Lineages whose judgment would be correlated with the work under review (author/architect lineages). */
	avoidLineages: readonly ModelLineage[];
}): DiversityReachabilityResult {
	// Distinct KNOWN lineages actually present in the pool — `unknown` is excluded (non-diverse-safe).
	const presentLineages = new Set<ModelLineage>();
	for (const candidate of input.candidates) {
		const lineage = resolveLineage(candidate.modelId);
		if (lineage !== "unknown") {
			presentLineages.add(lineage);
		}
	}

	// `unknown` in the avoid set carries no information — mirror the delegate and drop it. Typed as the full
	// `ModelLineage` union (not the narrowed post-filter element type) so `.has(lineage)` accepts a resolved lineage
	// that could be `unknown` — mirrors the delegate's `ReadonlySet<ModelLineage>` widening in model-diversity.ts.
	const avoid = new Set<ModelLineage>(input.avoidLineages.filter((lineage) => lineage !== "unknown"));

	// A diverse reviewer is reachable iff some present lineage is NOT one we must avoid.
	const hasFullCoverage = [...presentLineages].some((lineage) => !avoid.has(lineage));

	// When (and only when) coverage failed, name the avoided lineages the pool is actually TRAPPED in — the concrete
	// reason no uncorrelated reviewer exists (the self-review guard's evidence). Preserve avoid-set input order.
	const missingLineages: ModelLineage[] = hasFullCoverage
		? []
		: [...avoid].filter((lineage) => presentLineages.has(lineage));

	// Delegate the actual ordered pick — re-implement nothing; the delegate owns the margin/waiver logic and rationale.
	const preference = applyDiversityPreference({
		ranked: input.candidates,
		avoidLineages: input.avoidLineages,
	});

	return { hasFullCoverage, missingLineages, preference };
}
