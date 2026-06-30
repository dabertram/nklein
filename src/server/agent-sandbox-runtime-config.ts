import type { RuntimeConfigState } from "../config/runtime-config";
import type { RuntimeAgentSandboxStatus } from "../core/api-contract";
import { type AgentSandboxPoolConfig, resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox";

/**
 * Pure agent-sandbox construction helpers extracted from runtime-server. No I/O — they only map the
 * runtime config / image name into plain config + status objects, so they are behavior-preserving.
 */

/** Map the runtime config's sandbox fields into the agent-sandbox pool config (idle timeout: minutes → ms). */
export function buildAgentSandboxPoolConfig(runtimeConfig: RuntimeConfigState): AgentSandboxPoolConfig {
	return {
		maxContainers: runtimeConfig.sandboxMaxContainers,
		agentsPerContainer: runtimeConfig.sandboxAgentsPerContainer,
		memoryPerContainerMb: runtimeConfig.sandboxMemoryPerContainerMb,
		cpusPerContainer: runtimeConfig.sandboxCpusPerContainer,
		idleTimeoutMs: runtimeConfig.sandboxIdleTimeoutMinutes * 60 * 1000,
	};
}

/** The initial "checking" sandbox status, before docker/image availability has been probed. */
export function createCheckingAgentSandboxStatus(): RuntimeAgentSandboxStatus {
	return {
		state: "checking",
		dockerAvailable: null,
		imageAvailable: null,
		image: resolveAgentSandboxImageName(),
		message: null,
		checkedAt: null,
	};
}
