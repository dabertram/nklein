/**
 * P16.2 — GROUNDED field-report generation with per-claim provenance. PURE core.
 *
 * **This is the keystone: do not ship a Field Report without it.**
 *
 * A Field Report is written by a model over the user's own telemetry. A model asked to summarise 40,000
 * observations will produce fluent, specific, plausible claims — including about things that did not happen. An
 * LLM-written bug report that hallucinates is **worse than no report**: it wastes the maintainer's time, and it
 * poisons the evidence base Phase 15 depends on, because a fabricated pattern is indistinguishable from a real
 * one once it is in the issue tracker.
 *
 * So every claim must carry pointers to the recorded events that support it, and **a claim that cannot be
 * grounded is DROPPED, not softened.** Softening ("possibly", "it appears that") is the tempting middle path and
 * it is the wrong one: it keeps the fabrication while adding deniability, and a hedged claim in a bug report is
 * still read as a lead worth chasing.
 *
 * ── THE SECOND HALF: REPORT THE DROPS ──
 * A generator that silently discards half its claims is as misleading as one that keeps them — the reader sees a
 * short, confident report and cannot tell it was heavily filtered. So the result carries the drop count and the
 * dropped claims, and {@link summarizeGrounding} states the ratio plainly. A high drop rate is itself a finding:
 * it means the model was inventing, and the maintainer should trust the survivors less, not more.
 */

/** A recorded event a claim may cite. Ids come from the caller's own telemetry (observation ids, ledger ids). */
export interface EvidenceRecord {
	readonly id: string;
	/** Coarse kind, echoed into the provenance so a reader can see WHAT sort of evidence backs a claim. */
	readonly kind: string;
}

export interface DraftClaim {
	readonly text: string;
	/** Evidence ids the generator asserts support this claim. May be empty, wrong, or invented — all handled. */
	readonly citedEvidenceIds: readonly string[];
}

export type DropReason = "no_citations" | "unknown_evidence" | "insufficient_citations";

export interface GroundedClaim {
	readonly text: string;
	/** Evidence that actually EXISTS, resolved from the cited ids. */
	readonly evidence: readonly EvidenceRecord[];
}

export interface DroppedClaim {
	readonly text: string;
	readonly reason: DropReason;
	readonly detail: string;
}

export interface GroundingResult {
	readonly grounded: readonly GroundedClaim[];
	readonly dropped: readonly DroppedClaim[];
	readonly dropRate: number;
	readonly summary: string;
}

export interface GroundingOptions {
	/**
	 * Minimum surviving citations a claim needs. Default 1. Raising it is the honest lever when a model is
	 * observed citing a single unrelated event to justify a broad claim.
	 */
	readonly minCitations?: number;
}

/**
 * Ground a set of draft claims against the evidence that actually exists.
 *
 * Never throws, and never repairs a claim: an unsupported claim is removed whole. Partial repair (keeping the
 * claim, dropping the bad citation) would leave a claim that LOOKS cited while resting on nothing.
 */
export function groundClaims(
	claims: readonly DraftClaim[],
	evidence: readonly EvidenceRecord[],
	options: GroundingOptions = {},
): GroundingResult {
	const minCitations = Math.max(1, options.minCitations ?? 1);
	const byId = new Map(evidence.map((record) => [record.id, record]));
	const grounded: GroundedClaim[] = [];
	const dropped: DroppedClaim[] = [];

	for (const claim of claims) {
		if (claim.citedEvidenceIds.length === 0) {
			dropped.push({
				text: claim.text,
				reason: "no_citations",
				detail:
					"the claim cited no evidence at all — an uncited claim in a bug report is a guess presented as an observation",
			});
			continue;
		}
		const resolved = claim.citedEvidenceIds
			.map((id) => byId.get(id))
			.filter((record): record is EvidenceRecord => record !== undefined);
		const unknown = claim.citedEvidenceIds.length - resolved.length;

		if (resolved.length === 0) {
			dropped.push({
				text: claim.text,
				reason: "unknown_evidence",
				detail: `all ${claim.citedEvidenceIds.length} cited id(s) match no recorded event — the model invented its own provenance`,
			});
			continue;
		}
		if (resolved.length < minCitations) {
			dropped.push({
				text: claim.text,
				reason: "insufficient_citations",
				detail: `${resolved.length} surviving citation(s), ${minCitations} required${unknown > 0 ? ` (${unknown} cited id(s) did not exist)` : ""}`,
			});
			continue;
		}
		grounded.push({ text: claim.text, evidence: resolved });
	}

	const total = claims.length;
	const dropRate = total === 0 ? 0 : dropped.length / total;

	return { grounded, dropped, dropRate, summary: summarizeGrounding(grounded.length, dropped.length) };
}

/**
 * State the grounding ratio plainly. A HIGH drop rate is itself a finding — it means the model was inventing,
 * and the survivors deserve less trust rather than more.
 */
export function summarizeGrounding(groundedCount: number, droppedCount: number): string {
	const total = groundedCount + droppedCount;
	if (total === 0) {
		return "No claims were generated.";
	}
	if (droppedCount === 0) {
		return `All ${total} claim(s) are grounded in recorded events.`;
	}
	const pct = Math.round((droppedCount / total) * 100);
	const warning =
		pct >= 50
			? " **Over half the generated claims were ungrounded — the model was largely inventing, so treat the surviving claims with MORE suspicion, not less.**"
			: "";
	return `${groundedCount} of ${total} claim(s) grounded; ${droppedCount} (${pct}%) DROPPED as unsupported.${warning}`;
}

/**
 * Render a claim with its provenance for the review surface, so a user can check the reading themselves rather
 * than trusting the generator. Provenance is shown as evidence ids + kinds — never as prose, which could itself
 * be fabricated.
 */
export function renderClaimWithProvenance(claim: GroundedClaim): string {
	const cites = claim.evidence.map((record) => `${record.kind}:${record.id}`).join(", ");
	return `${claim.text}  [${cites}]`;
}
