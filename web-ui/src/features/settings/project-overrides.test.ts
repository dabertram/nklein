import { describe, expect, it } from "vitest";
import { listActiveProjectOverrides } from "./project-overrides";

describe("listActiveProjectOverrides (§10c#9 nav badge)", () => {
	it("returns empty for null/absent config or a config with no overrides", () => {
		expect(listActiveProjectOverrides(null)).toEqual([]);
		expect(listActiveProjectOverrides(undefined)).toEqual([]);
		expect(
			listActiveProjectOverrides({
				maxConcurrentTasksOverride: null,
				selectedAgentIdOverride: null,
				concurrencyOverride: null,
			}),
		).toEqual([]);
	});

	it("lists only the ACTIVE overrides, in stable display order", () => {
		const labels = listActiveProjectOverrides({
			maxConcurrentTasksOverride: 5,
			selectedAgentIdOverride: null,
			sandboxIsolationProfileOverride: "strict_per_agent",
			codeEmbeddingOverride: null,
			concurrencyOverride: { perHost: { m5max: 2 } },
			modelSuitabilityPolicyOverride: { onUnsuitable: "warn", onUnknown: "allow" },
			skillDynamicsLevelOverride: null,
			modelRolesOverride: null,
			agentRulesetsOverride: null,
		});
		expect(labels).toEqual(["Max concurrent tasks", "Sandbox isolation", "Concurrency caps", "Model suitability"]);
	});

	it("counts every override kind when all are set", () => {
		const labels = listActiveProjectOverrides({
			maxConcurrentTasksOverride: 2,
			selectedAgentIdOverride: "nklein",
			sandboxIsolationProfileOverride: "lean_shared",
			codeEmbeddingOverride: {},
			concurrencyOverride: {},
			modelSuitabilityPolicyOverride: {},
			skillDynamicsLevelOverride: "fully_dynamic",
			fileOverlapParallelismOverride: "allow",
			modelRolesOverride: {},
			agentRulesetsOverride: {},
		});
		expect(labels).toHaveLength(10);
	});
});
