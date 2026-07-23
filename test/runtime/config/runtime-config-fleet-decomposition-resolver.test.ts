import { describe, expect, it } from "vitest";
import {
	areFleetDecompositionSettingsEqual,
	deriveFleetDecompositionFields,
	normalizeFleetDecompositionSettings,
	resolveFleetDecompositionSettings,
} from "../../../src/config/runtime-config-fleet-decomposition-resolver";
import { DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS } from "../../../src/core/api-contract";

describe("fleet decomposition config resolution (F12.110b)", () => {
	it("fails closed to the complete off/default settings", () => {
		expect(normalizeFleetDecompositionSettings(undefined)).toEqual(DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS);
	});

	it("normalizes each field independently and trims model keys", () => {
		expect(
			normalizeFleetDecompositionSettings({
				mode: "fixed_target",
				fixedTargetModelKey: "  host/model  ",
				smallestBasis: "supported_floor",
				smallestSupportedModelKey: "  floor/model  ",
			}),
		).toEqual({
			mode: "fixed_target",
			fixedTargetModelKey: "host/model",
			smallestBasis: "supported_floor",
			smallestSupportedModelKey: "floor/model",
			autoReshardOnFleetChange: true,
		});
	});

	it("resolves project over global and preserves an explicit off override", () => {
		const global = { ...DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS, mode: "auto" as const };
		const project = { ...global, mode: "off" as const };
		const result = deriveFleetDecompositionFields(global, project);
		expect(result.fleetDecompositionDefaults).toEqual(global);
		expect(result.fleetDecompositionOverride).toEqual(project);
		expect(result.effectiveFleetDecompositionSettings).toEqual(project);
	});

	it("compares all five persisted fields", () => {
		const base = { ...DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS, mode: "smallest" as const };
		expect(areFleetDecompositionSettingsEqual(base, { ...base })).toBe(true);
		expect(areFleetDecompositionSettingsEqual(base, { ...base, smallestBasis: "supported_floor" })).toBe(false);
		expect(areFleetDecompositionSettingsEqual(base, { ...base, autoReshardOnFleetChange: false })).toBe(false);
	});

	it("uses resolveScopedOverride precedence for card > project > global, including explicit off", () => {
		const global = { ...DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS, mode: "auto" as const };
		const project = { ...global, mode: "smallest" as const };
		const task = { ...global, mode: "off" as const };
		expect(resolveFleetDecompositionSettings({ global, project, task })).toEqual({ value: task, source: "task" });
		expect(resolveFleetDecompositionSettings({ global, project, task: null })).toEqual({
			value: project,
			source: "project",
		});
		expect(resolveFleetDecompositionSettings({ global })).toEqual({ value: global, source: "global" });
	});
});
