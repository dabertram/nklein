import { describe, expect, it } from "vitest";

import { resolveRuntimeModelRolesConfig } from "../../../src/config/runtime-config-model-roles-resolver";

describe("resolveRuntimeModelRolesConfig", () => {
	it("uses the default roles as effective when there is no project override", () => {
		const result = resolveRuntimeModelRolesConfig(null, null);
		expect(result.modelRolesOverride).toBeNull();
		expect(result.effectiveModelRoles).toBe(result.modelRoles);
		expect(result.modelRoles).toBeTypeOf("object");
	});

	it("exposes exactly the three model-roles fields", () => {
		expect(Object.keys(resolveRuntimeModelRolesConfig(null, null)).sort()).toEqual([
			"effectiveModelRoles",
			"modelRoles",
			"modelRolesOverride",
		]);
	});
});
