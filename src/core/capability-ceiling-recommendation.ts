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

// ── F3.35 enrichment: name the exact promising NOT-loaded catalog model per under-served role ──────────────────────
//
// The detection half above says WHICH role is under-served and by how much. The enrichment answers "so load WHAT,
// WHERE?": cross-reference the fleet eval catalog (the role×model capability matrix produced by the model sweep) for a
// not-currently-loaded model that (a) actually out-performs the best loaded model for the role, (b) fits its home
// machine's memory, and (c) carries enough eval evidence to trust. Propose-only — this NEVER loads/downloads anything.

/** One (model, role) capability cell from the fleet eval catalog — the sweep's per-model role scores. */
export interface CatalogModelCandidate {
	readonly modelKey: string;
	readonly role: string;
	/** 0..1 measured capability for this (model, role) from the eval catalog (e.g. graded mean or Wilson lower bound). */
	readonly measuredCapability: number;
	/** The machine/pool this model lives on (its home endpoint). */
	readonly machine: string;
	/** On-disk size in GB — the load-footprint proxy checked against the machine's usable memory. */
	readonly sizeGB: number;
	/** How many eval samples backed `measuredCapability` — drives the uncertainty label. */
	readonly samples: number;
	/** Whether this model is currently loaded. A ceiling upgrade must recommend a NOT-loaded model (loaded ones are already in play). */
	readonly loaded: boolean;
	/**
	 * The measurement was resource-constrained (e.g. a >VRAM model that CPU-offloaded), so its score is unreliable and
	 * this candidate is excluded from recommendations. See the model-sweep gotcha on legion5pro VRAM limits.
	 */
	readonly measurementUnreliable?: boolean;
}

/** Usable memory budget per machine — the "fleet RAM map" the fit check needs. */
export interface MachineMemory {
	readonly machine: string;
	/** Usable memory (GB) available to load a model on this machine. */
	readonly usableGB: number;
}

export type UpgradeConfidence = "high" | "medium" | "low";

export interface CeilingUpgradeRecommendation {
	readonly role: string;
	/** The recommended not-loaded catalog model. */
	readonly candidateModelKey: string;
	readonly targetMachine: string;
	/** The candidate's measured 0..1 capability for the role. */
	readonly expectedCapability: number;
	/** expectedCapability minus the best loaded model's confidence — the projected gain from loading it. */
	readonly projectedGain: number;
	/** Uncertainty label from the backing sample count. */
	readonly confidence: UpgradeConfidence;
	/** Whether the candidate fits its home machine's usable memory (sizeGB ≤ usableGB). */
	readonly fitsTargetMachine: boolean;
	readonly candidateSizeGB: number;
	/** Propose-only recommendation text. */
	readonly recommendation: string;
}

/** One aggregated fitness observation per (model, role) — the enrichment's capability+samples input. */
export interface RoleFitnessSample {
	readonly modelKey: string;
	readonly role: string;
	readonly successCount: number;
	readonly sampleCount: number;
}

/** A downloaded-model catalog entry (machine + size) — the enrichment's fit input (e.g. from `parseLmsLsCatalog`). */
export interface CatalogEntry {
	readonly modelKey: string;
	readonly device: string;
	readonly sizeGB: number;
}

/**
 * Build the upgrade candidates by joining per-(model, role) fitness aggregates with the downloaded-model catalog
 * (machine + size). Aggregates the passed fitness samples per (model, role) first (so difficulty-tier rows collapse to
 * one capability = success rate + total samples), then keeps only models present in the catalog (fit needs machine +
 * size). Pure. The shared builder both the CLI and the runtime API use so their enrichment can't drift.
 */
export function buildUpgradeCandidatesFromFitness(
	fitnessSamples: readonly RoleFitnessSample[],
	catalog: readonly CatalogEntry[],
	isLoaded: (modelKey: string) => boolean,
): CatalogModelCandidate[] {
	const catalogByKey = new Map(catalog.map((c) => [c.modelKey, c]));
	const agg = new Map<string, { modelKey: string; role: string; success: number; samples: number }>();
	for (const s of fitnessSamples) {
		const key = `${s.modelKey}::${s.role}`;
		const cur = agg.get(key) ?? { modelKey: s.modelKey, role: s.role, success: 0, samples: 0 };
		cur.success += s.successCount;
		cur.samples += s.sampleCount;
		agg.set(key, cur);
	}
	const candidates: CatalogModelCandidate[] = [];
	for (const { modelKey, role, success, samples } of agg.values()) {
		const cat = catalogByKey.get(modelKey);
		if (!cat || samples <= 0) {
			continue;
		}
		candidates.push({
			modelKey,
			role,
			measuredCapability: Math.min(1, Math.max(0, success / samples)),
			machine: cat.device,
			sizeGB: cat.sizeGB,
			samples,
			loaded: isLoaded(modelKey),
		});
	}
	return candidates;
}

/**
 * The full fleet-upgrade computation, shared by the CLI and the runtime API so their enrichment can't drift: aggregate
 * the fitness samples per (model, role) → detect which roles the LOADED fleet can't clear (success-rate vs bar) → for
 * each hit role, name the best not-loaded catalog upgrade that fits. Pure over its gathered inputs (the caller does the
 * effectful reads: fitness store, `lms ls`, `lms ps`, RAM map). `deviceRamGB` maps machine → usable GB.
 */
export function computeFleetCapabilityUpgrades(input: {
	readonly fitnessSamples: readonly RoleFitnessSample[];
	readonly catalog: readonly CatalogEntry[];
	readonly deviceRamGB: Readonly<Record<string, number>>;
	readonly isLoaded: (modelKey: string) => boolean;
	readonly bars: readonly RoleQualityBar[];
	readonly options?: CeilingUpgradeOptions;
}): CeilingUpgradeRecommendation[] {
	// Detection over the loaded fleet: aggregate per (model, role), confidence = success rate, loaded = real state.
	const agg = new Map<string, { modelKey: string; role: string; success: number; samples: number }>();
	for (const s of input.fitnessSamples) {
		const key = `${s.modelKey}::${s.role}`;
		const cur = agg.get(key) ?? { modelKey: s.modelKey, role: s.role, success: 0, samples: 0 };
		cur.success += s.successCount;
		cur.samples += s.sampleCount;
		agg.set(key, cur);
	}
	const fitness: FleetModelFitness[] = [...agg.values()]
		.filter((a) => a.samples > 0)
		.map((a) => ({
			modelKey: a.modelKey,
			role: a.role,
			qualityConfidence: Math.min(1, Math.max(0, a.success / a.samples)),
			loaded: input.isLoaded(a.modelKey),
		}));
	const verdicts = assessCapabilityCeiling(input.bars, fitness);
	const candidates = buildUpgradeCandidatesFromFitness(input.fitnessSamples, input.catalog, input.isLoaded);
	const machines: MachineMemory[] = Object.entries(input.deviceRamGB).map(([machine, usableGB]) => ({
		machine,
		usableGB,
	}));
	return recommendCeilingUpgrades(verdicts, candidates, machines, input.options);
}

/** Uncertainty from eval sample count — mirrors the fitness store's confidence tiers (settled ≥ 4, high ≥ 10). */
function upgradeConfidenceFromSamples(samples: number): UpgradeConfidence {
	if (samples >= 10) {
		return "high";
	}
	return samples >= 4 ? "medium" : "low";
}

export interface CeilingUpgradeOptions {
	/**
	 * Minimum capability gain over the best loaded model for a candidate to count as a real upgrade (default 0.02) —
	 * guards against recommending a swap for measurement noise.
	 */
	readonly minGain?: number;
}

/**
 * For each ceiling-hit role, pick the single best NOT-loaded catalog model to load (pure, deterministic). A viable
 * candidate must: match the role, be not-loaded, have a reliable measurement, and beat the best loaded confidence by at
 * least `minGain`. Among the viable set, prefer the ones that FIT their home machine first, then highest capability,
 * then most samples, then modelKey (stable tiebreak). Roles with no viable candidate are omitted — the honest "no
 * better catalog model is available" answer, rather than a misleading recommendation.
 */
export function recommendCeilingUpgrades(
	verdicts: readonly CapabilityCeilingVerdict[],
	candidates: readonly CatalogModelCandidate[],
	machines: readonly MachineMemory[],
	options: CeilingUpgradeOptions = {},
): CeilingUpgradeRecommendation[] {
	const minGain = options.minGain ?? 0.02;
	const usableByMachine = new Map(machines.map((m) => [m.machine, m.usableGB]));
	const recommendations: CeilingUpgradeRecommendation[] = [];

	for (const verdict of ceilingHitRoles(verdicts)) {
		const bestLoadedConfidence = verdict.bestLoaded?.confidence ?? 0;
		const viable = candidates
			.filter(
				(c) =>
					c.role === verdict.role &&
					!c.loaded &&
					!c.measurementUnreliable &&
					c.measuredCapability - bestLoadedConfidence >= minGain,
			)
			.map((c) => {
				const usableGB = usableByMachine.get(c.machine);
				// A machine with no known memory budget is treated as unknown-fit = false (never claim a fit we can't verify).
				const fits = usableGB !== undefined && c.sizeGB <= usableGB;
				return { candidate: c, fits };
			})
			.sort(
				(a, b) =>
					Number(b.fits) - Number(a.fits) ||
					b.candidate.measuredCapability - a.candidate.measuredCapability ||
					b.candidate.samples - a.candidate.samples ||
					a.candidate.modelKey.localeCompare(b.candidate.modelKey),
			);

		const top = viable[0];
		if (!top) {
			continue;
		}
		const c = top.candidate;
		const projectedGain = c.measuredCapability - bestLoadedConfidence;
		const confidence = upgradeConfidenceFromSamples(c.samples);
		const fitClause = top.fits
			? `fits ${c.machine} (${c.sizeGB.toFixed(1)} GB)`
			: `does NOT fit ${c.machine}'s memory as configured (${c.sizeGB.toFixed(1)} GB) — free memory or use a smaller quant`;
		recommendations.push({
			role: verdict.role,
			candidateModelKey: c.modelKey,
			targetMachine: c.machine,
			expectedCapability: c.measuredCapability,
			projectedGain,
			confidence,
			fitsTargetMachine: top.fits,
			candidateSizeGB: c.sizeGB,
			recommendation:
				`For "${verdict.role}": load ${c.modelKey} on ${c.machine} — measured ${c.measuredCapability.toFixed(2)} ` +
				`vs the best loaded ${bestLoadedConfidence.toFixed(2)} (projected +${projectedGain.toFixed(2)}, ${confidence} confidence). ` +
				`${fitClause}. Propose-only — load it yourself; nothing is loaded or downloaded automatically.`,
		});
	}
	return recommendations;
}
