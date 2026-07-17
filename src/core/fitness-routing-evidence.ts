/**
 * Fitness-table routing evidence (§5.AB live consumption; 2026-07-17). The fitness store accumulates SYSTEMATIC
 * per-(model × role × difficulty) sweep evidence, but until now NOTHING on the live selection path read it — the
 * capability blender consumed only organic ledger evidence, so a freshly-swept model (strong measured fitness, zero
 * real tasks yet) routed on its registry prior alone (live-found: gemma-4-31b and ministral tied at the neutral
 * score for every role right after acing the 2026-07-17 sweep). This module projects fitness rows into the SAME
 * evidence shape the blender already consumes; the blender slots it between role-ledger evidence (real tasks beat
 * benchmarks) and the global ledger rollup (benchmarks beat nothing).
 *
 * Key-shape tolerance: fitness rows are written under BARE model ids by the eval harness ("google/gemma-4-31b-qat")
 * and under CANONICAL registry ids by the runtime ("lmstudio:model:http://…/v1"). {@link stableFitnessModelKey}
 * normalizes BOTH the stored key and the router's lookup key onto the bare form, so the two writers and any lookup
 * shape can never miss each other. Pure — the caller reads the store.
 */

import { type FitnessRow, fitnessSuccessRate } from "./fitness-table-schema";
import { roleEvidenceKey } from "./ledger-evidence";

/**
 * Normalize any fitness/registry model-key shape onto the bare model id: strip one leading single-segment provider
 * prefix ("lmstudio:") and one trailing endpoint suffix (":http://…", ":https://…", ":default"). Bare ids (which may
 * contain "/" but no ":") pass through unchanged, so normalizing twice is safe.
 */
export function stableFitnessModelKey(modelKey: string): string {
	const withoutEndpoint = modelKey.replace(/:(?:default|https?:\/\/\S*)$/i, "");
	return withoutEndpoint.replace(/^[a-z0-9_-]+:(?=\S)/i, "");
}

export interface FitnessRoutingEvidence {
	/** Per-(model, role) success rate + samples, keyed by roleEvidenceKey(stableFitnessModelKey(model), role). */
	readonly fitnessRoleSuccessByKey: ReadonlyMap<string, { successRate: number; samples: number }>;
}

/**
 * Aggregate fitness cells into per-(model, role) routing evidence. Difficulty tiers are folded together weighted by
 * their sample counts (difficulty-precise routing would need the blender to know the task difficulty — a later
 * refinement; the role-level rate is what the blender consumes today). Zero-sample cells contribute nothing.
 */
export function buildFitnessRoutingEvidence(rows: readonly FitnessRow[]): FitnessRoutingEvidence {
	const totals = new Map<string, { success: number; samples: number }>();
	for (const row of rows) {
		if (row.sampleCount <= 0) {
			continue;
		}
		const key = roleEvidenceKey(stableFitnessModelKey(row.modelKey), row.role);
		const bucket = totals.get(key) ?? { success: 0, samples: 0 };
		bucket.success += fitnessSuccessRate(row) * row.sampleCount;
		bucket.samples += row.sampleCount;
		totals.set(key, bucket);
	}
	const fitnessRoleSuccessByKey = new Map<string, { successRate: number; samples: number }>();
	for (const [key, bucket] of totals) {
		fitnessRoleSuccessByKey.set(key, { successRate: bucket.success / bucket.samples, samples: bucket.samples });
	}
	return { fitnessRoleSuccessByKey };
}
