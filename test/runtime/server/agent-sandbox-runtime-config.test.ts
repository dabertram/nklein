import { describe, expect, it } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { resolveAgentSandboxImageName } from "../../../src/nklein-agent/nklein-agent-sandbox";
import {
	buildAgentSandboxPoolConfig,
	createCheckingAgentSandboxStatus,
} from "../../../src/server/agent-sandbox-runtime-config";

/** Minimal config stub — buildAgentSandboxPoolConfig only reads the five sandbox fields. */
function config(overrides: Partial<RuntimeConfigState>): RuntimeConfigState {
	return {
		sandboxMaxContainers: 2,
		sandboxAgentsPerContainer: 3,
		sandboxMemoryPerContainerMb: 1024,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 5,
		...overrides,
	} as RuntimeConfigState;
}

describe("buildAgentSandboxPoolConfig", () => {
	it("maps the sandbox config fields one-to-one", () => {
		expect(buildAgentSandboxPoolConfig(config({}))).toEqual({
			maxContainers: 2,
			agentsPerContainer: 3,
			memoryPerContainerMb: 1024,
			cpusPerContainer: 2,
			idleTimeoutMs: 5 * 60 * 1000,
		});
	});

	it("converts the idle timeout from minutes to milliseconds", () => {
		expect(buildAgentSandboxPoolConfig(config({ sandboxIdleTimeoutMinutes: 0 })).idleTimeoutMs).toBe(0);
		expect(buildAgentSandboxPoolConfig(config({ sandboxIdleTimeoutMinutes: 10 })).idleTimeoutMs).toBe(600_000);
	});
});

describe("createCheckingAgentSandboxStatus", () => {
	it("returns the initial checking status with unprobed availability", () => {
		expect(createCheckingAgentSandboxStatus()).toEqual({
			state: "checking",
			dockerAvailable: null,
			imageAvailable: null,
			image: resolveAgentSandboxImageName(),
			message: null,
			checkedAt: null,
		});
	});
});
