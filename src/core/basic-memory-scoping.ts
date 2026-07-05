/**
 * §5.AR — pure scoping + egress-hardening plan for the basic-memory MCP server. basic-memory persists AUTHORED memory
 * as a Markdown knowledge graph; nKlein scopes it two ways at once (David 2026-07-05): a PER-PROJECT store keyed by the
 * workspace hash (repo-local tribal knowledge — the default the session is pinned to) and one shared GLOBAL store
 * (cross-repo lessons). Both are host-side, bind-mounted RW into the task's `--network none` sandbox container.
 *
 * This module is pure: it computes the host/container paths, the basic-memory project registrations for the container's
 * config.json, and the env (verified egress-hardening + config-dir/project pin). The runtime consumes the plan to add
 * the mounts, seed config.json, and set the exec env — the effectful edges stay at the call site.
 *
 * Egress note (verified against basic-memory v0.22.1 source): the local MCP data path is in-process (no socket), but
 * three DEFAULT-ON outbound vectors exist — a pypi auto-update thread on stdio startup, Umami analytics on cloud/promo
 * paths, and a first-use FastEmbed model download. {@link basicMemoryHardeningEnv} disables all three; the sandbox's
 * own `--network none` is the belt-and-suspenders backstop (every vector degrades gracefully when blocked).
 */

/** The two scoping levels a basic-memory store can have. */
export type BasicMemoryScope = "project" | "global";

/** The basic-memory project name for the single shared cross-repo store. */
export const BASIC_MEMORY_GLOBAL_PROJECT = "global";

/**
 * In-container root the basic-memory stores mount under. The sandbox container is SHARED across every project a slot
 * serves (maxContainers=1, unlimited agents), and `startContainer` mounts ALL registered projects into it at once — so
 * a per-project store's container path MUST carry the workspace hash (`<root>/<workspaceHash>/…`), else two projects
 * collide on the same `--mount` destination and `docker run` fails ("Duplicate mount point"), crashing the whole
 * container. The GLOBAL store is the one deliberate shared path (`<root>/global`, identical across projects — the
 * runtime dedups it by destination). (Fixed 2026-07-05: the old fixed `<root>/{notes,config}` was a multi-project
 * outage bug — a single-project run passed, two projects in one slot did not.)
 */
export const BASIC_MEMORY_CONTAINER_ROOT = "/nklein/basic-memory";

/** The per-project basic-memory project name for a workspace hash (never the host path — invariant #2). */
export function basicMemoryProjectName(workspaceHash: string): string {
	return `ws-${workspaceHash}`;
}

/** One project registered in the container's basic-memory config.json (name → notes dir), plus its host bind source. */
export interface BasicMemoryProjectRegistration {
	scope: BasicMemoryScope;
	/** basic-memory project name (pinned via BASIC_MEMORY_MCP_PROJECT or addressed per-call). */
	name: string;
	/** In-container notes dir (the project root basic-memory reads/writes markdown under). */
	containerNotesDir: string;
	/** Host notes dir bind-mounted RW to `containerNotesDir` (markdown = source of truth, survives container teardown). */
	hostNotesDir: string;
}

export interface BasicMemoryScopingPlan {
	/** BASIC_MEMORY_CONFIG_DIR — holds config.json + the SQLite index; per-workspace so indexes never collide. */
	containerConfigDir: string;
	/** Host dir bound RW to `containerConfigDir` (per-workspace). */
	hostConfigDir: string;
	/** The projects to register in config.json (per-project first, then global when enabled). */
	projects: BasicMemoryProjectRegistration[];
	/** The default project pinned via BASIC_MEMORY_MCP_PROJECT — the per-project store (work is repo-scoped by default). */
	defaultProject: string;
	/** The full exec env for the basic-memory MCP invocation (egress hardening + config-dir + default project pin). */
	env: Record<string, string>;
}

/**
 * The verified egress-hardening env (basic-memory v0.22.1). Disables the pypi auto-update thread, the Umami analytics
 * POST, and forces FastEmbed/HuggingFace to load only from the pre-seeded local cache (no first-use model download).
 */
export function basicMemoryHardeningEnv(): Record<string, string> {
	return {
		BASIC_MEMORY_AUTO_UPDATE: "false",
		BASIC_MEMORY_NO_PROMOS: "1",
		HF_HUB_OFFLINE: "1",
		TRANSFORMERS_OFFLINE: "1",
	};
}

/**
 * Build the scoping plan for a task. `scopes` selects which stores to mount (always at least "project"; add "global"
 * for the shared cross-repo store). The per-project store is the pinned default so repo work reads/writes its own KB
 * unless a tool call explicitly targets the global project.
 */
export function planBasicMemoryScoping(input: {
	/** The nKlein runtime home on the HOST (stores live under `<runtimeHome>/basic-memory/…`). */
	runtimeHome: string;
	/** The workspace-path hash (from the ledger's `hashWorkspacePathForLedger`) — keys the per-project store. */
	workspaceHash: string;
	/** Which scopes to enable. Deduped; "project" is always included (it's the default store). */
	scopes: readonly BasicMemoryScope[];
}): BasicMemoryScopingPlan {
	const home = input.runtimeHome.replace(/\/+$/u, "");
	const enabled = new Set<BasicMemoryScope>(["project", ...input.scopes]);

	// Per-workspace container root — the shared container mounts several projects at once, so each project's config +
	// notes dst MUST be unique (else duplicate `--mount` destinations crash `docker run`). The global store is the one
	// intentionally-shared path (identical across projects; the runtime dedups it by destination).
	const containerBase = `${BASIC_MEMORY_CONTAINER_ROOT}/${input.workspaceHash}`;

	const projectName = basicMemoryProjectName(input.workspaceHash);
	const projects: BasicMemoryProjectRegistration[] = [
		{
			scope: "project",
			name: projectName,
			containerNotesDir: `${containerBase}/notes`,
			hostNotesDir: `${home}/basic-memory/${input.workspaceHash}/notes`,
		},
	];
	if (enabled.has("global")) {
		projects.push({
			scope: "global",
			name: BASIC_MEMORY_GLOBAL_PROJECT,
			containerNotesDir: `${BASIC_MEMORY_CONTAINER_ROOT}/global`,
			hostNotesDir: `${home}/basic-memory/global/notes`,
		});
	}

	const containerConfigDir = `${containerBase}/config`;
	return {
		containerConfigDir,
		hostConfigDir: `${home}/basic-memory/${input.workspaceHash}/config`,
		projects,
		defaultProject: projectName,
		env: {
			...basicMemoryHardeningEnv(),
			BASIC_MEMORY_CONFIG_DIR: containerConfigDir,
			BASIC_MEMORY_MCP_PROJECT: projectName,
		},
	};
}

/** One RW bind mount the sandbox must add so basic-memory's host-side store is writable inside the container. */
export interface BasicMemoryMount {
	hostPath: string;
	containerPath: string;
	/** Always true here — the markdown store + SQLite index must be writable (the one deviation from the RO rootfs). */
	readWrite: boolean;
}

/** The sandbox primitives a scoping plan needs: the RW bind mounts + the exec env. */
export interface BasicMemorySandboxWiring {
	mounts: BasicMemoryMount[];
	env: Record<string, string>;
}

/**
 * Bridge a scoping plan to the sandbox primitives (pure): the RW bind mounts (the config/index dir + every project's
 * notes dir) plus the exec env. The runtime adds these mounts at container create + passes the env to
 * `buildSandboxMcpDockerExecArgs`. The config dir is per-workspace (isolated index), each project's notes are bound to
 * their host source (per-project = per-workspace; global = the shared cross-repo dir).
 */
export function planBasicMemorySandboxWiring(plan: BasicMemoryScopingPlan): BasicMemorySandboxWiring {
	const mounts: BasicMemoryMount[] = [
		{ hostPath: plan.hostConfigDir, containerPath: plan.containerConfigDir, readWrite: true },
		...plan.projects.map((project) => ({
			hostPath: project.hostNotesDir,
			containerPath: project.containerNotesDir,
			readWrite: true,
		})),
	];
	return { mounts, env: plan.env };
}

/**
 * The `docker exec` argv(s) that SEED basic-memory's config for a plan — one `basic-memory project add <name> <notesDir>`
 * per project (validated live 2026-07-05: basic-memory does NOT auto-init; an explicit `project add` registers the
 * project → its mounted notes dir, after which `write_note` pinned via BASIC_MEMORY_MCP_PROJECT persists there). Run each
 * with BASIC_MEMORY_CONFIG_DIR (in {@link BasicMemoryScopingPlan.env}) pointed at the mounted config dir. Pure — returns
 * the argv arrays; the caller execs them once at container start (idempotent: re-adding an existing project is a no-op).
 */
export function basicMemorySeedProjectArgs(plan: BasicMemoryScopingPlan): string[][] {
	return plan.projects.map((project) => ["basic-memory", "project", "add", project.name, project.containerNotesDir]);
}
