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
		// Spike guard: bound concurrent in-container `docker exec` commands so simultaneous heavy commands can't OOM the
		// one shared container. User-tunable via the runtime config (0 disables the guard); setup-detection recommends a
		// value sized against the detected Docker VM.
		maxConcurrentExec: runtimeConfig.sandboxMaxConcurrentExec,
		// Per-instance pool isolation (opt-in): PARALLEL nklein instances on one host (concurrent integration-test
		// backends) otherwise collide on the global container/volume names. Read here at the composition root; unset
		// ⇒ undefined ⇒ the historical global names (byte-identical for a single production instance).
		namespace: process.env.NKLEIN_SANDBOX_NAMESPACE?.trim() || undefined,
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
