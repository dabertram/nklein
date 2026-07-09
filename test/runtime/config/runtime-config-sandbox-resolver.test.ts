import { describe, expect, it } from "vitest";

import {
	type RuntimeSandboxConfigFields,
	resolveRuntimeSandboxConfig,
} from "../../../src/config/runtime-config-sandbox-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../../../src/nklein-agent/nklein-agent-sandbox";

const defaults: RuntimeSandboxConfigFields = {
	sandboxMaxContainers: DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	sandboxAgentsPerContainer: DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	sandboxMemoryPerContainerMb: DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
	sandboxCpusPerContainer: DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	sandboxMaxConcurrentExec: DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	sandboxIdleTimeoutMinutes: DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	sandboxIsolationProfileDefault: "lean_shared",
	sandboxIsolationProfileOverride: null,
	effectiveSandboxIsolationProfile: "lean_shared",
};

const config = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeSandboxConfig", () => {
	it("falls back to every default for a null config", () => {
		expect(resolveRuntimeSandboxConfig(null)).toEqual(defaults);
	});

	it("reads valid configured values", () => {
		expect(
			resolveRuntimeSandboxConfig(
				config({
					sandboxMaxContainers: 4,
					sandboxAgentsPerContainer: 2,
					sandboxMemoryPerContainerMb: 2048,
					sandboxCpusPerContainer: 1.5,
					sandboxMaxConcurrentExec: 3,
					sandboxIdleTimeoutMinutes: 30,
				}),
			),
		).toEqual({
			sandboxMaxContainers: 4,
			sandboxAgentsPerContainer: 2,
			sandboxMemoryPerContainerMb: 2048,
			sandboxCpusPerContainer: 1.5,
			sandboxMaxConcurrentExec: 3,
			sandboxIdleTimeoutMinutes: 30,
			sandboxIsolationProfileDefault: "custom",
			sandboxIsolationProfileOverride: null,
			effectiveSandboxIsolationProfile: "custom",
		});
	});

	it("rejects invalid values back to their defaults", () => {
		const result = resolveRuntimeSandboxConfig(
			config({ sandboxMaxContainers: 0, sandboxAgentsPerContainer: -1, sandboxMemoryPerContainerMb: Number.NaN }),
		);
		// maxContainers must be POSITIVE (0 → default); agents NON-NEGATIVE (−1 → default); NaN → default.
		expect(result.sandboxMaxContainers).toBe(DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS);
		expect(result.sandboxAgentsPerContainer).toBe(DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER);
		expect(result.sandboxMemoryPerContainerMb).toBe(DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB);
	});

	it("accepts 0 for the non-negative agents-per-container field", () => {
		expect(resolveRuntimeSandboxConfig(config({ sandboxAgentsPerContainer: 0 })).sandboxAgentsPerContainer).toBe(0);
	});

	it("accepts 0 for maxConcurrentExec (disables the spike guard) but rejects a negative back to the default", () => {
		expect(resolveRuntimeSandboxConfig(config({ sandboxMaxConcurrentExec: 0 })).sandboxMaxConcurrentExec).toBe(0);
		expect(resolveRuntimeSandboxConfig(config({ sandboxMaxConcurrentExec: -2 })).sandboxMaxConcurrentExec).toBe(
			DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
		);
	});

	it("forces the lean shared-container profile to one shared pool container", () => {
		expect(
			resolveRuntimeSandboxConfig(
				config({
					sandboxIsolationProfileDefault: "lean_shared",
					sandboxMaxContainers: 8,
					sandboxAgentsPerContainer: 1,
				}),
			),
		).toMatchObject({
			sandboxMaxContainers: 1,
			sandboxAgentsPerContainer: 0,
			sandboxIsolationProfileDefault: "lean_shared",
			effectiveSandboxIsolationProfile: "lean_shared",
		});
	});

	it("maps strict per-agent profile to one agent per container while keeping the configured container cap", () => {
		expect(
			resolveRuntimeSandboxConfig(
				config({
					sandboxIsolationProfileDefault: "strict_per_agent",
					sandboxMaxContainers: 6,
					sandboxAgentsPerContainer: 0,
				}),
			),
		).toMatchObject({
			sandboxMaxContainers: 6,
			sandboxAgentsPerContainer: 1,
			sandboxIsolationProfileDefault: "strict_per_agent",
			effectiveSandboxIsolationProfile: "strict_per_agent",
		});

		expect(
			resolveRuntimeSandboxConfig(config({ sandboxIsolationProfileDefault: "strict_per_agent" }))
				.sandboxMaxContainers,
		).toBe(4);
	});

	it("lets a project override the global sandbox isolation profile", () => {
		expect(
			resolveRuntimeSandboxConfig(config({ sandboxIsolationProfileDefault: "lean_shared" }), {
				sandboxIsolationProfileOverride: "strict_per_agent",
			}),
		).toMatchObject({
			sandboxMaxContainers: 4,
			sandboxAgentsPerContainer: 1,
			sandboxIsolationProfileDefault: "lean_shared",
			sandboxIsolationProfileOverride: "strict_per_agent",
			effectiveSandboxIsolationProfile: "strict_per_agent",
		});
	});
});
