/**
 * F1.32b evidence feed — the fitness-row → coverage-probe mapping that makes the rail picker's EVIDENCE mode
 * real. Folds the persisted eval-run log into per-model {@link MeasuredEvalCell}s (via the §5.AB aggregation),
 * plans coverage probes with {@link planEvalCoverage}, and derives each model's
 * {@link BackgroundEvalModelEvidence}. Persisted runs carry no timestamp or fingerprint, so cells are stamped
 * `measuredAt: 0` with an unknown fingerprint — the freshness policy then treats them as maximally stale, which
 * is exactly the conservative reading (covered-but-old ranks between uncovered and fresh). Pure over the
 * supplied runs; the caller owns reading the store.
 */

import { type BackgroundEvalModelEvidence, deriveBackgroundEvalModelEvidence } from "./background-eval-selection";
import { aggregateModelEvalRuns, type ModelEvalRun } from "./model-eval-aggregation";
import { type MeasuredEvalCell, planEvalCoverage } from "./model-eval-coverage-plan";

/** Default probe budget per model — enough to expose need ordering without planning the whole matrix. */
const DEFAULT_PROBE_BUDGET = 6;

/** Build each model's evidence (coverage-probe need) from the persisted eval-run rows. */
export function buildBackgroundEvalEvidenceByModel(
	runs: readonly ModelEvalRun[],
	options: { now: number; probeBudgetPerModel?: number },
): Map<string, BackgroundEvalModelEvidence> {
	const budget = Math.max(1, options.probeBudgetPerModel ?? DEFAULT_PROBE_BUDGET);
	const runsByModel = new Map<string, ModelEvalRun[]>();
	for (const run of runs) {
		const bucket = runsByModel.get(run.modelId);
		if (bucket) {
			bucket.push(run);
		} else {
			runsByModel.set(run.modelId, [run]);
		}
	}
	const evidenceByModel = new Map<string, BackgroundEvalModelEvidence>();
	for (const [modelId, modelRuns] of runsByModel) {
		const records = aggregateModelEvalRuns(modelRuns);
		const cells: MeasuredEvalCell[] = [];
		for (const record of records) {
			const tiers = new Set(modelRuns.filter((run) => run.role === record.role).map((run) => run.difficulty));
			for (const tier of tiers) {
				cells.push({
					tier,
					cell: { record, measuredAt: 0, fingerprint: { contextWindow: 0 } },
				});
			}
		}
		const probes = planEvalCoverage({ modelId, existingCells: cells, budget, now: options.now });
		evidenceByModel.set(modelId, deriveBackgroundEvalModelEvidence(probes));
	}
	return evidenceByModel;
}
