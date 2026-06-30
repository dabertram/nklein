import { describe, expect, it } from "vitest";

import { resolveRuntimeEmbeddingConfig } from "../../../src/config/runtime-config-embedding-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const globalCfg = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeEmbeddingConfig", () => {
	it("uses the defaults as the effective settings when there is no project override", () => {
		const result = resolveRuntimeEmbeddingConfig(null, null);
		expect(result.codeEmbeddingOverride).toBeNull();
		// `effective = override ?? defaults` → with no override, effective IS the defaults object.
		expect(result.effectiveCodeEmbeddingSettings).toBe(result.codeEmbeddingDefaults);
		expect(result.codeEmbeddingDefaults).toBeTypeOf("object");
	});

	it("resolves the defaults from the global config", () => {
		// A null global still yields a fully-defaulted settings object (no throw, no null).
		expect(resolveRuntimeEmbeddingConfig(globalCfg({}), null).codeEmbeddingDefaults).toBeTypeOf("object");
	});

	it("exposes exactly the three embedding fields", () => {
		expect(Object.keys(resolveRuntimeEmbeddingConfig(null, null)).sort()).toEqual([
			"codeEmbeddingDefaults",
			"codeEmbeddingOverride",
			"effectiveCodeEmbeddingSettings",
		]);
	});
});
