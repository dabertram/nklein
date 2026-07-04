import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox";
import {
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
} from "./runtime-config-normalizers";
import type { RuntimeConfigState, RuntimeGlobalConfigFileShape } from "./runtime-config-types";

/** The Docker-sandbox pool fields of the resolved runtime config. */
export type RuntimeSandboxConfigFields = Pick<
	RuntimeConfigState,
	| "sandboxMaxContainers"
	| "sandboxAgentsPerContainer"
	| "sandboxMemoryPerContainerMb"
	| "sandboxCpusPerContainer"
	| "sandboxMaxConcurrentExec"
	| "sandboxIdleTimeoutMinutes"
>;

/**
 * Resolve the Docker-sandbox pool config block from a stored global config, each field falling back
 * to its default. Extracted from the toRuntimeConfigState builder (§5.U) so the big config-state
 * assembly reads as a set of focused, independently-tested sub-resolvers.
 */
export function resolveRuntimeSandboxConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
): RuntimeSandboxConfigFields {
	return {
		sandboxMaxContainers: normalizePositiveInteger(
			globalConfig?.sandboxMaxContainers,
			DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
		),
		sandboxAgentsPerContainer: normalizeNonNegativeInteger(
			globalConfig?.sandboxAgentsPerContainer,
			DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
		),
		sandboxMemoryPerContainerMb: normalizePositiveInteger(
			globalConfig?.sandboxMemoryPerContainerMb,
			DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
		),
		sandboxCpusPerContainer: normalizePositiveNumber(
			globalConfig?.sandboxCpusPerContainer,
			DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
		),
		// Non-negative: 0 is a legal value that DISABLES the spike guard (unbounded concurrent execs).
		sandboxMaxConcurrentExec: normalizeNonNegativeInteger(
			globalConfig?.sandboxMaxConcurrentExec,
			DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
		),
		sandboxIdleTimeoutMinutes: normalizePositiveInteger(
			globalConfig?.sandboxIdleTimeoutMinutes,
			DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
		),
	};
}
