/**
 * F3.35 — capability-ceiling model recommendations (pure). When the LOADED fleet cannot clear a role's quality bar
 * (every candidate's confidence sits below the threshold), grinding harder won't help — the fix is a better model. This
 * core detects that ceiling per role and emits a propose-only recommendation (raise the loaded fleet), so the operator
 * (or the F3.34 research flow) knows WHICH role is under-served and by how much.
 *
 * Pure + deterministic. The caller supplies the role bars + the per-(role, model) confidence from the fitness store
 * (the same data `nklein dev advice` surfaces); this returns the ceiling verdicts.
 */

export interface RoleQualityBar {
	readonly role: string;
	/** 0..1 minimum confidence a model must reach to be "sufficient" for this role. */
	readonly minConfidence: number;
}

export interface FleetModelFitness {
	readonly modelKey: string;
	readonly role: string;
	/** 0..1 confidence (e.g. Wilson lower bound) for this (model, role). */
	readonly qualityConfidence: number;
	/** Whether this model is currently loaded on the fleet (only loaded models can clear a bar right now). */
	readonly loaded: boolean;
}

export type CeilingStatus = "sufficient" | "ceiling_hit" | "no_evidence";

export interface CapabilityCeilingVerdict {
	readonly role: string;
	readonly status: CeilingStatus;
	/** The best LOADED model for the role + its confidence, or null when none is loaded/measured. */
	readonly bestLoaded: { readonly modelKey: string; readonly confidence: number } | null;
	/** How far the best loaded model falls short of the bar (0 when sufficient/none). */
	readonly shortfall: number;
	/** Propose-only recommendation text (empty unless the ceiling is hit). */
	readonly recommendation: string;
}

export function assessCapabilityCeiling(
	bars: readonly RoleQualityBar[],
	fitness: readonly FleetModelFitness[],
): CapabilityCeilingVerdict[] {
	return bars.map((bar) => {
		const loadedForRole = fitness.filter((f) => f.role === bar.role && f.loaded);
		if (loadedForRole.length === 0) {
			return {
				role: bar.role,
				status: "no_evidence",
				bestLoaded: null,
				shortfall: 0,
				recommendation: "",
			};
		}
		const best = loadedForRole.reduce((top, f) => (f.qualityConfidence > top.qualityConfidence ? f : top));
		const bestLoaded = { modelKey: best.modelKey, confidence: best.qualityConfidence };
		if (best.qualityConfidence >= bar.minConfidence) {
			return { role: bar.role, status: "sufficient", bestLoaded, shortfall: 0, recommendation: "" };
		}
		const shortfall = bar.minConfidence - best.qualityConfidence;
		return {
			role: bar.role,
			status: "ceiling_hit",
			bestLoaded,
			shortfall,
			recommendation:
				`Capability ceiling for "${bar.role}": best loaded model ${best.modelKey} at ${best.qualityConfidence.toFixed(2)} ` +
				`is ${shortfall.toFixed(2)} below the ${bar.minConfidence.toFixed(2)} bar — load a stronger model for this role ` +
				`(the fleet cannot clear it as loaded).`,
		};
	});
}

/** Just the roles whose ceiling is hit (most-shortfall first) — the actionable subset for the operator surface. */
export function ceilingHitRoles(verdicts: readonly CapabilityCeilingVerdict[]): CapabilityCeilingVerdict[] {
	return verdicts
		.filter((v) => v.status === "ceiling_hit")
		.sort((a, b) => b.shortfall - a.shortfall || a.role.localeCompare(b.role));
}
