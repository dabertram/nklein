/**
 * §5.AR — the curated catalog of MCP servers that !Klein hosts INSIDE the agent sandbox, plus the pure helpers that
 * decide which ones a given model should get and how to launch each over `docker exec`. No I/O, no Docker, no registry —
 * this only describes + decides; the sandbox/runtime layer consumes it.
 *
 * Why sandbox-hosted (user 2026-07-01): stdio MCP servers are otherwise hard-disabled under strict isolation (spawning a
 * host process breaks invariant #2). Baking the server binaries into the sandbox image and reaching them via
 * `docker exec -i <container> <cmd>` keeps the server IN the container (the host only runs the `docker exec` pipe, exactly
 * like every other sandbox tool call), so isolation holds and — because the binaries ship in the image — nothing is
 * fetched at runtime (prime-directive #1; the container runs `--network none`).
 *
 * Each server carries its §5.AL model-fit profile ({@link McpServerModelFitProfile}), so the "for models where it fits"
 * gate ({@link decideMcpServerModelFitById}) is applied uniformly: a server is offered to a task only when its model fits.
 */

import { decideMcpServerMemoryFit } from "./mcp-server-memory-fit";
import {
	BASIC_MEMORY_FIT,
	CODEBASE_MEMORY_FIT,
	decideMcpServerModelFitById,
	type McpServerModelFitProfile,
	SEQUENTIAL_THINKING_FIT,
} from "./mcp-server-model-fit";

/** A curated MCP server hosted inside the sandbox image. */
export interface SandboxMcpServerDef {
	/** Stable id — matches the fit profile's `serverId` and the settings opt-out key. */
	id: string;
	/** Display label for logs / UI. */
	label: string;
	/**
	 * The argv to launch the server INSIDE the container (the binary is baked into the sandbox image). The first element
	 * is the in-container executable (e.g. `mcp-server-sequential-thinking`); it speaks MCP over stdio.
	 */
	inContainerArgv: readonly string[];
	/** The §5.AL model-fit profile — gates which models get this server (see {@link selectSandboxMcpServersForModel}). */
	fit: McpServerModelFitProfile;
	/**
	 * Peak resident memory budget in MB — feeds the §5.AF memory-fit gate
	 * ({@link import("./mcp-server-memory-fit").decideMcpServerMemoryFit}) so a heavy server is withheld from a container
	 * too small to host it alongside the worker (the codebase-memory OOM-under-load fix). codebase-memory advertises
	 * `budget_mb=2048`; the lightweight scaffolds (sequential-thinking, basic-memory) reserve conservatively small.
	 */
	memoryBudgetMb: number;
	/**
	 * Whether the server's binary is actually present in the current sandbox image. Both `sequential-thinking` (§5.AR
	 * increment 1) and `codebase-memory` (`codebase-memory-mcp@0.8.1`, its static binary + compiled-in embeddings baked
	 * in via docker/agent-sandbox/Dockerfile) now ship in the image — {@link listAvailableSandboxMcpServers} filters on
	 * this so we never try to exec a missing binary.
	 */
	available: boolean;
}

/**
 * The curated registry. Order is display order. `available` reflects what the sandbox image currently ships — keep it
 * in lock-step with docker/agent-sandbox/Dockerfile (a server is `available: true` only once its binary is baked in).
 */
export const SANDBOX_MCP_SERVERS: readonly SandboxMcpServerDef[] = [
	{
		id: "sequential-thinking",
		label: "Sequential Thinking",
		inContainerArgv: ["mcp-server-sequential-thinking"],
		fit: SEQUENTIAL_THINKING_FIT,
		// A stateless reasoning scaffold (no embeddings/index) — a small node process; conservatively 256 MB.
		memoryBudgetMb: 256,
		available: true,
	},
	{
		id: "codebase-memory",
		label: "Codebase Memory",
		// The static binary is baked into the image (§5.AR — `codebase-memory-mcp@0.8.1`, see docker/agent-sandbox/
		// Dockerfile). Bare invocation speaks stdio MCP (matches its published client config `args: []`).
		inContainerArgv: ["codebase-memory-mcp"],
		fit: CODEBASE_MEMORY_FIT,
		// The heavy one: compiled-in embeddings + a code graph. It advertises `mem.init budget_mb=2048` on startup — this
		// 2 GB is what OOM-kills the 4 GB default container under concurrent load, so the memory-fit gate keys on it.
		memoryBudgetMb: 2048,
		available: true,
	},
	{
		id: "basic-memory",
		label: "Basic Memory",
		// §5.AR authored markdown-graph memory, baked into the image (uv tool install basic-memory==0.22.1, see docker/
		// agent-sandbox/Dockerfile). `basic-memory mcp` forces STDIO (the published image CMD defaults to an SSE server).
		// A failed connect degrades gracefully (createToolBundle try/catch → warning), so this is safe pre-rebuild.
		inContainerArgv: ["basic-memory", "mcp"],
		fit: BASIC_MEMORY_FIT,
		// A python/uv markdown-graph store — moderate; conservatively 512 MB (fits the default container).
		memoryBudgetMb: 512,
		available: true,
	},
];

/** The curated servers whose binaries are actually present in the sandbox image (safe to exec). */
export function listAvailableSandboxMcpServers(): readonly SandboxMcpServerDef[] {
	return SANDBOX_MCP_SERVERS.filter((server) => server.available);
}

/**
 * The curated, AVAILABLE servers that should be offered to `modelId` on a container with `containerMemoryLimitMb` — i.e.
 * present in the image AND cleared by BOTH the §5.AL model-fit gate ("for models where it fits") AND the §5.AF memory-fit
 * gate ("for containers that can host it without OOM"). Pure. `containerMemoryLimitMb` omitted/unbounded ⇒ the memory gate
 * does not engage (backward-compatible: model-fit only). The runtime pairs each survivor with a `docker exec` transport
 * ({@link buildSandboxMcpDockerExecArgs}) and adds its tools to the model's bundle.
 */
export function selectSandboxMcpServersForModel(
	modelId: string,
	containerMemoryLimitMb?: number,
): readonly SandboxMcpServerDef[] {
	return listAvailableSandboxMcpServers().filter(
		(server) =>
			decideMcpServerModelFitById(server.fit, modelId).offer &&
			decideMcpServerMemoryFit({
				serverId: server.id,
				memoryBudgetMb: server.memoryBudgetMb,
				containerMemoryLimitMb,
			}).offer,
	);
}

/** A server the MODEL gate would have offered but the §5.AF MEMORY gate withheld — surfaced so the loss isn't silent. */
export interface MemoryWithheldSandboxServer {
	id: string;
	label: string;
	/** The memory-fit reason (container size vs budget + headroom). */
	reason: string;
}

/**
 * The available, MODEL-fitting servers that the MEMORY-fit gate WITHHELD for `containerMemoryLimitMb` — i.e. servers a
 * bigger container would have gotten. Pure. Used to WARN the operator (no silent loss of a capability): on the 4 GB
 * default container this returns codebase-memory, so the runtime can tell them why localization is off + how to fix it.
 * Empty when the memory limit is unbounded/omitted (the gate doesn't engage) or nothing is withheld.
 */
export function listMemoryWithheldSandboxServers(
	modelId: string,
	containerMemoryLimitMb: number | undefined,
): MemoryWithheldSandboxServer[] {
	const withheld: MemoryWithheldSandboxServer[] = [];
	for (const server of listAvailableSandboxMcpServers()) {
		if (!decideMcpServerModelFitById(server.fit, modelId).offer) {
			continue; // the model gate would skip it regardless — not a memory-driven loss.
		}
		const memory = decideMcpServerMemoryFit({
			serverId: server.id,
			memoryBudgetMb: server.memoryBudgetMb,
			containerMemoryLimitMb,
		});
		if (!memory.offer) {
			withheld.push({ id: server.id, label: server.label, reason: memory.reason });
		}
	}
	return withheld;
}

/**
 * Server ids that stay OFF by default even when baked + model-fitting — they require an EXPLICIT opt-in. `basic-memory`
 * is write-capable authored memory: a durable free-form store is only trustworthy once the §5.AW strong-model audit is
 * running, so it must be deliberately enabled (global/per-project setting), never on by default.
 */
export const DEFAULT_OFF_SANDBOX_MCP_SERVERS: readonly string[] = ["basic-memory"];

/**
 * Drop any default-OFF server not present in `enabledOptIns` (pure). Read-only, low-risk servers (sequential-thinking,
 * codebase-memory) pass through untouched; a default-OFF server (basic-memory) is kept only when explicitly enabled.
 */
export function filterEnabledSandboxServers(
	servers: readonly SandboxMcpServerDef[],
	enabledOptIns: ReadonlySet<string>,
): readonly SandboxMcpServerDef[] {
	return servers.filter(
		(server) => !DEFAULT_OFF_SANDBOX_MCP_SERVERS.includes(server.id) || enabledOptIns.has(server.id),
	);
}

/** The identity of a task's sandbox container needed to build a `docker exec` into it. */
export interface SandboxExecTarget {
	/** The Docker container name (e.g. from `createAgentSandboxContainerName(slot)`). */
	containerName: string;
	/** The task user's uid (the sandbox runs the agent as an unprivileged uid). */
	uid: number;
	/** The task's working directory inside the container. */
	workdir: string;
	/**
	 * The container's cgroup memory limit in MB (the pool's `memoryPerContainerMb`). Rides along with the exec target
	 * so {@link selectSandboxMcpServersForModel} can apply the §5.AF memory-fit gate — withholding a heavy MCP server
	 * from a container too small to host it without OOM. Optional/absent ⇒ treated as unbounded (gate does not engage).
	 */
	memoryLimitMb?: number;
}

/**
 * Build the `docker` ARGV that launches a curated MCP server inside a task's sandbox container over a persistent stdio
 * pipe. Mirrors the sandbox's own `execAsTaskUser` shape (`exec -u <uid> -w <workdir> <container> …`) but ADDS `-i` so
 * stdin stays open for the bidirectional MCP JSON-RPC stream. Pure — returns the argv for an MCP stdio transport whose
 * `command` is `"docker"`; the caller spawns it. NOTE: the returned process runs on the host, but it is only the
 * `docker exec` pipe — the MCP server itself runs INSIDE the container (isolation intact, invariant #2).
 *
 * `env` (optional) adds `-e KEY=VALUE` pairs BEFORE the container name — the per-server scoping + egress-hardening env
 * some curated servers need (e.g. basic-memory's BASIC_MEMORY_CONFIG_DIR / BASIC_MEMORY_MCP_PROJECT + hardening). Keys
 * are emitted in a stable (sorted) order so the argv is deterministic. Values are passed as literal `-e KEY=VALUE`
 * tokens (argv, never a shell string — no interpolation/injection surface).
 */
export function buildSandboxMcpDockerExecArgs(
	target: SandboxExecTarget,
	inContainerArgv: readonly string[],
	env?: Record<string, string>,
): string[] {
	const envArgs = env
		? Object.keys(env)
				.sort()
				.flatMap((key) => ["-e", `${key}=${env[key]}`])
		: [];
	return [
		"exec",
		"-i",
		"-u",
		String(target.uid),
		"-w",
		target.workdir,
		...envArgs,
		target.containerName,
		...inContainerArgv,
	];
}
