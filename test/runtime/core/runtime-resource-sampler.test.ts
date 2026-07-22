import { describe, expect, it } from "vitest";
import { deriveCpuPercent } from "../../../src/core/runtime-resource-sampler";

describe("deriveCpuPercent", () => {
	it("leaves the first sample unknown instead of reporting a lifetime average", () => {
		expect(
			deriveCpuPercent(null, {
				atMs: 1_000,
				processMicros: 10_000,
				systemIdleMs: 100,
				systemTotalMs: 400,
				logicalCpuCount: 4,
			}),
		).toEqual({ processCpuPercent: null, systemCpuPercent: null });
	});

	it("normalizes process CPU to whole-host capacity and derives system busy time from deltas", () => {
		const result = deriveCpuPercent(
			{ atMs: 1_000, processMicros: 20_000, systemIdleMs: 100, systemTotalMs: 400, logicalCpuCount: 4 },
			{ atMs: 2_000, processMicros: 1_020_000, systemIdleMs: 300, systemTotalMs: 800, logicalCpuCount: 4 },
		);
		expect(result.processCpuPercent).toBe(25);
		expect(result.systemCpuPercent).toBe(50);
	});
});
