import { describe, expect, it } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { buildCommunitySkillExecutionEnvironment } from "../../../src/server/community-skill-execution-environment";

function config(overrides: Partial<RuntimeConfigState> = {}): RuntimeConfigState {
	return {
		effectiveAgentRulesets: {
			capability: { globalPreset: "fully_open" },
			delivery: { globalPreset: "fully_open" },
		},
		sandboxEgressProxyEnabled: true,
		sandboxEgressAllowlist: "api.example.test,worker:worker.example.test",
		...overrides,
	} as RuntimeConfigState;
}

describe("buildCommunitySkillExecutionEnvironment", () => {
	it("derives Docker tools and authenticated egress from trusted workspace policy", () => {
		const result = buildCommunitySkillExecutionEnvironment(config(), "worker");
		expect(result).toMatchObject({
			requestedNetworkPolicy: "full",
			dockerSandbox: true,
			sensitiveAccess: false,
			ambientCredentialNames: [],
			taskScopedEgressIdentity: true,
		});
		expect(result.availableTools.map(({ name }) => name)).toEqual(
			expect.arrayContaining(["read_files", "write_file", "web_search"]),
		);
		expect(result.availableTools.map(({ name }) => name)).not.toContain("run_commands");
		expect(result.availableTools.every(({ manifest }) => manifest.fsScope !== "host")).toBe(true);
	});

	it("does not advertise egress tools when the authenticated proxy route is unavailable", () => {
		const result = buildCommunitySkillExecutionEnvironment(config({ sandboxEgressProxyEnabled: false }), "worker");
		expect(result.taskScopedEgressIdentity).toBe(false);
		expect(result.availableTools.map(({ name }) => name)).not.toContain("web_search");
	});

	it("honours the role's strict offline ruleset", () => {
		const result = buildCommunitySkillExecutionEnvironment(
			config({
				effectiveAgentRulesets: {
					capability: { globalPreset: "fully_open", roleOverrides: { reviewer: "strict" } },
					delivery: { globalPreset: "fully_open" },
				},
			}),
			"reviewer",
		);
		expect(result).toMatchObject({ requestedNetworkPolicy: "none", taskScopedEgressIdentity: false });
		expect(result.availableTools.map(({ name }) => name)).not.toContain("web_search");
	});
});
