/**
 * P0.HEAP — the pure half of process-memory observation.
 *
 * The server died twice at its heap limit (4 GB default on 2026-09-02; 24.5 GB with the drain's raised limit on
 * 2026-09-07, 9.7 h in) and nothing in telemetry showed the climb — the only memory reading in the codebase is the
 * fleet rail's on-demand sampler, which runs while an operator has the rail open. This module decides WHEN a
 * memory sample is worth a telemetry row, so the board-liveness watchdog can sample every tick without turning
 * the telemetry log into a second `board_liveness_watchdog_tick` flood: emit on a fixed cadence, sooner when the
 * heap grew by a whole step since the last emitted row (a fast leak shows up at step granularity, not at the
 * cadence), and as a WARNING the moment the heap crosses the pressure fraction of V8's limit — an early alarm
 * where the previous signal was the FATAL line itself.
 */
export interface ProcessMemorySample {
	sampledAt: number;
	rssBytes: number;
	heapUsedBytes: number;
	heapTotalBytes: number;
	externalBytes: number;
	arrayBuffersBytes: number;
	/** V8's `heap_size_limit`, or null when unknown. */
	heapLimitBytes: number | null;
}

export interface ProcessMemoryEmissionPolicy {
	/** A sample is always emitted once this long has passed since the last emitted one. */
	minIntervalMs: number;
	/** A sample is emitted early when heapUsed grew by at least this much since the last emitted one. */
	growthStepBytes: number;
	/** heapUsed / heapLimit at or above this fraction is heap PRESSURE: emitted as a warning, and the crossing is emitted at once. */
	warnHeapFraction: number;
}

export const DEFAULT_PROCESS_MEMORY_EMISSION_POLICY: ProcessMemoryEmissionPolicy = {
	minIntervalMs: 5 * 60_000,
	growthStepBytes: 256 * 1024 * 1024,
	warnHeapFraction: 0.75,
};

export type ProcessMemoryEmissionReason = "first_sample" | "interval_elapsed" | "heap_growth_step" | "heap_pressure";

export type ProcessMemoryEmissionDecision =
	| { emit: false; reason: "within_interval"; heapUsedFraction: number | null }
	| {
			emit: true;
			reason: ProcessMemoryEmissionReason;
			severity: "debug" | "warning";
			heapUsedDeltaBytes: number | null;
			heapUsedFraction: number | null;
	  };

export function heapUsedFractionOf(sample: ProcessMemorySample): number | null {
	if (sample.heapLimitBytes === null || !(sample.heapLimitBytes > 0)) {
		return null;
	}
	return sample.heapUsedBytes / sample.heapLimitBytes;
}

export function decideProcessMemorySampleEmission(input: {
	/** The last EMITTED sample (not the last taken one), so growth is measured since the last telemetry row. */
	previous: ProcessMemorySample | null;
	sample: ProcessMemorySample;
	policy?: Partial<ProcessMemoryEmissionPolicy>;
}): ProcessMemoryEmissionDecision {
	const policy = { ...DEFAULT_PROCESS_MEMORY_EMISSION_POLICY, ...(input.policy ?? {}) };
	const heapUsedFraction = heapUsedFractionOf(input.sample);
	const underPressure = heapUsedFraction !== null && heapUsedFraction >= policy.warnHeapFraction;
	const severity = underPressure ? "warning" : "debug";
	if (!input.previous) {
		return { emit: true, reason: "first_sample", severity, heapUsedDeltaBytes: null, heapUsedFraction };
	}
	const heapUsedDeltaBytes = input.sample.heapUsedBytes - input.previous.heapUsedBytes;
	const previousFraction = heapUsedFractionOf(input.previous);
	const crossedIntoPressure =
		underPressure && (previousFraction === null || previousFraction < policy.warnHeapFraction);
	if (crossedIntoPressure) {
		return { emit: true, reason: "heap_pressure", severity, heapUsedDeltaBytes, heapUsedFraction };
	}
	if (heapUsedDeltaBytes >= policy.growthStepBytes) {
		return { emit: true, reason: "heap_growth_step", severity, heapUsedDeltaBytes, heapUsedFraction };
	}
	if (input.sample.sampledAt - input.previous.sampledAt >= policy.minIntervalMs) {
		return { emit: true, reason: "interval_elapsed", severity, heapUsedDeltaBytes, heapUsedFraction };
	}
	return { emit: false, reason: "within_interval", heapUsedFraction };
}

export function formatMebibytes(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
