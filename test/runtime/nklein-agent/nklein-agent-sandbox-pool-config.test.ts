import { describe, expect, it } from "vitest";
import { normalizeAgentSandboxPoolConfig } from "../../../src/nklein-agent/nklein-agent-sandbox-docker";

const defaults = normalizeAgentSandboxPoolConfig(undefined);

describe("normalizeAgentSandboxPoolConfig", () => {
	it("fills every field with a sane default when the config is undefined", () => {
		expect(defaults.maxContainers).toBeGreaterThan(0);
		expect(defaults.memoryPerContainerMb).toBeGreaterThan(0);
		expect(defaults.cpusPerContainer).toBeGreaterThan(0);
		expect(defaults.agentsPerContainer).toBeGreaterThanOrEqual(0);
		expect(defaults.namespace).toBeUndefined();
	});

	it("passes valid overrides through and trims the namespace", () => {
		const config = normalizeAgentSandboxPoolConfig({
			maxContainers: 5,
			agentsPerContainer: 3,
			memoryPerContainerMb: 4096,
			cpusPerContainer: 2.5,
			maxConcurrentExec: 4,
			namespace: "  test  ",
		});
		expect(config).toMatchObject({
			maxContainers: 5,
			agentsPerContainer: 3,
			memoryPerContainerMb: 4096,
			cpusPerContainer: 2.5,
			maxConcurrentExec: 4,
			namespace: "test",
		});
	});

	it("clamps invalid values (0 / negative) back to the default rather than accepting them", () => {
		const config = normalizeAgentSandboxPoolConfig({
			maxContainers: 0,
			memoryPerContainerMb: -5,
			cpusPerContainer: 0,
		});
		expect(config.maxContainers).toBe(defaults.maxContainers);
		expect(config.memoryPerContainerMb).toBe(defaults.memoryPerContainerMb);
		expect(config.cpusPerContainer).toBe(defaults.cpusPerContainer);
	});

	it("treats a blank namespace as unset (undefined)", () => {
		expect(normalizeAgentSandboxPoolConfig({ namespace: "   " }).namespace).toBeUndefined();
	});
});
