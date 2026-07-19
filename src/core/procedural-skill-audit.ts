/**
 * F12.30 — ground-truth-free skill auditing via PAIRED trajectories (SkillAudit; ACE evolving-playbooks).
 *
 * The procedural bank's missing candidate→active promotion SIGNAL when no labeled outcome exists: compare
 * attempts where the procedure was SURFACED against comparable attempts where it was not, on the outcomes the
 * ledger already records (success + turn count + wall time). A procedure that helps shows up as a better success
 * rate — or the same success materially cheaper; one that misleads shows up worse. Thin samples are honestly
 * UNMEASURED (never promote or retire on noise), composing with the F12.29 execution gate: execution validates
 * ONE application, this audit validates the POPULATION.
 *
 * Pure + deterministic; the caller supplies the paired samples (the ledger projection owns matching attempts by
 * task kind — same tags the retrieval used).
 */

export interface SkillTrajectorySample {
	/** Did the attempt reach a clean terminal (awaiting_review via completion, acceptance green, …)? */
	succeeded: boolean;
	/** Model turns consumed (proxy for effort); omit when unknown. */
	turns?: number;
	/** Wall-clock ms; omit when unknown. */
	wallMs?: number;
}

export interface SkillAuditVerdict {
	action: "promote" | "revise" | "retire" | "unmeasured";
	/** with − without success-rate delta in [-1, 1]; null when a side has no samples. */
	successDelta: number | null;
	/** with ÷ without mean-cost ratio (turns preferred, wallMs fallback); null when unknown. */
	costRatio: number | null;
	withSamples: number;
	withoutSamples: number;
	reason: string;
}

const mean = (values: readonly number[]): number | null =>
	values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

function meanCost(samples: readonly SkillTrajectorySample[]): number | null {
	const turns = samples.map((sample) => sample.turns).filter((value): value is number => typeof value === "number");
	if (turns.length > 0) {
		return mean(turns);
	}
	const walls = samples.map((sample) => sample.wallMs).filter((value): value is number => typeof value === "number");
	return mean(walls);
}

/**
 * Audit a procedure from paired trajectories. Defaults: ≥3 samples per side to measure at all; promote at
 * successDelta ≥ +0.15, or equal-success with ≥20% cost saving; retire at successDelta ≤ −0.15 (the procedure
 * actively misleads); everything between ⇒ revise (signal exists but is not decisive either way).
 */
export function auditSkillFromPairedTrajectories(
	withSkill: readonly SkillTrajectorySample[],
	withoutSkill: readonly SkillTrajectorySample[],
	options?: { minSamplesPerSide?: number; promoteDelta?: number; retireDelta?: number; costSavingRatio?: number },
): SkillAuditVerdict {
	const minSamples = options?.minSamplesPerSide ?? 3;
	const promoteDelta = options?.promoteDelta ?? 0.15;
	const retireDelta = options?.retireDelta ?? -0.15;
	const costSavingRatio = options?.costSavingRatio ?? 0.8;
	const base = { withSamples: withSkill.length, withoutSamples: withoutSkill.length };
	if (withSkill.length < minSamples || withoutSkill.length < minSamples) {
		return {
			action: "unmeasured",
			successDelta: null,
			costRatio: null,
			...base,
			reason: `thin sample (${withSkill.length} with / ${withoutSkill.length} without < ${minSamples} per side) — no promote/retire on noise`,
		};
	}
	const withRate = withSkill.filter((sample) => sample.succeeded).length / withSkill.length;
	const withoutRate = withoutSkill.filter((sample) => sample.succeeded).length / withoutSkill.length;
	const successDelta = withRate - withoutRate;
	const withCost = meanCost(withSkill);
	const withoutCost = meanCost(withoutSkill);
	const costRatio = withCost !== null && withoutCost !== null && withoutCost > 0 ? withCost / withoutCost : null;
	if (successDelta >= promoteDelta) {
		return {
			action: "promote",
			successDelta,
			costRatio,
			...base,
			reason: `success ${(withRate * 100).toFixed(0)}% with vs ${(withoutRate * 100).toFixed(0)}% without (Δ+${(successDelta * 100).toFixed(0)}pp)`,
		};
	}
	if (successDelta <= retireDelta) {
		return {
			action: "retire",
			successDelta,
			costRatio,
			...base,
			reason: `success ${(withRate * 100).toFixed(0)}% with vs ${(withoutRate * 100).toFixed(0)}% without (Δ${(successDelta * 100).toFixed(0)}pp) — the procedure misleads`,
		};
	}
	if (Math.abs(successDelta) < promoteDelta && costRatio !== null && costRatio <= costSavingRatio) {
		return {
			action: "promote",
			successDelta,
			costRatio,
			...base,
			reason: `equal success, ×${costRatio.toFixed(2)} cost — the procedure saves ≥${((1 - costSavingRatio) * 100).toFixed(0)}% effort`,
		};
	}
	return {
		action: "revise",
		successDelta,
		costRatio,
		...base,
		reason: `indecisive (Δ${(successDelta * 100).toFixed(0)}pp, cost ×${costRatio?.toFixed(2) ?? "?"}) — revise before re-audit`,
	};
}
