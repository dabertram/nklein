import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { Command } from "commander";
import { loadGlobalRuntimeConfig } from "../config/runtime-config";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { buildTaskEscalationReport } from "../core/agent-attempt-ledger";
import {
	buildModelCapabilityAdvice,
	buildStucknessSignalsFromLedger,
	summarizeLedgerForDisplay,
} from "../core/agent-ledger-projections";
import { classifyAgentStuckness, isHardStuck } from "../core/agent-stuckness";
import { runtimeAgentIdSchema } from "../core/api-contract";
import { summarizeDevTestCleanup } from "../core/dev-test-cleanup";
import { type DevTestSweepEntry, formatDevTestSweepReport, runDevTestSweep } from "../core/dev-test-sweep";
import { buildEscalationSuggestions } from "../core/escalation-suggestions";
import { aggregateRailEvidence, buildRailEvidenceAnalysisPrompt } from "../core/rail-evidence";
import { buildKanbanRuntimeUrl, getRuntimeFetch } from "../core/runtime-endpoint";
import { buildStuckTaskAnalysisRequest } from "../core/stuck-task-analysis";
import { buildWorkspaceScopeHeaders } from "../core/workspace-scope";
import { buildNKleinAdvisorRequest, type NKleinAdvisorKind } from "../nklein-agent/nklein-advisor";
import { runDevTestProject } from "../nklein-agent/nklein-dev-test-harness";
import {
	NKLEIN_DEV_TEST_PROJECT_MARKER_PATH,
	type NKleinDevTestProjectPreset,
	resolveNKleinDevTestProjectScenario,
} from "../nklein-agent/nklein-dev-test-project";
import {
	createDevTestStateReader,
	type DevTestCleanupCandidate,
	discoverDevTestCleanupEntries,
} from "../nklein-agent/nklein-dev-test-runner";
import { writeNKleinDogfoodBacklog } from "../nklein-agent/nklein-dogfood-engine";
import { runNKleinDevSmokeEval } from "../nklein-agent/nklein-eval-harness";
import { assertLocalProviderAllowed } from "../nklein-agent/nklein-local-only-policy";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-agent/nklein-model-research";
import { resolveProjectInputPath } from "../projects/project-path";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { readRailEvidenceReports } from "../state/rail-evidence-store";
import { loadWorkspaceBoardById, loadWorkspaceContext } from "../state/workspace-state";
import type { RuntimeAppRouter } from "../trpc/app-router";

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
	json?: boolean;
	cwd?: string;
	write?: (text: string) => void;
}

function parseDevTestPreset(value: string | undefined): NKleinDevTestProjectPreset {
	if (value === undefined) {
		return "mid_task";
	}
	if (
		value === "mid_task" ||
		value === "complex_dag" ||
		value === "audio_vst" ||
		value === "daw_foundation" ||
		value === "wide_fanout" ||
		value === "deep_chain" ||
		value === "mixed_dag" ||
		value === "many_small"
	) {
		return value;
	}
	throw new Error(
		"Invalid preset. Expected one of: mid_task, complex_dag, audio_vst, daw_foundation, wide_fanout, deep_chain, mixed_dag, many_small.",
	);
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
async function executeDevTestPreset(input: {
	client: ReturnType<typeof createDevRuntimeClient>;
	workspaceId: string;
	preset: NKleinDevTestProjectPreset;
	baseRef: string;
	pollIntervalMs?: number;
	maxWaitMs?: number;
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
	});
	const startedAt = Date.now();
	const result = await runDevTestProject(
		{
			scenario,
			seedTaskId,
			baseRef: input.baseRef,
			...(typeof input.pollIntervalMs === "number" ? { pollIntervalMs: input.pollIntervalMs } : {}),
			...(typeof input.maxWaitMs === "number" ? { maxWaitMs: input.maxWaitMs } : {}),
		},
		{
			startSeedTask: async (payload) => {
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
	const projectPath = resolveProjectInputPath(options.projectPath ?? cwd, cwd);
	const workspace = await loadWorkspaceContext(projectPath, { autoCreateIfMissing: true });
	const client = createDevRuntimeClient(workspace.workspaceId);
	const { scenario, result } = await executeDevTestPreset({
		client,
		workspaceId: workspace.workspaceId,
		preset,
		baseRef: options.baseRef ?? "main",
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

const DEFAULT_DEV_TEST_SWEEP_PRESETS: readonly NKleinDevTestProjectPreset[] = [
	"wide_fanout",
	"deep_chain",
	"mixed_dag",
	"many_small",
];

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

function parseDevTestSweepPresets(value: string | undefined): NKleinDevTestProjectPreset[] {
	if (value === undefined || value.trim().length === 0) {
		return [...DEFAULT_DEV_TEST_SWEEP_PRESETS];
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => parseDevTestPreset(entry));
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

interface DevCleanupReportOptions {
	scanDir?: string;
	activeWorkspacePath?: string;
	json?: boolean;
	cwd?: string;
	write?: (text: string) => void;
}

/** Directory size in bytes via `du -sk`; best-effort, returns 0 when `du` is unavailable. */
async function directorySizeBytes(path: string): Promise<number> {
	try {
		const { stdout } = await execFileAsync("du", ["-sk", path]);
		const kib = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "0", 10);
		return Number.isFinite(kib) ? kib * 1024 : 0;
	} catch {
		return 0;
	}
}

/** Scan a parent directory for scaffolded dev-test project workspaces (identified by their marker file). */
async function discoverDevTestWorkspacesInDir(scanDir: string): Promise<DevTestCleanupCandidate[]> {
	let entries: string[];
	try {
		entries = await readdir(scanDir);
	} catch {
		return [];
	}
	const candidates: DevTestCleanupCandidate[] = [];
	for (const entry of entries) {
		const workspacePath = join(scanDir, entry);
		try {
			const markerStat = await stat(join(workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH));
			if (!markerStat.isFile()) {
				continue;
			}
		} catch {
			continue;
		}
		candidates.push({
			path: workspacePath,
			kind: "dev_test_workspace",
			sizeBytes: await directorySizeBytes(workspacePath),
		});
	}
	return candidates;
}

/** Docker sandbox named volumes created for agent isolation (`nklein`-prefixed); size is best-effort. */
async function discoverSandboxVolumes(): Promise<DevTestCleanupCandidate[]> {
	try {
		const { stdout } = await execFileAsync("docker", ["volume", "ls", "--format", "{{.Name}}"]);
		return stdout
			.split("\n")
			.map((name) => name.trim())
			.filter((name) => name.startsWith("nklein"))
			.map((name) => ({ path: name, kind: "sandbox_volume" as const, sizeBytes: 0 }));
	} catch {
		return [];
	}
}

export async function runDevCleanupReportCommand(options: DevCleanupReportOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const scanDir = options.scanDir ?? tmpdir();
	const activeWorkspacePath = options.activeWorkspacePath
		? resolveProjectInputPath(options.activeWorkspacePath, options.cwd ?? process.cwd())
		: null;

	const entries = await discoverDevTestCleanupEntries({
		listDevTestWorkspaces: () => discoverDevTestWorkspacesInDir(scanDir),
		listSandboxVolumes: discoverSandboxVolumes,
		activeWorkspacePath,
	});
	const report = summarizeDevTestCleanup(entries);

	if (options.json) {
		write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	write(`Scanned dev-test workspaces under: ${scanDir}\n`);
	write(`${report.summary}\n`);
	for (const entry of report.reclaimable) {
		write(`  reclaimable [${entry.kind}] ${entry.path}\n`);
	}
}

async function runDevLedgerCommand(options: { json?: boolean }): Promise<void> {
	const summary = summarizeLedgerForDisplay(await readAllAgentLedger());
	if (options.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Agent Attempt Ledger — ${summary.totalAttempts} attempt(s) across ${summary.totalEvents} event(s)\n\n`,
	);
	if (summary.outcomes.length === 0) {
		process.stdout.write("(no model attempts recorded yet — run some tasks, then re-check)\n");
		return;
	}
	process.stdout.write("Per-model outcomes:\n");
	for (const outcome of summary.outcomes) {
		const breakdown = Object.entries(outcome.byOutcome)
			.filter(([, count]) => count > 0)
			.map(([kind, count]) => `${kind}×${count}`)
			.join(" ");
		process.stdout.write(
			`  ${outcome.modelId.padEnd(40)} ${String(outcome.samples).padStart(3)} run(s)  ` +
				`${String(Math.round(outcome.successRate * 100)).padStart(3)}% success  [${breakdown}]\n`,
		);
	}
	process.stdout.write("\nPer-model × role (the §5.Z matrix, as a ledger query):\n");
	for (const row of summary.byRole) {
		process.stdout.write(
			`  ${row.modelId.padEnd(40)} ${row.role.padEnd(10)} ${String(row.samples).padStart(3)} run(s)  ` +
				`${String(Math.round(row.successRate * 100)).padStart(3)}% success\n`,
		);
	}
	if (summary.byFlow.length > 0) {
		process.stdout.write("\nPer-model × flow (the §5.Z matrix by board/chat/autonomous):\n");
		for (const row of summary.byFlow) {
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${row.flow.padEnd(10)} ${String(row.samples).padStart(3)} run(s)  ` +
					`${String(Math.round(row.successRate * 100)).padStart(3)}% success\n`,
			);
		}
	}
	if (summary.toolUsage.length > 0) {
		process.stdout.write("\nPer-model × tool (usage + outcome — the §5.AA small-model signal):\n");
		for (const row of summary.toolUsage) {
			const completed = row.successes + row.errors;
			const rate = completed > 0 ? `${String(Math.round(row.successRate * 100)).padStart(3)}% ok` : " n/a   ";
			const incomplete = row.incomplete > 0 ? ` (${row.incomplete} incomplete)` : "";
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${row.toolName.padEnd(20)} ${String(row.calls).padStart(3)} call(s)  ${rate}${incomplete}\n`,
			);
		}
	}

	if (summary.speed.length > 0) {
		process.stdout.write("\nPer-model speed (from ledger ttft + tok/s — a §5.AB selection signal):\n");
		for (const row of summary.speed) {
			const ttft = row.avgTtftMs !== null ? `${Math.round(row.avgTtftMs)}ms ttft` : "no ttft";
			const tps = row.avgTokensPerSec !== null ? `${row.avgTokensPerSec.toFixed(1)} tok/s` : "no tok/s";
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${String(row.samples).padStart(3)} sample(s)  ${ttft.padStart(12)}  ${tps.padStart(12)}\n`,
			);
		}
	}

	if (summary.contextUsage.length > 0) {
		process.stdout.write("\nPer-model context usage (prompt tokens — a §5.AD budget / §5.AB routing signal):\n");
		for (const row of summary.contextUsage) {
			const avg = row.avgContextTokens !== null ? `${Math.round(row.avgContextTokens)} avg` : "n/a";
			const max = row.maxContextTokens !== null ? `${row.maxContextTokens} max` : "n/a";
			const over = row.overBudget > 0 ? `  ${row.overBudget} over-budget` : "";
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${String(row.samples).padStart(3)} sample(s)  ${avg.padStart(12)}  ${max.padStart(12)}${over}\n`,
			);
		}
	}
}

async function runDevAdviceCommand(options: { json?: boolean }): Promise<void> {
	const advice = buildModelCapabilityAdvice(await readAllAgentLedger());
	if (options.json) {
		process.stdout.write(`${JSON.stringify(advice, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		"Model capability advice (§5.AB) — which model to trust per role, from real ledger outcomes\n\n",
	);
	if (advice.perRole.length === 0) {
		process.stdout.write("(no model attempts recorded yet — run some tasks, then re-check)\n");
		return;
	}
	for (const row of advice.perRole) {
		const failure = row.topFailureMode ? ` (mostly ${row.topFailureMode})` : "";
		process.stdout.write(
			`  ${row.modelId.padEnd(40)} ${row.role.padEnd(10)} ${String(row.samples).padStart(3)} run(s)  ` +
				`${String(Math.round(row.successRate * 100)).padStart(3)}%  ${row.verdict}${failure}\n`,
		);
	}
	if (advice.notes.length > 0) {
		process.stdout.write("\nPer-role guidance:\n");
		for (const note of advice.notes) {
			process.stdout.write(`  • ${note}\n`);
		}
	}
}

async function runDevEscalationCommand(options: { taskId: string; json?: boolean; analyze?: boolean }): Promise<void> {
	const events = await readAllAgentLedger();
	const report = buildTaskEscalationReport(events, options.taskId);
	// §5.AB: the user-chosen "make a bigger model available to analyze + guide" option — print the analysis prompt.
	if (options.analyze) {
		const request = buildStuckTaskAnalysisRequest(report);
		process.stdout.write(`# ${request.title}\n\n${request.prompt}\n`);
		return;
	}
	// §5.AB: the progress verdict over the same ledger. `hard_stuck` means the AUTOMATIC ladder (all approaches × all
	// loaded models) is exhausted → escalate to the user with the "get through the wall" suggestions.
	const signals = buildStucknessSignalsFromLedger(events, options.taskId);
	const stuckness = classifyAgentStuckness(signals);
	const suggestions = isHardStuck(signals) ? buildEscalationSuggestions() : [];
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ report, stuckness, suggestions }, null, 2)}\n`);
		return;
	}
	if (report.totalAttempts === 0) {
		process.stdout.write(`No attempts recorded for task "${options.taskId}" yet.\n`);
		return;
	}
	process.stdout.write(
		`Escalation report — task ${report.taskId}\n` +
			`  ${report.totalAttempts} attempt(s) · models tried: ${report.modelsTried.join(", ")} · final: ${report.finalOutcome}\n\n`,
	);
	for (const row of report.attempts) {
		const quality = row.qualityScore !== null ? ` q=${row.qualityScore.toFixed(2)}` : "";
		const salvage = row.salvage ? ` salvage=${row.salvage}` : "";
		process.stdout.write(
			`  rung ${String(row.rung).padStart(2)}  ${row.modelId.padEnd(36)} ${row.approach.padEnd(28)} → ${row.outcome}${quality}${salvage}\n`,
		);
	}
	process.stdout.write(`\n  Progress verdict: ${stuckness}\n`);
	if (suggestions.length > 0) {
		process.stdout.write(
			"  Automatic recovery exhausted — escalate to the user. Suggestions to get through the wall:\n",
		);
		for (const suggestion of suggestions) {
			process.stdout.write(`    • ${suggestion.title} — ${suggestion.detail}\n`);
		}
	}
}

async function runDevRailEvidenceCommand(options: { json?: boolean; advisor?: boolean }): Promise<void> {
	const aggregate = aggregateRailEvidence(await readRailEvidenceReports());
	if (options.advisor) {
		const request = buildRailEvidenceAnalysisPrompt(aggregate);
		process.stdout.write(`# ${request.title}\n\n${request.prompt}\n`);
		return;
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Dev-test rail evidence — ${aggregate.totalRuns} run(s) across ${aggregate.totalReports} report(s)` +
			(aggregate.models.length > 0 ? ` · models: ${aggregate.models.join(", ")}` : "") +
			"\n\n",
	);
	if (aggregate.byProject.length === 0) {
		process.stdout.write("(no rail evidence harvested yet — run scripts/dev-test-rail.mts, then re-check)\n");
		return;
	}
	process.stdout.write("Per-project (worst delivery first):\n");
	for (const project of aggregate.byProject) {
		const flags = [
			project.failedToStart > 0 ? `start-fail×${project.failedToStart}` : "",
			project.failed > 0 ? `fail×${project.failed}` : "",
			project.nonTerminal > 0 ? `nonterm×${project.nonTerminal}` : "",
			project.anomalyRuns > 0 ? `anomaly×${project.anomalyRuns}` : "",
		]
			.filter((flag) => flag.length > 0)
			.join(" ");
		process.stdout.write(
			`  ${project.project.padEnd(16)} ${project.delivered}/${project.runs} delivered  ` +
				`${String(Math.round(project.deliveryRate * 100)).padStart(3)}%  ${flags}\n`,
		);
	}
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

	dev.command("advice")
		.description(
			"Show per-role model capability advice (§5.AB): which model to trust per role, with dominant failure modes, from the ledger.",
		)
		.option("--json", "Print machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runDevAdviceCommand(options);
		});

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
		.action(async (options: { json?: boolean; advisor?: boolean }) => {
			await runDevRailEvidenceCommand(options);
		});

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
