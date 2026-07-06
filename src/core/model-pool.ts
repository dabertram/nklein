/**
 * §5.W / §5.AF — the `ModelPool` model (pure core). !Klein drives models across several machines (an workstation, an
 * desktop, a laptop box), each linked through LM Studio. Residency + headroom are PER-MACHINE, not global: loading a
 * model must respect THAT machine's RAM/VRAM budget and concurrency, not the local host's. This defines one pool per
 * machine + the pure per-pool headroom primitives the loader/scheduler consult (the actual `decideModelLoad`/loader
 * rewiring to be per-pool is a separate integration leaf). Pure + total + deterministic.
 */

/** One model resident on a pool, with its approximate footprint. */
export interface PoolResidentModel {
	/** Canonical model key (e.g. `provider/family` or the LM Studio identifier). */
	modelKey: string;
	/** Approximate resident RAM/VRAM footprint in MB (0 when unknown). */
	ramMb: number;
}

/** A pool of model capacity on ONE machine/endpoint. */
export interface ModelPool {
	/** Stable id — typically the LM Studio device id (`lms ps` deviceIdentifier), or `local`. */
	id: string;
	/** Human label (e.g. `workstation`, `desktop`, `laptop`). */
	label: string;
	/** The pool's LM Studio base endpoint. */
	endpoint: string;
	/** Max concurrent predictions this pool serves. */
	maxConcurrency: number;
	/** RAM/VRAM budget available for model residency on this machine, in MB. */
	ramBudgetMb: number;
	/** The models currently resident on this pool. */
	residentModels: readonly PoolResidentModel[];
}

const nonNeg = (value: number): number => Math.max(0, value);

/** The model keys resident on a pool. */
export function poolResidentModelKeys(pool: ModelPool): string[] {
	return pool.residentModels.map((model) => model.modelKey);
}

/** Total resident RAM/VRAM on a pool, in MB (negatives clamped to 0). */
export function poolResidentRamMb(pool: ModelPool): number {
	return pool.residentModels.reduce((sum, model) => sum + nonNeg(model.ramMb), 0);
}

/** Free RAM/VRAM headroom on a pool, in MB — never negative (an over-budget pool reports 0 free). */
export function poolFreeRamMb(pool: ModelPool): number {
	return Math.max(0, nonNeg(pool.ramBudgetMb) - poolResidentRamMb(pool));
}

/** True when loading `additionalRamMb` more would still fit THIS pool's RAM budget (not the local host's). */
export function poolHasRamHeadroom(pool: ModelPool, additionalRamMb: number): boolean {
	return poolResidentRamMb(pool) + nonNeg(additionalRamMb) <= nonNeg(pool.ramBudgetMb);
}

/** True when the pool can take another concurrent request (`activeRequests` below its `maxConcurrency`). */
export function poolHasConcurrencyHeadroom(pool: ModelPool, activeRequests: number): boolean {
	return nonNeg(activeRequests) < nonNeg(pool.maxConcurrency);
}

/** True when a model with the given key is already resident on the pool (no reload needed). */
export function poolHasResidentModel(pool: ModelPool, modelKey: string): boolean {
	return pool.residentModels.some((model) => model.modelKey === modelKey);
}
