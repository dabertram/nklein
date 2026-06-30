import { describe, expect, it } from "vitest";

import { resolveRuntimeAgentIdConfig } from "../../../src/config/runtime-config-agent-id-resolver";

describe("resolveRuntimeAgentIdConfig", () => {
	it("uses the default agent id as effective when there is no project override", () => {
		const result = resolveRuntimeAgentIdConfig(null, null);
		expect(result.selectedAgentIdOverride).toBeNull();
		expect(result.effectiveSelectedAgentId).toBe(result.selectedAgentId);
	});

	it("exposes exactly the three agent-id fields", () => {
		expect(Object.keys(resolveRuntimeAgentIdConfig(null, null)).sort()).toEqual([
			"effectiveSelectedAgentId",
			"selectedAgentId",
			"selectedAgentIdOverride",
		]);
	});
});
