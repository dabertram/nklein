/**
 * F12.75 Apple-Silicon wired-memory enrichment for load routing — PURE core.
 *
 * On Apple Silicon, RAM and VRAM are one pool, but macOS caps what the GPU may WIRE at roughly 75% of physical
 * memory. The remaining ~25% is not free headroom the loader can spend — it is unreachable to the GPU. Raising
 * `iogpu.wired_limit_mb` reclaims most of it and lets a Mac hold either a bigger model or the full 32k KV cache
 * GPU-resident (the m4mini swap-crash is this ceiling being hit).
 *
 * !KLEIN NEVER RAISES THE LIMIT ITSELF. `sudo sysctl iogpu.wired_limit_mb=…` is a system-settings change on the
 * user's machine; this module only computes what the ceiling IS and what raising it WOULD buy, and renders the
 * command for a human to run. Consistent with the standing no-auto-load/unload production constraint: the loader
 * recommends, the operator decides.
 *
 * ── INTERACTION WARNING (the reason this is a separate core rather than a factor folded into the router) ──
 * `selectDeviceForModelLoad` already applies a `reserveFraction` (default 0.25) against TOTAL RAM. That number
 * numerically resembles the 75% GPU cap but means something entirely different: it is a swap-avoidance buffer
 * against the OS and other processes. Multiplying both — 0.75 × 0.75 ≈ 0.56 — would silently strand ~44% of a
 * Mac's memory and make big models look unplaceable. So {@link gpuUsableBytes} returns the CEILING, and a caller
 * that adopts it must treat it as the new denominator, not as an extra multiplier on top of the reserve.
 */

/** Fraction of physical RAM macOS lets the GPU wire by default on Apple Silicon. */
const DEFAULT_WIRED_FRACTION = 0.75;

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface GpuUsableInput {
	/** Physical RAM on the device, in bytes. */
	readonly totalRamBytes: number;
	/**
	 * Current `iogpu.wired_limit_mb` value if it has been read, else null. A value of 0 is macOS's documented
	 * "use the default" sentinel and is treated as unset, NOT as a zero ceiling.
	 */
	readonly wiredLimitMb?: number | null;
	/** Whether this device is Apple Silicon. The cap is a macOS artifact and must not be applied elsewhere. */
	readonly appleSilicon: boolean;
}

export interface GpuUsableResult {
	/** Bytes the GPU may actually wire — the ceiling a placement decision should measure against. */
	readonly usableBytes: number;
	/** True when an explicit raised `iogpu.wired_limit_mb` is in effect rather than the default fraction. */
	readonly raised: boolean;
	/** Bytes that are physically present but NOT GPU-reachable at the current ceiling. */
	readonly unreachableBytes: number;
	readonly reason: string;
}

/**
 * Compute the GPU-usable ceiling for a device. On non-Apple-Silicon the full pool is returned unchanged — the cap
 * is a macOS artifact, and applying it to a Linux/NVIDIA node would invent a limit that does not exist.
 */
export function gpuUsableBytes(input: GpuUsableInput): GpuUsableResult {
	const total = Number.isFinite(input.totalRamBytes) ? Math.max(0, input.totalRamBytes) : 0;
	if (!input.appleSilicon) {
		return {
			usableBytes: total,
			raised: false,
			unreachableBytes: 0,
			reason: "not Apple Silicon — the macOS GPU wiring cap does not apply",
		};
	}
	// 0 is macOS's "use the default" sentinel, not a zero ceiling.
	const explicit =
		input.wiredLimitMb !== null && input.wiredLimitMb !== undefined && input.wiredLimitMb > 0
			? input.wiredLimitMb * BYTES_PER_MB
			: null;
	if (explicit === null) {
		const usableBytes = Math.floor(total * DEFAULT_WIRED_FRACTION);
		return {
			usableBytes,
			raised: false,
			unreachableBytes: total - usableBytes,
			reason: `default macOS cap — the GPU may wire ~${Math.round(DEFAULT_WIRED_FRACTION * 100)}% of ${formatGb(total)}, leaving ${formatGb(total - usableBytes)} physically present but GPU-unreachable`,
		};
	}
	// An explicit limit ABOVE physical memory is not achievable; clamp rather than report fantasy headroom.
	const usableBytes = Math.min(explicit, total);
	const defaultBytes = Math.floor(total * DEFAULT_WIRED_FRACTION);
	return {
		usableBytes,
		raised: usableBytes > defaultBytes,
		unreachableBytes: total - usableBytes,
		reason:
			usableBytes > defaultBytes
				? `iogpu.wired_limit_mb raised — ${formatGb(usableBytes)} of ${formatGb(total)} GPU-wireable (${formatGb(usableBytes - defaultBytes)} reclaimed over the default cap)`
				: `iogpu.wired_limit_mb set to ${formatGb(usableBytes)}, at or BELOW the ${formatGb(defaultBytes)} default cap — this setting is costing headroom, not adding it`,
	};
}

export interface WiredLimitRecommendation {
	/** Recommended `iogpu.wired_limit_mb` value, or null when the default cap is already the right answer. */
	readonly recommendedMb: number | null;
	/** Bytes this would reclaim over the current ceiling. */
	readonly reclaimedBytes: number;
	/** The exact command for a HUMAN to run. !Klein never executes it. */
	readonly command: string | null;
	readonly reason: string;
}

/** Headroom left for macOS itself. Below ~8 GB the OS starts paging; the item's guidance is 8–16 GB. */
const OS_RESERVE_GB_MIN = 8;
const OS_RESERVE_GB_LARGE = 16;
/** Above this much RAM, leave the larger OS reserve — big machines run more alongside the model. */
const LARGE_MACHINE_GB = 64;

/**
 * Recommend a wired-memory limit, leaving the OS a real reserve. Advisory only.
 *
 * Returns `null` when the machine is too small for the raise to be safe: on a 16 GB Mac, an 8 GB OS reserve leaves
 * 8 GB — which is BELOW the default 75% cap (12 GB), so "raising" the limit would lower the ceiling. Recommending
 * it anyway would be actively harmful, so this abstains and says why.
 */
export function recommendWiredLimit(input: {
	readonly totalRamBytes: number;
	readonly appleSilicon: boolean;
	readonly wiredLimitMb?: number | null;
}): WiredLimitRecommendation {
	if (!input.appleSilicon) {
		return {
			recommendedMb: null,
			reclaimedBytes: 0,
			command: null,
			reason: "not Apple Silicon — no wired-memory limit to raise",
		};
	}
	const total = Number.isFinite(input.totalRamBytes) ? Math.max(0, input.totalRamBytes) : 0;
	const totalGb = total / BYTES_PER_GB;
	const reserveGb = totalGb >= LARGE_MACHINE_GB ? OS_RESERVE_GB_LARGE : OS_RESERVE_GB_MIN;
	const targetBytes = total - reserveGb * BYTES_PER_GB;
	const current = gpuUsableBytes({
		totalRamBytes: total,
		wiredLimitMb: input.wiredLimitMb ?? null,
		appleSilicon: true,
	});

	if (targetBytes <= current.usableBytes) {
		return {
			recommendedMb: null,
			reclaimedBytes: 0,
			command: null,
			reason: `leaving macOS its ${reserveGb} GB reserve would cap the GPU at ${formatGb(Math.max(0, targetBytes))}, which is no better than the current ${formatGb(current.usableBytes)} — raising the limit would LOWER the ceiling on a machine this size`,
		};
	}
	const recommendedMb = Math.floor(targetBytes / BYTES_PER_MB);
	return {
		recommendedMb,
		reclaimedBytes: targetBytes - current.usableBytes,
		command: `sudo sysctl iogpu.wired_limit_mb=${recommendedMb}`,
		reason: `raising the cap to ${formatGb(targetBytes)} (${reserveGb} GB left for macOS) reclaims ${formatGb(targetBytes - current.usableBytes)} of GPU-unreachable memory — run the command yourself; !Klein does not change system settings`,
	};
}

function formatGb(bytes: number): string {
	return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}
