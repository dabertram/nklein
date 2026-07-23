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
			sandboxMcpServersEnabledOverride: false,
			sandboxMcpServerOverrides: { "codebase-memory": false },
		});
		expect(labels).toEqual([
			"Max concurrent tasks",
			"Sandbox isolation",
			"Concurrency caps",
			"Model suitability",
			"Curated MCP master",
			"Curated MCP servers",
		]);
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
			fleetDecompositionOverride: { mode: "off" },
			fileOverlapParallelismOverride: "allow",
			modelRolesOverride: {},
			agentRulesetsOverride: {},
			sandboxMcpServersEnabledOverride: true,
			sandboxMcpServerOverrides: { "basic-memory": true },
		});
		expect(labels).toHaveLength(13);
		expect(labels).toContain("Fleet decomposition");
	});
});
