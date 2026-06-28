import { describe, expect, it } from "vitest";
import {
	detectSystemPowerMode,
	parseMacPowerMode,
	powerModeTimeoutMultiplier,
	resolvePowerAwareTimeoutMs,
	scaleTimeoutForPowerMode,
} from "../../../src/core/power-aware-timeout";

describe("parseMacPowerMode", () => {
	it("reads the unified `powermode` field (0=normal, 1=low, 2=high)", () => {
		expect(parseMacPowerMode(" powermode            0")).toBe("normal");
		expect(parseMacPowerMode(" powermode            1")).toBe("low");
		expect(parseMacPowerMode(" powermode            2")).toBe("high");
	});

	it("reads the older `lowpowermode` flag and is not confused by the substring in `lowpowermode`", () => {
		expect(parseMacPowerMode("lowpowermode 1")).toBe("low");
		expect(parseMacPowerMode("lowpowermode 0")).toBe("normal");
		// `lowpowermode 0` must NOT be misread as the standalone `powermode 0` via the substring.
		expect(parseMacPowerMode(" lowpowermode         0\n other 9")).toBe("normal");
	});

	it("prefers low when either signal reports it; unknown when nothing recognized", () => {
		expect(parseMacPowerMode("lowpowermode 1\n powermode 2")).toBe("low");
		expect(parseMacPowerMode("no power info here")).toBe("unknown");
		expect(parseMacPowerMode("")).toBe("unknown");
	});
});

describe("powerModeTimeoutMultiplier + scaleTimeoutForPowerMode", () => {
	it("doubles in low power, never shortens otherwise, respects overrides", () => {
		expect(powerModeTimeoutMultiplier("low")).toBe(2);
		expect(powerModeTimeoutMultiplier("high")).toBe(1);
		expect(powerModeTimeoutMultiplier("normal")).toBe(1);
		expect(powerModeTimeoutMultiplier("unknown")).toBe(1);
		expect(powerModeTimeoutMultiplier("low", { lowMultiplier: 2.5 })).toBe(2.5);
		expect(scaleTimeoutForPowerMode(1000, "low")).toBe(2000);
		expect(scaleTimeoutForPowerMode(1000, "high")).toBe(1000);
	});
});

describe("detectSystemPowerMode", () => {
	it("is unknown off darwin and never spawns there", async () => {
		let spawned = false;
		const mode = await detectSystemPowerMode({
			platform: "linux",
			run: async () => {
				spawned = true;
				return "powermode 1";
			},
		});
		expect(mode).toBe("unknown");
		expect(spawned).toBe(false);
	});

	it("parses injected pmset output on darwin; failures degrade to unknown", async () => {
		expect(await detectSystemPowerMode({ platform: "darwin", run: async () => " powermode 1" })).toBe("low");
		expect(
			await detectSystemPowerMode({
				platform: "darwin",
				run: async () => {
					throw new Error("pmset missing");
				},
			}),
		).toBe("unknown");
	});
});

describe("resolvePowerAwareTimeoutMs", () => {
	it("scales a base budget by the detected mode (low → 2×)", async () => {
		const resolved = await resolvePowerAwareTimeoutMs(1_000_000, {
			platform: "darwin",
			run: async () => " powermode 1",
			envScale: undefined,
		});
		expect(resolved).toMatchObject({ timeoutMs: 2_000_000, baseMs: 1_000_000, mode: "low", source: "detected" });
	});

	it("honors an explicit env scale override (wins over detection)", async () => {
		const resolved = await resolvePowerAwareTimeoutMs(1_000_000, {
			platform: "darwin",
			run: async () => " powermode 2",
			envScale: "3",
		});
		expect(resolved).toMatchObject({ timeoutMs: 3_000_000, multiplier: 3, source: "env_override" });
	});

	it("does not scale at normal/high power", async () => {
		const high = await resolvePowerAwareTimeoutMs(500_000, {
			platform: "darwin",
			run: async () => " powermode 2",
			envScale: undefined,
		});
		expect(high).toMatchObject({ timeoutMs: 500_000, mode: "high" });
	});
});
