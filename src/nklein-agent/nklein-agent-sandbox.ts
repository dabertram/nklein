import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { ToolExecutors } from "@nklein/core";
import { type SandboxNetworkPolicy, sandboxNetworkHasEgress } from "../core/agent-rulesets";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import type { NKleinPauseController } from "./nklein-pause-controller";

export const DEFAULT_AGENT_SANDBOX_IMAGE = "nklein/agent-sandbox:0.0.1";
export const AGENT_SANDBOX_IMAGE_ENV = "NKLEIN_AGENT_SANDBOX_IMAGE";
export const AGENT_SANDBOX_CONTAINER_LABEL = "nklein.kind=agent-sandbox";
export const AGENT_SANDBOX_VOLUME_PREFIX = "nklein-agent-ws";
export const AGENT_SANDBOX_CONTAINER_PREFIX = "nklein-agent-sandbox";
export const AGENT_SANDBOX_WORKSPACES_DIR = "/workspaces";
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
export const DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES = 10;
export const DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MS = DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB = 2048;
export const DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER = 2;
export const DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS = 1;
export const DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER = 0;
const TASK_UID_BASE = 70_000;
const TASK_UID_SPAN = 20_000;
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

export interface AgentSandboxPoolConfig {
	maxContainers: number;
	agentsPerContainer: number;
	memoryPerContainerMb: number;
	cpusPerContainer: number;
	idleTimeoutMs: number;
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
	};
}

export function resolveAgentSandboxImageName(): string {
	return process.env[AGENT_SANDBOX_IMAGE_ENV]?.trim() || DEFAULT_AGENT_SANDBOX_IMAGE;
}

export function createAgentSandboxProjectKey(projectRepoPath: string): string {
	return createHash("sha256").update(projectRepoPath).digest("hex").slice(0, 12);
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
	const containerName = createAgentSandboxContainerName(options.slot);
	const volumeName = createAgentSandboxVolumeName(options.slot);
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

export function createAgentSandboxContainerName(slot: number): string {
	return `${AGENT_SANDBOX_CONTAINER_PREFIX}-${slot}`;
}

export function createAgentSandboxVolumeName(slot: number): string {
	return `${AGENT_SANDBOX_VOLUME_PREFIX}-${slot}`;
}

/**
 * Interactive shell into a task's prepared sandbox container (todo §5.A: shell-on-task = `docker exec` into the
 * task's hardened container, not a host worktree). Tries a login bash, falling back to sh, so it works across
 * sandbox base images.
 */
export const DEFAULT_AGENT_SANDBOX_SHELL: readonly string[] = [
	"/bin/sh",
	"-lc",
	"exec bash -il 2>/dev/null || exec sh -il",
];

export interface AgentSandboxShellTarget {
	containerName: string;
	uid: number;
	workdir: string;
}

/**
 * Build the `docker` argv for an INTERACTIVE shell into a task's sandbox container. Mirrors the internal
 * `execAsTaskUser` exec (same task user + workdir + container) but adds `-it` to allocate a TTY and keep stdin
 * open, so a PTY can drive it. The user shell lands in the sandbox working copy, as isolated as the agent.
 */
export function buildAgentSandboxInteractiveShellArgs(
	target: AgentSandboxShellTarget,
	shell: readonly string[] = DEFAULT_AGENT_SANDBOX_SHELL,
): string[] {
	return ["exec", "-it", "-u", String(target.uid), "-w", target.workdir, target.containerName, ...shell];
}

export interface TaskShellSpawnSpec {
	binary: string;
	args: string[];
	/** True when the shell will `docker exec` into the task's sandbox container rather than a host shell. */
	usesSandbox: boolean;
}

/**
 * Decide how to spawn a shell-on-task PTY (todo §5.A): when the task has a prepared sandbox, shell INTO its
 * hardened container via `docker exec`; otherwise fall back to the provided host shell (the legacy host-worktree
 * path). Pure so the decision is unit-tested; the caller resolves the host cwd and supplies the host shell.
 */
export function buildTaskShellSpawnSpec(
	shellTarget: AgentSandboxShellTarget | null,
	hostShell: { binary: string; args?: readonly string[] },
): TaskShellSpawnSpec {
	if (shellTarget) {
		return { binary: "docker", args: buildAgentSandboxInteractiveShellArgs(shellTarget), usesSandbox: true };
	}
	return { binary: hostShell.binary, args: [...(hostShell.args ?? [])], usesSandbox: false };
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
	private readonly networkPolicy: SandboxNetworkPolicy;
	private readonly execFileImpl: typeof execFile;
	private readonly setTimeoutImpl: typeof setTimeout;
	private readonly clearTimeoutImpl: typeof clearTimeout;
	private readonly containers = new Map<number, ContainerState>();
	private readonly placements = new Map<string, TaskPlacement>();
	private readonly projectMountsByKey = new Map<string, AgentSandboxProjectMount>();
	private readonly queue: QueueEntry[] = [];

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
			this.queue.push({
				taskId: input.taskId,
				projectRepoPath: input.projectRepoPath,
				resolve,
				reject,
			});
		});
	}

	async prepareWorkspace(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef?: string | null;
		onQueued?: () => void;
	}): Promise<{ workdir: string; uid: number }> {
		const placement = await this.acquireSlot({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			onQueued: input.onQueued,
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
		const removal = await this.execAsTaskUser(placement, ["rm", "-rf", placement.workdir], {
			workdir: AGENT_SANDBOX_WORKSPACES_DIR,
		});
		try {
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
		return mount;
	}

	private async tryAcquireSlot(taskId: string, projectRepoPath: string): Promise<TaskPlacement | null> {
		const reusable = [...this.containers.values()].find((container) => this.hasContainerCapacity(container));
		if (reusable) {
			return await this.assignContainer(taskId, projectRepoPath, reusable);
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
		if (container.containerId) {
			return;
		}
		if (!container.starting) {
			container.starting = this.startContainer(container);
		}
		await container.starting;
	}

	private async startContainer(container: ContainerState): Promise<void> {
		await this.runDocker(["rm", "-f", container.containerName], { timeoutMs: 30_000 }).catch(() => null);
		const result = await this.runDocker(
			buildAgentSandboxDockerRunArgs({
				slot: container.slot,
				image: this.image,
				projectMounts: [...this.projectMountsByKey.values()],
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
		container.starting = null;
	}

	private createContainerState(slot: number): ContainerState {
		return {
			slot,
			containerName: createAgentSandboxContainerName(slot),
			volumeName: createAgentSandboxVolumeName(slot),
			containerId: null,
			starting: null,
			retiring: null,
			occupancy: new Set<string>(),
			idleTimer: null,
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
					if (queuedIndex >= 0) {
						this.queue.splice(queuedIndex, 1);
					}
					queued.resolve(placement);
				})
				.catch((error) => {
					const queuedIndex = this.queue.indexOf(queued);
					if (queuedIndex >= 0) {
						this.queue.splice(queuedIndex, 1);
					}
					queued.reject(error);
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

	private async execAsTaskUser(
		placement: TaskPlacement,
		argv: string[],
		options?: { timeoutMs?: number; workdir?: string },
	): Promise<AgentSandboxExecResult> {
		return await this.runDocker(
			[
				"exec",
				"-u",
				String(placement.uid),
				"-w",
				options?.workdir ?? placement.workdir,
				createAgentSandboxContainerName(placement.slot),
				...argv,
			],
			options,
		);
	}

	private async execAsRoot(
		placement: TaskPlacement,
		argv: string[],
		options?: { timeoutMs?: number },
	): Promise<AgentSandboxExecResult> {
		return await this.runDocker(
			[
				"exec",
				"-u",
				"0:0",
				"-w",
				AGENT_SANDBOX_WORKSPACES_DIR,
				createAgentSandboxContainerName(placement.slot),
				...argv,
			],
			options,
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
			containerName: createAgentSandboxContainerName(placement.slot),
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

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeTaskIdForSandboxPath(taskId: string): string {
	return (
		taskId
			.trim()
			.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
			.replace(/^-+/g, "")
			.slice(0, 80) || "task"
	);
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

function bufferOrStringToString(value: string | Buffer | undefined): string {
	if (typeof value === "string") {
		return value;
	}
	return value?.toString("utf8") ?? "";
}

function joinDockerOutput(result: AgentSandboxExecResult): string {
	return [result.stderr, result.stdout]
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n");
}

function parseDockerOutputLines(stdout: string): string[] {
	return stdout
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean);
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

function parseToolRunnerResult(stdout: string): { ok: true; result: unknown } | { ok: false; error: string } {
	try {
		const parsed = JSON.parse(stdout) as unknown;
		if (parsed && typeof parsed === "object" && "ok" in parsed) {
			const record = parsed as Record<string, unknown>;
			if (record.ok === true) {
				return { ok: true, result: record.result };
			}
			return { ok: false, error: typeof record.error === "string" ? record.error : "Tool runner failed." };
		}
	} catch {
		// Fall through to a plain output error.
	}
	return { ok: false, error: stdout.trim() || "Tool runner returned invalid JSON." };
}

function formatSandboxToolFailure(tool: string, details: string): string {
	const normalizedTool = tool.trim() || "unknown";
	const normalizedDetails = details.trim();
	const detailText = normalizedDetails ? `\n${normalizedDetails}` : "";
	return `Sandbox tool ${normalizedTool} failed.${detailText}\nNext step: inspect the command, file path, permissions, and sandbox output above; then retry with a smaller focused ${normalizedTool} request.`;
}

function assertSandboxExecOk(result: AgentSandboxExecResult, operation: string): void {
	if (result.exitCode === 0) {
		return;
	}
	const output = joinDockerOutput(result);
	throw new AgentSandboxExecutionError(`Could not ${operation}.${output ? `\n${output}` : ""}`, result);
}
