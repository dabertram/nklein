import { describe, expect, it } from "vitest";

import { resolveRuntimeRulesetsConfig } from "../../../src/config/runtime-config-rulesets-resolver";

describe("resolveRuntimeRulesetsConfig", () => {
	it("uses the default rulesets as effective when there is no project override", () => {
		const result = resolveRuntimeRulesetsConfig(null, null);
		expect(result.agentRulesetsOverride).toBeNull();
		expect(result.effectiveAgentRulesets).toBe(result.agentRulesets);
		expect(result.agentRulesets).toBeTypeOf("object");
	});

	it("exposes exactly the three ruleset fields", () => {
		expect(Object.keys(resolveRuntimeRulesetsConfig(null, null)).sort()).toEqual([
			"agentRulesets",
			"agentRulesetsOverride",
			"effectiveAgentRulesets",
		]);
	});
});
