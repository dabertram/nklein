import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { Command } from "commander";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../config/runtime-config";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { RuntimeTaskNKleinSettings } from "../core/api-contract";
import { runtimeAgentIdSchema } from "../core/api-contract";
import {
	adviseContextSizes,
	buildContextSizeObservations,
	formatContextSizeAdvice,
} from "../core/context-size-advisor";
import { formatDeliveryQualityGateAuditReport, runDeliveryQualityGateAudit } from "../core/delivery-quality-gate-audit";
import { type DevTestSweepEntry, formatDevTestSweepReport, runDevTestSweep } from "../core/dev-test-sweep";
import { createDefaultLmsRunner, fetchLmsPsModels } from "../core/lms-ps-json";
import { buildLmStudioCapacityReport, formatLmStudioCapacityReport } from "../core/lmstudio-capacity-report";
import { parseLmStudioRequestStats, renderLmStudioRequestStats } from "../core/lmstudio-request-stats";
import { buildKanbanRuntimeUrl, getRuntimeFetch } from "../core/runtime-endpoint";
import { addTaskToColumn } from "../core/task-board-mutations";
import { countActiveAgentSessions, countAttentionParkedSessions } from "../core/task-session-api-contract";
import { buildWorkspaceScopeHeaders } from "../core/workspace-scope";
import { buildNKleinAdvisorRequest, type NKleinAdvisorKind } from "../nklein-agent/nklein-advisor";
import { runDevTestProject } from "../nklein-agent/nklein-dev-test-harness";
import {
	type DevTestSelection,
	resolveNKleinDevTestProjectScenario,
	scaffoldNKleinDevTestProject,
} from "../nklein-agent/nklein-dev-test-project";
import { createDevTestStateReader } from "../nklein-agent/nklein-dev-test-runner";
import { writeNKleinDogfoodBacklog } from "../nklein-agent/nklein-dogfood-engine";
import { runNKleinDevSmokeEval } from "../nklein-agent/nklein-eval-harness";
import { assertLocalProviderAllowed } from "../nklein-agent/nklein-local-only-policy";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-agent/nklein-model-research";
import { resolveProjectInputPath } from "../projects/project-path";
import { loadWorkspaceBoardById, loadWorkspaceContext } from "../state/workspace-state";
import { readModelPerformanceStats } from "../telemetry/model-performance-stats";
import type { RuntimeAppRouter } from "../trpc/app-router";
import { type DevCleanupReportOptions, runDevCleanupReportCommand } from "./dev-cleanup-commands";
import {
	runDevAdviceCommand,
	runDevCapabilityCeilingCommand,
	runDevControllerTraceCommand,
	runDevEscalationCommand,
	runDevEvalFreshnessCommand,
	runDevFleetAdviceCommand,
	runDevKnowledgeOutcomesCommand,
	runDevLedgerCommand,
	runDevMemoryAuditCommand,
	runDevMemoryLifecycleCommand,
	runDevModelRoleStabilityCommand,
	runDevModelVerdictCommand,
	runDevOpportunisticValueCommand,
	runDevPlaceholderScanCommand,
	runDevQualityBudgetCommand,
	runDevRailEvidenceCommand,
	runDevReasoningBenefitCommand,
	runDevRemediationCommand,
	runDevReplayEvalAutoCaptureCommand,
	runDevReplayEvalCommand,
	runDevRetrievalUsefulnessCommand,
	runDevRostersCommand,
	runDevRoutingCalibrationCommand,
	runDevRoutingPreviewCommand,
	runDevStubbornFailureCommand,
	runDevSwarmCommand,
} from "./dev-telemetry-commands";
import { parseDevTestPreset, parseDevTestSweepPresets } from "./dev-test-preset-parsing";
import { runDevToolMenuCommand, runDevToolPickCommand } from "./dev-two-phase-tool-commands";

interface DevSmokeEvalOptions {
	json?: boolean;
	parentDir?: string;
	evidenceRoot?: string;
	telemetryRoot?: string;
	git?: boolean;
	providerId?: string;
	modelId?: string;
	endpoint?: string;
	write?: (text: string) => void;
}

interface DevDogfoodBacklogOptions {
	json?: boolean;
	projectPath?: string;
	telemetryRoot?: string;
	slug?: string;
	suggestion?: string;
	write?: (text: string) => void;
	cwd?: string;
}

interface DevAdvisorPromptOptions {
	json?: boolean;
	kind: NKleinAdvisorKind;
	workspacePath?: string;
	repoSummary?: string;
	modelRegistrySummary?: string;
	runtimeConfigSummary?: string;
	telemetrySummary?: string;
	taskSummary?: string;
	userQuestion?: string;
	write?: (text: string) => void;
}

type DevAdvisorShortcutOptions = Omit<DevAdvisorPromptOptions, "kind">;

const DEFAULT_TELEMETRY_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "telemetry");

function buildDevSmokeEvalModelObservation(options: DevSmokeEvalOptions) {
	const providerId = options.providerId?.trim();
	const modelId = options.modelId?.trim();
	const endpoint = options.endpoint?.trim();
	if (!providerId && !modelId && !endpoint) {
		return undefined;
	}
	if (!providerId || !modelId) {
		throw new Error("--provider-id and --model-id are required together when recording smoke eval capability.");
	}
	assertLocalProviderAllowed({ providerId, baseUrl: endpoint || null });
	return {
		providerId,
		modelId,
		endpoint: endpoint || undefined,
	};
}

function parseAdvisorKind(value: string): NKleinAdvisorKind {
	if (
		value === "model_freshness" ||
		value === "mcp_discovery" ||
		value === "config_explainer" ||
		value === "log_analysis" ||
		value === "task_failure"
	) {
		return value;
	}
	throw new Error(
		"Invalid advisor kind. Expected one of: model_freshness, mcp_discovery, config_explainer, log_analysis, task_failure.",
	);
}

export async function runDevSmokeEvalCommand(options: DevSmokeEvalOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	// §5.W: honor the configured workspace base dir (global setting) for the CLI dev-test's created workspace.
	const globalConfig = await loadGlobalRuntimeConfig();
	const result = await runNKleinDevSmokeEval({
		parentDir: options.parentDir,
		...(globalConfig.workspaceBaseDir ? { workspaceBaseDir: globalConfig.workspaceBaseDir } : {}),
		evidenceRootDir: options.evidenceRoot,
		telemetryRootDir: options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT,
		initializeGit: options.git !== false,
		modelObservation: buildDevSmokeEvalModelObservation(options),
	});
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write(`${result.passed ? "Dev smoke eval passed." : "Dev smoke eval failed."}\n`);
	write(`Workspace: ${result.workspacePath}\n`);
	write(`Evidence: ${result.evidenceBundlePath}\n`);
	write(`Command: ${result.acceptanceCommand}\n`);
	if (!result.passed && result.output.trim()) {
		write(`${result.output.trim()}\n`);
	}
}

interface DevGateAuditOptions {
	json?: boolean;
	write?: (text: string) => void;
}

/** Measure the delivery-quality gate's accuracy over the bundled labeled fixture matrix (opencode-swarm gate-audit). */
export async function runDevGateAuditCommand(options: DevGateAuditOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const result = runDeliveryQualityGateAudit();
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write(formatDeliveryQualityGateAuditReport(result));
}

export async function runDevDogfoodBacklogCommand(options: DevDogfoodBacklogOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const cwd = options.cwd ?? process.cwd();
	const workspacePath = resolveProjectInputPath(options.projectPath ?? cwd, cwd);
	const result = await writeNKleinDogfoodBacklog({
		workspacePath,
		telemetryRootDir: options.telemetryRoot ?? DEFAULT_TELEMETRY_ROOT,
		slug: options.slug,
		userSuggestions: options.suggestion ? [options.suggestion] : undefined,
	});
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write("Dogfood backlog artifacts written.\n");
	write(`Plan: ${result.rootPath}\n`);
	write(`Tasks: ${result.taskGraph.tasks.length}\n`);
	write(`Next: task decompose --slug ${result.taskGraph.slug} --project-path ${workspacePath}\n`);
}

export async function runDevAdvisorPromptCommand(options: DevAdvisorPromptOptions): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const request = buildNKleinAdvisorRequest(options.kind, {
		workspacePath: options.workspacePath,
		repoSummary: options.repoSummary,
		modelRegistrySummary: options.modelRegistrySummary,
		runtimeConfigSummary: options.runtimeConfigSummary,
		telemetrySummary: options.telemetrySummary,
		taskSummary: options.taskSummary,
		userQuestion: options.userQuestion,
	});
	if (options.json) {
		write(`${JSON.stringify(request, null, 2)}\n`);
		return;
	}
	write(`# ${request.title}\n\n${request.prompt}\n`);
}

export async function runDevAdvisorShortcutCommand(
	kind: NKleinAdvisorKind,
	options: DevAdvisorShortcutOptions = {},
): Promise<void> {
	await runDevAdvisorPromptCommand({
		...options,
		kind,
	});
}

export async function runDevCheckModelsCommand(
	options: { json?: boolean; write?: (text: string) => void } = {},
): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const request = await buildNKleinModelFreshnessAdvisorRequest();
	if (options.json) {
		write(`${JSON.stringify(request, null, 2)}\n`);
		return;
	}
	write(`# ${request.title}\n\n${request.prompt}\n`);
}

const execFileAsync = promisify(execFile);

interface DevTestProjectOptions {
	preset?: string;
	projectPath?: string;
	baseRef?: string;
	pollIntervalMs?: number;
	maxWaitMs?: number;
	/** §5.AN: force the seed card onto a specific loaded model (provider:model), bypassing stale config roles. */
	modelId?: string;
	providerId?: string;
	/** Commander sets `plan: false` for `--no-plan` → start the seed in ACT mode (agent works directly). */
	plan?: boolean;
	json?: boolean;
	cwd?: string;
	write?: (text: string) => void;
}

function createDevRuntimeClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => buildWorkspaceScopeHeaders(workspaceId),
				fetch: async (url, options) => {
					const runtimeFetch = await getRuntimeFetch();
					return runtimeFetch(url, options);
				},
			}),
		],
	});
}

/**
 * Run one dev-test preset against an already-resolved runtime client + workspace, returning the raw run
 * result + wall time. Shared by the single-preset command and the sweep orchestrator (todo §5.O).
 */
// Real-model dev-test runs have BETWEEN-TURN lulls (the model sits idle between a worker finishing and the next
// card's session spawning) that far exceed the fast-simulator's 30s default settle (DEFAULT_STABLE_POLLS=6 × 5s),
// so the harness would settle "blocked/stagnant" while the runtime is STILL working. Live-found 2026-07-12: it
// settled at 3m (completed=1) while the runtime kept going to completed=3 by 18m. Give real models a much longer
// no-progress tolerance (~4 min); the overall run is still bounded by --max-wait-ms and the active-session guard
// means this only accumulates during a genuine lull (no running/queued session). Callers may override per-run.
const DEVTEST_REAL_MODEL_STABLE_POLLS = 48;

async function executeDevTestPreset(input: {
	client: ReturnType<typeof createDevRuntimeClient>;
	workspaceId: string;
	preset: DevTestSelection;
	baseRef: string;
	pollIntervalMs?: number;
	maxWaitMs?: number;
	stablePollsUntilSettled?: number;
	/** §5.AN: force the seed card onto a specific (loaded) model, bypassing stale/multi-machine config roles. */
	nkleinSettings?: RuntimeTaskNKleinSettings;
	/** When false, the seed card starts in ACT mode (the agent does the work directly) instead of plan/decompose. */
	startInPlanMode?: boolean;
}): Promise<{
	scenario: ReturnType<typeof resolveNKleinDevTestProjectScenario>;
	result: Awaited<ReturnType<typeof runDevTestProject>>;
	durationMs: number;
}> {
	const scenario = resolveNKleinDevTestProjectScenario(input.preset);
	const seedTaskId = `devtest-${scenario.id}-${Date.now()}`;
	const readState = createDevTestStateReader({
		readLiveBoard: async () => (await input.client.workspace.getState.query()).board,
		readPersistedBoard: async () => await loadWorkspaceBoardById(input.workspaceId),
		// Count in-flight sessions (running + queued) so the monitor doesn't settle "stagnant" while a slow model turn
		// (e.g. a decompose under Low Power) keeps the board static for minutes (§5.AI).
		readActiveSessionCount: async () => {
			const sessions = Object.values((await input.client.workspace.getState.query()).sessions ?? {});
			const counts = countActiveAgentSessions(sessions);
			return counts.running + counts.queued;
		},
		// Sessions parked FOR THE OPERATOR (awaiting_review + attention): lets the monitor report "needs your
		// attention: answer the question" instead of a generic stagnant (the §12 turn-loop park, live 2026-07-12).
		readAttentionCardCount: async () => {
			const sessions = Object.values((await input.client.workspace.getState.query()).sessions ?? {});
			return countAttentionParkedSessions(sessions);
		},
	});
	const startedAt = Date.now();
	const result = await runDevTestProject(
		{
			scenario,
			seedTaskId,
			baseRef: input.baseRef,
			...(typeof input.startInPlanMode === "boolean" ? { startInPlanMode: input.startInPlanMode } : {}),
			...(input.nkleinSettings ? { nkleinSettings: input.nkleinSettings } : {}),
			...(typeof input.pollIntervalMs === "number" ? { pollIntervalMs: input.pollIntervalMs } : {}),
			...(typeof input.maxWaitMs === "number" ? { maxWaitMs: input.maxWaitMs } : {}),
			// Real models settle far slower than the simulator — tolerate long between-turn lulls (see the constant above).
			stablePollsUntilSettled: input.stablePollsUntilSettled ?? DEVTEST_REAL_MODEL_STABLE_POLLS,
		},
		{
			startSeedTask: async (payload) => {
				// `startTaskSession` only RECONCILES an existing card's lane — it does not create the board card. The UI
				// always creates the card first; the CLI dev-test previously skipped that, so on a CLEAN workspace no seed
				// card ever appeared and the board stayed empty (§5.AI). Mirror the UI: create the backlog card, then start.
				try {
					const state = await input.client.workspace.getState.query();
					const cardExists = state.board.columns.some((column) =>
						column.cards.some((card) => card.id === payload.taskId),
					);
					if (!cardExists) {
						const seeded = addTaskToColumn(
							state.board,
							"backlog",
							{
								taskId: payload.taskId,
								prompt: payload.prompt,
								title: payload.taskTitle,
								baseRef: payload.baseRef,
								startInPlanMode: payload.startInPlanMode,
								...(payload.nkleinSettings ? { nkleinSettings: payload.nkleinSettings } : {}),
							},
							() => crypto.randomUUID(),
						);
						await input.client.workspace.saveState.mutate({
							board: seeded.board,
							expectedRevision: state.revision,
						});
					}
				} catch (error) {
					return {
						ok: false,
						message: `Failed to seed board card: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
				const started = await input.client.runtime.startTaskSession.mutate({
					taskId: payload.taskId,
					prompt: payload.prompt,
					taskTitle: payload.taskTitle,
					startInPlanMode: payload.startInPlanMode,
					baseRef: payload.baseRef,
					agentId: runtimeAgentIdSchema.catch("nklein").parse(payload.agentId),
					...(payload.nkleinSettings ? { nkleinSettings: payload.nkleinSettings } : {}),
				});
				return { ok: started.ok, ...(started.error ? { message: started.error } : {}) };
			},
			readState,
			sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
			now: () => Date.now(),
		},
	);
	return { scenario, result, durationMs: Date.now() - startedAt };
}

export async function runDevTestProjectCommand(options: DevTestProjectOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const cwd = options.cwd ?? process.cwd();
	const preset = parseDevTestPreset(options.preset);
	// With NO `--project-path`, SCAFFOLD a fresh isolated scenario project (template + `specification.md` + git init) and
	// run against it — a true one-shot trustworthy verification (scaffold + seed + run, §5.AI). Without the scaffolded
	// spec the decompose card has nothing to read and stalls; running against the cwd also risks workspace contamination.
	// An explicit `--project-path` is used as-is (a real project or a pre-scaffolded one).
	let projectPath: string;
	let scaffoldedBaseRef: string | null = null;
	if (options.projectPath) {
		projectPath = resolveProjectInputPath(options.projectPath, cwd);
	} else {
		const globalConfig = await loadGlobalRuntimeConfig();
		const scaffold = await scaffoldNKleinDevTestProject({
			scenario: resolveNKleinDevTestProjectScenario(preset),
			...(globalConfig.workspaceBaseDir ? { workspaceBaseDir: globalConfig.workspaceBaseDir } : {}),
		});
		projectPath = scaffold.workspacePath;
		// Use the scaffold's actual default branch as the seed baseRef (its `git init` does not force `main`).
		scaffoldedBaseRef = await execFileAsync("git", ["-C", projectPath, "rev-parse", "--abbrev-ref", "HEAD"])
			.then(({ stdout }) => stdout.trim() || null)
			.catch(() => null);
		write(`Scaffolded isolated dev-test workspace: ${projectPath}\n`);
	}
	const workspace = await loadWorkspaceContext(projectPath, { autoCreateIfMissing: true });
	const client = createDevRuntimeClient(workspace.workspaceId);
	const modelId = options.modelId?.trim();
	const nkleinSettings: RuntimeTaskNKleinSettings | undefined = modelId
		? { providerId: options.providerId?.trim() || "lmstudio", modelId }
		: undefined;
	const { scenario, result } = await executeDevTestPreset({
		client,
		workspaceId: workspace.workspaceId,
		preset,
		baseRef: options.baseRef ?? scaffoldedBaseRef ?? "main",
		...(nkleinSettings ? { nkleinSettings } : {}),
		...(options.plan === false ? { startInPlanMode: false } : {}),
		...(typeof options.pollIntervalMs === "number" ? { pollIntervalMs: options.pollIntervalMs } : {}),
		...(typeof options.maxWaitMs === "number" ? { maxWaitMs: options.maxWaitMs } : {}),
	});

	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	write(`Dev-test scenario: ${scenario.title} (${preset})\n`);
	write(
		`Seed start: ${
			result.started ? "ok" : `failed${result.startMessage ? ` — ${result.startMessage}` : ""}`
		} after ${result.polls} poll(s)\n`,
	);
	write(`${result.classification.summary}\n`);
}

interface DevTestSweepOptions {
	presets?: string;
	projectPath?: string;
	baseRef?: string;
	pollIntervalMs?: number;
	maxWaitMs?: number;
	json?: boolean;
	cwd?: string;
	write?: (text: string) => void;
}

export async function runDevTestSweepCommand(options: DevTestSweepOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const cwd = options.cwd ?? process.cwd();
	const presets = parseDevTestSweepPresets(options.presets);
	const projectPath = resolveProjectInputPath(options.projectPath ?? cwd, cwd);
	const workspace = await loadWorkspaceContext(projectPath, { autoCreateIfMissing: true });
	const client = createDevRuntimeClient(workspace.workspaceId);
	const baseRef = options.baseRef ?? "main";

	const summary = await runDevTestSweep(presets, async (preset) => {
		const { scenario, result, durationMs } = await executeDevTestPreset({
			client,
			workspaceId: workspace.workspaceId,
			preset: parseDevTestPreset(preset),
			baseRef,
			...(typeof options.pollIntervalMs === "number" ? { pollIntervalMs: options.pollIntervalMs } : {}),
			...(typeof options.maxWaitMs === "number" ? { maxWaitMs: options.maxWaitMs } : {}),
		});
		return {
			preset,
			scenarioTitle: scenario.title,
			started: result.started,
			startMessage: result.startMessage ?? null,
			outcome: result.classification.outcome,
			success: result.classification.success,
			incompleteCardCount: result.classification.incompleteCardCount,
			summary: result.classification.summary,
			evidenceBundlePath: null,
			durationMs,
		} satisfies DevTestSweepEntry;
	});

	if (options.json) {
		write(`${JSON.stringify(summary, null, 2)}\n`);
		return;
	}
	write(formatDevTestSweepReport(summary));
}

interface DevModelSpeedOptions {
	json?: boolean;
	modelId?: string;
	endpoint?: string;
}

interface DevCapacityOptions {
	json?: boolean;
	cwd?: string;
}

/**
 * §5.AN: measure a loaded model's REAL speed via LM Studio's native `/api/v0/chat/completions` `stats` (tokens_per_second
 * + time_to_first_token), which the OpenAI `/v1` endpoint does not populate. A diagnostic for the §5.AB/MCSR speed signal
 * — no model loading here (probes whatever's resident); the loaded model is auto-discovered when `--model-id` is omitted.
 */
async function runDevModelSpeedCommand(options: DevModelSpeedOptions = {}): Promise<void> {
	const base = (options.endpoint ?? "http://localhost:1234").replace(/\/$/, "").replace(/\/v1$/, "");
	let modelId = options.modelId?.trim();
	if (!modelId) {
		const modelsResponse = await fetch(`${base}/api/v0/models`).catch(() => null);
		const modelsJson = (await modelsResponse?.json().catch(() => null)) as {
			data?: Array<{ id?: string; type?: string; state?: string }>;
		} | null;
		modelId = modelsJson?.data?.find((m) => m.state === "loaded" && m.type === "llm")?.id;
		if (!modelId) {
			throw new Error(`No loaded LLM found at ${base}/api/v0/models — load a model or pass --model-id.`);
		}
	}
	const response = await fetch(`${base}/api/v0/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: modelId,
			max_tokens: 64,
			temperature: 0,
			messages: [{ role: "user", content: "Reply with the single word: ready. /no_think" }],
		}),
	});
	if (!response.ok) {
		throw new Error(`Model speed probe failed (${response.status}) at ${base}/api/v0/chat/completions.`);
	}
	const json = await response.json();
	const stats = parseLmStudioRequestStats(json);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ modelId, ...stats }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Model speed (real /api/v0 stats):\n  ${renderLmStudioRequestStats(modelId, stats)}\n`);
}

async function runDevCapacityCommand(options: DevCapacityOptions = {}): Promise<void> {
	const cwd = options.cwd ?? process.cwd();
	const rawPerMachineCap = Number(process.env.NKLEIN_PER_MACHINE_MAX_CONCURRENCY);
	const legacyHostFallback = Number.isInteger(rawPerMachineCap) && rawPerMachineCap > 0 ? rawPerMachineCap : null;
	const [config, models, perf] = await Promise.all([
		loadRuntimeConfig(cwd),
		fetchLmsPsModels(createDefaultLmsRunner()),
		readModelPerformanceStats({}).catch(() => null),
	]);
	const report = buildLmStudioCapacityReport({
		models,
		global: config.concurrencyDefaults,
		override: config.concurrencyOverride,
		hostFallback: legacyHostFallback,
	});
	// §5.AQ B2: advise on wasted context (slow prefill over an over-provisioned window) from loaded models + telemetry.
	const contextAdvice = adviseContextSizes(
		buildContextSizeObservations({
			loadedModels: models,
			modelPerfAggregates: perf?.aggregates ?? [],
		}),
	);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ cwd, legacyHostFallback, ...report, contextAdvice }, null, 2)}\n`);
		return;
	}
	process.stdout.write("LM Studio serving capacity (read-only lms ps + runtime config):\n\n");
	process.stdout.write(formatLmStudioCapacityReport(report));
	process.stdout.write(`\n${formatContextSizeAdvice(contextAdvice)}`);
}

export function registerDevCommand(program: Command): void {
	const dev = program.command("dev").description("Developer-only !Klein diagnostics and smoke tests.");

	const addAdvisorContextOptions = (command: ReturnType<Command["command"]>) => {
		return command
			.option("--json", "Print machine-readable JSON.")
			.option("--workspace-path <path>", "Workspace path context.")
			.option("--repo-summary <text>", "Repo summary context.")
			.option("--model-registry-summary <text>", "Model registry context.")
			.option("--runtime-config-summary <text>", "Runtime config context.")
			.option("--telemetry-summary <text>", "Telemetry/log summary context.")
			.option("--task-summary <text>", "Task-specific context.")
			.option("--user-question <text>", "User question or pain point.");
	};

	dev.command("smoke-eval")
		.description("Run the bundled dev smoke eval and write an evidence bundle.")
		.option("--json", "Print machine-readable JSON.")
		.option("--parent-dir <path>", "Parent directory for the throwaway workspace.")
		.option("--evidence-root <path>", "Directory for evidence bundles.")
		.option("--telemetry-root <path>", "Telemetry JSONL root to include guard/overflow/timeout signals.")
		.option("--no-git", "Skip git initialization in the throwaway workspace.")
		.option("--provider-id <id>", "Provider id to score in the model capability registry.")
		.option("--model-id <id>", "Model id to score in the model capability registry.")
		.option("--endpoint <url>", "Optional model endpoint to score in the model capability registry.")
		.action(async (options: DevSmokeEvalOptions) => {
			await runDevSmokeEvalCommand(options);
		});

	dev.command("gate-audit")
		.description("Measure the delivery-quality gate's catch vs false-reject rate over labeled fixtures.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevGateAuditCommand(options);
		});

	dev.command("dogfood-backlog")
		.description("Generate dogfood improvement plan artifacts from local self-observation telemetry.")
		.option("--json", "Print machine-readable JSON.")
		.option("--project-path <path>", "!Klein repo path where .nklein/nklein/plans should be written.")
		.option("--telemetry-root <path>", "Telemetry JSONL root. Defaults to ~/.nklein/nklein/telemetry.")
		.option("--slug <slug>", "Plan slug under .nklein/nklein/plans/<slug>.")
		.option("--suggestion <text>", "Seed the dogfood backlog with a user-described improvement.")
		.action(async (options: DevDogfoodBacklogOptions) => {
			await runDevDogfoodBacklogCommand(options);
		});

	dev.command("advisor-prompt")
		.description("Build a user-triggered advisor prompt for model, MCP, config, log, or task help.")
		.requiredOption(
			"--kind <kind>",
			"Advisor kind: model_freshness | mcp_discovery | config_explainer | log_analysis | task_failure.",
			parseAdvisorKind,
		)
		.option("--json", "Print machine-readable JSON.")
		.option("--workspace-path <path>", "Workspace path context.")
		.option("--repo-summary <text>", "Repo summary context.")
		.option("--model-registry-summary <text>", "Model registry context.")
		.option("--runtime-config-summary <text>", "Runtime config context.")
		.option("--telemetry-summary <text>", "Telemetry/log summary context.")
		.option("--task-summary <text>", "Task-specific context.")
		.option("--user-question <text>", "User question or pain point.")
		.action(async (options: DevAdvisorPromptOptions) => {
			await runDevAdvisorPromptCommand(options);
		});

	addAdvisorContextOptions(
		dev.command("find-mcp-plugins").description("Build a user-triggered MCP discovery prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("mcp_discovery", options);
	});

	addAdvisorContextOptions(
		dev.command("explain-config").description("Build a user-triggered runtime config advisor prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("config_explainer", options);
	});

	addAdvisorContextOptions(
		dev.command("analyze-logs").description("Build a user-triggered !Klein logs advisor prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("log_analysis", options);
	});

	addAdvisorContextOptions(
		dev.command("explain-task-failure").description("Build a user-triggered task failure advisor prompt."),
	).action(async (options: DevAdvisorShortcutOptions) => {
		await runDevAdvisorShortcutCommand("task_failure", options);
	});

	dev.command("check-models")
		.description("Build a user-triggered model freshness advisor prompt from the local model registry.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevCheckModelsCommand(options);
		});

	dev.command("ledger")
		.description("Show the Agent Attempt Ledger (§5.AF): per-model outcomes + success rates from real task runs.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevLedgerCommand(options);
		});

	dev.command("model-verdict")
		.description("Show evidence-based runtime suitability verdicts per model from persisted telemetry (§5.AL).")
		.argument("[modelId]", "Limit to one model id (default: every model with runtime evidence).")
		.option("--json", "Print machine-readable JSON.")
		.action(async (modelId: string | undefined, options: { json?: boolean }) => {
			await runDevModelVerdictCommand({ modelId, json: options.json });
		});

	dev.command("rosters")
		.description("Show the named swarm rosters (§5.AB per-machine pools) + whether each FITS the machine budgets.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevRostersCommand(options);
		});

	dev.command("model-speed")
		.description("Measure a loaded model's REAL tok/s + ttft via LM Studio's native /api/v0 stats (§5.AN).")
		.option("--json", "Print machine-readable JSON.")
		.option("--model-id <id>", "Model id to probe (defaults to the loaded LLM).")
		.option("--endpoint <url>", "LM Studio base URL (default http://localhost:1234).")
		.action(async (options: DevModelSpeedOptions) => {
			await runDevModelSpeedCommand(options);
		});

	dev.command("capacity")
		.description("Report loaded LM Studio host/model capacity from lms ps plus configured concurrency caps (§5.AB).")
		.option("--json", "Print machine-readable JSON.")
		.option(
			"--cwd <path>",
			"Workspace path whose runtime/project config should be read (default: current directory).",
		)
		.action(async (options: DevCapacityOptions) => {
			await runDevCapacityCommand(options);
		});

	dev.command("advice")
		.description(
			"Show per-role model capability advice (§5.AB): which model to trust per role, with dominant failure modes, from the ledger.",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevAdviceCommand(options);
		});

	dev.command("capability-ceiling")
		.description("Show roles the LOADED fleet cannot clear (F3.35) — load a stronger model where flagged.")
		.option("--json", "Print machine-readable JSON.")
		.option("--endpoint <url>", "Local provider endpoint to read loaded models from.")
		.action(async (options: { json?: boolean; endpoint?: string }) => {
			await runDevCapabilityCeilingCommand(options);
		});

	dev.command("eval-freshness")
		.description("Rank fitness cells by re-evaluation priority (F3.26) — which cells to re-run first.")
		.option("--json", "Print machine-readable JSON.")
		.option("--limit <n>", "How many top cells to show (default 15).", (v) => Number.parseInt(v, 10))
		.action(async (options: { json?: boolean; limit?: number }) => {
			await runDevEvalFreshnessCommand(options);
		});

	dev.command("stubborn-failure")
		.description("Assess a task's stubborn-failure state (F3.29) from its ledger attempts — exhausted? best partial?")
		.requiredOption("--task <id>", "The task id to assess.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { task: string; json?: boolean }) => {
			await runDevStubbornFailureCommand({ taskId: options.task, json: options.json });
		});

	dev.command("routing-preview")
		.description("Preview the confidence+resource-aware routing order for a role over the loaded fleet (F3.33).")
		.option("--role <role>", "Role to rank for (architect|worker|reviewer|…).", "worker")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { role: string; json?: boolean }) => {
			await runDevRoutingPreviewCommand(options);
		});

	dev.command("controller-trace")
		.description(
			"Project a card's lifecycle onto the outer-controller phases (F3.12) — plan→act→verify→repair→finish.",
		)
		.requiredOption("--task <id>", "The task id to trace.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { task: string; json?: boolean }) => {
			await runDevControllerTraceCommand({ taskId: options.task, json: options.json });
		});

	dev.command("memory-lifecycle")
		.description("Classify the ~/basic-memory corpus into promote/retire/merge (opencode-swarm port, read-only).")
		.option("--json", "Print machine-readable JSON.")
		.option("--root <path>", "basic-memory root (defaults to ~/basic-memory).")
		.action(async (options: { json?: boolean; root?: string }) => {
			await runDevMemoryLifecycleCommand(options);
		});

	dev.command("memory-audit")
		.description(
			"Run the F5.2 freshness audit over ~/basic-memory (stale/orphaned/broken-link/duplicate, read-only).",
		)
		.option("--json", "Print machine-readable JSON.")
		.option("--root <path>", "basic-memory root (defaults to ~/basic-memory).")
		.option("--stale-days <n>", "Flag notes older than this many days as stale (default 180).", (v) => Number(v))
		.action(async (options: { json?: boolean; root?: string; staleDays?: number }) => {
			await runDevMemoryAuditCommand(options);
		});

	dev.command("retrieval-usefulness")
		.description(
			"Project the ledger's retrieval events into a usefulness summary (§5.AC — is retrieval earning its keep?).",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevRetrievalUsefulnessCommand(options);
		});

	dev.command("opportunistic-value")
		.description("Project the ledger into per-kind opportunistic-work realized-value rates (F1.36).")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevOpportunisticValueCommand(options);
		});

	dev.command("routing-calibration")
		.description("Join recorded routing decisions with ledger outcomes into a calibration summary (§5.AB).")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevRoutingCalibrationCommand(options);
		});

	dev.command("model-role-stability")
		.description("Over recorded eval runs, is each (model, role) settled or flaky (per-run quality spread)?")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevModelRoleStabilityCommand(options);
		});

	dev.command("reasoning-benefit")
		.description("Over recorded reasoning A/B observations, does forcing reasoning help each cell (F3.16)?")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevReasoningBenefitCommand(options);
		});

	dev.command("knowledge-outcomes")
		.description("Project the ledger into knowledge-tool + knowledge-debt success lift per model (F1.1).")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevKnowledgeOutcomesCommand(options);
		});

	dev.command("remediation")
		.description(
			"Replay a card's ledger trajectory through the process-remediation detector (PRM, opencode-swarm port).",
		)
		.requiredOption("--task <id>", "The task id to analyze.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { task: string; json?: boolean }) => {
			await runDevRemediationCommand({ taskId: options.task, json: options.json });
		});

	dev.command("placeholder-scan")
		.description(
			"Scan a git diff's added lines for TODO/FIXME/stub/not-implemented placeholders (opencode-swarm port).",
		)
		.option("--base <ref>", "Diff against this ref (defaults to HEAD — working-tree changes).")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { base?: string; json?: boolean }) => {
			await runDevPlaceholderScanCommand(options);
		});

	dev.command("quality-budget")
		.description(
			"Assess a git diff against the per-file/test-ratio/duplication quality budget (opencode-swarm port).",
		)
		.option("--base <ref>", "Diff against this ref (defaults to HEAD — working-tree changes).")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { base?: string; json?: boolean }) => {
			await runDevQualityBudgetCommand(options);
		});

	dev.command("swarm")
		.description(
			"Show the loaded models grouped by MACHINE (LM Link), each with the auto-selector's affinity tags + cold-start prior + queue depth (§5.AB).",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevSwarmCommand(options);
		});

	dev.command("fleet-advice")
		.description(
			"Suggest what to ADD to the loaded model fleet (base-family diversity + reasoning depth) to strengthen review + escalation (§5.AB/§5.AL).",
		)
		.option("--json", "Print machine-readable JSON.")
		.option("--endpoint <url>", "LM Studio base URL (default http://localhost:1234/v1).")
		.action(async (options: { json?: boolean; endpoint?: string }) => {
			await runDevFleetAdviceCommand(options);
		});

	dev.command("tool-menu")
		.description(
			"Show the §5.O two-phase phase-1 tool menu (short cards, not verbose schemas) a small model is offered, with its token footprint.",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevToolMenuCommand(options);
		});

	dev.command("tool-pick")
		.description(
			"Run the §5.O two-phase phase-1 pick for a task against a LOADED model (auto-discovers a resident LLM; read-only, no loading).",
		)
		.requiredOption("--task <text>", "The step/task description to pick a tool for.")
		.option("--model <id>", "Model id to query (default: the first loaded LLM).")
		.option(
			"--budget <n>",
			"starting max_tokens budget (default 1024 — reasoning models need room before the pick lands).",
		)
		.option(
			"--max-retries <n>",
			"on a finish:length truncation, escalate the budget (§5.AA) and retry up to N times (default 3).",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(
			async (options: { task: string; model?: string; budget?: string; maxRetries?: string; json?: boolean }) => {
				await runDevToolPickCommand(options);
			},
		);

	dev.command("escalation")
		.description(
			"Show a task's escalation report (§5.AG): the attempt chain + progress verdict, and (when hard-stuck) the Layer-2 user suggestions.",
		)
		.requiredOption("--task-id <id>", "Task id to report on.")
		.option("--json", "Print machine-readable JSON.")
		.option("--analyze", "Print the bigger-model analysis prompt for this stuck task (§5.AB) instead of the report.")
		.action(async (options: { taskId: string; json?: boolean; analyze?: boolean }) => {
			await runDevEscalationCommand(options);
		});

	dev.command("rail-evidence")
		.description("Aggregate the harvested dev-test rail evidence (rail-*.json) into a per-project scorecard (§5.AI).")
		.option("--json", "Print machine-readable JSON.")
		.option("--advisor", "Print the analysis prompt that asks a model to propose todo bullets from the evidence.")
		.option("--findings", "Classify the evidence into typed findings + propose-only backlog packages (F1.33b).")
		.option("--retain", "With --findings: also retain each finding to the ledger (latest-wins). Implies --findings.")
		.action(async (options: { json?: boolean; advisor?: boolean; findings?: boolean; retain?: boolean }) => {
			await runDevRailEvidenceCommand(options);
		});

	dev.command("replay-eval <taskId>")
		.description(
			"F1.26b: replay-eval determinism check for a task. With --baseline/--replay, compares two captured ledgers. " +
				"Without them, AUTO-CAPTURES: runs the deterministic simulated dev-test suite on the current tree and on " +
				"the task's result-branch worktree, then compares. --retain writes the verdict the M4 gate reads back.",
		)
		.option("--baseline <file>", "Path to a captured baseline (pre-patch) ledger JSONL. Omit both to auto-capture.")
		.option("--replay <file>", "Path to a replayed (patched-tree) ledger JSONL. Omit both to auto-capture.")
		.option("--retain", "Retain the pass/fail verdict to the ledger (M4 gate reads it back).")
		.option("--json", "Print machine-readable JSON.")
		.action(
			async (taskId: string, options: { baseline?: string; replay?: string; retain?: boolean; json?: boolean }) => {
				if (options.baseline && options.replay) {
					await runDevReplayEvalCommand({
						taskId,
						baseline: options.baseline,
						replay: options.replay,
						...(options.retain ? { retain: true } : {}),
						...(options.json ? { json: true } : {}),
					});
					return;
				}
				if (options.baseline || options.replay) {
					throw new Error("Provide BOTH --baseline and --replay to compare, or NEITHER to auto-capture.");
				}
				await runDevReplayEvalAutoCaptureCommand({
					taskId,
					...(options.retain ? { retain: true } : {}),
					...(options.json ? { json: true } : {}),
				});
			},
		);

	dev.command("test-project")
		.description(
			"Start a dev-test scenario seed card against the running runtime and monitor it to a classified outcome.",
		)
		.option(
			"--preset <preset>",
			"Scenario preset: mid_task | complex_dag | audio_vst | daw_foundation | wide_fanout | deep_chain | mixed_dag | many_small.",
		)
		.option("--project-path <path>", "Workspace path to run the dev-test scenario in. Defaults to the cwd.")
		.option("--base-ref <ref>", "Base git ref for the seed card. Defaults to main.")
		.option("--model-id <id>", "Force the seed card onto a specific (loaded) model, bypassing config roles.")
		.option("--provider-id <id>", "Provider for --model-id (default lmstudio).")
		.option("--no-plan", "Start the seed in ACT mode (agent works directly) instead of plan/decompose.")
		.option("--poll-interval-ms <ms>", "Board poll interval in milliseconds.", (value) => Number.parseInt(value, 10))
		.option("--max-wait-ms <ms>", "Maximum monitor duration in milliseconds.", (value) => Number.parseInt(value, 10))
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: DevTestProjectOptions) => {
			await runDevTestProjectCommand(options);
		});

	dev.command("sweep")
		.description("Run several dev-test scenario presets in sequence and report each run's classified outcome.")
		.option(
			"--presets <list>",
			"Comma-separated presets to sweep. Defaults to the parallel-fan-out set (wide_fanout,deep_chain,mixed_dag,many_small).",
		)
		.option("--project-path <path>", "Workspace path to run the dev-test scenarios in. Defaults to the cwd.")
		.option("--base-ref <ref>", "Base git ref for each seed card. Defaults to main.")
		.option("--poll-interval-ms <ms>", "Board poll interval in milliseconds.", (value) => Number.parseInt(value, 10))
		.option("--max-wait-ms <ms>", "Maximum monitor duration per preset in milliseconds.", (value) =>
			Number.parseInt(value, 10),
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: DevTestSweepOptions) => {
			await runDevTestSweepCommand(options);
		});

	dev.command("cleanup-report")
		.description("Report reclaimable dev-test workspaces and sandbox volumes, retaining the active run.")
		.option(
			"--scan-dir <path>",
			"Parent directory to scan for scaffolded dev-test workspaces. Defaults to the OS temp dir.",
		)
		.option("--active-workspace-path <path>", "Path of the active run's workspace to retain.")
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: DevCleanupReportOptions) => {
			await runDevCleanupReportCommand(options);
		});
}
