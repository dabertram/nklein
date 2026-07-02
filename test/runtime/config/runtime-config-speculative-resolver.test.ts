import { describe, expect, it } from "vitest";

import {
	DEFAULT_SPECULATIVE_BEST_OF_N_ENABLED,
	DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS,
	DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN,
	type RuntimeSpeculativeConfigFields,
	resolveRuntimeSpeculativeConfig,
	SPECULATIVE_MAX_CONCURRENT_SPECS_CAP,
	SPECULATIVE_MAX_SPECS_PER_RUN_CAP,
} from "../../../src/config/runtime-config-speculative-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const defaults: RuntimeSpeculativeConfigFields = {
	speculativeBestOfNEnabled: DEFAULT_SPECULATIVE_BEST_OF_N_ENABLED,
	speculativeMaxConcurrentSpecs: DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS,
	speculativeMaxSpecsPerRun: DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN,
};

const config = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeSpeculativeConfig", () => {
	it("falls back to every default for a null config (enabled, 1 concurrent, 3 per run)", () => {
		expect(resolveRuntimeSpeculativeConfig(null)).toEqual(defaults);
		expect(DEFAULT_SPECULATIVE_BEST_OF_N_ENABLED).toBe(true);
		expect(DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS).toBe(1);
		expect(DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN).toBe(3);
	});

	it("reads valid configured values", () => {
		expect(
			resolveRuntimeSpeculativeConfig(
				config({
					speculativeBestOfNEnabled: false,
					speculativeMaxConcurrentSpecs: 2,
					speculativeMaxSpecsPerRun: 5,
				}),
			),
		).toEqual({
			speculativeBestOfNEnabled: false,
			speculativeMaxConcurrentSpecs: 2,
			speculativeMaxSpecsPerRun: 5,
		});
	});

	it("stays default-ON: only a literal boolean false disables (opposite polarity of the retrieval gate)", () => {
		for (const value of ["false", 0, "no", {}, [], null, undefined, 1, "true", true]) {
			const result = resolveRuntimeSpeculativeConfig(
				config({ speculativeBestOfNEnabled: value as unknown as boolean }),
			);
			expect(result.speculativeBestOfNEnabled).toBe(true);
		}
		expect(
			resolveRuntimeSpeculativeConfig(config({ speculativeBestOfNEnabled: false })).speculativeBestOfNEnabled,
		).toBe(false);
	});

	it("clamps the integer ceilings to their caps", () => {
		expect(
			resolveRuntimeSpeculativeConfig(config({ speculativeMaxConcurrentSpecs: 99 })).speculativeMaxConcurrentSpecs,
		).toBe(SPECULATIVE_MAX_CONCURRENT_SPECS_CAP);
		expect(resolveRuntimeSpeculativeConfig(config({ speculativeMaxSpecsPerRun: 99 })).speculativeMaxSpecsPerRun).toBe(
			SPECULATIVE_MAX_SPECS_PER_RUN_CAP,
		);
		expect(SPECULATIVE_MAX_CONCURRENT_SPECS_CAP).toBe(4);
		expect(SPECULATIVE_MAX_SPECS_PER_RUN_CAP).toBe(20);
	});

	it("normalizes non-positive/non-integer/non-number ceilings back to their defaults (no 0 = off)", () => {
		for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined, {}, []]) {
			const result = resolveRuntimeSpeculativeConfig(
				config({
					speculativeMaxConcurrentSpecs: value as unknown as number,
					speculativeMaxSpecsPerRun: value as unknown as number,
				}),
			);
			expect(result.speculativeMaxConcurrentSpecs).toBe(DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS);
			expect(result.speculativeMaxSpecsPerRun).toBe(DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN);
		}
	});

	it("keeps in-range integer ceilings unchanged (including the cap boundary)", () => {
		expect(
			resolveRuntimeSpeculativeConfig(config({ speculativeMaxConcurrentSpecs: 4 })).speculativeMaxConcurrentSpecs,
		).toBe(4);
		expect(resolveRuntimeSpeculativeConfig(config({ speculativeMaxSpecsPerRun: 20 })).speculativeMaxSpecsPerRun).toBe(
			20,
		);
		expect(resolveRuntimeSpeculativeConfig(config({ speculativeMaxSpecsPerRun: 1 })).speculativeMaxSpecsPerRun).toBe(
			1,
		);
	});
});
