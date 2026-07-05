/**
 * §5.AR — provenance stamping + provenance-weighted RECALL for authored (basic-memory) notes. Because a note is
 * model-written free-form prose, trusting it blindly is the failure mode; provenance makes each note self-describing
 * (who wrote it, in which task, at which commit, when) and carries the §5.AW audit verdict, so recall can PREFER
 * verified notes, DE-WEIGHT unaudited/unverifiable ones, DROP contradicted ones, and decay stale ones. Pure + total.
 */

import { type MemoryAuditVerdict, recallWeightForVerdict } from "./memory-audit.js";

/** Provenance stamped into a note's YAML frontmatter so recall can weight it by origin, age, and audit verdict. */
export interface NoteProvenance {
	/** The model key that authored the note. */
	authoredBy: string;
	/** The task/card the note was written during. */
	taskId: string;
	/** ISO timestamp of authoring (passed in — this module has no clock). */
	createdAtIso: string;
	/** The repo commit at authoring time — a staleness anchor (null when unknown). */
	commitSha?: string | null;
	/** The §5.AW audit verdict, set once the memory_audit runs (null ⇒ not yet audited). */
	auditVerdict?: MemoryAuditVerdict | null;
}

/** The recall trust weight for a note that has NOT yet been audited: kept, but below a confirmed note. */
export const UNAUDITED_RECALL_WEIGHT = 0.5;

/** Escape a YAML scalar minimally (quote + backslash) so provenance values can't break the frontmatter block. */
function yamlScalar(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Render provenance as a YAML frontmatter block to prepend to a basic-memory note (markdown = source of truth). */
export function renderProvenanceFrontmatter(provenance: NoteProvenance): string {
	const lines = [
		"---",
		`authored_by: ${yamlScalar(provenance.authoredBy)}`,
		`task_id: ${yamlScalar(provenance.taskId)}`,
		`created_at: ${yamlScalar(provenance.createdAtIso)}`,
		`commit: ${provenance.commitSha ? yamlScalar(provenance.commitSha) : "null"}`,
		`audit_verdict: ${provenance.auditVerdict ? yamlScalar(provenance.auditVerdict) : "null"}`,
		"---",
	];
	return lines.join("\n");
}

/** The recall trust weight for a note's audit verdict — an unaudited note gets {@link UNAUDITED_RECALL_WEIGHT}. */
export function verdictRecallWeight(verdict: MemoryAuditVerdict | null | undefined): number {
	return verdict ? recallWeightForVerdict(verdict) : UNAUDITED_RECALL_WEIGHT;
}

/** Exponential age decay in (0,1]: 1 for a fresh note, 0.5 at one half-life, approaching 0 for very old notes. */
export function ageDecay(ageDays: number, halfLifeDays = 90): number {
	const age = Math.max(0, ageDays);
	const halfLife = halfLifeDays > 0 ? halfLifeDays : 90;
	return 0.5 ** (age / halfLife);
}

/** A note surfaced by a basic-memory search, with the provenance signals recall weighting needs. */
export interface RecallCandidate {
	ref: string;
	/** The raw search relevance (FTS/semantic score) from basic-memory. */
	baseRelevance: number;
	/** The note's audit verdict (null ⇒ not yet audited). */
	auditVerdict: MemoryAuditVerdict | null;
	/** How old the note is, in days. */
	ageDays: number;
}

export interface WeightedRecall extends RecallCandidate {
	/** baseRelevance × verdictWeight × ageDecayFactor. */
	effectiveScore: number;
	/** The trust multiplier from the audit verdict (surfaced for the "why recalled" explanation). */
	verdictWeight: number;
	/** The freshness multiplier from age decay (surfaced for the "why recalled" explanation). */
	ageDecayFactor: number;
}

export interface DeweightRecallOptions {
	halfLifeDays?: number;
	/** Drop contradicted notes entirely (default true) — a disproven note should never surface as authoritative. */
	dropContradicted?: boolean;
}

/**
 * Provenance-weighted recall (pure): effectiveScore = baseRelevance × verdictWeight × ageDecay, contradicted notes
 * dropped (unless disabled), sorted best-first (ties keep input order — a stable sort). This is how a verified note
 * outranks an unaudited one and a fresh note outranks a stale one, so later sessions surface trustworthy memory first.
 */
export function deweightRecall(
	candidates: readonly RecallCandidate[],
	options: DeweightRecallOptions = {},
): WeightedRecall[] {
	const dropContradicted = options.dropContradicted ?? true;
	const weighted: WeightedRecall[] = candidates
		.filter((candidate) => !(dropContradicted && candidate.auditVerdict === "contradicted"))
		.map((candidate) => {
			const verdictWeight = verdictRecallWeight(candidate.auditVerdict);
			const ageDecayFactor = ageDecay(candidate.ageDays, options.halfLifeDays);
			return {
				...candidate,
				verdictWeight,
				ageDecayFactor,
				effectiveScore: candidate.baseRelevance * verdictWeight * ageDecayFactor,
			};
		});
	return weighted
		.map((candidate, index) => ({ candidate, index }))
		.sort((a, b) => b.candidate.effectiveScore - a.candidate.effectiveScore || a.index - b.index)
		.map((entry) => entry.candidate);
}

/**
 * "Why recalled" (§5.M) — a short human-readable explanation of why a note surfaced where it did, from its recall
 * components: the raw search relevance, the audit-verdict trust multiplier, and the freshness (age-decay) multiplier.
 * Pure. Surfacing the reason is a memory-governance requirement — a recalled memory should never be an opaque assertion.
 */
export function explainRecall(recall: WeightedRecall): string {
	const trust =
		recall.auditVerdict === "confirmed"
			? "audit-confirmed"
			: recall.auditVerdict === "unverifiable"
				? "unverifiable (de-weighted)"
				: recall.auditVerdict === "contradicted"
					? "audit-contradicted"
					: "unaudited (de-weighted)";
	const freshness =
		recall.ageDecayFactor >= 0.95
			? "fresh"
			: recall.ageDecayFactor >= 0.5
				? `aging (${Math.round(recall.ageDays)}d)`
				: `stale (${Math.round(recall.ageDays)}d)`;
	return (
		`relevance ${recall.baseRelevance.toFixed(2)} × trust ${recall.verdictWeight.toFixed(2)} (${trust}) × ` +
		`freshness ${recall.ageDecayFactor.toFixed(2)} (${freshness}) = ${recall.effectiveScore.toFixed(2)}`
	);
}
