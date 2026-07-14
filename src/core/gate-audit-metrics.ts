/**
 * Gate audit metrics (pure) — ported from opencode-swarm's gate-audit / gate-stats. !Klein's eval-harness measures a
 * MODEL's fitness; this measures a GATE's decision quality — how good the reviewer / delivery gate is at telling real
 * defects from clean work. Given labeled outcomes (each: did the gate reject? was there actually a defect?), it folds
 * the confusion matrix and derives the rates that matter for tuning a gate:
 *
 *   - catch rate (recall)  — of the real defects, what fraction did the gate reject?  TP / (TP + FN)
 *   - false-reject rate    — of the clean work, what fraction did the gate wrongly hold?  FP / (FP + TN)
 *   - precision            — of the gate's rejects, what fraction were real defects?  TP / (TP + FP)
 *
 * A high false-reject rate is the specific failure the reviewer-ceiling notes warn about (a gate that holds good work
 * churns the pipeline). Pure + deterministic: the caller assembles labeled outcomes from the ledger + ground truth
 * (e.g. an eval fixture, or a human adjudication) and hands them in.
 */

export interface GateOutcome {
	/** Which gate produced the decision (e.g. "reviewer", "placeholder_scan", "quality_budget"). */
	readonly gate: string;
	/** Whether the gate REJECTED / held the card (its positive prediction). */
	readonly predictedReject: boolean;
	/** Ground truth: whether the card ACTUALLY contained a defect the gate should have caught. */
	readonly actualDefect: boolean;
}

export interface GateStats {
	readonly total: number;
	/** Rejected AND actually defective — correctly caught. */
	readonly truePositive: number;
	/** Rejected but actually clean — a false reject (churn). */
	readonly falsePositive: number;
	/** Passed AND actually clean — correctly passed. */
	readonly trueNegative: number;
	/** Passed but actually defective — a missed defect (the dangerous miss). */
	readonly falseNegative: number;
	/** TP / (TP + FN); null when there were no real defects to catch. */
	readonly catchRate: number | null;
	/** FP / (FP + TN); null when there was no clean work to wrongly reject. */
	readonly falseRejectRate: number | null;
	/** TP / (TP + FP); null when the gate rejected nothing. */
	readonly precision: number | null;
}

export interface GateAuditReport {
	readonly overall: GateStats;
	/** Per-gate stats, keyed by gate name (sorted by name for stable output). */
	readonly perGate: Readonly<Record<string, GateStats>>;
}

function emptyTally(): { tp: number; fp: number; tn: number; fn: number } {
	return { tp: 0, fp: 0, tn: 0, fn: 0 };
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function toStats(tally: { tp: number; fp: number; tn: number; fn: number }): GateStats {
	const { tp, fp, tn, fn } = tally;
	return {
		total: tp + fp + tn + fn,
		truePositive: tp,
		falsePositive: fp,
		trueNegative: tn,
		falseNegative: fn,
		catchRate: ratio(tp, tp + fn),
		falseRejectRate: ratio(fp, fp + tn),
		precision: ratio(tp, tp + fp),
	};
}

export function aggregateGateAudit(outcomes: readonly GateOutcome[]): GateAuditReport {
	const overall = emptyTally();
	const byGate = new Map<string, { tp: number; fp: number; tn: number; fn: number }>();

	for (const outcome of outcomes) {
		const tally = byGate.get(outcome.gate) ?? emptyTally();
		const bucket =
			outcome.predictedReject && outcome.actualDefect
				? "tp"
				: outcome.predictedReject && !outcome.actualDefect
					? "fp"
					: !outcome.predictedReject && outcome.actualDefect
						? "fn"
						: "tn";
		tally[bucket] += 1;
		overall[bucket] += 1;
		byGate.set(outcome.gate, tally);
	}

	const perGate: Record<string, GateStats> = {};
	for (const gate of [...byGate.keys()].sort()) {
		const tally = byGate.get(gate);
		if (tally) {
			perGate[gate] = toStats(tally);
		}
	}

	return { overall: toStats(overall), perGate };
}
