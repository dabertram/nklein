import { describe, expect, it } from "vitest";

import {
	AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
	resolveAutonomousTimeoutPowerMultiplier,
	withAutonomousNKleinTimeoutSettings,
} from "../../../src/core/autonomous-timeout-defaults";

describe("autonomous timeout defaults", () => {
	it("adds bounded timeout settings when none are provided", () => {
		expect(withAutonomousNKleinTimeoutSettings()).toEqual(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS);
	});

	it("preserves model settings while filling missing bounded timeouts", () => {
		expect(
			withAutonomousNKleinTimeoutSettings({
				providerId: "lmstudio",
				modelId: "qwen3.5-9b",
				streamTimeoutMs: 120_000,
			}),
		).toEqual({
			...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
			providerId: "lmstudio",
			modelId: "qwen3.5-9b",
			streamTimeoutMs: 120_000,
		});
	});

	it("preserves explicit unlimited timeout mode", () => {
		expect(
			withAutonomousNKleinTimeoutSettings({
				providerId: "lmstudio",
				modelId: "qwen3.5-9b",
				timeoutMode: "unlimited",
			}),
		).toEqual({
			providerId: "lmstudio",
			modelId: "qwen3.5-9b",
			timeoutMode: "unlimited",
		});
	});
});

describe("autonomous timeout power-aware scaling (§5.AF/§5.Z)", () => {
	it("scales every default timeout by the power multiplier (Low Power ≈ ×2)", () => {
		const scaled = withAutonomousNKleinTimeoutSettings(undefined, { powerMultiplier: 2 });
		expect(scaled).toEqual({
			timeoutMode: AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.timeoutMode,
			requestTimeoutMs: AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.requestTimeoutMs * 2,
			streamTimeoutMs: AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.streamTimeoutMs * 2,
			toolTimeoutMs: AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.toolTimeoutMs * 2,
			agentTimeoutMs: AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.agentTimeoutMs * 2,
			conversationTimeoutMs: AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.conversationTimeoutMs * 2,
		});
	});

	it("scales only the FILLED defaults — an explicit per-role timeout is respected as-is", () => {
		const scaled = withAutonomousNKleinTimeoutSettings(
			{ providerId: "lmstudio", streamTimeoutMs: 120_000 },
			{ powerMultiplier: 2 },
		);
		expect(scaled.streamTimeoutMs).toBe(120_000); // explicit → unscaled
		expect(scaled.toolTimeoutMs).toBe(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.toolTimeoutMs * 2); // default → scaled
	});

	it("never SHORTENS: a multiplier ≤ 1 (or absent) leaves the defaults unchanged", () => {
		expect(withAutonomousNKleinTimeoutSettings(undefined, { powerMultiplier: 0.5 })).toEqual(
			AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
		);
		expect(withAutonomousNKleinTimeoutSettings(undefined, { powerMultiplier: 1 })).toEqual(
			AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
		);
	});

	it("leaves an unlimited mode untouched regardless of the multiplier", () => {
		expect(withAutonomousNKleinTimeoutSettings({ timeoutMode: "unlimited" }, { powerMultiplier: 2 })).toEqual({
			timeoutMode: "unlimited",
		});
	});

	it("resolveAutonomousTimeoutPowerMultiplier honors an explicit env scale override (no OS probe)", async () => {
		expect(await resolveAutonomousTimeoutPowerMultiplier({ envScale: "2" })).toBe(2);
		expect(await resolveAutonomousTimeoutPowerMultiplier({ envScale: "1" })).toBe(1);
		expect(await resolveAutonomousTimeoutPowerMultiplier({ envScale: "1.5" })).toBe(1.5);
	});
});
