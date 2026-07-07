/**
 * §5.AB autonomous load/unload planner (David 2026-07-07: "load/unload as-needed, just don't overload any of the 3
 * systems"). {@link import("./model-load-headroom").decideModelLoad} answers "can I load X into the CURRENT free
 * headroom?"; this answers the next question — "if it doesn't fit, WHAT should I unload to make room, WITHOUT overloading
 * and WITHOUT evicting a model that is mid-task?" — so !Klein can bring a best-fit model resident on demand.
 *
 * Eviction policy: free the least valuable capacity first — COLDEST (oldest `lastUsedAt`) among the NOT-in-use residents,
 * one at a time, until the needed model fits under the budget's usable headroom (`budget × (1 − reserveFraction)`). A
 * model that is IN USE (running a session) is NEVER evicted. If even unloading every evictable model can't make room, the
 * plan REFUSES (`fits:false`, no unloads) — the caller keeps the current set rather than overload the machine.
 *
 * Pure + deterministic (no I/O, no clock): the caller supplies the resident set, sizes, in-use flags, and budget.
 */

/** Fraction of the machine budget reserved for the OS + KV-cache headroom (matches `decideModelLoad`'s default). */
const DEFAULT_RESERVE_FRACTION = 0.25;

export interface ResidentModelInfo {
	/** The model's routing/registry key (opaque here) — echoed back in `toUnload`. */
	key: string;
	/** Resident footprint in bytes. */
	sizeBytes: number;
	/** True when the model is running a session — NEVER evicted (would kill in-flight work). */
	inUse: boolean;
	/** Last-used epoch ms — coldest (smallest) is evicted first. */
	lastUsedAt: number;
}

export interface ResidencyPlan {
	/** True when the needed model fits (already, or after the returned `toUnload`). */
	fits: boolean;
	/** The resident keys to UNLOAD (coldest not-in-use first) to make room; empty when it already fits or can't fit. */
	toUnload: string[];
	/** Bytes free (under the usable budget) AFTER applying `toUnload` and loading the needed model; may be negative when !fits. */
	freeBytesAfter: number;
	reason: string;
}

/**
 * Plan the residency change to bring a model of `neededSizeBytes` resident: keep it if it already fits, else evict the
 * coldest not-in-use residents until it fits, else refuse (never overload). Pure.
 */
export function planResidencyForModel(input: {
	neededSizeBytes: number;
	resident: readonly ResidentModelInfo[];
	totalBudgetBytes: number;
	reserveFraction?: number;
}): ResidencyPlan {
	const reserveFraction = input.reserveFraction ?? DEFAULT_RESERVE_FRACTION;
	const usableBudget = input.totalBudgetBytes * (1 - reserveFraction);
	const residentBytes = input.resident.reduce((sum, model) => sum + Math.max(0, model.sizeBytes), 0);

	if (!(input.neededSizeBytes > 0) || !(input.totalBudgetBytes > 0)) {
		return {
			fits: false,
			toUnload: [],
			freeBytesAfter: 0,
			reason: "Unknown model size or machine budget — refusing to plan a load.",
		};
	}

	// Already fits in the current free headroom (no eviction needed).
	const freeNow = usableBudget - residentBytes;
	if (input.neededSizeBytes <= freeNow) {
		return {
			fits: true,
			toUnload: [],
			freeBytesAfter: freeNow - input.neededSizeBytes,
			reason: `Fits in current headroom (${bytesToGiB(freeNow)} free ≥ ${bytesToGiB(input.neededSizeBytes)} needed).`,
		};
	}

	// Evict coldest not-in-use residents until the needed model fits. In-use models are immovable.
	const evictable = input.resident.filter((model) => !model.inUse).sort((a, b) => a.lastUsedAt - b.lastUsedAt); // coldest first
	const toUnload: string[] = [];
	let freed = 0;
	for (const model of evictable) {
		if (input.neededSizeBytes <= freeNow + freed) {
			break;
		}
		toUnload.push(model.key);
		freed += Math.max(0, model.sizeBytes);
	}

	const freeBytesAfter = freeNow + freed - input.neededSizeBytes;
	if (freeBytesAfter >= 0) {
		return {
			fits: true,
			toUnload,
			freeBytesAfter,
			reason:
				toUnload.length === 0
					? `Fits in current headroom.`
					: `Fits after unloading ${toUnload.length} cold model(s) to free ${bytesToGiB(freed)}.`,
		};
	}
	return {
		fits: false,
		toUnload: [],
		freeBytesAfter,
		reason: `Cannot fit ${bytesToGiB(input.neededSizeBytes)} even after unloading every evictable model — keeping the current set (never overload).`,
	};
}

const GiB = 1024 ** 3;
function bytesToGiB(bytes: number): string {
	return `${(bytes / GiB).toFixed(1)} GiB`;
}
