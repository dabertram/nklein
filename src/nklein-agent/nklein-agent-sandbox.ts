import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolExecutors } from "@cline/sdk";
import type { SandboxNetworkPolicy } from "../core/agent-rulesets";
import {
	type BasicMemoryScopingPlan,
	basicMemorySeedProjectArgs,
	planBasicMemorySandboxWiring,
	planBasicMemoryScoping,
} from "../core/basic-memory-scoping";
import { isTruthyEnv } from "../core/env-flag";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import type { SandboxExecTarget } from "../core/sandbox-mcp-catalog";
import {
	AGENT_SANDBOX_CONTAINER_LABEL,
	AGENT_SANDBOX_VOLUME_PREFIX,
	AGENT_SANDBOX_WORKSPACES_DIR,
	type AgentSandboxPoolConfig,
	type AgentSandboxProjectMount,
	buildAgentSandboxDockerRunArgs,
	createAgentSandboxContainerName,
	createAgentSandboxProjectKey,
	createAgentSandboxTaskUid,
	createAgentSandboxVolumeName,
	normalizeAgentSandboxPoolConfig,
	resolveAgentSandboxImageName,
} from "./nklein-agent-sandbox-docker";
import { bufferOrStringToString, joinDockerOutput, parseDockerOutputLines } from "./nklein-agent-sandbox-output";
import {
	type AgentSandboxShellTarget,
	buildAgentSandboxInteractiveShellArgs,
	buildTaskShellSpawnSpec,
	DEFAULT_AGENT_SANDBOX_SHELL,
	type TaskShellSpawnSpec,
} from "./nklein-agent-sandbox-shell";
import { normalizeTaskIdForSandboxPath } from "./nklein-agent-sandbox-task-path";
import { formatSandboxToolFailure, parseToolRunnerResult } from "./nklein-agent-sandbox-tool-result";
import type { NKleinPauseController } from "./nklein-pause-controller";

// Re-export the Docker construction surface (consts, run-option types, arg/name/uid builders) now in
// nklein-agent-sandbox-docker so existing importers of this module (runtime-config, server, task-session-service)
// are unchanged.
export * from "./nklein-agent-sandbox-docker";
// Re-export the interactive-shell builders (now in nklein-agent-sandbox-shell) so existing importers of this
// module — runtime-api (buildTaskShellSpawnSpec) and task-session-service (AgentSandboxShellTarget) — are unchanged.
export {
	type AgentSandboxShellTarget,
	buildAgentSandboxInteractiveShellArgs,
	buildTaskShellSpawnSpec,
	DEFAULT_AGENT_SANDBOX_SHELL,
	type TaskShellSpawnSpec,
};

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const DOCKER_UNAVAILABLE_MARKERS = [
	"cannot connect to the docker daemon",
	"is the docker daemon running",
	"executable file not found",
	"no such file or directory",
	"command not found",
	"permission denied",
];
type SandboxBashInput = Parameters<NonNullable<ToolExecutors["bash"]>>[0];
type SandboxReadFileInput = Parameters<NonNullable<ToolExecutors["readFile"]>>[0];
type SandboxEditorInput = Parameters<NonNullable<ToolExecutors["editor"]>>[0];
type SandboxApplyPatchInput = Parameters<NonNullable<ToolExecutors["applyPatch"]>>[0];

export interface AgentSandboxToolExecutorOptions {
	pauseController?: Pick<NKleinPauseController, "waitUntilResumed">;
}

export interface AgentSandboxExecResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface AgentSandboxAvailabilityStatus {
	state: "ready" | "blocked";
	dockerAvailable: boolean;
	imageAvailable: boolean;
	image: string;
	message: string | null;
	checkedAt: number;
}

export interface AgentSandboxManagerOptions {
	image?: string;
	poolConfig?: Partial<AgentSandboxPoolConfig>;
	/**
	 * Outbound network posture for this pool's containers, from the resolved GLOBAL capability ruleset preset.
	 * Defaults to `"none"`. Per-role network overrides would require keying the container pool by policy (a
	 * pooled container's `--network` is fixed at creation); that is a documented follow-up — today the pool is
	 * uniform, so the global preset governs egress for every container.
	 */
	networkPolicy?: SandboxNetworkPolicy;
	execFile?: typeof execFile;
	setTimeout?: typeof setTimeout;
	clearTimeout?: typeof clearTimeout;
}

interface DockerExecError extends Error {
	code?: number | string;
	stdout?: string | Buffer;
	stderr?: string | Buffer;
}

interface ContainerState {
	slot: number;
	containerName: string;
	volumeName: string;
	containerId: string | null;
	starting: Promise<void> | null;
	retiring: Promise<void> | null;
	occupancy: Set<string>;
	idleTimer: ReturnType<typeof setTimeout> | null;
	/**
	 * The project keys this container was `docker run` with (mounts are BAKED at start — a project registered
	 * later is NOT reachable under /repos/<key> in an already-running container). null = not started yet, so any
	 * project fits (the start will mount the then-current registry). run19: assigning a task to a running
	 * container without its mount made `git clone /repos/<key>` fail and fail-closed the whole delivery.
	 */
	mountedProjectKeys: Set<string> | null;
}

interface TaskPlacement {
	taskId: string;
	slot: number;
	workdir: string;
	uid: number;
	projectKey: string;
	projectRepoPath: string;
}

interface QueueEntry {
	taskId: string;
	projectRepoPath: string;
	resolve: (placement: TaskPlacement) => void;
	reject: (error: unknown) => void;
}

interface AgentSandboxAcquireSlotInput {
	taskId: string;
	projectRepoPath: string;
	onQueued?: () => void;
	/**
	 * Bounded queue wait (ms). When set, a queued acquisition REJECTS after this long instead of waiting forever —
	 * required for auxiliary acquisitions (review sessions, acceptance re-checks) whose slot may be held by the very
	 * session that is waiting on THEM (run19's review-seam deadlock). Unset = wait indefinitely (primary task starts).
	 */
	maxQueueWaitMs?: number;
}

export class AgentSandboxUnavailableError extends Error {
	readonly code = "AGENT_SANDBOX_UNAVAILABLE";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "AgentSandboxUnavailableError";
	}
}

export class AgentSandboxExecutionError extends Error {
	constructor(
		message: string,
		readonly result: AgentSandboxExecResult,
	) {
		super(message);
		this.name = "AgentSandboxExecutionError";
	}
}

export function createAgentSandboxToolExecutors(
	manager: AgentSandboxManager,
	taskId: string,
	options: AgentSandboxToolExecutorOptions = {},
): Partial<ToolExecutors> {
	const runToolWhenResumed = async (tool: string, input: unknown): Promise<string> => {
		await options.pauseController?.waitUntilResumed(taskId);
		return await manager.runTool(taskId, tool, input);
	};
	return {
		bash: async (command: SandboxBashInput) => runToolWhenResumed("bash", command),
		readFile: async (request: SandboxReadFileInput) => runToolWhenResumed("readFile", request),
		search: async (query: string) => runToolWhenResumed("search", query),
		editor: async (input: SandboxEditorInput) => runToolWhenResumed("editor", input),
		applyPatch: async (input: SandboxApplyPatchInput) => runToolWhenResumed("applyPatch", input),
		webFetch: async () =>
			"Agent web fetch is disabled because !Klein runs agent tools in a no-network Docker sandbox.",
	};
}

export class AgentSandboxManager {
	private readonly image: string;
	private poolConfig: AgentSandboxPoolConfig;
	// Mutable so an operator tightening/loosening the capability tier at runtime is re-applied (see setNetworkPolicy).
	private networkPolicy: SandboxNetworkPolicy;
	private readonly execFileImpl: typeof execFile;
	private readonly setTimeoutImpl: typeof setTimeout;
	private readonly clearTimeoutImpl: typeof clearTimeout;
	private readonly containers = new Map<number, ContainerState>();
	private readonly placements = new Map<string, TaskPlacement>();
	private readonly projectMountsByKey = new Map<string, AgentSandboxProjectMount>();
	// §5.AR basic-memory (OFF by default via NKLEIN_BASIC_MEMORY): per-project scoping plan keyed by projectKey. When
	// enabled, each registered project gets a per-project writable store (config + notes) mounted RW at container start
	// and seeded via `basic-memory project add`. Empty ⇒ no writable mounts ⇒ the sandbox stays fully read-only.
	private readonly basicMemoryEnabled = isTruthyEnv(process.env.NKLEIN_BASIC_MEMORY);
	private readonly basicMemoryPlanByKey = new Map<string, BasicMemoryScopingPlan>();
	private readonly queue: QueueEntry[] = [];
	// Spike guard (2026-07-04): the ONE shared container hosts every agent, and each `docker exec` tool command
	// (npm/build/acceptance) can spike to ~1–2 GiB. `activeExecs` + `execWaiters` bound how many run AT ONCE
	// (poolConfig.maxConcurrentExec) so simultaneous heavy commands can't OOM the container; excess FIFO-queue.
	private activeExecs = 0;
	private readonly execWaiters: (() => void)[] = [];

	constructor(options: AgentSandboxManagerOptions = {}) {
		this.image = options.image ?? resolveAgentSandboxImageName();
		this.poolConfig = normalizeAgentSandboxPoolConfig(options.poolConfig);
		this.networkPolicy = options.networkPolicy ?? "none";
		this.execFileImpl = options.execFile ?? execFile;
		this.setTimeoutImpl = options.setTimeout ?? setTimeout;
		this.clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
	}

	async updatePoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void> {
		this.poolConfig = normalizeAgentSandboxPoolConfig(config);
		await this.reconcileIdleContainersWithPoolConfig();
		this.drainQueue();
	}

	/**
	 * Re-apply the sandbox Docker `--network` policy at runtime (an operator tightening/loosening the capability tier).
	 * The flag is baked into each container at `docker run` (buildAgentSandboxDockerRunArgs), so a change only takes
	 * effect on the NEXT start — retire idle (unoccupied) containers now so they recreate with the new policy. Occupied
	 * containers hold in-flight agent work and age out to recreate on their next assignment. Without this, a cached
	 * manager kept its original (looser) egress after the operator restricted isolation — a fail-open Docker-isolation
	 * drift (prime directive #2).
	 */
	async setNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void> {
		if (policy === this.networkPolicy) {
			return;
		}
		this.networkPolicy = policy;
		const retirements = [...this.containers.values()]
			.filter((container) => container.occupancy.size === 0)
			.map((container) => this.retireContainer(container));
		await Promise.all(retirements);
		this.drainQueue();
	}

	async checkAvailability(now: () => number = Date.now): Promise<AgentSandboxAvailabilityStatus> {
		try {
			const version = await this.runDocker(["version"], { timeoutMs: 10_000 });
			if (version.exitCode !== 0) {
				return {
					state: "blocked",
					dockerAvailable: false,
					imageAvailable: false,
					image: this.image,
					message: toSandboxUnavailableError(version, this.image).message,
					checkedAt: now(),
				};
			}
			const image = await this.runDocker(["image", "inspect", this.image], { timeoutMs: 10_000 });
			if (image.exitCode !== 0) {
				return {
					state: "blocked",
					dockerAvailable: true,
					imageAvailable: false,
					image: this.image,
					message: toSandboxUnavailableError(image, this.image).message,
					checkedAt: now(),
				};
			}
		} catch (error) {
			return {
				state: "blocked",
				dockerAvailable: false,
				imageAvailable: false,
				image: this.image,
				message: toSandboxUnavailableError(error, this.image).message,
				checkedAt: now(),
			};
		}
		return {
			state: "ready",
			dockerAvailable: true,
			imageAvailable: true,
			image: this.image,
			message: null,
			checkedAt: now(),
		};
	}

	async assertAvailable(): Promise<void> {
		const status = await this.checkAvailability();
		if (status.state !== "ready") {
			throw new AgentSandboxUnavailableError(
				status.message ?? "Docker is required for !Klein agent isolation, but the sandbox is unavailable.",
			);
		}
	}

	async reapOrphanResources(): Promise<void> {
		const containerIds = await this.listOrphanContainerIds();
		for (const containerId of containerIds) {
			await this.runDocker(["rm", "-f", containerId], { timeoutMs: 30_000 }).catch(() => null);
		}

		const volumeNames = await this.listOrphanWorkspaceVolumeNames();
		for (const volumeName of volumeNames) {
			await this.runDocker(["volume", "rm", volumeName], { timeoutMs: 30_000 }).catch(() => null);
		}
	}

	async acquireSlot(input: AgentSandboxAcquireSlotInput): Promise<TaskPlacement> {
		const existing = this.placements.get(input.taskId);
		if (existing) {
			return existing;
		}
		this.registerProject(input.projectRepoPath);
		const immediate = await this.tryAcquireSlot(input.taskId, input.projectRepoPath);
		if (immediate) {
			return immediate;
		}
		input.onQueued?.();
		return await new Promise<TaskPlacement>((resolve, reject) => {
			const entry = {
				taskId: input.taskId,
				projectRepoPath: input.projectRepoPath,
				resolve,
				reject,
			};
			this.queue.push(entry);
			// run19 live finding (the review-sandbox-prep hang): AUXILIARY acquisitions (the acceptance re-check,
			// the reviewer session) must never queue FOREVER behind a held slot — the holder may be waiting on the
			// very check that's queued (a pool-capacity deadlock at the review seam). A bounded wait rejects with a
			// clear error; the auxiliary callers fail CLOSED (held in review) instead of freezing the run.
			const waitCapMs = input.maxQueueWaitMs;
			if (typeof waitCapMs === "number" && waitCapMs > 0) {
				const timer = setTimeout(() => {
					const queuedIndex = this.queue.indexOf(entry);
					if (queuedIndex >= 0) {
						this.queue.splice(queuedIndex, 1);
						reject(
							new AgentSandboxUnavailableError(
								`No sandbox slot opened within ${Math.round(waitCapMs / 1000)}s for ${input.taskId}; giving up the queued wait (fail-closed).`,
							),
						);
					}
				}, waitCapMs);
				timer.unref?.();
			}
		});
	}

	async prepareWorkspace(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef?: string | null;
		onQueued?: () => void;
		/** Bounded slot wait for AUXILIARY preparations (review sessions, acceptance re-checks) — see acquireSlot. */
		maxQueueWaitMs?: number;
	}): Promise<{ workdir: string; uid: number }> {
		const placement = await this.acquireSlot({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			onQueued: input.onQueued,
			...(input.maxQueueWaitMs !== undefined ? { maxQueueWaitMs: input.maxQueueWaitMs } : {}),
		});
		try {
			const repoSource = `/repos/${placement.projectKey}`;
			assertSandboxExecOk(
				await this.execAsRoot(placement, ["mkdir", "-p", AGENT_SANDBOX_WORKSPACES_DIR]),
				"create sandbox workspace root",
			);
			assertSandboxExecOk(
				await this.execAsRoot(placement, ["chmod", "1777", AGENT_SANDBOX_WORKSPACES_DIR]),
				"set sandbox workspace root permissions",
			);
			// Clear any STALE workspace left at this path before cloning. The sandbox workspaces dir is a host-level
			// shared volume keyed by taskId, so a prior run that didn't dispose cleanly (an interrupted/aborted session,
			// or a reused taskId across processes) leaves a non-empty `/workspaces/<taskId>` — and `git clone` then fails
			// with "destination path already exists and is not an empty directory", blocking the start. Every caller of
			// prepareWorkspace wants a FRESH clone (start / review-at-result / acceptance-at-result), and the clone always
			// overwrites anyway, so removing a stale dir first only turns a hard failure into a clean fresh clone.
			assertSandboxExecOk(
				await this.execAsTaskUser(placement, ["rm", "-rf", placement.workdir], {
					workdir: AGENT_SANDBOX_WORKSPACES_DIR,
				}),
				"clear any stale sandbox task workspace",
			);
			assertSandboxExecOk(
				await this.execAsTaskUser(placement, ["mkdir", "-m", "700", "-p", placement.workdir], {
					workdir: AGENT_SANDBOX_WORKSPACES_DIR,
				}),
				"create sandbox task workspace",
			);
			assertSandboxExecOk(
				await this.execAsTaskUser(placement, ["git", "clone", "--no-hardlinks", repoSource, placement.workdir]),
				"clone project into sandbox workspace",
			);
			if (input.baseRef?.trim()) {
				assertSandboxExecOk(
					await this.execAsTaskUser(placement, ["git", "-C", placement.workdir, "checkout", input.baseRef.trim()]),
					"check out sandbox task base ref",
				);
			}
			return {
				workdir: placement.workdir,
				uid: placement.uid,
			};
		} catch (error) {
			await this.disposeWorkspace(input.taskId).catch(() => null);
			throw error;
		}
	}

	async exec(
		taskId: string,
		argv: readonly string[],
		options?: { timeoutMs?: number },
	): Promise<AgentSandboxExecResult> {
		const placement = this.requirePlacement(taskId);
		return await this.execAsTaskUser(placement, [...argv], options);
	}

	/**
	 * The identity needed to `docker exec` into a task's prepared sandbox container — for §5.AR curated MCP servers
	 * hosted IN the sandbox (the runtime builds a `docker exec -i …` stdio transport from this). Returns `null` when no
	 * workspace is prepared for the task (never throws — MCP hosting is best-effort and must not break session start).
	 */
	getSandboxExecTarget(taskId: string): SandboxExecTarget | null {
		const placement = this.placements.get(taskId);
		if (!placement) {
			return null;
		}
		return {
			containerName: createAgentSandboxContainerName(placement.slot, this.poolConfig.namespace),
			uid: placement.uid,
			workdir: placement.workdir,
		};
	}

	/**
	 * §5.AR: the basic-memory MCP exec env (BASIC_MEMORY_CONFIG_DIR + BASIC_MEMORY_MCP_PROJECT + egress hardening) for a
	 * task's project, or undefined when basic-memory is off or the task has no placement. The MCP runtime applies it
	 * ONLY to the basic-memory `docker exec`, so the server reads/writes THIS project's mounted store.
	 */
	getBasicMemoryExecEnv(taskId: string): Record<string, string> | undefined {
		const placement = this.placements.get(taskId);
		return placement ? this.basicMemoryPlanByKey.get(placement.projectKey)?.env : undefined;
	}

	async runTool(taskId: string, tool: string, input: unknown): Promise<string> {
		const placement = this.requirePlacement(taskId);
		const result = await this.execAsTaskUser(
			placement,
			["node", "/opt/nklein/tool-runner.cjs", tool, JSON.stringify(input), placement.projectRepoPath],
			{
				timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
			},
		);
		if (result.exitCode !== 0) {
			throw new AgentSandboxExecutionError(formatSandboxToolFailure(tool, joinDockerOutput(result)), result);
		}
		const parsed = parseToolRunnerResult(result.stdout);
		if (!parsed.ok) {
			throw new Error(formatSandboxToolFailure(tool, parsed.error));
		}
		return typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
	}

	async captureWorkspacePatch(taskId: string, options: { baseRef?: string | null } = {}): Promise<string> {
		const placement = this.requirePlacement(taskId);
		assertSandboxExecOk(
			await this.execAsTaskUser(placement, ["git", "add", "-A"]),
			"stage sandbox workspace changes",
		);
		const diffArgs = ["git", "diff", "--staged", "--binary"];
		const baseRef = options.baseRef?.trim();
		if (baseRef) {
			diffArgs.push(baseRef, "--");
		}
		const diff = await this.execAsTaskUser(placement, diffArgs, {
			timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
		});
		assertSandboxExecOk(diff, "capture sandbox workspace patch");
		return diff.stdout;
	}

	async disposeWorkspace(taskId: string): Promise<void> {
		const placement = this.placements.get(taskId);
		if (!placement) {
			return;
		}
		// run19 ROOT CAUSE: the exec used to be awaited OUTSIDE this try — a throwing docker exec (timeout,
		// dead container) skipped releaseSlot and LEAKED the slot, deadlocking the pool forever (every later
		// acquisition queued indefinitely, silently: callers .catch(() => null)). The slot release must be
		// unconditional: a leftover workdir is recoverable, a leaked slot freezes the whole run.
		try {
			const removal = await this.execAsTaskUser(placement, ["rm", "-rf", placement.workdir], {
				workdir: AGENT_SANDBOX_WORKSPACES_DIR,
			});
			assertSandboxExecOk(removal, "remove sandbox task workspace");
		} finally {
			this.releaseSlot(taskId);
		}
	}

	async stopNow(): Promise<void> {
		const containers = [...this.containers.values()];
		for (const container of containers) {
			if (container.idleTimer) {
				this.clearTimeoutImpl(container.idleTimer);
				container.idleTimer = null;
			}
			await this.runDocker(["rm", "-f", container.containerName], { timeoutMs: 30_000 }).catch(() => null);
			await this.runDocker(["volume", "rm", container.volumeName], { timeoutMs: 30_000 }).catch(() => null);
		}
		this.containers.clear();
		this.placements.clear();
		while (this.queue.length > 0) {
			this.queue.shift()?.reject(new AgentSandboxUnavailableError("Agent sandbox stopped before a slot opened."));
		}
	}

	private registerProject(projectRepoPath: string): AgentSandboxProjectMount {
		const projectKey = createAgentSandboxProjectKey(projectRepoPath);
		const mount = { projectKey, projectRepoPath };
		this.projectMountsByKey.set(projectKey, mount);
		// §5.AR: when basic-memory is enabled, give each project a per-project writable store (pure plan; the host dirs
		// are created + mounted + seeded at container start). Keyed by projectKey so it survives across this container.
		if (this.basicMemoryEnabled && !this.basicMemoryPlanByKey.has(projectKey)) {
			this.basicMemoryPlanByKey.set(
				projectKey,
				planBasicMemoryScoping({ runtimeHome: join(homedir(), ".nklein"), workspaceHash: projectKey, scopes: [] }),
			);
		}
		return mount;
	}

	private async tryAcquireSlot(taskId: string, projectRepoPath: string): Promise<TaskPlacement | null> {
		const projectKey = createAgentSandboxProjectKey(projectRepoPath);
		const canReachProject = (container: ContainerState): boolean =>
			container.mountedProjectKeys === null || container.mountedProjectKeys.has(projectKey);
		const reusable = [...this.containers.values()].find(
			(container) => this.hasContainerCapacity(container) && canReachProject(container),
		);
		if (reusable) {
			return await this.assignContainer(taskId, projectRepoPath, reusable);
		}
		// A running-but-EMPTY container whose baked mounts miss this project is stale — retire it so the fresh
		// start below mounts the current registry (mounts cannot be added to a live container).
		const staleEmpty = [...this.containers.values()].find(
			(container) =>
				this.hasContainerCapacity(container) && !canReachProject(container) && container.occupancy.size === 0,
		);
		if (staleEmpty) {
			await this.retireContainer(staleEmpty);
		}
		if (this.containers.size >= this.poolConfig.maxContainers) {
			return null;
		}
		const container = this.createContainerState(this.nextContainerSlot());
		this.containers.set(container.slot, container);
		return await this.assignContainer(taskId, projectRepoPath, container);
	}

	private async assignContainer(
		taskId: string,
		projectRepoPath: string,
		container: ContainerState,
	): Promise<TaskPlacement> {
		if (container.idleTimer) {
			this.clearTimeoutImpl(container.idleTimer);
			container.idleTimer = null;
		}
		const projectKey = createAgentSandboxProjectKey(projectRepoPath);
		const placement = {
			taskId,
			slot: container.slot,
			workdir: `${AGENT_SANDBOX_WORKSPACES_DIR}/${normalizeTaskIdForSandboxPath(taskId)}`,
			uid: createAgentSandboxTaskUid(taskId),
			projectKey,
			projectRepoPath,
		};
		container.occupancy.add(taskId);
		this.placements.set(taskId, placement);
		try {
			await this.ensureContainerStarted(container);
		} catch (error) {
			this.placements.delete(taskId);
			container.occupancy.delete(taskId);
			if (!container.containerId) {
				this.containers.delete(container.slot);
				container.starting = null;
			}
			throw error;
		}
		return placement;
	}

	private async ensureContainerStarted(container: ContainerState): Promise<void> {
		// SINGLE-FLIGHT the ENTIRE ensure operation — the liveness re-check of a cached container, the recreate-if-dead,
		// AND the fresh start — under ONE `starting` promise, so concurrent reuses of the same slot await one recovery.
		// (Race, C3 review 2026-07-04: doing the `await isCachedContainerLive` BEFORE the single-flight guard let two
		// concurrent callers both probe a dead container, both clear `starting`, and both `docker run --name <same>` —
		// the second Conflicts on the reused name → a spurious start failure of a healthy acquire.) A cached-LIVE
		// container resolves the promise after just the inspect; the new-container hot path is a plain start.
		if (!container.starting) {
			container.starting = this.ensureContainerRunning(container);
		}
		await container.starting;
	}

	/** The single-flight body behind {@link ensureContainerStarted}'s `starting` promise — never call it directly. */
	private async ensureContainerRunning(container: ContainerState): Promise<void> {
		try {
			if (container.containerId) {
				// DEAD-CONTAINER RECOVERY (bug 2026-07-04): a cached containerId is NOT proof the container is still
				// alive — it can die OUT-OF-BAND (OOM inside the Docker VM, a `docker restart`, a manual `rm`). Reusing
				// a dead id makes every later `docker exec` fail with "No such container" and stalls the whole run. So
				// before trusting the cached id on a REUSE, verify the container is actually running. This inspect fires
				// ONLY on the reuse path (containerId set), never on a fresh start, so the new-container path is a plain
				// start. We do NOT recreate on an AMBIGUOUS liveness result (see isCachedContainerLive): a false "dead"
				// verdict must never tear a LIVE container out from under co-occupants, so that path keeps the container.
				if (await this.isCachedContainerLive(container)) {
					return;
				}
				// Genuinely dead: its occupants (if any) are already lost — they would themselves fail on exec — so
				// clearing the stale state and re-creating is correct. startContainer() `docker rm -f`s the name first.
				container.containerId = null;
				container.mountedProjectKeys = null;
			}
			await this.startContainer(container);
		} finally {
			// Clear the single-flight guard once the operation settles (success OR failure) so a later acquire can
			// retry a failed start / a since-died container. `startContainer` no longer clears `starting` itself.
			container.starting = null;
		}
	}

	/**
	 * Liveness gate for REUSING a container whose `containerId` is cached. Returns true when the container is
	 * confirmed running (or when the check is inconclusive), false ONLY when the container is confirmed DEAD.
	 *
	 * Safety: this decides whether {@link ensureContainerStarted} will `docker rm -f` + re-create the slot. A false
	 * "dead" verdict on a still-LIVE container would destroy it under any co-occupants (the pool defaults to
	 * unlimited agents per container), so we recreate ONLY on an EXPLICIT dead signal:
	 *   - inspect succeeds but the running state is not `true` (empty / "false") — the container is stopped/dead.
	 *   - inspect exits non-zero AND stderr says the container is GONE ("No such container/object") — it was rm'd.
	 * Any OTHER inspect failure (docker daemon unreachable, permission denied, timeout) is INCONCLUSIVE — it is not
	 * proof the container died — so we conservatively KEEP the container. Tearing a live container out from under
	 * co-occupants on daemon flakiness is destructive; when the container really is dead, the subsequent exec still
	 * fails through the existing error path — no worse than before this fix — but a live co-occupant is never lost.
	 */
	private async isCachedContainerLive(container: ContainerState): Promise<boolean> {
		try {
			const result = await this.runDocker(["inspect", "-f", "{{.State.Running}}", container.containerName], {
				timeoutMs: 10_000,
			});
			if (result.exitCode === 0) {
				// Confirmed dead only when inspect succeeds AND the state is explicitly not running.
				return result.stdout.trim() === "true";
			}
			// Non-zero: DEAD only when docker explicitly reports the container is gone; every other failure
			// (daemon down, permission) is inconclusive → keep the container.
			return !isContainerMissingError(joinDockerOutput(result));
		} catch {
			// runDocker swallows docker failures into a result, so reaching here means an UNEXPECTED throw. Decide
			// conservatively: keep the container (do not recreate), never tearing a possibly-live container out from
			// under co-occupants. No slot is leaked — ensureContainerStarted's caller (assignContainer) already
			// releases occupancy on throw, and here we simply return without mutating state.
			return true;
		}
	}

	private async startContainer(container: ContainerState): Promise<void> {
		await this.runDocker(["rm", "-f", container.containerName], { timeoutMs: 30_000 }).catch(() => null);
		const mounts = [...this.projectMountsByKey.values()];
		// §5.AR basic-memory (flag-gated): the per-project writable stores for the projects this container serves. Empty
		// unless NKLEIN_BASIC_MEMORY is on ⇒ no writable mounts ⇒ the sandbox is byte-identical + fully read-only.
		const basicMemoryPlans = mounts
			.map((mount) => this.basicMemoryPlanByKey.get(mount.projectKey))
			.filter((plan): plan is BasicMemoryScopingPlan => plan !== undefined);
		const writableMounts = basicMemoryPlans.flatMap((plan) =>
			planBasicMemorySandboxWiring(plan).mounts.map((mount) => ({
				hostPath: mount.hostPath,
				containerPath: mount.containerPath,
			})),
		);
		// Create the host store dirs (the RW bind sources) before the container mounts them.
		await Promise.all(
			writableMounts.map((mount) => mkdir(mount.hostPath, { recursive: true }).catch(() => undefined)),
		);
		const result = await this.runDocker(
			buildAgentSandboxDockerRunArgs({
				slot: container.slot,
				image: this.image,
				projectMounts: mounts,
				...(writableMounts.length > 0 ? { writableMounts } : {}),
				config: this.poolConfig,
				networkPolicy: this.networkPolicy,
			}),
			{ timeoutMs: 30_000 },
		);
		if (result.exitCode !== 0 || !result.stdout.trim()) {
			throw new AgentSandboxUnavailableError(
				`Could not start Docker agent sandbox ${container.containerName}: ${joinDockerOutput(result)}`,
			);
		}
		container.containerId = result.stdout.trim();
		// §5.AR: seed basic-memory's per-project config (validated live: no auto-init) — an idempotent `project add`
		// per project, run as root with the plan's env (BASIC_MEMORY_CONFIG_DIR → the mounted config dir). Best-effort.
		for (const plan of basicMemoryPlans) {
			const envArgs = Object.entries(plan.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
			for (const argv of basicMemorySeedProjectArgs(plan)) {
				await this.runDocker(["exec", ...envArgs, container.containerName, ...argv], { timeoutMs: 30_000 }).catch(
					() => null,
				);
			}
		}
		// NOTE: the `starting` single-flight guard is cleared by ensureContainerRunning's `finally` (its sole owner),
		// not here — clearing it mid-flight would let a concurrent caller start a second recovery for the same slot.
		container.mountedProjectKeys = new Set(mounts.map((mount) => mount.projectKey));
	}

	private createContainerState(slot: number): ContainerState {
		return {
			slot,
			containerName: createAgentSandboxContainerName(slot, this.poolConfig.namespace),
			volumeName: createAgentSandboxVolumeName(slot, this.poolConfig.namespace),
			containerId: null,
			starting: null,
			retiring: null,
			occupancy: new Set<string>(),
			idleTimer: null,
			mountedProjectKeys: null,
		};
	}

	private nextContainerSlot(): number {
		for (let slot = 1; slot <= this.poolConfig.maxContainers; slot += 1) {
			if (!this.containers.has(slot)) {
				return slot;
			}
		}
		return this.poolConfig.maxContainers + 1;
	}

	private hasContainerCapacity(container: ContainerState): boolean {
		if (container.retiring || this.isExcessContainer(container)) {
			return false;
		}
		return this.poolConfig.agentsPerContainer === 0 || container.occupancy.size < this.poolConfig.agentsPerContainer;
	}

	private async listOrphanContainerIds(): Promise<string[]> {
		const result = await this.runDocker(["ps", "-aq", "--filter", `label=${AGENT_SANDBOX_CONTAINER_LABEL}`], {
			timeoutMs: 10_000,
		});
		return result.exitCode === 0 ? parseDockerOutputLines(result.stdout) : [];
	}

	private async listOrphanWorkspaceVolumeNames(): Promise<string[]> {
		const result = await this.runDocker(["volume", "ls", "-q", "--filter", `name=${AGENT_SANDBOX_VOLUME_PREFIX}`], {
			timeoutMs: 10_000,
		});
		if (result.exitCode !== 0) {
			return [];
		}
		return parseDockerOutputLines(result.stdout).filter(isAgentSandboxWorkspaceVolumeName);
	}

	private releaseSlot(taskId: string): void {
		const placement = this.placements.get(taskId);
		if (!placement) {
			return;
		}
		this.placements.delete(taskId);
		const container = this.containers.get(placement.slot);
		if (!container) {
			return;
		}
		container.occupancy.delete(taskId);
		this.drainQueue();
		if (container.occupancy.size === 0) {
			this.handleEmptyContainer(container);
		}
	}

	private drainQueue(): void {
		for (let index = 0; index < this.queue.length; ) {
			const queued = this.queue[index];
			if (!queued) {
				index += 1;
				continue;
			}
			void this.tryAcquireSlot(queued.taskId, queued.projectRepoPath)
				.then((placement) => {
					if (!placement) {
						return;
					}
					const queuedIndex = this.queue.indexOf(queued);
					if (queuedIndex < 0) {
						// The bounded wait already rejected this entry — hand the slot back instead of leaking it.
						this.releaseSlot(queued.taskId);
						return;
					}
					this.queue.splice(queuedIndex, 1);
					queued.resolve(placement);
				})
				.catch((error) => {
					const queuedIndex = this.queue.indexOf(queued);
					if (queuedIndex >= 0) {
						this.queue.splice(queuedIndex, 1);
						queued.reject(error);
					}
				});
			index += 1;
		}
	}

	private armIdleTimer(container: ContainerState): void {
		if (this.poolConfig.idleTimeoutMs <= 0 || container.idleTimer) {
			return;
		}
		container.idleTimer = this.setTimeoutImpl(() => {
			void (async () => {
				if (container.occupancy.size > 0) {
					return;
				}
				await this.retireContainer(container);
				this.drainQueue();
			})();
		}, this.poolConfig.idleTimeoutMs);
	}

	private handleEmptyContainer(container: ContainerState): void {
		if (this.isExcessContainer(container)) {
			void this.retireContainer(container).then(() => {
				this.drainQueue();
			});
			return;
		}
		this.armIdleTimer(container);
	}

	private async reconcileIdleContainersWithPoolConfig(): Promise<void> {
		const retirements = [...this.containers.values()]
			.filter((container) => container.occupancy.size === 0 && this.isExcessContainer(container))
			.map((container) => this.retireContainer(container));
		await Promise.all(retirements);
	}

	private isExcessContainer(container: ContainerState): boolean {
		return container.slot > this.poolConfig.maxContainers;
	}

	private async retireContainer(container: ContainerState): Promise<void> {
		if (container.retiring) {
			await container.retiring;
			return;
		}
		if (container.idleTimer) {
			this.clearTimeoutImpl(container.idleTimer);
			container.idleTimer = null;
		}
		container.retiring = (async () => {
			await this.runDocker(["rm", "-f", container.containerName], { timeoutMs: 30_000 }).catch(() => null);
			await this.runDocker(["volume", "rm", container.volumeName], { timeoutMs: 30_000 }).catch(() => null);
			this.containers.delete(container.slot);
		})();
		await container.retiring;
	}

	/**
	 * The SPIKE GUARD: run a `docker exec` under the container's concurrency cap so simultaneous heavy commands
	 * (npm/build/acceptance across co-occupant agents) can't OOM the one shared container. A FIFO hand-off semaphore
	 * bounded by `poolConfig.maxConcurrentExec` (0 = unbounded); excess execs queue and take a slot as one frees. Leaf
	 * op — execs never nest or hold-a-slot-while-awaiting-another, so this cannot deadlock (prep/tool/capture all just
	 * queue). Every exec is timeout-bounded by the caller, so a hung command releases its slot rather than wedging.
	 */
	private async withExecSlot<T>(run: () => Promise<T>): Promise<T> {
		const limit = this.poolConfig.maxConcurrentExec;
		if (!(limit > 0)) {
			return await run();
		}
		if (this.activeExecs >= limit) {
			await new Promise<void>((resolve) => this.execWaiters.push(resolve));
			// A releaser HANDED us its slot (activeExecs unchanged) — do not re-increment.
		} else {
			this.activeExecs += 1;
		}
		try {
			return await run();
		} finally {
			const next = this.execWaiters.shift();
			if (next) {
				next(); // hand the slot straight to the next waiter (keeps activeExecs at the cap, no gap)
			} else {
				this.activeExecs -= 1;
			}
		}
	}

	private async execAsTaskUser(
		placement: TaskPlacement,
		argv: string[],
		options?: { timeoutMs?: number; workdir?: string },
	): Promise<AgentSandboxExecResult> {
		return await this.withExecSlot(() =>
			this.runDocker(
				[
					"exec",
					"-u",
					String(placement.uid),
					"-w",
					options?.workdir ?? placement.workdir,
					createAgentSandboxContainerName(placement.slot, this.poolConfig.namespace),
					...argv,
				],
				options,
			),
		);
	}

	private async execAsRoot(
		placement: TaskPlacement,
		argv: string[],
		options?: { timeoutMs?: number },
	): Promise<AgentSandboxExecResult> {
		return await this.withExecSlot(() =>
			this.runDocker(
				[
					"exec",
					"-u",
					"0:0",
					"-w",
					AGENT_SANDBOX_WORKSPACES_DIR,
					createAgentSandboxContainerName(placement.slot, this.poolConfig.namespace),
					...argv,
				],
				options,
			),
		);
	}

	/**
	 * Whether a sandbox workspace is currently prepared for the task. Used by callers to distinguish a
	 * benign teardown race from a real error.
	 */
	hasWorkspace(taskId: string): boolean {
		return this.placements.has(taskId);
	}

	/**
	 * The interactive-shell target for a task's prepared sandbox workspace, or null when none is prepared. The
	 * shell-on-task flow uses this to `docker exec` into the task's container instead of ensuring a host worktree
	 * (todo §5.A). Pair with {@link buildAgentSandboxInteractiveShellArgs} to build the PTY `docker` argv.
	 */
	getTaskShellTarget(taskId: string): AgentSandboxShellTarget | null {
		const placement = this.placements.get(taskId);
		if (!placement) {
			return null;
		}
		return {
			containerName: createAgentSandboxContainerName(placement.slot, this.poolConfig.namespace),
			uid: placement.uid,
			workdir: placement.workdir,
		};
	}

	private requirePlacement(taskId: string): TaskPlacement {
		const placement = this.placements.get(taskId);
		if (!placement) {
			throw new AgentSandboxUnavailableError(`No Docker sandbox workspace is prepared for task ${taskId}.`);
		}
		return placement;
	}

	private async runDocker(argv: readonly string[], options?: { timeoutMs?: number }): Promise<AgentSandboxExecResult> {
		try {
			const result = await promisify(this.execFileImpl)("docker", [...argv], {
				timeout: options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
				maxBuffer: 64 * 1024 * 1024,
			});
			return {
				exitCode: 0,
				stdout: bufferOrStringToString(result.stdout),
				stderr: bufferOrStringToString(result.stderr),
			};
		} catch (error) {
			const dockerError = error as DockerExecError;
			return {
				exitCode: typeof dockerError.code === "number" ? dockerError.code : null,
				stdout: bufferOrStringToString(dockerError.stdout),
				stderr: bufferOrStringToString(dockerError.stderr),
			};
		}
	}
}

/**
 * The deterministic in-container workspace path for a task (`/workspaces/<taskId>`). This is where the task's repo
 * is cloned inside the sandbox and where its agent tools execute. It is also the **only** working directory a
 * Docker-isolated agent should ever perceive (see the "agents must never see host details" rule in AGENTS.md) —
 * never the host mount path. Deterministic from the taskId, so callers that don't hold a live `TaskPlacement`
 * (e.g. the session host configuring the agent-core `cwd`) can compute it without touching Docker.
 */
export function buildAgentSandboxWorkdir(taskId: string): string {
	return `${AGENT_SANDBOX_WORKSPACES_DIR}/${normalizeTaskIdForSandboxPath(taskId)}`;
}

/**
 * The single source of truth for the working directory the agent PERCEIVES — used for BOTH the agent-core
 * `config.cwd` AND the system-prompt `<env>` "Working Directory" line so they never diverge. For a real
 * (Docker-isolated) task this is the in-container sandbox workdir (`/workspaces/<taskId>`), never the host
 * mount: agents must never see host details (AGENTS.md). Home/chat sessions are not sandbox-backed, so they
 * keep the host cwd. Centralizing this prevents the leak class where one surface (e.g. the system prompt's
 * working-directory line) keeps echoing the host path after another (`config.cwd`) was switched to the sandbox.
 */
export function resolveNKleinAgentPerceivedCwd(taskId: string, hostCwd: string): string {
	return isHomeAgentSessionId(taskId) ? hostCwd : buildAgentSandboxWorkdir(taskId);
}

/**
 * Whether a `docker inspect` failure explicitly means the container is GONE (rm'd / OOM-killed / never existed),
 * as opposed to an inconclusive daemon error. Only a genuinely-missing container is safe to treat as DEAD and
 * recreate; every other failure keeps the container (see {@link AgentSandboxManager.isCachedContainerLive}).
 */
function isContainerMissingError(output: string): boolean {
	const normalized = output.toLowerCase();
	return normalized.includes("no such container") || normalized.includes("no such object");
}

function isAgentSandboxWorkspaceVolumeName(volumeName: string): boolean {
	return new RegExp(`^${escapeRegExp(AGENT_SANDBOX_VOLUME_PREFIX)}-\\d+$`).test(volumeName);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSandboxUnavailableError(error: unknown, image: string): AgentSandboxUnavailableError {
	if (error instanceof AgentSandboxUnavailableError) {
		return error;
	}
	const result = isAgentSandboxExecResult(error) ? error : null;
	const output = result ? joinDockerOutput(result) : error instanceof Error ? error.message : String(error);
	const normalized = output.toLowerCase();
	const isKnownDockerFailure = DOCKER_UNAVAILABLE_MARKERS.some((marker) => normalized.includes(marker));
	const message = isKnownDockerFailure
		? "Docker is required for !Klein agent isolation, but it is unavailable. Start Docker, build the sandbox image, then retry."
		: `Docker agent sandbox image ${image} is unavailable. Run npm run sandbox:build, then retry.`;
	return new AgentSandboxUnavailableError(message, { cause: error });
}

function isAgentSandboxExecResult(value: unknown): value is AgentSandboxExecResult {
	return (
		Boolean(value) &&
		value !== null &&
		typeof value === "object" &&
		"exitCode" in value &&
		"stdout" in value &&
		"stderr" in value
	);
}

function assertSandboxExecOk(result: AgentSandboxExecResult, operation: string): void {
	if (result.exitCode === 0) {
		return;
	}
	const output = joinDockerOutput(result);
	throw new AgentSandboxExecutionError(`Could not ${operation}.${output ? `\n${output}` : ""}`, result);
}
