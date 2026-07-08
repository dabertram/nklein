/**
 * Model-load headroom guard (todo §5.AF resource governance) — the PURE prerequisite for letting !Klein load models
 * itself (the 2026-06-29 working-mode shift). The original no-load directive existed for ONE reason: a too-big load can
 * exhaust RAM/VRAM and freeze the machine (the real `ornith-1.0-35b@8bit` "would overload your system" refusal). So the
 * safe form of autonomous loading isn't "never load" — it's "load only when this guard proves the headroom." Given the
 * resident set's size + the candidate's size + the machine's RAM + a safety reserve, decide whether the load is safe;
 * refuse with a clear reason (so the caller queues / unloads something / asks the user) instead of risking a freeze.
 *
 * Pure + deterministic so it is fully unit-testable; a thin adapter feeds it from `lms ps` / `/api/v0/models` (resident
 * sizes) + the host RAM. Loading itself (`lms load --context-length …`) stays in the effectful wrapper that consults this.
 */

import { type LlmfitModel, llmfitFitClears } from "./llmfit-adapter";

const BYTES_PER_UNIT: Record<string, number> = {
	B: 1,
	KB: 1024,
	MB: 1024 ** 2,
	GB: 1024 ** 3,
	TB: 1024 ** 4,
};

/** Parse a human size like "4.37 GB" / "146.15 MB" / "2.18GB" into bytes; null when unparseable. */
export function parseModelSizeBytes(text: string): number | null {
	const match = text.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
	if (!match) {
		return null;
	}
	const value = Number.parseFloat(match[1]);
	const unit = BYTES_PER_UNIT[match[2].toUpperCase()];
	if (!Number.isFinite(value) || unit === undefined) {
		return null;
	}
	return Math.round(value * unit);
}

/** Sum resident model sizes given as human strings (unparseable entries are skipped). */
export function sumResidentBytes(sizes: readonly string[]): number {
	return sizes.reduce((total, size) => total + (parseModelSizeBytes(size) ?? 0), 0);
}

/**
 * Resolve a user-declared RAM budget (bytes) from the environment — `NKLEIN_MAX_RAM_BUDGET_GB` (a power-user cap usable
 * TODAY, ahead of a Settings field). Pure over the injected env. Returns `undefined` when unset/invalid (⇒ no cap, detected
 * RAM stands). Accepts a plain number (GB); a non-positive or non-finite value is ignored (fail-open: never a false cap).
 */
export function resolveRamBudgetBytesFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env.NKLEIN_MAX_RAM_BUDGET_GB;
	if (raw === undefined || raw.trim().length === 0) {
		return undefined;
	}
	const gb = Number.parseFloat(raw.trim());
	if (!Number.isFinite(gb) || gb <= 0) {
		return undefined;
	}
	return Math.round(gb * 1024 ** 3);
}

export interface LoadHeadroomInput {
	/** Size of the model we want to load, in bytes. */
	candidateSizeBytes: number;
	/** Sum of currently-resident model sizes, in bytes. */
	residentSizeBytes: number;
	/** Total host RAM in bytes (for a unified-memory Mac, the shared RAM/VRAM pool). */
	totalRamBytes: number;
	/**
	 * Optional USER-DECLARED budget cap in bytes — the most RAM the user allows !Klein to plan against on this machine
	 * (e.g. "use ≤100 GB of my 128"). When set (>0), the guard plans against `min(totalRamBytes, userBudgetBytes)`, so it
	 * refuses a load that would exceed the user's cap even though physical RAM could hold it. Omitted ⇒ detected RAM stands.
	 */
	userBudgetBytes?: number;
	/** Fraction of total RAM to keep free for the OS + headroom (default 0.25 — the freeze-avoidance buffer). */
	reserveFraction?: number;
	/** Optional hard cap on total resident model bytes (defense beyond the reserve). */
	maxResidentBytes?: number;
}

export type LoadHeadroomDecision =
	| { allow: true; projectedResidentBytes: number; freeBytesAfter: number; reason: string }
	| { allow: false; projectedResidentBytes: number; freeBytesAfter: number; reason: string };

const GiB = 1024 ** 3;
const gib = (bytes: number): string => `${(bytes / GiB).toFixed(1)} GiB`;

/**
 * Decide whether loading `candidate` is safe. Allows only when, AFTER the load, free RAM stays ≥ the reserve AND the
 * resident total stays ≤ `maxResidentBytes` (when set). Conservative: any non-finite / non-positive RAM ⇒ refuse.
 */
export function decideModelLoad(input: LoadHeadroomInput): LoadHeadroomDecision {
	const reserveFraction = input.reserveFraction ?? 0.25;
	// Honor a user-declared budget below physical RAM: plan against the SMALLER of detected RAM and the user's cap.
	const capped = input.userBudgetBytes !== undefined && input.userBudgetBytes > 0;
	const effectiveTotalRamBytes = capped
		? Math.min(input.totalRamBytes, input.userBudgetBytes as number)
		: input.totalRamBytes;
	const budgetIsBinding = capped && (input.userBudgetBytes as number) < input.totalRamBytes;
	const projectedResidentBytes = input.residentSizeBytes + input.candidateSizeBytes;
	const freeBytesAfter = effectiveTotalRamBytes - projectedResidentBytes;
	const reserveBytes = effectiveTotalRamBytes * reserveFraction;

	if (!(effectiveTotalRamBytes > 0) || !(input.candidateSizeBytes > 0)) {
		return {
			allow: false,
			projectedResidentBytes,
			freeBytesAfter,
			reason: "Unknown RAM or candidate size — refusing to load (cannot prove headroom).",
		};
	}
	if (freeBytesAfter < reserveBytes) {
		const capNote = budgetIsBinding ? ` within your ${gib(effectiveTotalRamBytes)} budget cap` : "";
		return {
			allow: false,
			projectedResidentBytes,
			freeBytesAfter,
			reason: `Load would leave only ${gib(freeBytesAfter)} free${capNote}, below the ${Math.round(
				reserveFraction * 100,
			)}% reserve (${gib(reserveBytes)}) — unload something first or pick a smaller quant (freeze risk).`,
		};
	}
	if (input.maxResidentBytes !== undefined && projectedResidentBytes > input.maxResidentBytes) {
		return {
			allow: false,
			projectedResidentBytes,
			freeBytesAfter,
			reason: `Load would push resident models to ${gib(projectedResidentBytes)}, over the ${gib(
				input.maxResidentBytes,
			)} budget — unload something first.`,
		};
	}
	return {
		allow: true,
		projectedResidentBytes,
		freeBytesAfter,
		reason: `OK — ${gib(freeBytesAfter)} free after load (≥ ${Math.round(reserveFraction * 100)}% reserve).`,
	};
}

/**
 * Refine a {@link decideModelLoad} verdict with llmfit's per-quant/MoE-aware FIT estimate (§5.AB). The RAM headroom
 * guard stays the HARD gate (it prevents the freeze, #safety) — a headroom DENY is final, llmfit can never override it.
 * But when headroom allows, llmfit can still REFUSE a `Marginal`/`Too Tight`/unknown fit (its estimate is tighter than
 * our bytes heuristic — e.g. VRAM vs unified RAM, KV-cache at context, MoE active-vs-total params). No llmfit data ⇒ the
 * headroom verdict stands. Pure — the caller fetches the llmfit model (via the runner) and passes it here.
 */
export function refineLoadDecisionWithLlmfit(
	headroom: LoadHeadroomDecision,
	llmfit: LlmfitModel | null,
): LoadHeadroomDecision {
	if (!headroom.allow || !llmfit) {
		return headroom;
	}
	if (llmfitFitClears(llmfit)) {
		return {
			...headroom,
			reason: `${headroom.reason} llmfit: ${llmfit.fitLevel} (~${llmfit.memoryRequiredGb ?? "?"} GB).`,
		};
	}
	return {
		...headroom,
		allow: false,
		reason: `llmfit fit is "${llmfit.fitLevel ?? "unknown"}" (~${llmfit.memoryRequiredGb ?? "?"} GB needed) — refusing despite RAM headroom; its per-quant/MoE estimate is tighter than the bytes heuristic.`,
	};
}
