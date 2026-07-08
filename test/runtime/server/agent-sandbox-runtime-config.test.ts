import { describe, expect, it } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { resolveAgentSandboxImageName } from "../../../src/nklein-agent/nklein-agent-sandbox";
import {
	buildAgentSandboxPoolConfig,
	buildChatAgentSandboxPoolConfig,
	createCheckingAgentSandboxStatus,
} from "../../../src/server/agent-sandbox-runtime-config";

/** Minimal config stub — buildAgentSandboxPoolConfig only reads the six sandbox fields. */
function config(overrides: Partial<RuntimeConfigState>): RuntimeConfigState {
	return {
		sandboxMaxContainers: 2,
		sandboxAgentsPerContainer: 3,
		sandboxMemoryPerContainerMb: 1024,
		sandboxCpusPerContainer: 2,
		sandboxMaxConcurrentExec: 4,
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
			// Spike guard — mapped one-to-one from the runtime-config field; namespace is undefined (env unset).
			maxConcurrentExec: 4,
		});
	});

	it("converts the idle timeout from minutes to milliseconds", () => {
		expect(buildAgentSandboxPoolConfig(config({ sandboxIdleTimeoutMinutes: 0 })).idleTimeoutMs).toBe(0);
		expect(buildAgentSandboxPoolConfig(config({ sandboxIdleTimeoutMinutes: 10 })).idleTimeoutMs).toBe(600_000);
	});
});

describe("buildChatAgentSandboxPoolConfig", () => {
	it("uses a chat-specific namespace so chat read sandboxes do not collide with task sandboxes", () => {
		const previous = process.env.NKLEIN_SANDBOX_NAMESPACE;
		delete process.env.NKLEIN_SANDBOX_NAMESPACE;
		try {
			expect(buildChatAgentSandboxPoolConfig(config({}))).toMatchObject({
				maxContainers: 2,
				agentsPerContainer: 3,
				namespace: "chat",
			});
		} finally {
			if (previous === undefined) {
				delete process.env.NKLEIN_SANDBOX_NAMESPACE;
			} else {
				process.env.NKLEIN_SANDBOX_NAMESPACE = previous;
			}
		}
	});

	it("preserves a per-process namespace while separating the chat pool", () => {
		const previous = process.env.NKLEIN_SANDBOX_NAMESPACE;
		process.env.NKLEIN_SANDBOX_NAMESPACE = "worker-1";
		try {
			expect(buildChatAgentSandboxPoolConfig(config({})).namespace).toBe("worker-1-chat");
		} finally {
			if (previous === undefined) {
				delete process.env.NKLEIN_SANDBOX_NAMESPACE;
			} else {
				process.env.NKLEIN_SANDBOX_NAMESPACE = previous;
			}
		}
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
