import {
	DEFAULT_RUNTIME_SANDBOX_ISOLATION_PROFILE,
	type RuntimeSandboxIsolationProfile,
} from "../core/runtime-config-api-contract";
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
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

const STRICT_AGENT_SANDBOX_DEFAULT_MAX_CONTAINERS = 4;

const SANDBOX_NUMERIC_CONFIG_KEYS = [
	"sandboxMaxContainers",
	"sandboxAgentsPerContainer",
	"sandboxMemoryPerContainerMb",
	"sandboxCpusPerContainer",
	"sandboxMaxConcurrentExec",
	"sandboxIdleTimeoutMinutes",
] as const;

/** The Docker-sandbox pool fields of the resolved runtime config. */
export type RuntimeSandboxConfigFields = Pick<
	RuntimeConfigState,
	| "sandboxMaxContainers"
	| "sandboxAgentsPerContainer"
	| "sandboxMemoryPerContainerMb"
	| "sandboxCpusPerContainer"
	| "sandboxMaxConcurrentExec"
	| "sandboxIdleTimeoutMinutes"
	| "sandboxIsolationProfileDefault"
	| "sandboxIsolationProfileOverride"
	| "effectiveSandboxIsolationProfile"
>;

export function isRuntimeSandboxIsolationProfile(value: unknown): value is RuntimeSandboxIsolationProfile {
	return value === "lean_shared" || value === "strict_per_agent" || value === "custom";
}

function hasLegacySandboxNumericConfig(globalConfig: RuntimeGlobalConfigFileShape | null): boolean {
	if (!globalConfig) {
		return false;
	}
	return SANDBOX_NUMERIC_CONFIG_KEYS.some((key) => Object.hasOwn(globalConfig, key));
}

export function normalizeRuntimeSandboxIsolationProfile(
	value: unknown,
	fallback: RuntimeSandboxIsolationProfile,
): RuntimeSandboxIsolationProfile {
	return isRuntimeSandboxIsolationProfile(value) ? value : fallback;
}

export function normalizeRuntimeSandboxIsolationProfileOverride(value: unknown): RuntimeSandboxIsolationProfile | null {
	return isRuntimeSandboxIsolationProfile(value) ? value : null;
}

/**
 * Resolve the Docker-sandbox pool config block from stored global/project config. The explicit isolation profile is the
 * product-facing control; the numeric fields remain the low-level custom knobs and are preserved for legacy configs.
 */
export function resolveRuntimeSandboxConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null = null,
): RuntimeSandboxConfigFields {
	const profileDefault = normalizeRuntimeSandboxIsolationProfile(
		globalConfig?.sandboxIsolationProfileDefault,
		hasLegacySandboxNumericConfig(globalConfig) ? "custom" : DEFAULT_RUNTIME_SANDBOX_ISOLATION_PROFILE,
	);
	const profileOverride = normalizeRuntimeSandboxIsolationProfileOverride(
		projectConfig?.sandboxIsolationProfileOverride,
	);
	const effectiveProfile = profileOverride ?? profileDefault;

	const sandboxMaxContainers =
		effectiveProfile === "lean_shared"
			? DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS
			: normalizePositiveInteger(
					globalConfig?.sandboxMaxContainers,
					effectiveProfile === "strict_per_agent"
						? STRICT_AGENT_SANDBOX_DEFAULT_MAX_CONTAINERS
						: DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
				);
	const sandboxAgentsPerContainer =
		effectiveProfile === "lean_shared"
			? DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER
			: effectiveProfile === "strict_per_agent"
				? 1
				: normalizeNonNegativeInteger(
						globalConfig?.sandboxAgentsPerContainer,
						DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
					);

	return {
		sandboxMaxContainers,
		sandboxAgentsPerContainer,
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
		sandboxIsolationProfileDefault: profileDefault,
		sandboxIsolationProfileOverride: profileOverride,
		effectiveSandboxIsolationProfile: effectiveProfile,
	};
}
