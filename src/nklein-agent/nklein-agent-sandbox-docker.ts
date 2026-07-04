// Pure Docker construction for the agent sandbox (extracted from nklein-agent-sandbox.ts, §5.U): the sandbox
// tuning constants, the pool/run-option types, and the argument/name/uid builders. Self-contained (depends only
// on normalize-number, agent-rulesets, and node:crypto), so the `docker run` argv, container/volume naming, and
// the deterministic per-task uid are unit-testable away from the effectful AgentSandboxManager. The sandbox
// module re-exports this surface so existing importers (runtime-config, server, task-session-service) are unchanged.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { type SandboxNetworkPolicy, sandboxNetworkHasEgress } from "../core/agent-rulesets";
import {
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
} from "../core/normalize-number";

export const DEFAULT_AGENT_SANDBOX_IMAGE = "nklein/agent-sandbox:0.0.1";
export const AGENT_SANDBOX_IMAGE_ENV = "NKLEIN_AGENT_SANDBOX_IMAGE";
export const AGENT_SANDBOX_CONTAINER_LABEL = "nklein.kind=agent-sandbox";
export const AGENT_SANDBOX_VOLUME_PREFIX = "nklein-agent-ws";
export const AGENT_SANDBOX_CONTAINER_PREFIX = "nklein-agent-sandbox";
export const AGENT_SANDBOX_WORKSPACES_DIR = "/workspaces";
export const DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES = 10;
export const DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MS = DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB = 2048;
export const DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER = 2;
export const DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS = 1;
export const DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER = 0;
const TASK_UID_BASE = 70_000;
const TASK_UID_SPAN = 20_000;

export interface AgentSandboxPoolConfig {
	maxContainers: number;
	agentsPerContainer: number;
	memoryPerContainerMb: number;
	cpusPerContainer: number;
	idleTimeoutMs: number;
	/**
	 * Optional per-INSTANCE discriminator woven into the container/volume names (`nklein-agent-sandbox[-<namespace>]-<slot>`).
	 * `undefined` (the default) ⇒ the historical global names — byte-identical for a single production instance. Set it to
	 * isolate the pool of PARALLEL nklein instances on one host (e.g. concurrent integration-test backends, which otherwise
	 * all collide on `nklein-agent-sandbox-1`). NOTE: startup orphan-reaping is by label, so a namespaced instance must
	 * skip the reap (tests set NKLEIN_SANDBOX_SKIP_STARTUP_REAP) — cross-namespace reaping is a follow-up.
	 */
	namespace?: string;
}

export interface AgentSandboxProjectMount {
	projectKey: string;
	projectRepoPath: string;
}

export interface AgentSandboxDockerRunOptions {
	slot: number;
	image: string;
	projectMounts: readonly AgentSandboxProjectMount[];
	config: AgentSandboxPoolConfig;
	/**
	 * Sandbox network posture from the resolved capability ruleset. Defaults to `"none"` (the historical,
	 * fully-isolated behavior). Docker isolation itself (cap-drop, read-only rootfs, etc.) is unconditional and
	 * NEVER affected by this value — only outbound network reachability changes.
	 */
	networkPolicy?: SandboxNetworkPolicy;
}

export function normalizeAgentSandboxPoolConfig(
	config: Partial<AgentSandboxPoolConfig> | undefined,
): AgentSandboxPoolConfig {
	return {
		maxContainers: normalizePositiveInteger(config?.maxContainers, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
		agentsPerContainer: normalizeNonNegativeInteger(
			config?.agentsPerContainer,
			DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
		),
		memoryPerContainerMb: normalizePositiveInteger(
			config?.memoryPerContainerMb,
			DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
		),
		cpusPerContainer: normalizePositiveNumber(config?.cpusPerContainer, DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER),
		idleTimeoutMs: normalizeNonNegativeInteger(config?.idleTimeoutMs, DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MS),
		namespace: config?.namespace?.trim() ? config.namespace.trim() : undefined,
	};
}

export function resolveAgentSandboxImageName(): string {
	return process.env[AGENT_SANDBOX_IMAGE_ENV]?.trim() || DEFAULT_AGENT_SANDBOX_IMAGE;
}

export function createAgentSandboxProjectKey(projectRepoPath: string): string {
	// CANONICALIZE before hashing (run19 root cause): the same repo reached this seam under two spellings —
	// macOS's `/var/folders/...` TMPDIR symlink vs the resolved `/private/var/folders/...` — hashing to two
	// different keys. The container was started with a mount for one key, then the review/acceptance prep asked
	// for the other, and `git clone /repos/<otherKey>` failed ("repository does not exist"), fail-closing every
	// delivery. realpath makes every spelling of one directory produce ONE key (fallback: the raw path).
	let canonicalPath = projectRepoPath;
	try {
		canonicalPath = realpathSync(projectRepoPath);
	} catch {
		// Path may not exist yet (tests, dry paths) — hash the raw string rather than throw.
	}
	return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 12);
}

export function createAgentSandboxTaskUid(taskId: string): number {
	const digest = createHash("sha256").update(taskId).digest();
	const offset = digest.readUInt32BE(0) % TASK_UID_SPAN;
	return TASK_UID_BASE + offset;
}

/**
 * Map a resolved {@link SandboxNetworkPolicy} to Docker `--network` arguments.
 *
 *  - `none`  → `--network none` (no outbound reachability; the historical default).
 *  - `full`  → `--network bridge` (default bridge network with NAT egress).
 *  - `allowlist` → **fail-closed to `none` for now.** A real per-domain egress allowlist needs an egress proxy
 *    or firewalled network that does not yet exist; granting full egress under an "allowlist" label would be a
 *    security lie, so until the proxy lands we deny rather than over-grant. Tracked as a follow-up.
 *
 * Hard invariant: this only changes outbound reachability. The container's other isolation flags
 * (`--cap-drop ALL`, `--read-only`, `no-new-privileges`, tmpfs, read-only mounts) are unconditional.
 */
export function resolveAgentSandboxNetworkArgs(policy: SandboxNetworkPolicy): string[] {
	return sandboxNetworkHasEgress(policy) ? ["--network", "bridge"] : ["--network", "none"];
}

export function buildAgentSandboxDockerRunArgs(options: AgentSandboxDockerRunOptions): string[] {
	const containerName = createAgentSandboxContainerName(options.slot, options.config.namespace);
	const volumeName = createAgentSandboxVolumeName(options.slot, options.config.namespace);
	const pidsLimit =
		options.config.agentsPerContainer > 0 ? Math.max(256, 256 * options.config.agentsPerContainer) : 1024;
	const args = [
		"run",
		"-d",
		"--name",
		containerName,
		"--label",
		AGENT_SANDBOX_CONTAINER_LABEL,
		"--label",
		`nklein.slot=${options.slot}`,
		...resolveAgentSandboxNetworkArgs(options.networkPolicy ?? "none"),
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		String(pidsLimit),
		"--memory",
		`${options.config.memoryPerContainerMb}m`,
		"--cpus",
		String(options.config.cpusPerContainer),
		"--read-only",
		"--tmpfs",
		"/tmp:noexec,nosuid,size=512m",
		"--mount",
		`type=volume,src=${volumeName},dst=${AGENT_SANDBOX_WORKSPACES_DIR}`,
		"--user",
		"0:0",
	];
	for (const mount of options.projectMounts) {
		args.push("--mount", `type=bind,src=${mount.projectRepoPath},dst=/repos/${mount.projectKey},readonly`);
	}
	args.push(options.image, "sleep", "infinity");
	return args;
}

export function createAgentSandboxContainerName(slot: number, namespace?: string): string {
	const ns = namespace?.trim();
	return ns ? `${AGENT_SANDBOX_CONTAINER_PREFIX}-${ns}-${slot}` : `${AGENT_SANDBOX_CONTAINER_PREFIX}-${slot}`;
}

export function createAgentSandboxVolumeName(slot: number, namespace?: string): string {
	const ns = namespace?.trim();
	return ns ? `${AGENT_SANDBOX_VOLUME_PREFIX}-${ns}-${slot}` : `${AGENT_SANDBOX_VOLUME_PREFIX}-${slot}`;
}
