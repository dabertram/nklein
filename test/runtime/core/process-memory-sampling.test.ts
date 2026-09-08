import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROCESS_MEMORY_EMISSION_POLICY,
	decideProcessMemorySampleEmission,
	formatMebibytes,
	heapUsedFractionOf,
	type ProcessMemorySample,
} from "../../../src/core/process-memory-sampling";

/**
 * P0.HEAP. The server died twice at its heap limit and nothing in telemetry showed the climb — the only memory
 * reading in the codebase ran on demand while an operator had the fleet rail open. The watchdog can now sample
 * every tick, and this decides which samples are worth a row: a fixed cadence, sooner on a whole growth step, and
 * a warning the moment the heap crosses the pressure fraction. The previous early warning was the FATAL line.
 */
const sample = (over: Partial<ProcessMemorySample> = {}): ProcessMemorySample => ({
	sampledAt: 0,
	rssBytes: 2 * 1024 ** 3,
	heapUsedBytes: 1 * 1024 ** 3,
	heapTotalBytes: 2 * 1024 ** 3,
	externalBytes: 64 * 1024 ** 2,
	arrayBuffersBytes: 8 * 1024 ** 2,
	heapLimitBytes: 4 * 1024 ** 3,
	...over,
});

describe("decideProcessMemorySampleEmission", () => {
	it("always emits the first sample, because a baseline nobody recorded explains nothing later", () => {
		const decision = decideProcessMemorySampleEmission({ previous: null, sample: sample() });
		expect(decision).toMatchObject({ emit: true, reason: "first_sample", severity: "debug" });
	});

	it("stays quiet between samples inside the cadence — a per-tick sampler must not flood telemetry", () => {
		const previous = sample({ sampledAt: 0 });
		const decision = decideProcessMemorySampleEmission({
			previous,
			sample: sample({ sampledAt: 60_000, heapUsedBytes: previous.heapUsedBytes + 1024 }),
		});
		expect(decision).toMatchObject({ emit: false, reason: "within_interval" });
	});

	it("emits on the cadence once it has elapsed", () => {
		const previous = sample({ sampledAt: 0 });
		const decision = decideProcessMemorySampleEmission({
			previous,
			sample: sample({ sampledAt: DEFAULT_PROCESS_MEMORY_EMISSION_POLICY.minIntervalMs }),
		});
		expect(decision).toMatchObject({ emit: true, reason: "interval_elapsed" });
	});

	it("emits EARLY on a whole growth step, so a fast leak is visible at step granularity", () => {
		const previous = sample({ sampledAt: 0, heapUsedBytes: 1024 ** 3 });
		const decision = decideProcessMemorySampleEmission({
			previous,
			// Well inside the cadence, but a full step of growth.
			sample: sample({
				sampledAt: 30_000,
				heapUsedBytes: 1024 ** 3 + DEFAULT_PROCESS_MEMORY_EMISSION_POLICY.growthStepBytes,
			}),
		});
		expect(decision).toMatchObject({ emit: true, reason: "heap_growth_step" });
		expect(decision.emit && decision.heapUsedDeltaBytes).toBe(DEFAULT_PROCESS_MEMORY_EMISSION_POLICY.growthStepBytes);
	});

	it("emits the CROSSING into heap pressure at once, as a warning, whatever the cadence says", () => {
		const limit = 4 * 1024 ** 3;
		const previous = sample({ sampledAt: 0, heapLimitBytes: limit, heapUsedBytes: limit * 0.5 });
		const decision = decideProcessMemorySampleEmission({
			previous,
			sample: sample({ sampledAt: 1_000, heapLimitBytes: limit, heapUsedBytes: limit * 0.8 }),
		});
		expect(decision).toMatchObject({ emit: true, reason: "heap_pressure", severity: "warning" });
	});

	it("reports the crossing once, then falls back to the ordinary rules while it stays under pressure", () => {
		const limit = 4 * 1024 ** 3;
		const underPressure = sample({ sampledAt: 0, heapLimitBytes: limit, heapUsedBytes: limit * 0.8 });
		const decision = decideProcessMemorySampleEmission({
			previous: underPressure,
			sample: sample({ sampledAt: 1_000, heapLimitBytes: limit, heapUsedBytes: limit * 0.81 }),
		});
		// Still above the fraction, but no longer a CROSSING — so the cadence governs and it stays quiet.
		expect(decision.emit).toBe(false);
		// It is still reported as pressure when it does emit.
		const later = decideProcessMemorySampleEmission({
			previous: underPressure,
			sample: sample({
				sampledAt: DEFAULT_PROCESS_MEMORY_EMISSION_POLICY.minIntervalMs,
				heapLimitBytes: limit,
				heapUsedBytes: limit * 0.81,
			}),
		});
		expect(later).toMatchObject({ emit: true, reason: "interval_elapsed", severity: "warning" });
	});

	it("handles an unknown heap limit without inventing a fraction", () => {
		const unknown = sample({ heapLimitBytes: null });
		expect(heapUsedFractionOf(unknown)).toBeNull();
		expect(heapUsedFractionOf(sample({ heapLimitBytes: 0 }))).toBeNull();
		const decision = decideProcessMemorySampleEmission({ previous: null, sample: unknown });
		expect(decision).toMatchObject({ emit: true, severity: "debug", heapUsedFraction: null });
	});

	it("takes a policy override", () => {
		const previous = sample({ sampledAt: 0 });
		const decision = decideProcessMemorySampleEmission({
			previous,
			sample: sample({ sampledAt: 1_000 }),
			policy: { minIntervalMs: 500 },
		});
		expect(decision).toMatchObject({ emit: true, reason: "interval_elapsed" });
	});
});

describe("formatMebibytes", () => {
	it("rounds to whole mebibytes", () => {
		expect(formatMebibytes(1024 ** 2)).toBe("1 MiB");
		expect(formatMebibytes(1024 ** 3)).toBe("1024 MiB");
		expect(formatMebibytes(0)).toBe("0 MiB");
	});
});
