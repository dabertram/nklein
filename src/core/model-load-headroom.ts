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

export interface LoadHeadroomInput {
	/** Size of the model we want to load, in bytes. */
	candidateSizeBytes: number;
	/** Sum of currently-resident model sizes, in bytes. */
	residentSizeBytes: number;
	/** Total host RAM in bytes (for a unified-memory Mac, the shared RAM/VRAM pool). */
	totalRamBytes: number;
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
	const projectedResidentBytes = input.residentSizeBytes + input.candidateSizeBytes;
	const freeBytesAfter = input.totalRamBytes - projectedResidentBytes;
	const reserveBytes = input.totalRamBytes * reserveFraction;

	if (!(input.totalRamBytes > 0) || !(input.candidateSizeBytes > 0)) {
		return {
			allow: false,
			projectedResidentBytes,
			freeBytesAfter,
			reason: "Unknown RAM or candidate size — refusing to load (cannot prove headroom).",
		};
	}
	if (freeBytesAfter < reserveBytes) {
		return {
			allow: false,
			projectedResidentBytes,
			freeBytesAfter,
			reason: `Load would leave only ${gib(freeBytesAfter)} free, below the ${Math.round(
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
