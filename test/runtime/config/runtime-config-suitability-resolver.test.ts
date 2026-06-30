import { describe, expect, it } from "vitest";

import { resolveRuntimeSuitabilityConfig } from "../../../src/config/runtime-config-suitability-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const globalCfg = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeSuitabilityConfig", () => {
	it("uses the defaults as the effective policy when there is no project override", () => {
		const result = resolveRuntimeSuitabilityConfig(null, null);
		expect(result.modelSuitabilityPolicyOverride).toBeNull();
		expect(result.effectiveModelSuitabilityPolicy).toBe(result.modelSuitabilityPolicyDefaults);
		expect(result.modelSuitabilityPolicyDefaults).toBeTypeOf("object");
	});

	it("yields a fully-defaulted policy object from a null/empty global config", () => {
		expect(resolveRuntimeSuitabilityConfig(globalCfg({}), null).modelSuitabilityPolicyDefaults).toBeTypeOf("object");
	});

	it("exposes exactly the three suitability fields", () => {
		expect(Object.keys(resolveRuntimeSuitabilityConfig(null, null)).sort()).toEqual([
			"effectiveModelSuitabilityPolicy",
			"modelSuitabilityPolicyDefaults",
			"modelSuitabilityPolicyOverride",
		]);
	});
});
