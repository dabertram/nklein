/**
 * §5.AR / §5.AF — decide whether a curated sandbox MCP server FITS in a task's container MEMORY budget, paralleling the
 * §5.AL model-fit gate ({@link import("./mcp-server-model-fit").decideMcpServerModelFit}). Pure + deterministic; the
 * caller supplies the container's cgroup memory limit and this only DECIDES.
 *
 * Why this exists (live-observed 2026-07-11, single-machine smoke): the codebase-memory MCP (2 GB budget) intermittently
 * died with `MCP error -32000: Connection closed` under concurrent worker+index load. Root cause is RESOURCE, not code —
 * the sandbox container is sized for build/test exec spikes (setup-detection.ts: `baseline + N × exec-spike`), NOT for a
 * co-resident 2 GB MCP server, so the MCP's budget + a single build/test spike exceeds the container's cgroup limit →
 * the kernel OOM-kills a process → the MCP's stdio transport closes. Graceful degradation catches it (the worker
 * continues without code localization), but the OOM-kill is non-deterministic (only "under load") and its churn can
 * cascade under concurrency.
 *
 * The fix (todo §5.AF/§5.AR, option 1): rather than launch a heavy MCP into a container that will OOM it mid-work,
 * WITHHOLD it up front when the container can't hold it alongside the worker's own working set. Same graceful end-state
 * (the worker runs without that server), but DETERMINISTIC + predictable — no mid-run crash, no OOM churn. The operator
 * raises `memoryPerContainerMb` (Settings → Agents → isolation pool) to get the server back on a bigger container.
 */

/**
 * MB the container must keep free for everything OTHER than the MCP server: the container baseline plus at least one
 * concurrent build/test command. Mirrors setup-detection.ts's sizing unit (`SANDBOX_CONTAINER_BASELINE_MB` 1024 +
 * one `SANDBOX_EXEC_SPIKE_BUDGET_MB` 1536 = 2560) — a heavy MCP fits only if the container has room for it PLUS the
 * container's own minimum working set. Calibrated to the 2026-07-11 OOM: the 4096 MB DEFAULT container could not hold
 * codebase-memory's 2 GB budget (2048 + 2560 = 4608 > 4096 ⇒ correctly withheld), while a 6 GB+ container fits it.
 */
export const DEFAULT_MCP_WORKER_HEADROOM_MB = 2560;

/** Inputs to the memory-fit decision. All state INJECTED — pure over its inputs (a ledger replay reproduces the verdict). */
export interface McpServerMemoryFitInput {
	/** Stable server id (for telemetry / matching a live server), e.g. `"codebase-memory"`. */
	serverId: string;
	/** The server's peak resident memory budget in MB (e.g. codebase-memory advertises `budget_mb=2048`). */
	memoryBudgetMb: number;
	/**
	 * The container's cgroup memory limit in MB (from the sandbox pool's `memoryPerContainerMb`). `undefined`, non-finite,
	 * or ≤ 0 ⇒ UNBOUNDED — no per-container cgroup limit to OOM against, so the gate does not engage (offer).
	 */
	containerMemoryLimitMb?: number;
	/**
	 * MB the container must keep free for everything besides this server (baseline + ≥ 1 concurrent build/test). Defaults
	 * to {@link DEFAULT_MCP_WORKER_HEADROOM_MB}; the caller can raise it (e.g. per measured worker footprint).
	 */
	workerHeadroomMb?: number;
}

/** The decision: whether the container can host this server, and a short human `reason` for telemetry / operator logs. */
export interface McpServerMemoryFitDecision {
	offer: boolean;
	reason: string;
}

/**
 * Decide whether a curated MCP server fits in a task's container memory alongside the worker's working set. Pure.
 * An unbounded/unknown container limit ⇒ offer (no cgroup limit to OOM against). Otherwise offer iff
 * `containerMemoryLimitMb ≥ memoryBudgetMb + workerHeadroomMb`.
 */
export function decideMcpServerMemoryFit(input: McpServerMemoryFitInput): McpServerMemoryFitDecision {
	const limit = input.containerMemoryLimitMb;
	if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
		return {
			offer: true,
			reason: `${input.serverId}: container memory limit unbounded/unknown — no per-container OOM gate`,
		};
	}
	const headroom = input.workerHeadroomMb ?? DEFAULT_MCP_WORKER_HEADROOM_MB;
	const required = input.memoryBudgetMb + headroom;
	if (limit >= required) {
		return {
			offer: true,
			reason: `${input.serverId}: fits — container ${limit}MB ≥ ${input.memoryBudgetMb}MB budget + ${headroom}MB worker headroom`,
		};
	}
	return {
		offer: false,
		reason: `${input.serverId}: withheld — container ${limit}MB < ${input.memoryBudgetMb}MB budget + ${headroom}MB worker headroom (would OOM-kill under concurrent build/test load)`,
	};
}
