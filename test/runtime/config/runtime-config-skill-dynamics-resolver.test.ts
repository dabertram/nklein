import { describe, expect, it } from "vitest";

import { resolveRuntimeSkillDynamicsConfig } from "../../../src/config/runtime-config-skill-dynamics-resolver";

describe("resolveRuntimeSkillDynamicsConfig", () => {
	it("uses the default level as effective when there is no project override", () => {
		const result = resolveRuntimeSkillDynamicsConfig(null, null);
		expect(result.skillDynamicsLevelOverride).toBeNull();
		expect(result.effectiveSkillDynamicsLevel).toBe(result.skillDynamicsLevelDefault);
	});

	it("reports a defined default level (never null) for an absent config", () => {
		const result = resolveRuntimeSkillDynamicsConfig(null, null);
		expect(result.skillDynamicsLevelDefault).toBeDefined();
		expect(result.skillDynamicsLevelDefault).not.toBeNull();
	});

	it("exposes exactly the three skill-dynamics fields", () => {
		expect(Object.keys(resolveRuntimeSkillDynamicsConfig(null, null)).sort()).toEqual([
			"effectiveSkillDynamicsLevel",
			"skillDynamicsLevelDefault",
			"skillDynamicsLevelOverride",
		]);
	});
});
