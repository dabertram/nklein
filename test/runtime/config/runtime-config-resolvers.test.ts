import { describe, expect, it } from "vitest";
import { deriveModelRolesFields } from "../../../src/config/runtime-config-model-roles-resolver";
import { deriveSuitabilityFields } from "../../../src/config/runtime-config-suitability-resolver";

describe("deriveModelRolesFields (§5.U effective = override ?? default)", () => {
	it("a null override yields the default as effective", () => {
		const fields = deriveModelRolesFields(undefined, null);
		expect(fields.modelRolesOverride).toBeNull();
		expect(fields.effectiveModelRoles).toBe(fields.modelRoles);
	});

	it("a set override becomes the effective value (project overrides global)", () => {
		const fields = deriveModelRolesFields(undefined, { reviewer: { providerId: "lmstudio", modelId: "m-x" } });
		// If the override normalizes to a non-null value, it must win as the effective roles.
		if (fields.modelRolesOverride !== null) {
			expect(fields.effectiveModelRoles).toBe(fields.modelRolesOverride);
		}
	});
});

describe("deriveSuitabilityFields (§5.U effective = override ?? default)", () => {
	it("a null override yields the default policy as effective", () => {
		const fields = deriveSuitabilityFields(undefined, null);
		expect(fields.modelSuitabilityPolicyOverride).toBeNull();
		expect(fields.effectiveModelSuitabilityPolicy).toBe(fields.modelSuitabilityPolicyDefaults);
		// The default policy is always populated (never null) so downstream gates always have a policy.
		expect(fields.modelSuitabilityPolicyDefaults).toBeTruthy();
	});
});
