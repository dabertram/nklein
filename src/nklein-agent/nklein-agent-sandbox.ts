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
	buildEgressProxyExecEnvArgs,
	EGRESS_PROXY_BUNDLE_HOST_PATH_ENV,
	type EgressProxyAvailability,
	egressNetworkName,
	egressProxyContainerName,
	ensureEgressProxyAvailable,
	isEgressProxyEnabled,
	resolveSandboxEgressWiring,
	teardownEgressProxy,
} from "./egress-proxy-lifecycle";
import { parseEgressAllowlist } from "./egress-proxy-role-snapshot";
import {
	AGENT_SANDBOX_CONTAINER_LABEL,
	AGENT_SANDBOX_VOLUME_PREFIX,
	AGENT_SANDBOX_WORKSPACES_DIR,
	type AgentSandboxEgressWiring,
	type AgentSandboxPoolConfig,
	type AgentSandboxProjectMount,
	type AgentSandboxWritableMount,
	buildAgentSandboxDockerRunArgs,
	createAgentSandboxContainerName,
	createAgentSandboxProjectKey,
	createAgentSandboxTaskUid,
	createAgentSandboxVolumeName,
	normalizeAgentSandboxPoolConfig,
	resolveAgentSandboxImageName,
} from "./nklein-agent-sandbox-docker";
import { AGENT_SANDBOX_EXTRA_TOOL_RUNNER } from "./nklein-agent-sandbox-extra-tools";
import { bufferOrStringToString, joinDockerOutput, parseDockerOutputLines } from "./nklein-agent-sandbox-output";
import {
	isAgentSandboxExecResult,
	isAgentSandboxWorkspaceVolumeName,
	isContainerMissingError,
} from "./nklein-agent-sandbox-predicates";
import {
	type AgentSandboxShellTarget,
	buildAgentSandboxInteractiveShellArgs,
	buildTaskShellSpawnSpec,
	DEFAULT_AGENT_SANDBOX_SHELL,
	type TaskShellSpawnSpec,
} from "./nklein-agent-sandbox-shell";
import { normalizeTaskIdForSandboxPath, stripRedundantSandboxWorkdirPrefix } from "./nklein-agent-sandbox-task-path";
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
/** A QUEUED slot acquisition waiting past this (via the injected `warn`) is logged as a possible capacity stall. */
const SLOT_QUEUE_SLOW_WAIT_LOG_MS = 30_000;
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
	/**
	 * §5.L egress proxy (§6 I3): the persisted `sandboxEgressProxyEnabled` Settings flag. Consulted by
	 * `isEgressProxyEnabled` ONLY when `NKLEIN_SANDBOX_EGRESS_PROXY` is unset (real environment wins). Default false.
	 */
	sandboxEgressProxyEnabled?: boolean;
	/**
	 * §5.L egress proxy (§6 I3): the persisted `sandboxEgressAllowlist` (raw comma/newline string). Parsed via
	 * `parseEgressAllowlist` and handed to the proxy container as its `allowlistForRole` source. Empty ⇒ default-deny.
	 */
	sandboxEgressAllowlist?: string | null;
	/**
	 * §5.AR/§5.BB basic-memory: enables the per-project writable store plan (config + notes mounted RW at container
	 * start). Composed with the `NKLEIN_BASIC_MEMORY` env override at construction/set time (either enables); defaults
	 * to false = fully read-only sandbox unless the env flag is set.
	 */
	basicMemoryEnabled?: boolean;
	/** Extra read-write host bind mounts for explicitly approved sandbox-visible stores/paths. Empty by default. */
	writableMounts?: readonly AgentSandboxWritableMount[];
	execFile?: typeof execFile;
	setTimeout?: typeof setTimeout;
	clearTimeout?: typeof clearTimeout;
	/**
	 * Optional diagnostic logger. When a slot acquisition has to QUEUE (pool at capacity), a warn fires if the
	 * wait exceeds {@link SLOT_QUEUE_SLOW_WAIT_LOG_MS} and again on resolve/reject — so a silent capacity stall
	 * (the review-hang autopsy, 2026-07-10) is visible instead of a mysterious freeze. No-op by default.
	 */
	warn?: (message: string) => void;
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
	/**
	 * §5.L egress proxy (§10c#18): the proxy's INTERNAL IP this container was `docker run` on the `--internal` egress
	 * network with, or `null` when it is NOT on that network (every `none`/`full` container, and any `allowlist`
	 * container started while the proxy was unavailable — fail-closed). The exec seam keys per-`docker exec`
	 * `HTTP(S)_PROXY` injection off THIS value, so a container's proxy env exactly matches the network it was created
	 * on — never a stale pool-policy read across a runtime tier switch (occupied containers age out).
	 */
	egressProxyIp: string | null;
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

/**
 * Rewrite a tool input's path field(s) with the §5.O redundant-prefix recovery, cloning only when a path actually
 * changes. Handles both the single-path shape (`{ path }` — write_file / edit_file / read_large_file / editor / readFile)
 * and the multi-path shape (`{ files: [{ path }, …] }` — write_files); anything else passes through untouched.
 */
function recoverPathField(input: unknown, taskId: string): unknown {
	if (input === null || typeof input !== "object") {
		return input;
	}
	if ("path" in input && typeof (input as { path: unknown }).path === "string") {
		const rawPath = (input as { path: string }).path;
		const corrected = stripRedundantSandboxWorkdirPrefix(rawPath, taskId);
		return corrected === rawPath ? input : { ...input, path: corrected };
	}
	if ("files" in input && Array.isArray((input as { files: unknown }).files)) {
		const files = (input as { files: unknown[] }).files;
		let changed = false;
		const recovered = files.map((file) => {
			if (file !== null && typeof file === "object" && typeof (file as { path: unknown }).path === "string") {
				const rawPath = (file as { path: string }).path;
				const corrected = stripRedundantSandboxWorkdirPrefix(rawPath, taskId);
				if (corrected !== rawPath) {
					changed = true;
					return { ...file, path: corrected };
				}
			}
			return file;
		});
		return changed ? { ...input, files: recovered } : input;
	}
	return input;
}

/**
 * §5.O parse-and-recover applied at the sandbox tool boundary: strip a redundant `workspaces/<taskId>/` relative prefix
 * from a path-bearing tool's input so a model that mistakes its cwd (the sandbox workdir) for the repo root still lands
 * the file at the intended location. Covers BOTH proxy shapes — the SDK `editor`/`readFile` executors (path at
 * `input.path`) and !Klein's own tools proxied through the extra-tool runner (path at `input.input.path` / `.files[].path`,
 * e.g. `write_file` / `edit_file` / `write_files`). Anything without a string path passes through untouched. Exported
 * for unit tests; the runtime caller is `runTool`.
 */
export function recoverRedundantSandboxToolPath(tool: string, input: unknown, taskId: string): unknown {
	if (tool === "editor" || tool === "readFile") {
		return recoverPathField(input, taskId);
	}
	if (tool === AGENT_SANDBOX_EXTRA_TOOL_RUNNER) {
		if (input === null || typeof input !== "object" || !("input" in input)) {
			return input;
		}
		const inner = (input as { input: unknown }).input;
		const recoveredInner = recoverPathField(inner, taskId);
		return recoveredInner === inner ? input : { ...input, input: recoveredInner };
	}
	return input;
}

export class AgentSandboxManager {
	private readonly image: string;
	private poolConfig: AgentSandboxPoolConfig;
	// Mutable so an operator tightening/loosening the capability tier at runtime is re-applied (see setNetworkPolicy).
	private networkPolicy: SandboxNetworkPolicy;
	// §5.L egress proxy (§6 I3): the persisted flag + raw allowlist string, mutable so a live Settings change re-applies
	// (setSandboxEgressConfig). Read at container (re)create: `isEgressProxyEnabled(env, this.sandboxEgressProxyEnabled)`
	// gates the wiring and `parseEgressAllowlist(this.sandboxEgressAllowlist)` rides the proxy container's env. The
	// `NKLEIN_SANDBOX_EGRESS_PROXY` env still overrides the flag (real environment wins).
	private sandboxEgressProxyEnabled: boolean;
	private sandboxEgressAllowlist: string;
	private readonly execFileImpl: typeof execFile;
	private readonly setTimeoutImpl: typeof setTimeout;
	private readonly clearTimeoutImpl: typeof clearTimeout;
	private readonly staticWritableMounts: readonly AgentSandboxWritableMount[];
	private readonly containers = new Map<number, ContainerState>();
	private readonly placements = new Map<string, TaskPlacement>();
	private readonly projectMountsByKey = new Map<string, AgentSandboxProjectMount>();
	// §5.AR basic-memory (OFF by default; the `basicMemoryEnabled` runtime setting OR NKLEIN_BASIC_MEMORY enables —
	// §5.BB): per-project scoping plan keyed by projectKey. When enabled, each registered project gets a per-project
	// writable store (config + notes) mounted RW at container start and seeded via `basic-memory project add`. Empty ⇒
	// no writable mounts ⇒ the sandbox stays fully read-only. Mutable so a live Settings change applies to projects
	// registered AFTER it (mounts are baked at container start; already-running containers keep their posture).
	private basicMemoryEnabled: boolean;
	private readonly basicMemoryPlanByKey = new Map<string, BasicMemoryScopingPlan>();
	private readonly queue: QueueEntry[] = [];
	private readonly workspaceLifecycleTails = new Map<string, Promise<void>>();
	// Spike guard (2026-07-04): the ONE shared container hosts every agent, and each `docker exec` tool command
	// (npm/build/acceptance) can spike to ~1–2 GiB. `activeExecs` + `execWaiters` bound how many run AT ONCE
	// (poolConfig.maxConcurrentExec) so simultaneous heavy commands can't OOM the container; excess FIFO-queue.
	private activeExecs = 0;
	private readonly execWaiters: (() => void)[] = [];
	// §5.L egress proxy (§10c#18, docs/dev/egress-proxy-design.md §4/§6). The proxy is a POOL-LEVEL shared gateway
	// (one per namespace), computed ONCE and MEMOIZED here: the first `allowlist` container (re)create resolves this
	// promise, every subsequent create reuses it (invariant: one `ensureEgressProxyAvailable` across N creates).
	// `null` ⇒ "not yet probed / re-probe on the next allowlist create". Reset on a switch TO `allowlist`
	// (setNetworkPolicy) so a re-enabled tier re-probes, and on stopNow. Untouched for `none`/`full` or flag-off.
	private egressEnsurePromise: Promise<EgressProxyAvailability> | null = null;
	// STICKY teardown guard, separate from the (resettable) memo: true once we may have created egress Docker
	// resources (network + proxy container), so stopNow tears them down even after a memo reset left a prior proxy
	// running (e.g. allowlist → none → allowlist). Never over-grants; only governs cleanup. Cleared after teardown.
	private egressProxyEnsured = false;

	constructor(options: AgentSandboxManagerOptions = {}) {
		this.image = options.image ?? resolveAgentSandboxImageName();
		this.poolConfig = normalizeAgentSandboxPoolConfig(options.poolConfig);
		this.networkPolicy = options.networkPolicy ?? "none";
		this.sandboxEgressProxyEnabled = options.sandboxEgressProxyEnabled ?? false;
		this.sandboxEgressAllowlist = options.sandboxEgressAllowlist ?? "";
		this.basicMemoryEnabled = (options.basicMemoryEnabled ?? false) || isTruthyEnv(process.env.NKLEIN_BASIC_MEMORY);
		this.execFileImpl = options.execFile ?? execFile;
		this.setTimeoutImpl = options.setTimeout ?? setTimeout;
		this.clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
		this.staticWritableMounts = [...(options.writableMounts ?? [])];
		this.warn = options.warn;
	}

	private readonly warn: ((message: string) => void) | undefined;

	/**
	 * §5.BB live-apply the basic-memory setting on a runtime-config change (same seam as {@link setNetworkPolicy},
	 * without the container retirement: mounts are additive-opt-in, not an isolation tightening). The env override
	 * still ORs in so `NKLEIN_BASIC_MEMORY=1` scripts keep working. Takes effect for projects registered after the
	 * change; containers already running keep the mount set they started with until they age out.
	 */
	setBasicMemoryEnabled(enabled: boolean): void {
		this.basicMemoryEnabled = enabled || isTruthyEnv(process.env.NKLEIN_BASIC_MEMORY);
	}

	/**
	 * §5.L egress proxy (§6 I3) live-apply on a runtime-config change (same seam as {@link setBasicMemoryEnabled} /
	 * {@link setNetworkPolicy}). Updates the persisted flag + raw allowlist and, when EITHER changed, resets the
	 * availability memo so the NEXT `allowlist` container (re)create re-probes/re-provisions the shared proxy — never
	 * keeping a stale verdict or a stale startup allowlist (drift protection, prime directive #2). A proxy container
	 * already running keeps its startup allowlist until the pool reaps it at stopNow (env is baked at container start —
	 * the same "applies to subsequently-created containers" discipline as the basic-memory writable mounts).
	 */
	setSandboxEgressConfig(enabled: boolean, allowlist: string): void {
		if (enabled !== this.sandboxEgressProxyEnabled || allowlist !== this.sandboxEgressAllowlist) {
			this.egressEnsurePromise = null;
		}
		this.sandboxEgressProxyEnabled = enabled;
		this.sandboxEgressAllowlist = allowlist;
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
		// §5.L egress proxy: a switch TO `allowlist` must re-trigger the availability probe on the NEXT container
		// (re)create — clear the memo so a re-enabled tier re-probes (fail-closed) instead of reusing a stale verdict.
		// A switch AWAY from `allowlist` deliberately does NOT tear the proxy down here: occupied containers started on
		// the egress network are aging out and STILL route through it, so an eager teardown would break their in-flight
		// egress. The proxy is reaped at stopNow (and by the `nklein.kind=egress-proxy` startup reap) — the `Ensured`
		// flag stays set so that cleanup still fires. Idle egress containers are retired below like any policy change.
		if (policy === "allowlist") {
			this.egressEnsurePromise = null;
		}
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
			// Diagnostic: a QUEUED acquisition that stalls (pool at capacity, or a leaked slot never released) is the
			// silent freeze from the 2026-07-10 review-hang autopsy. Log when the wait crosses the slow threshold and
			// again on settle, so a capacity stall pinpoints itself instead of looking like a mysterious hang.
			const queuedAt = Date.now();
			let slowTimer: ReturnType<typeof setTimeout> | undefined;
			if (this.warn) {
				slowTimer = this.setTimeoutImpl(() => {
					this.warn?.(
						`Sandbox slot for ${input.taskId} has been QUEUED ${Math.round(SLOT_QUEUE_SLOW_WAIT_LOG_MS / 1000)}s+ (pool at capacity — ${this.containers.size}/${this.poolConfig.maxContainers} containers, ${this.queue.length} waiting). A slot may be leaked if this never clears.`,
					);
				}, SLOT_QUEUE_SLOW_WAIT_LOG_MS);
				slowTimer.unref?.();
			}
			const settleLog = (outcome: string): void => {
				if (slowTimer) {
					this.clearTimeoutImpl(slowTimer);
				}
				const waitedMs = Date.now() - queuedAt;
				if (this.warn && waitedMs >= SLOT_QUEUE_SLOW_WAIT_LOG_MS) {
					this.warn(`Sandbox slot for ${input.taskId} ${outcome} after ${Math.round(waitedMs / 1000)}s queued.`);
				}
			};
			const entry = {
				taskId: input.taskId,
				projectRepoPath: input.projectRepoPath,
				resolve: (placement: TaskPlacement) => {
					settleLog("acquired");
					resolve(placement);
				},
				reject: (error: unknown) => {
					settleLog("gave up");
					reject(error);
				},
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
		return await this.withWorkspaceLifecycle(input.taskId, async () => {
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
					await this.execAsTaskUser(placement, ["git", "clone", "--no-hardlinks", repoSource, placement.workdir], {
						workdir: AGENT_SANDBOX_WORKSPACES_DIR,
					}),
					"clone project into sandbox workspace",
				);
				if (input.baseRef?.trim()) {
					assertSandboxExecOk(
						await this.execAsTaskUser(placement, [
							"git",
							"-C",
							placement.workdir,
							"checkout",
							input.baseRef.trim(),
						]),
						"check out sandbox task base ref",
					);
				}
				return {
					workdir: placement.workdir,
					uid: placement.uid,
				};
			} catch (error) {
				await this.disposeWorkspaceUnlocked(input.taskId).catch(() => null);
				throw error;
			}
		});
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
			// §5.AF: carry the container's cgroup memory limit so the MCP memory-fit gate can withhold a heavy server
			// (codebase-memory, 2 GB) from a container too small to host it without OOM under concurrent load.
			memoryLimitMb: this.poolConfig.memoryPerContainerMb,
		};
	}

	/**
	 * §5.AF: the pool-wide per-container cgroup memory limit in MB (every container in the pool is `docker run --memory`
	 * this). Lets the session's structural-retrieval SKILL FRAGMENT apply the SAME memory-fit gate as the tool bundle, so
	 * the "prefer codebase-memory graph queries" nudge is never added when that server is withheld from a small container.
	 */
	getContainerMemoryLimitMb(): number {
		return this.poolConfig.memoryPerContainerMb;
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
		// §5.O: recover a redundant `workspaces/<taskId>/` prefix a model emits when it mistakes its cwd (the sandbox
		// workdir) for the repo root — otherwise the container nests the file and the write lands off the deliverable path.
		const effectiveInput = recoverRedundantSandboxToolPath(tool, input, taskId);
		const result = await this.execAsTaskUser(
			placement,
			["node", "/opt/nklein/tool-runner.cjs", tool, JSON.stringify(effectiveInput), placement.projectRepoPath],
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
		await this.withWorkspaceLifecycle(taskId, async () => {
			await this.disposeWorkspaceUnlocked(taskId);
		});
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
		// §5.L: reap the pool's shared egress proxy + its `--internal` network, but ONLY if we ever ensured it (a
		// flag-off / never-`allowlist` pool touched no egress Docker resources ⇒ this is a no-op, so stopNow stays
		// byte-identical for those pools). Best-effort + resets the memo so a restarted pool re-probes from scratch.
		await this.teardownEgressProxyIfEnsured();
		this.containers.clear();
		this.placements.clear();
		while (this.queue.length > 0) {
			this.queue.shift()?.reject(new AgentSandboxUnavailableError("Agent sandbox stopped before a slot opened."));
		}
	}

	/** Best-effort teardown of the pool's shared egress proxy + network (see stopNow). No-op if it was never ensured. */
	private async teardownEgressProxyIfEnsured(): Promise<void> {
		if (!this.egressProxyEnsured) {
			return;
		}
		await teardownEgressProxy((argv, options) => this.runDocker(argv, options), {
			containerName: egressProxyContainerName(this.poolConfig.namespace),
			networkName: egressNetworkName(this.poolConfig.namespace),
		});
		this.egressProxyEnsured = false;
		this.egressEnsurePromise = null;
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

	/**
	 * §5.L: resolve the egress wiring for a container ABOUT TO START. Returns EMPTY (⇒ pre-proxy run args) unless the
	 * flag is on AND the pool policy is `allowlist`; only then is the shared proxy ensured (memoized) and, when it is
	 * CONFIRMED available, the container joins the `--internal` egress network (`wiring`) and pins `--dns` at the proxy
	 * stub (`internalIp`). An unavailable/unhealthy proxy returns the fail-closed wiring (no `internalIp`), which the
	 * arg builder maps to `--network none` (R2). Never invoked for `none`/`full` or with the flag off.
	 */
	private async resolveContainerEgressWiring(): Promise<{ wiring?: AgentSandboxEgressWiring; internalIp?: string }> {
		// FAIL-CLOSED / DEFAULT-OFF gate (§7): flag off or a non-`allowlist` policy ⇒ no ensure call, no egress wiring.
		// The flag is now env OR persisted config (§6 I3): env-when-set wins, else the `sandboxEgressProxyEnabled` setting.
		if (!isEgressProxyEnabled(process.env, this.sandboxEgressProxyEnabled) || this.networkPolicy !== "allowlist") {
			return {};
		}
		const availability = await this.ensureEgressAvailability();
		const wiring = resolveSandboxEgressWiring(availability);
		if (availability.available && availability.internalIp) {
			return { wiring, internalIp: availability.internalIp };
		}
		// FAIL CLOSED (R2): a proxy that is not confirmed available yields `{ egressProxyAvailable: false }`, which the
		// arg builder maps to `--network none` — no `--dns`, no egress — exactly the pre-proxy behavior.
		return { wiring };
	}

	/**
	 * Ensure (ONCE, memoized) the pool's shared egress proxy and return its availability. The promise is cached so N
	 * concurrent/sequential `allowlist` container creates trigger exactly ONE `ensureEgressProxyAvailable`; the memo is
	 * reset only on a switch TO `allowlist` (setNetworkPolicy) or stopNow. Caller guarantees flag-on + `allowlist`.
	 */
	private ensureEgressAvailability(): Promise<EgressProxyAvailability> {
		if (!this.egressEnsurePromise) {
			this.egressEnsurePromise = this.probeEgressAvailability();
		}
		return this.egressEnsurePromise;
	}

	/** The memoized body behind {@link ensureEgressAvailability} — resolves the bundle path, then runs the lifecycle. */
	private async probeEgressAvailability(): Promise<EgressProxyAvailability> {
		const networkName = egressNetworkName(this.poolConfig.namespace);
		// I2b interim seam (no app bundling step yet — design §6 I4): the app-shipped proxy bundle path comes from
		// NKLEIN_EGRESS_PROXY_BUNDLE. ABSENT ⇒ FAIL CLOSED to unavailable WITHOUT touching Docker (no bundle ⇒ no
		// proxy ⇒ `allowlist` stays `--network none`), so a flag flipped on without a shipped bundle never over-grants.
		const bundleHostPath = process.env[EGRESS_PROXY_BUNDLE_HOST_PATH_ENV]?.trim();
		if (!bundleHostPath) {
			return { available: false, networkName, internalIp: null };
		}
		// From here Docker resources (the `--internal` network, the proxy container) MAY be created — mark the sticky
		// teardown guard BEFORE the call so stopNow reaps them even if the probe later fails or is memo-reset.
		this.egressProxyEnsured = true;
		return await ensureEgressProxyAvailable((argv, options) => this.runDocker(argv, options), {
			namespace: this.poolConfig.namespace,
			bundleHostPath,
			image: this.image,
			env: process.env,
			// §6 I3: the persisted flag (env still overrides) + the resolved global allowlist handed to the proxy
			// container as its `allowlistForRole` source. v1 is ONE global allowlist for every role (per-role later).
			configuredEnabled: this.sandboxEgressProxyEnabled,
			allowlist: parseEgressAllowlist(this.sandboxEgressAllowlist),
		});
	}

	/**
	 * §5.L exec seam: the per-`docker exec` proxy env argv (`-e HTTP_PROXY=… -e HTTPS_PROXY=… -e NO_PROXY=`) for a
	 * container, or `[]` when it is NOT on the egress network. Keyed off the CONTAINER's recorded `egressProxyIp`
	 * (set at create time) — NOT the live pool policy — so a container's proxy env always matches the network it was
	 * created on, and a flag-off / `none` / `full` / fail-closed container injects NOTHING (byte-identical exec argv).
	 *
	 * v1 attributes EVERY exec to the WORKER listener port (EGRESS_PROXY_ROLE_PORTS.worker). Per-role attribution is
	 * an I3 refinement — the manager's exec seam does not carry the task's resolved ruleset role, and the design
	 * (§6 I3, risk Q4) explicitly defers task/role attribution rather than plumbing role through the pool here.
	 * TODO(I3): attribute injected exec env to the task's resolved role instead of always WORKER.
	 */
	private egressProxyExecEnvArgs(slot: number): string[] {
		const internalIp = this.containers.get(slot)?.egressProxyIp;
		if (!internalIp) {
			return [];
		}
		return buildEgressProxyExecEnvArgs(internalIp, "worker");
	}

	private async startContainer(container: ContainerState): Promise<void> {
		await this.runDocker(["rm", "-f", container.containerName], { timeoutMs: 30_000 }).catch(() => null);
		const mounts = [...this.projectMountsByKey.values()];
		// §5.AR basic-memory (flag-gated): the per-project writable stores for the projects this container serves. Empty
		// unless basic-memory is enabled (the runtime setting or NKLEIN_BASIC_MEMORY, §5.BB) ⇒ no writable mounts ⇒ the
		// sandbox is byte-identical + fully read-only.
		const basicMemoryPlans = mounts
			.map((mount) => this.basicMemoryPlanByKey.get(mount.projectKey))
			.filter((plan): plan is BasicMemoryScopingPlan => plan !== undefined);
		// DEDUP by container destination: the per-project stores are workspace-hashed (unique), but the GLOBAL store is
		// intentionally shared, so every project's plan yields the SAME `/nklein/basic-memory/global` mount — docker
		// rejects duplicate `--mount` destinations ("Duplicate mount point"), which would crash the whole shared
		// container. Keeping the first occurrence is lossless (same-dst mounts here have the same host source too).
		const writableMountsByDst = new Map<string, { hostPath: string; containerPath: string }>();
		for (const plan of basicMemoryPlans) {
			for (const mount of planBasicMemorySandboxWiring(plan).mounts) {
				if (!writableMountsByDst.has(mount.containerPath)) {
					writableMountsByDst.set(mount.containerPath, {
						hostPath: mount.hostPath,
						containerPath: mount.containerPath,
					});
				}
			}
		}
		for (const mount of this.staticWritableMounts) {
			if (!writableMountsByDst.has(mount.containerPath)) {
				writableMountsByDst.set(mount.containerPath, {
					hostPath: mount.hostPath,
					containerPath: mount.containerPath,
				});
			}
		}
		const writableMounts = [...writableMountsByDst.values()];
		// Create the host store dirs (the RW bind sources) before the container mounts them.
		await Promise.all(
			writableMounts.map((mount) => mkdir(mount.hostPath, { recursive: true }).catch(() => undefined)),
		);
		// §5.L egress proxy (§10c#18): resolve the egress wiring for THIS container. Only a flag-ON `allowlist` pool
		// ensures the shared proxy (memoized) and — when it is CONFIRMED available — joins the `--internal` egress
		// network + pins `--dns` at the proxy stub. Flag off / `none` / `full` / unavailable ⇒ empty wiring ⇒ the run
		// args are byte-identical to the pre-proxy path (`allowlist` fail-closes to `--network none`, R2).
		const egress = await this.resolveContainerEgressWiring();
		const result = await this.runDocker(
			buildAgentSandboxDockerRunArgs({
				slot: container.slot,
				image: this.image,
				projectMounts: mounts,
				...(writableMounts.length > 0 ? { writableMounts } : {}),
				config: this.poolConfig,
				networkPolicy: this.networkPolicy,
				...(egress.wiring ? { egress: egress.wiring } : {}),
				...(egress.internalIp ? { egressDnsServer: egress.internalIp } : {}),
			}),
			{ timeoutMs: 30_000 },
		);
		if (result.exitCode !== 0 || !result.stdout.trim()) {
			throw new AgentSandboxUnavailableError(
				`Could not start Docker agent sandbox ${container.containerName}: ${joinDockerOutput(result)}`,
			);
		}
		container.containerId = result.stdout.trim();
		// Record the proxy IP this container was created on the egress network with (null unless a confirmed proxied
		// `allowlist` start) so the exec seam injects `HTTP(S)_PROXY` iff the container truly has that route.
		container.egressProxyIp = egress.internalIp ?? null;
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
			egressProxyIp: null,
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
			void (async () => {
				// LIVE-FOUND RACE (det-bounce, 2026-07-08): the bounded wait can reject+splice this entry DURING the
				// acquisition below; the old stale-hand-back then called releaseSlot(taskId) — which releases whatever
				// placement CURRENTLY sits under that id, clobbering a same-task RETRY's fresh placement (the
				// ::acceptance re-entry) → its exec threw "No Docker sandbox workspace is prepared". Harden three ways:
				// skip if already rejected; hand a same-id EXISTING placement to the waiter instead of acquiring a
				// duplicate (assignContainer would overwrite it); identity-guard the stale hand-back.
				if (this.queue.indexOf(queued) < 0) {
					return; // rejected before we acquired anything — nothing to hand back.
				}
				const preExisting = this.placements.get(queued.taskId);
				if (preExisting) {
					const queuedIndex = this.queue.indexOf(queued);
					if (queuedIndex >= 0) {
						this.queue.splice(queuedIndex, 1);
						queued.resolve(preExisting);
					}
					return;
				}
				const placement = await this.tryAcquireSlot(queued.taskId, queued.projectRepoPath);
				if (!placement) {
					return;
				}
				const queuedIndex = this.queue.indexOf(queued);
				if (queuedIndex < 0) {
					// Rejected while we acquired — hand back ONLY the placement THIS drain created.
					if (this.placements.get(queued.taskId) === placement) {
						this.releaseSlot(queued.taskId);
					}
					return;
				}
				this.queue.splice(queuedIndex, 1);
				queued.resolve(placement);
			})().catch((error) => {
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

	private async withWorkspaceLifecycle<T>(taskId: string, run: () => Promise<T>): Promise<T> {
		// Review bounces can schedule a same-task redrive while finalization is still disposing the old workspace.
		// Serialize the destructive prepare/dispose pair so neither removes `/workspaces/<task>` under the other's cwd.
		const previous = this.workspaceLifecycleTails.get(taskId) ?? Promise.resolve();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.catch(() => undefined).then(() => gate);
		this.workspaceLifecycleTails.set(taskId, tail);
		await previous.catch(() => undefined);
		try {
			return await run();
		} finally {
			release();
			if (this.workspaceLifecycleTails.get(taskId) === tail) {
				this.workspaceLifecycleTails.delete(taskId);
			}
		}
	}

	private async disposeWorkspaceUnlocked(taskId: string): Promise<void> {
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

	private async execAsTaskUser(
		placement: TaskPlacement,
		argv: string[],
		options?: { timeoutMs?: number; workdir?: string },
	): Promise<AgentSandboxExecResult> {
		return await this.withExecSlot(() =>
			this.runDocker(
				[
					"exec",
					// §5.L: inject the egress-proxy env (`-e HTTP(S)_PROXY`) for a container on the egress network; `[]`
					// otherwise, so a flag-off / non-proxied exec is byte-identical. Additive — this seam carries no
					// other `-e` env (basic-memory rides the separate MCP-host exec), so nothing is clobbered.
					...this.egressProxyExecEnvArgs(placement.slot),
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
					// §5.L: same egress-proxy env injection as execAsTaskUser (EVERY task exec on the egress network).
					...this.egressProxyExecEnvArgs(placement.slot),
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
	 * Whether the manager still has an in-memory placement for the task. This is only a fast ownership hint: the
	 * Docker container or `/workspaces/<task>` directory can disappear out-of-band. Use `isWorkspacePrepared` before
	 * deciding a task can safely re-drive without restoring its sandbox cwd.
	 */
	hasWorkspace(taskId: string): boolean {
		return this.placements.has(taskId);
	}

	/**
	 * Probe the concrete Docker cwd for a placed task. A stale placement is not enough for tool execution: Node/Docker
	 * reports a missing cwd as `spawn /bin/bash ENOENT` / `chdir ... no such file or directory`, which previously made
	 * re-driven review turns look like model/tool failures instead of lost sandbox state.
	 */
	async isWorkspacePrepared(taskId: string): Promise<boolean> {
		const placement = this.placements.get(taskId);
		if (!placement) {
			return false;
		}
		try {
			const result = await this.execAsTaskUser(placement, ["test", "-d", placement.workdir], {
				workdir: AGENT_SANDBOX_WORKSPACES_DIR,
				timeoutMs: 10_000,
			});
			return result.exitCode === 0;
		} catch {
			return false;
		}
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

function assertSandboxExecOk(result: AgentSandboxExecResult, operation: string): void {
	if (result.exitCode === 0) {
		return;
	}
	const output = joinDockerOutput(result);
	throw new AgentSandboxExecutionError(`Could not ${operation}.${output ? `\n${output}` : ""}`, result);
}
