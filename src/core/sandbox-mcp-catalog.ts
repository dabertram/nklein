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

import {
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
		available: true,
	},
	{
		id: "codebase-memory",
		label: "Codebase Memory",
		// The static binary is baked into the image (§5.AR — `codebase-memory-mcp@0.8.1`, see docker/agent-sandbox/
		// Dockerfile). Bare invocation speaks stdio MCP (matches its published client config `args: []`).
		inContainerArgv: ["codebase-memory-mcp"],
		fit: CODEBASE_MEMORY_FIT,
		available: true,
	},
];

/** The curated servers whose binaries are actually present in the sandbox image (safe to exec). */
export function listAvailableSandboxMcpServers(): readonly SandboxMcpServerDef[] {
	return SANDBOX_MCP_SERVERS.filter((server) => server.available);
}

/**
 * The curated, AVAILABLE servers that should be offered to `modelId` — i.e. present in the image AND cleared by the
 * §5.AL fit gate ("for models where it fits"). Pure. The runtime pairs each with a `docker exec` transport
 * ({@link buildSandboxMcpDockerExecArgs}) and adds its tools to the model's bundle.
 */
export function selectSandboxMcpServersForModel(modelId: string): readonly SandboxMcpServerDef[] {
	return listAvailableSandboxMcpServers().filter((server) => decideMcpServerModelFitById(server.fit, modelId).offer);
}

/** The identity of a task's sandbox container needed to build a `docker exec` into it. */
export interface SandboxExecTarget {
	/** The Docker container name (e.g. from `createAgentSandboxContainerName(slot)`). */
	containerName: string;
	/** The task user's uid (the sandbox runs the agent as an unprivileged uid). */
	uid: number;
	/** The task's working directory inside the container. */
	workdir: string;
}

/**
 * Build the `docker` ARGV that launches a curated MCP server inside a task's sandbox container over a persistent stdio
 * pipe. Mirrors the sandbox's own `execAsTaskUser` shape (`exec -u <uid> -w <workdir> <container> …`) but ADDS `-i` so
 * stdin stays open for the bidirectional MCP JSON-RPC stream. Pure — returns the argv for an MCP stdio transport whose
 * `command` is `"docker"`; the caller spawns it. NOTE: the returned process runs on the host, but it is only the
 * `docker exec` pipe — the MCP server itself runs INSIDE the container (isolation intact, invariant #2).
 */
export function buildSandboxMcpDockerExecArgs(target: SandboxExecTarget, inContainerArgv: readonly string[]): string[] {
	return ["exec", "-i", "-u", String(target.uid), "-w", target.workdir, target.containerName, ...inContainerArgv];
}
