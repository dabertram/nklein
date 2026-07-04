/**
 * §5.BA guided-configuration detection core — PURE "detect → recommend" logic.
 *
 * These functions turn already-gathered facts (hardware, loaded models, package.json) into the
 * recommendations the setup wizards render. They perform NO I/O: the caller (runtime/CLI) gathers the facts
 * — RAM/CPU from the host, loaded-model count from LM Studio, the package.json from the repo — and hands
 * them in. Keeping this layer pure makes every recommendation unit-testable and keeps the wizard UI a thin
 * renderer over `buildGlobalSetupPlan` / `buildProjectSetupPlan`.
 *
 * Ordering (per todo §5.BA): the completion-stamp config fields + this detection layer land as runtime work
 * BEFORE the React wizard surface (§5.AX era). The trigger-wiring (auto-fire on the null stamp) and the UI
 * are the next phase; they consume the step models produced here.
 */

import { DEFAULT_MAX_CONCURRENT_TASKS } from "../config/runtime-config-defaults";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox-docker";

// ---------------------------------------------------------------------------------------------------------
// Sandbox pool sizing
// ---------------------------------------------------------------------------------------------------------

/** Recommended ONE-shared-container sandbox sizing derived from the host + the Docker VM. */
export interface SandboxPoolRecommendation {
	/** 1 — one shared container hosts every agent. */
	maxContainers: number;
	/** 0 — unlimited co-occupancy; the exec cap (not the agent count) governs the memory peak. */
	agentsPerContainer: number;
	/** The one container's memory, fitted inside the Docker VM (minus Docker's own overhead). */
	memoryPerContainerMb: number;
	cpusPerContainer: number;
	/** Concurrent in-container commands the container can hold at once — the spike guard. */
	maxConcurrentExec: number;
	/** The Docker VM memory (MB) the sizing was computed against, or null when it couldn't be detected. */
	dockerVmMemoryMb: number | null;
	/** Actionable warnings — chiefly "raise the Docker VM" when it's too small for a useful container. */
	warnings: string[];
	/** Plain-language explanation of how the numbers were derived (rendered under the wizard step). */
	rationale: string;
}

/** Reserve for the OS + local model server when sizing against HOST RAM (the fallback when the Docker VM is unknown). */
const SANDBOX_HOST_RESERVED_RAM_MB = 8192;
/** Reserve one CPU for the host/model server; the rest is available to the container. */
const SANDBOX_HOST_RESERVED_CPUS = 1;
/** Memory a single concurrent heavy in-container command (npm/build/the acceptance command) can claim. */
const SANDBOX_EXEC_SPIKE_BUDGET_MB = 1536;
/** The one container's baseline (sleep + page cache + light git ops) on top of the concurrent spikes. */
const SANDBOX_CONTAINER_BASELINE_MB = 1024;
/** Reserved inside the Docker VM for the docker daemon / buildkit / image layers, before the container's own budget. */
const DOCKER_VM_OVERHEAD_MB = 3072;
/** Never recommend more concurrent execs than this (diminishing returns + thrash guard). */
const SANDBOX_MAX_RECOMMENDED_EXEC = 6;

/**
 * Recommend ONE-shared-container sizing (todo §5.AR): one container hosts every agent (maxContainers=1,
 * agentsPerContainer=0), and the memory ceiling is governed by how many in-container commands run AT ONCE
 * (`maxConcurrentExec` — the spike guard), NOT the agent count. Sizes the container + exec cap against the DOCKER VM
 * (containers live inside it on macOS/Windows), falling back to a host-RAM budget only when the VM size isn't known,
 * and WARNS when the Docker VM is too small for a useful container (the real bottleneck on a big host running a
 * default Docker VM). Pure: the caller passes detected host RAM/CPU + the Docker VM memory (from `docker info`).
 */
export function recommendSandboxPoolSizing(input: {
	totalRamMb: number;
	cpuCount: number;
	/** Docker VM memory in MB (from `docker info` Total Memory). null/undefined ⇒ unknown (Linux host, or not probed). */
	dockerVmMemoryMb?: number | null;
}): SandboxPoolRecommendation {
	const totalRamMb = Number.isFinite(input.totalRamMb) && input.totalRamMb > 0 ? input.totalRamMb : 0;
	const cpuCount = Number.isFinite(input.cpuCount) && input.cpuCount > 0 ? Math.floor(input.cpuCount) : 1;
	const dockerVmMemoryMb =
		typeof input.dockerVmMemoryMb === "number" &&
		Number.isFinite(input.dockerVmMemoryMb) &&
		input.dockerVmMemoryMb > 0
			? Math.floor(input.dockerVmMemoryMb)
			: null;

	// How many concurrent heavy commands the host could usefully run — ~one per 2 cores, clamped.
	const availableCpus = Math.max(0, cpuCount - SANDBOX_HOST_RESERVED_CPUS);
	const execTarget = Math.min(SANDBOX_MAX_RECOMMENDED_EXEC, Math.max(1, Math.floor(availableCpus / 2)));
	const targetContainerMb = execTarget * SANDBOX_EXEC_SPIKE_BUDGET_MB + SANDBOX_CONTAINER_BASELINE_MB;

	// The container lives inside the Docker VM (macOS/Windows) → capped by VM − Docker overhead. Unknown VM ⇒ fall back
	// to a host-RAM budget (Linux, where containers use host memory directly).
	const containerCeilingMb =
		dockerVmMemoryMb !== null
			? Math.max(0, dockerVmMemoryMb - DOCKER_VM_OVERHEAD_MB)
			: Math.max(0, totalRamMb - SANDBOX_HOST_RESERVED_RAM_MB);

	// Fit the target into the ceiling, never below the shipped floor (a tiny VM still gets a working — if capped — box).
	// ALWAYS clamp to the ceiling: when the ceiling is ≤ 0 (a Docker VM at/below Docker's own overhead) `min(target, 0)`
	// is 0 and the outer `Math.max` restores the floor — so a smaller VM never yields a LARGER recommendation than a
	// bigger one (the too-small-VM warning below tells the operator to raise it).
	const memoryPerContainerMb = Math.max(
		DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
		Math.min(targetContainerMb, containerCeilingMb),
	);
	const maxConcurrentExec = Math.min(
		execTarget,
		Math.max(1, Math.floor((memoryPerContainerMb - SANDBOX_CONTAINER_BASELINE_MB) / SANDBOX_EXEC_SPIKE_BUDGET_MB)),
	);
	const cpusPerContainer = Math.max(DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER, Math.min(12, availableCpus));

	const warnings: string[] = [];
	const neededVmMb = targetContainerMb + DOCKER_VM_OVERHEAD_MB;
	if (dockerVmMemoryMb !== null && dockerVmMemoryMb < neededVmMb) {
		warnings.push(
			`Docker's VM is only ${formatRamGb(dockerVmMemoryMb)} — too small to run ${execTarget} concurrent build/test ` +
				`commands (capped at ${maxConcurrentExec}). Raise it to ≥ ${formatRamGb(neededVmMb)} in Docker Desktop → ` +
				`Settings → Resources → Memory (your host has ${formatRamGb(totalRamMb)}; the VM is dynamic, so a higher cap ` +
				`does not pre-reserve RAM).`,
		);
	} else if (dockerVmMemoryMb === null) {
		warnings.push(
			`Could not detect the Docker VM memory — on Docker Desktop, ensure its VM is ≥ ${formatRamGb(neededVmMb)} ` +
				`(Settings → Resources → Memory) so the sandbox can run ${execTarget} concurrent build/test commands.`,
		);
	}

	const rationale =
		`One shared container hosts every agent; its memory ceiling is governed by how many in-container commands run at ` +
		`once, not the agent count. Detected ${formatRamGb(totalRamMb)} host RAM, ${cpuCount} CPU${cpuCount === 1 ? "" : "s"}` +
		`${dockerVmMemoryMb !== null ? `, Docker VM ${formatRamGb(dockerVmMemoryMb)}` : ", Docker VM size unknown"}. ` +
		`Sized the container to ${formatRamGb(memoryPerContainerMb)} with up to ${maxConcurrentExec} concurrent command` +
		`${maxConcurrentExec === 1 ? "" : "s"} (~${formatRamGb(SANDBOX_EXEC_SPIKE_BUDGET_MB)} each + ` +
		`${formatRamGb(SANDBOX_CONTAINER_BASELINE_MB)} baseline).`;

	return {
		maxContainers: 1,
		agentsPerContainer: DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
		memoryPerContainerMb,
		cpusPerContainer,
		maxConcurrentExec,
		dockerVmMemoryMb,
		warnings,
		rationale,
	};
}

function formatRamGb(ramMb: number): string {
	const gb = ramMb / 1024;
	// Whole numbers render without a decimal (8 GB, not 8.0 GB); otherwise one decimal place.
	return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------------------------------------

/** Recommended task concurrency derived from the loaded-model fleet + CPU count. */
export interface ConcurrencyRecommendation {
	maxConcurrentTasks: number;
	rationale: string;
}

/** Never recommend more concurrent tasks than this regardless of the fleet (per-endpoint serialization guard). */
const MAX_RECOMMENDED_CONCURRENT_TASKS = 8;

/**
 * Recommend `maxConcurrentTasks` from the number of loaded models and the CPU count. More loaded models =
 * more endpoints to parallelize across; a machine with more CPUs can sustain more concurrent orchestration.
 * The DEFAULT_MAX_CONCURRENT_TASKS is the floor (a single loaded model still gets the sane default); the
 * recommendation never exceeds the loaded-model count (no point scheduling more tasks than endpoints) nor
 * a hard cap that keeps the machine from thrashing.
 */
export function recommendConcurrency(input: { loadedModelCount: number; cpuCount: number }): ConcurrencyRecommendation {
	const loadedModelCount =
		Number.isFinite(input.loadedModelCount) && input.loadedModelCount > 0 ? Math.floor(input.loadedModelCount) : 0;
	const cpuCount = Number.isFinite(input.cpuCount) && input.cpuCount > 0 ? Math.floor(input.cpuCount) : 1;

	// Scale by loaded models but never above what the CPUs can sustain (~1 task per 2 CPUs beyond the floor).
	const byCpu = Math.max(DEFAULT_MAX_CONCURRENT_TASKS, Math.floor(cpuCount / 2));
	const byModels = Math.max(DEFAULT_MAX_CONCURRENT_TASKS, loadedModelCount);
	const maxConcurrentTasks = Math.min(MAX_RECOMMENDED_CONCURRENT_TASKS, byCpu, byModels);

	const modelPhrase =
		loadedModelCount === 0
			? "no loaded models detected"
			: `${loadedModelCount} loaded model${loadedModelCount === 1 ? "" : "s"}`;
	const rationale =
		`With ${modelPhrase} and ${cpuCount} CPU${cpuCount === 1 ? "" : "s"}, ${maxConcurrentTasks} concurrent ` +
		`task${maxConcurrentTasks === 1 ? "" : "s"} balances throughput against per-endpoint serialization ` +
		`(floor ${DEFAULT_MAX_CONCURRENT_TASKS}, cap ${MAX_RECOMMENDED_CONCURRENT_TASKS}).`;

	return { maxConcurrentTasks, rationale };
}

// ---------------------------------------------------------------------------------------------------------
// Acceptance command detection
// ---------------------------------------------------------------------------------------------------------

/** The detected project acceptance (verification) command + which package.json script it came from. */
export interface AcceptanceCommandDetection {
	/** The `npm run <name>` (or `npm test`) form, or null when no suitable script exists. */
	command: string | null;
	source: "test-script" | "build-script" | "none";
}

/**
 * Detect a project acceptance command from package.json scripts: prefer a `test` script, else `build`, else
 * none. `test` resolves to the canonical `npm test`; other scripts resolve to `npm run <name>`. Empty or
 * whitespace-only script bodies are treated as absent (a placeholder `"test": ""` is not a real command).
 */
export function detectProjectAcceptanceCommand(input: {
	packageJson: { scripts?: Record<string, string> } | null;
}): AcceptanceCommandDetection {
	const scripts = input.packageJson?.scripts;
	if (!scripts || typeof scripts !== "object") {
		return { command: null, source: "none" };
	}
	if (hasNonEmptyScript(scripts, "test")) {
		return { command: "npm test", source: "test-script" };
	}
	if (hasNonEmptyScript(scripts, "build")) {
		return { command: "npm run build", source: "build-script" };
	}
	return { command: null, source: "none" };
}

function hasNonEmptyScript(scripts: Record<string, string>, name: string): boolean {
	const value = scripts[name];
	return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------------------------------------
// Review posture
// ---------------------------------------------------------------------------------------------------------

/**
 * Plain-language consequence line for the review-posture wizard step. Second-opinion review ON is the
 * default (a reviewer role must approve before merge); turning it OFF puts delivery in manual-merge mode —
 * the fail-closed gate still blocks auto-merge, so a human confirms every card by hand.
 */
export function summarizeReviewPostureChoice(enabled: boolean): string {
	return enabled
		? "On (recommended): every card gets a second-opinion review pass — a reviewer role must approve before merge, and reviewer diversity (a different model than the author) strengthens the check."
		: "Off = manual-merge mode: no automated reviewer approves work, and under the fail-closed gate an unreviewed card never auto-merges — you confirm and merge each card by hand.";
}

// ---------------------------------------------------------------------------------------------------------
// Plan composition (the wizard step model)
// ---------------------------------------------------------------------------------------------------------

/** One step of a guided-setup wizard: a stable id, a title, the headline recommendation, and detail text. */
export interface SetupPlanStep {
	stepId: string;
	title: string;
	/** The short headline recommendation shown next to the step (the "detect → recommend" verdict). */
	recommendation: string;
	/** The longer explanation / rationale rendered under the step. */
	detail: string;
}

/** Facts the caller gathers for the GLOBAL wizard (hardware + fleet + probes). */
export interface GlobalSetupFacts {
	totalRamMb: number;
	cpuCount: number;
	loadedModelCount: number;
	/** Whether LM Studio (or another local provider endpoint) responded to the probe. */
	providerReachable: boolean;
	/** The default provider endpoint the probe targeted (e.g. "http://localhost:1234"). */
	providerEndpoint: string;
	/** Whether the Docker daemon + sandbox image are available (null = not probed / unknown). */
	dockerAvailable: boolean | null;
	/** Docker VM memory in MB (from `docker info` Total Memory); null = not probed / Linux host. Sizes the sandbox. */
	dockerVmMemoryMb?: number | null;
	/** Current second-opinion review posture (defaults to the global default when unset). */
	secondOpinionReviewEnabled: boolean;
}

/** Facts the caller gathers for the PROJECT wizard (repo detection). */
export interface ProjectSetupFacts {
	packageJson: { scripts?: Record<string, string> } | null;
	/** Loaded models + CPUs, so the per-project concurrency step can suggest a cap relative to the global default. */
	loadedModelCount: number;
	cpuCount: number;
	/** The repo's detected default base branch (e.g. "main"), or null when it could not be detected. */
	detectedBaseBranch: string | null;
}

/** Stable step ids for the GLOBAL wizard (matches todo §5.BA's global step list). */
export const GLOBAL_SETUP_STEP_IDS = [
	"provider",
	"sandbox",
	"concurrency",
	"review",
	"guardrails",
	"features",
] as const;

/** Stable step ids for the PROJECT wizard (matches todo §5.BA's project step list). */
export const PROJECT_SETUP_STEP_IDS = [
	"overrides",
	"concurrency",
	"overlap",
	"egress",
	"acceptance",
	"baseBranch",
] as const;

/**
 * Compose the GLOBAL setup wizard step model from gathered facts. Steps are in a stable order with stable
 * ids (provider → sandbox → concurrency → review → guardrails → features); the UI renders this list later.
 */
export function buildGlobalSetupPlan(facts: GlobalSetupFacts): SetupPlanStep[] {
	const sandbox = recommendSandboxPoolSizing({
		totalRamMb: facts.totalRamMb,
		cpuCount: facts.cpuCount,
		dockerVmMemoryMb: facts.dockerVmMemoryMb,
	});
	const concurrency = recommendConcurrency({ loadedModelCount: facts.loadedModelCount, cpuCount: facts.cpuCount });

	const providerRecommendation = facts.providerReachable
		? `Connected at ${facts.providerEndpoint} — ${facts.loadedModelCount} model${facts.loadedModelCount === 1 ? "" : "s"} loaded.`
		: `No local provider reached at ${facts.providerEndpoint} — start LM Studio (or point to your endpoint) before running cards.`;

	const dockerDetail =
		facts.dockerAvailable === null
			? "Docker availability not probed. Strict Docker isolation is required — every agent action runs in a container."
			: facts.dockerAvailable
				? "Docker daemon + sandbox image available. Strict isolation is ready."
				: "Docker not available. Strict isolation fails closed — install/start Docker and build the sandbox image before running cards.";

	return [
		{
			stepId: "provider",
			title: "Provider & endpoint",
			recommendation: providerRecommendation,
			detail: `Probe the local model server (default ${facts.providerEndpoint}) and confirm the loaded models !Klein will drive. Local-only: no cloud provider is used.`,
		},
		{
			stepId: "sandbox",
			title: "Docker sandbox",
			recommendation: `One shared container @ ${sandbox.memoryPerContainerMb} MB / ${sandbox.cpusPerContainer} CPU, up to ${sandbox.maxConcurrentExec} concurrent command${sandbox.maxConcurrentExec === 1 ? "" : "s"}.`,
			detail: [sandbox.rationale, dockerDetail, ...sandbox.warnings].join(" "),
		},
		{
			stepId: "concurrency",
			title: "Concurrency",
			recommendation: `${concurrency.maxConcurrentTasks} concurrent task${concurrency.maxConcurrentTasks === 1 ? "" : "s"}.`,
			detail: concurrency.rationale,
		},
		{
			stepId: "review",
			title: "Review posture",
			recommendation: facts.secondOpinionReviewEnabled
				? "Second-opinion review ON (recommended)."
				: "Second-opinion review OFF (manual-merge).",
			detail: summarizeReviewPostureChoice(facts.secondOpinionReviewEnabled),
		},
		{
			stepId: "guardrails",
			title: "Swarm guardrails",
			recommendation: "Keep the default turn + wall-time budgets.",
			detail:
				"Per-task budgets (max autonomous turns, wall-time, repeated-no-diff checkpoints) stop a runaway or stalled swarm. The defaults are sane for local hardware; raise them only for large decompositions.",
		},
		{
			stepId: "features",
			title: "Optional features",
			recommendation: "Review each opt-in trade-off; defaults are safe.",
			detail:
				"knows-today (date grounding), sandbox-hosted MCP servers, retrieval egress (sends search queries off this machine — OFF by default), and the file-overlap parallelism default. Each is skippable; keeping the defaults never sends data off-machine.",
		},
	];
}

/**
 * Compose the PROJECT setup wizard step model from repo-detection facts. Steps are in a stable order with
 * stable ids (overrides → concurrency → overlap → egress → acceptance → baseBranch); the UI renders it later.
 * Every step is framed as a per-project override relative to the inherited global default.
 */
export function buildProjectSetupPlan(facts: ProjectSetupFacts): SetupPlanStep[] {
	const acceptance = detectProjectAcceptanceCommand({ packageJson: facts.packageJson });
	const concurrency = recommendConcurrency({ loadedModelCount: facts.loadedModelCount, cpuCount: facts.cpuCount });

	const acceptanceRecommendation =
		acceptance.command === null
			? "No test/build script detected — set an acceptance command manually or leave unset."
			: `Use \`${acceptance.command}\` (from the ${acceptance.source === "test-script" ? "test" : "build"} script).`;

	const baseBranchRecommendation =
		facts.detectedBaseBranch === null
			? "Base branch not detected — confirm the default branch for result branches."
			: `Detected base branch \`${facts.detectedBaseBranch}\`.`;

	return [
		{
			stepId: "overrides",
			title: "Model-role overrides",
			recommendation: "Inherit the global model roles unless this project needs different models.",
			detail: "Override the per-role model choices for this project only; unset roles inherit the global defaults.",
		},
		{
			stepId: "concurrency",
			title: "Concurrency override",
			recommendation: `Inherit global, or cap this project at ${concurrency.maxConcurrentTasks}.`,
			detail: `${concurrency.rationale} Leave unset to inherit the global concurrency; override only to throttle this project independently.`,
		},
		{
			stepId: "overlap",
			title: "File-overlap parallelism override",
			recommendation: "Inherit the global file-overlap setting.",
			detail:
				"Override whether cards touching overlapping files run in parallel (allow) or serialize for this project only; unset inherits the global default.",
		},
		{
			stepId: "egress",
			title: "Retrieval egress (this project)",
			recommendation: "Off unless this project needs online retrieval.",
			detail:
				"Opt this project into egress-gated online retrieval (web_search / browse_url). This sends queries off this machine — decide per project; unset inherits the global (OFF) default.",
		},
		{
			stepId: "acceptance",
			title: "Acceptance command",
			recommendation: acceptanceRecommendation,
			detail: `Detected from package.json scripts (source: ${acceptance.source}). The acceptance command is the verification the delivery gate runs before a card is accepted.`,
		},
		{
			stepId: "baseBranch",
			title: "Base branch",
			recommendation: baseBranchRecommendation,
			detail: "The branch result branches merge back into. Confirm the detected default or set it explicitly.",
		},
	];
}
