import { assignReviewLenses, type ReviewLens, shouldStopAddingEyes } from "./review-lenses.js";
import type { PanelVerdictSeverity } from "./review-panel-verdict.js";

/**
 * F1.37 (§5.AW) — orthogonal N-EYES review scheduling, the pure protocol layer over the shipped parts: lenses
 * (orthogonal stances ordered by measured failure mass), the lineage-diverse judge panel, and the majority+veto
 * combine. This module adds what none of them owns:
 *   - the SCHEDULE composer pairing distinct (judge, lens) eyes — model-family diversity × perspective
 *     orthogonality, every eye a distinct pair;
 *   - finding DEDUP/CORROBORATION with the per-eye marginal-value trace that feeds the existing
 *     {@link shouldStopAddingEyes} stopping rule (stop when the last eye added nothing new);
 *   - the BLIND-THEN-CONFER protocol: eyes review blind (no other eye's findings), then each eye receives the
 *     OTHER eyes' deduped findings to confirm/dispute; resolution is majority-of-responders with a FAIL-CLOSED
 *     rule for veto-severity findings (a disputed high/critical security/correctness finding is never silently
 *     dropped — it stays `disputed` for a stronger tie-break, preserving the panel's security veto).
 * Pure + deterministic; the live runner (sequential judge sessions) mounts it as F1.37b.
 */

export interface NEyesJudge {
	judgeModelKey: string;
}

export interface NEyesEye {
	/** Stable id: `eye-<index>` in schedule order. */
	eyeId: string;
	judgeModelKey: string;
	lens: ReviewLens;
}

/**
 * Compose the N-eyes schedule: lenses in failure-mass order (the first N lenses are the most valuable N), judges
 * cycled in the given (diversity-ranked) order, every eye a DISTINCT (judge, lens) pair. Eye count is bounded by
 * `maxEyes` and by lenses×judges (no duplicate pair is ever scheduled).
 */
export function planNEyesSchedule(input: {
	judges: readonly NEyesJudge[];
	reviewerTier: "weak" | "mid" | "strong";
	maxEyes: number;
}): NEyesEye[] {
	const maxEyes = Math.max(0, Math.trunc(input.maxEyes));
	if (maxEyes === 0 || input.judges.length === 0) {
		return [];
	}
	const lenses = assignReviewLenses({ eyes: Number.MAX_SAFE_INTEGER, reviewerTier: input.reviewerTier });
	if (lenses.length === 0) {
		return [];
	}
	// Round-shifted rotation: round r pairs lens i with judge (i + r) — every (judge, lens) pair is unique across
	// all rounds (the offset differs mod judge count), lenses advance eye-to-eye (orthogonality first), and
	// consecutive eyes land on different families whenever more than one judge exists.
	const eyes: NEyesEye[] = [];
	for (let round = 0; round < input.judges.length && eyes.length < maxEyes; round += 1) {
		for (let lensIndex = 0; lensIndex < lenses.length && eyes.length < maxEyes; lensIndex += 1) {
			const judge = input.judges[(lensIndex + round) % input.judges.length];
			eyes.push({ eyeId: `eye-${eyes.length + 1}`, judgeModelKey: judge.judgeModelKey, lens: lenses[lensIndex] });
		}
	}
	return eyes;
}

export interface EyeFinding {
	category: string;
	severity: PanelVerdictSeverity;
	summary: string;
}

export interface EyeFindingsReport {
	eyeId: string;
	findings: readonly EyeFinding[];
}

/** Deterministic dedup key: category + summary normalized (case/punctuation/whitespace-insensitive). */
export function normalizeFindingKey(category: string, summary: string): string {
	const normalizedSummary = summary
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return `${category.trim().toLowerCase()}|${normalizedSummary}`;
}

const SEVERITY_RANK: Record<PanelVerdictSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface DedupedFinding {
	key: string;
	category: string;
	/** The HIGHEST severity any eye assigned (severity never averages down). */
	severity: PanelVerdictSeverity;
	/** The first eye's wording (stable; later duplicates corroborate, they don't rewrite). */
	summary: string;
	corroboratedBy: readonly string[];
}

export interface DedupeEyeFindingsResult {
	unique: readonly DedupedFinding[];
	/** Non-duplicate findings each successive eye added — the input to {@link shouldStopAddingEyes}. */
	newFindingsPerEye: readonly number[];
}

/** Fold the eyes' blind reports (in schedule order) into deduped findings + the per-eye marginal-value trace. */
export function dedupeEyeFindings(reports: readonly EyeFindingsReport[]): DedupeEyeFindingsResult {
	const byKey = new Map<string, { finding: DedupedFinding; corroborators: string[] }>();
	const newFindingsPerEye: number[] = [];
	for (const report of reports) {
		let added = 0;
		for (const finding of report.findings) {
			const key = normalizeFindingKey(finding.category, finding.summary);
			const existing = byKey.get(key);
			if (existing) {
				if (!existing.corroborators.includes(report.eyeId)) {
					existing.corroborators.push(report.eyeId);
				}
				if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.finding.severity]) {
					existing.finding = { ...existing.finding, severity: finding.severity };
				}
				continue;
			}
			byKey.set(key, {
				finding: {
					key,
					category: finding.category,
					severity: finding.severity,
					summary: finding.summary,
					corroboratedBy: [],
				},
				corroborators: [report.eyeId],
			});
			added += 1;
		}
		newFindingsPerEye.push(added);
	}
	return {
		unique: [...byKey.values()].map(({ finding, corroborators }) => ({
			...finding,
			corroboratedBy: [...corroborators],
		})),
		newFindingsPerEye,
	};
}

/** Whether another eye is still worth scheduling (composes the shipped marginal-value stop rule). */
export function shouldScheduleAnotherEye(dedup: DedupeEyeFindingsResult): boolean {
	return !shouldStopAddingEyes(dedup.newFindingsPerEye);
}

export interface ConferAssignment {
	eyeId: string;
	/** The OTHER eyes' findings this eye must confirm/dispute (its own are excluded — no self-confirmation). */
	findingKeys: readonly string[];
}

/** Blind-then-confer phase 2 setup: each eye receives every deduped finding it did NOT itself raise/corroborate. */
export function buildConferAssignments(
	dedup: DedupeEyeFindingsResult,
	eyes: readonly { eyeId: string }[],
): ConferAssignment[] {
	return eyes.map((eye) => ({
		eyeId: eye.eyeId,
		findingKeys: dedup.unique
			.filter((finding) => !finding.corroboratedBy.includes(eye.eyeId))
			.map((finding) => finding.key),
	}));
}

export interface ConferResponse {
	eyeId: string;
	findingKey: string;
	stance: "confirm" | "dispute";
}

export type ConferredFindingStatus = "confirmed" | "disputed" | "dropped";

export interface ConferredFinding extends DedupedFinding {
	status: ConferredFindingStatus;
	confirms: number;
	disputes: number;
}

const VETO_SEVERITIES: ReadonlySet<PanelVerdictSeverity> = new Set<PanelVerdictSeverity>(["high", "critical"]);
const VETO_CATEGORIES: ReadonlySet<string> = new Set(["security", "correctness"]);

/**
 * Resolve the confer round. Corroborators count as implicit confirms; a finding is `dropped` only when disputes
 * OUT-VOTE confirms, `disputed` when any dispute exists without out-voting (it surfaces for arbitration rather
 * than silently standing), and `confirmed` when nobody disputed. FAIL-CLOSED exception: a veto-severity finding
 * in a veto category is NEVER `dropped` — an out-voting majority only marks it `disputed`, so the security veto
 * survives conferring and a stronger tie-break (or a human) makes the final call.
 */
export function resolveConferredFindings(
	dedup: DedupeEyeFindingsResult,
	responses: readonly ConferResponse[],
): ConferredFinding[] {
	return dedup.unique.map((finding) => {
		const confirms =
			finding.corroboratedBy.length +
			responses.filter((response) => response.findingKey === finding.key && response.stance === "confirm").length;
		const disputes = responses.filter(
			(response) => response.findingKey === finding.key && response.stance === "dispute",
		).length;
		let status: ConferredFindingStatus;
		if (disputes > confirms) {
			const isVetoClass =
				VETO_SEVERITIES.has(finding.severity) && VETO_CATEGORIES.has(finding.category.trim().toLowerCase());
			status = isVetoClass ? "disputed" : "dropped";
		} else if (disputes > 0) {
			status = "disputed";
		} else {
			status = "confirmed";
		}
		return { ...finding, status, confirms, disputes };
	});
}
