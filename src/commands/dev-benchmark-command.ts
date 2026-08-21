import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	AIDER_POLYGLOT_LANGUAGES,
	buildAiderPolyglotExecutionPrompt,
	buildAiderPolyglotPublicAcceptanceCommand,
	buildAiderPolyglotTask,
	PINNED_AIDER_POLYGLOT_COMMIT,
	parseAiderPolyglotConfig,
	parseAiderPolyglotManifest,
} from "../core/aider-polyglot-benchmark";
import {
	buildAiderPolyglotGradeDockerPlan,
	classifyAiderPolyglotTestResult,
	resolveAiderPolyglotCompanionExamplePath,
	resolveAiderPolyglotGraderImage,
} from "../core/aider-polyglot-grade-plan";
import type { RuntimeTaskTestEvidencePolicy } from "../core/api-contract";
import { buildFreshBenchmarkTrack, type FreshBenchmarkLeakageHit } from "../core/fresh-benchmark-track";
import {
	buildLiveCodeBenchControlReport,
	PINNED_LIVECODEBENCH_COMMIT,
	planLiveCodeBenchControl,
} from "../core/livecodebench-control";
import { buildLocalBenchmarkExecutionPrompt, LOCAL_BENCHMARK_PUBLIC_ACCEPTANCE } from "../core/local-benchmark-mint";
import { getKanbanRuntimeOrigin, setKanbanRuntimeHost, setKanbanRuntimePort } from "../core/runtime-endpoint";
import {
	assertCandidateCalibration,
	type BenchmarkAttempt,
	type BenchmarkAttemptStatus,
	buildLeakageSafeBenchmarkTask,
	buildSwebenchPrediction,
	calibrateGoldAttempts,
	evaluateResolvedSetRegression,
	type LeakageSafeBenchmarkTask,
	parseOfficialSwebenchRunReport,
	parseSwebenchDataset,
	planOfficialSwebenchEvaluation,
	planOfficialSwebenchLiveEvaluation,
	type RepositoryBenchmarkSource,
	type SwebenchDifficulty,
	type SwebenchPrediction,
	selectSwebenchInstances,
	serializeSwebenchLivePredictions,
	serializeSwebenchPredictions,
} from "../core/swebench-benchmark";
import { resolveSwebenchWorkspaceName } from "../core/swebench-workspace-plan";
import {
	assessTerminalBenchAgentBoundary,
	assessTerminalBenchHost,
	PINNED_HARBOR_VERSION,
	planTerminalBenchAgentSmoke,
	planTerminalBenchOracleSmoke,
	type TerminalBenchEnvironmentCapabilities,
} from "../core/terminal-bench-harness";
import { resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox-docker";
import { materializeAiderPolyglotWorkspace } from "../nklein-agent/nklein-aider-polyglot-workspace";
import { materializeSwebenchWorkspace } from "../nklein-agent/nklein-swebench-workspace";
import { loadWorkspaceContext } from "../state/workspace-state";
import { gradeLocalBenchmark, type LocalBenchmarkDockerRunner } from "../workspace/local-benchmark-grade-runner";
import { mintLocalBenchmarkTasks } from "../workspace/local-benchmark-mint-runner";
import {
	captureBenchmarkWorkspaceResult,
	verifySealedBenchmarkWorkspace,
} from "../workspace/repository-benchmark-result";
import { createDevRuntimeClient, executeDevTestScenario } from "./dev-project-execution";
import { ensureRuntimeWorkspace } from "./task/task-runtime-workspace";

const execFile = promisify(execFileCallback);

export interface DevBenchmarkOptions {
	action: string;
	dataset?: string;
	datasetName?: string;
	repo?: string;
	repoName?: string;
	files?: string;
	testFiles?: string;
	testCommand?: string;
	split?: string;
	source?: string;
	output?: string;
	instance?: string;
	instanceIds?: string;
	difficulty?: string;
	freshAfter?: string;
	modelCutoffs?: string;
	leakageHits?: string;
	limit?: string;
	repoCache?: string;
	workspaceParent?: string;
	image?: string;
	model?: string;
	patch?: string;
	predictions?: string;
	runId?: string;
	reportDir?: string;
	python?: string;
	liveHarness?: string;
	corpus?: string;
	languages?: string;
	maxWorkers?: string;
	maxTokens?: string;
	timeout?: string;
	attempts?: string;
	reports?: string;
	baseline?: string;
	current?: string;
	quarantine?: string;
	calibration?: string;
	receipt?: string;
	modelId?: string;
	providerId?: string;
	pollIntervalMs?: string;
	maxWaitMs?: string;
	harborPath?: string;
	requiredFreeGb?: string;
	storagePath?: string;
	baseUrl?: string;
	modelCutoff?: string;
	startDate?: string;
	endDate?: string;
	runtimeHost?: string;
	runtimePort?: string;
	plan?: boolean;
	execute?: boolean;
	replace?: boolean;
	json?: boolean;
	write?: (text: string) => void;
}

export interface BenchmarkTaskExecutionInput {
	workspacePath: string;
	task: LeakageSafeBenchmarkTask;
	acceptanceCommand: string;
	runId: string;
	modelId?: string;
	providerId?: string;
	startInPlanMode: boolean;
	testEvidencePolicy: RuntimeTaskTestEvidencePolicy;
	pollIntervalMs?: number;
	maxWaitMs?: number;
}

export interface BenchmarkTaskExecutionResult {
	seedTaskId: string;
	durationMs: number;
	workflowOutcome: string;
	completedCardCount: number;
	baseCommit: string;
	resultCommit: string;
	evidenceRef: string;
	patch: string;
}

export interface DevBenchmarkCommandDeps {
	executeBenchmarkTask?: (input: BenchmarkTaskExecutionInput) => Promise<BenchmarkTaskExecutionResult>;
	runBenchmarkDocker?: LocalBenchmarkDockerRunner;
	probeTerminalBenchHost?: (input: { harborPath: string; storagePath: string }) => Promise<{
		harborVersion: string | null;
		dockerReachable: boolean;
		dockerArchitecture: string | null;
		availableBytes: number;
		reclaimableDockerBytes: number;
	}>;
	probeTerminalBenchAgentBoundary?: (input: {
		pythonPath: string;
		repoPath: string;
	}) => Promise<TerminalBenchEnvironmentCapabilities>;
	runTerminalBenchCommand?: (input: {
		command: string;
		args: readonly string[];
		cwd: string;
		env?: Readonly<Record<string, string>>;
	}) => Promise<{ stdout: string; stderr: string }>;
}

function csv(value: string | undefined): string[] | undefined {
	const values = value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return values && values.length > 0 ? values : undefined;
}

function parseSource(value: string | undefined): RepositoryBenchmarkSource {
	const source = value ?? "swebench_legacy";
	if (
		source === "swebench_legacy" ||
		source === "swebench_live" ||
		source === "swe_rebench" ||
		source === "local_minted" ||
		source === "aider_polyglot"
	)
		return source;
	throw new Error("--source must be swebench_legacy, swebench_live, swe_rebench, local_minted, or aider_polyglot.");
}

function parseDifficulties(value: string | undefined): SwebenchDifficulty[] | undefined {
	const values = csv(value);
	if (!values) return undefined;
	for (const entry of values) {
		if (!(["under_15m", "15m_to_1h", "1h_to_4h", "over_4h", "unknown"] as string[]).includes(entry)) {
			throw new Error(`Unknown benchmark difficulty ${entry}.`);
		}
	}
	return values as SwebenchDifficulty[];
}

function integer(value: string | undefined, name: string): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
	return parsed;
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporary, content, { flag: "wx" });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

async function atomicWriteNew(path: string, content: string, artifact = "immutable artifact"): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporary, content, { flag: "wx" });
		await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "EEXIST") throw new Error(`Refusing to replace existing ${artifact}: ${path}`);
			throw error;
		});
	} finally {
		await rm(temporary, { force: true });
	}
}

async function createExclusiveReportDirectory(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await mkdir(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "EEXIST") {
			throw new Error(`Refusing to reuse existing benchmark report directory: ${path}`);
		}
		throw error;
	});
}

async function loadDataset(options: DevBenchmarkOptions) {
	if (!options.dataset) throw new Error(`benchmark ${options.action} requires --dataset <local-json-or-jsonl>.`);
	return parseSwebenchDataset(await readFile(resolve(options.dataset), "utf8"), parseSource(options.source));
}

async function loadAiderPolyglotManifest(options: DevBenchmarkOptions) {
	if (!options.dataset) throw new Error(`benchmark ${options.action} requires --dataset <polyglot-manifest.json>.`);
	return parseAiderPolyglotManifest(JSON.parse(await readFile(resolve(options.dataset), "utf8")) as unknown);
}

async function readOptionalFile(path: string): Promise<string> {
	return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return "";
		throw error;
	});
}

async function verifyAiderPolyglotCorpus(path: string): Promise<void> {
	const [commit, origin, status] = await Promise.all([
		execFile("git", ["-C", path, "rev-parse", "HEAD"], { timeout: 10_000 }).then((result) => result.stdout.trim()),
		execFile("git", ["-C", path, "remote", "get-url", "origin"], { timeout: 10_000 }).then((result) =>
			result.stdout.trim(),
		),
		execFile("git", ["-C", path, "status", "--porcelain"], { timeout: 10_000 }).then((result) =>
			result.stdout.trim(),
		),
	]);
	if (commit !== PINNED_AIDER_POLYGLOT_COMMIT) {
		throw new Error(`Aider polyglot corpus must be pinned at ${PINNED_AIDER_POLYGLOT_COMMIT}; found ${commit}.`);
	}
	if (origin !== "https://github.com/Aider-AI/polyglot-benchmark.git") {
		throw new Error(`Unexpected Aider polyglot corpus origin: ${origin}.`);
	}
	if (status) throw new Error("Aider polyglot corpus checkout must be clean before manifest or workspace creation.");
}

async function prepareAiderPolyglot(options: DevBenchmarkOptions) {
	if (!options.corpus || !options.output) {
		throw new Error("Aider polyglot prepare requires --corpus <pinned-checkout> and --output <manifest.json>.");
	}
	const corpus = resolve(options.corpus);
	await verifyAiderPolyglotCorpus(corpus);
	const requestedLanguages = csv(options.languages) ?? [...AIDER_POLYGLOT_LANGUAGES];
	for (const language of requestedLanguages) {
		if (!(AIDER_POLYGLOT_LANGUAGES as readonly string[]).includes(language)) {
			throw new Error(`Unknown Aider polyglot language ${language}.`);
		}
	}
	const requestedIds = new Set(csv(options.instanceIds) ?? []);
	const tasks: ReturnType<typeof buildAiderPolyglotTask>[] = [];
	for (const language of [...requestedLanguages].sort()) {
		const practice = join(corpus, language, "exercises", "practice");
		const exercises = (await readdir(practice, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		for (const exercise of exercises) {
			const root = join(practice, exercise);
			const task = buildAiderPolyglotTask({
				language,
				exercise,
				corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
				configText: await readFile(join(root, ".meta", "config.json"), "utf8"),
				instructionParts: await Promise.all([
					readOptionalFile(join(root, ".docs", "introduction.md")),
					readOptionalFile(join(root, ".docs", "instructions.md")),
					readOptionalFile(join(root, ".docs", "instructions.append.md")),
				]),
			});
			if (requestedIds.size === 0 || requestedIds.has(task.instanceId)) tasks.push(task);
		}
	}
	for (const instanceId of requestedIds) {
		if (!tasks.some((task) => task.instanceId === instanceId)) {
			throw new Error(`Requested Aider polyglot instance ${instanceId} was not found.`);
		}
	}
	const limit = integer(options.limit, "limit");
	if (limit !== undefined && limit < 1) throw new Error("--limit must be at least 1.");
	const selected = limit === undefined ? tasks : tasks.slice(0, limit);
	if (selected.length === 0) throw new Error("Aider polyglot selection is empty.");
	const output = resolve(options.output);
	await atomicWriteNew(
		output,
		`${JSON.stringify({ schemaVersion: 1, corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT, tasks: selected }, null, 2)}\n`,
		"immutable benchmark manifest",
	);
	return { action: "prepare", source: "aider_polyglot", output, selected: selected.length };
}

async function loadExecutionTask(
	options: DevBenchmarkOptions,
): Promise<{ task: LeakageSafeBenchmarkTask; acceptanceCommand: string }> {
	if (!options.instance) throw new Error("Benchmark execution requires --instance.");
	if (parseSource(options.source) === "aider_polyglot") {
		const manifest = await loadAiderPolyglotManifest(options);
		const polyglot = manifest.tasks.find((task) => task.instanceId === options.instance);
		if (!polyglot) throw new Error(`Benchmark instance ${options.instance} is not present in the local manifest.`);
		const acceptanceCommand = buildAiderPolyglotPublicAcceptanceCommand(polyglot);
		return {
			task: {
				instanceId: polyglot.instanceId,
				repo: `Aider-AI/polyglot-benchmark/${polyglot.language}/${polyglot.exercise}`,
				baseCommit: polyglot.corpusCommit,
				prompt: buildAiderPolyglotExecutionPrompt(polyglot),
				source: "aider_polyglot",
				difficulty: "unknown",
				createdAt: null,
			},
			acceptanceCommand,
		};
	}
	const instances = await loadDataset(options);
	const instance = instances.find((entry) => entry.instanceId === options.instance);
	if (!instance) throw new Error(`Benchmark instance ${options.instance} is not present in the local dataset.`);
	const task = buildLeakageSafeBenchmarkTask(instance);
	if (instance.source === "local_minted") {
		return {
			task: { ...task, prompt: buildLocalBenchmarkExecutionPrompt(task.prompt) },
			acceptanceCommand: LOCAL_BENCHMARK_PUBLIC_ACCEPTANCE,
		};
	}
	return { task, acceptanceCommand: "" };
}

function selectionFromOptions(options: DevBenchmarkOptions) {
	return {
		instanceIds: csv(options.instanceIds),
		difficulties: parseDifficulties(options.difficulty),
		freshAfter: options.freshAfter,
		limit: integer(options.limit, "limit"),
	};
}

async function prepare(options: DevBenchmarkOptions) {
	if (parseSource(options.source) === "aider_polyglot") return prepareAiderPolyglot(options);
	if (!options.output) throw new Error("benchmark prepare requires --output <manifest.json>.");
	const selected = selectSwebenchInstances(await loadDataset(options), selectionFromOptions(options));
	const tasks = selected.map(buildLeakageSafeBenchmarkTask);
	const output = resolve(options.output);
	await atomicWrite(output, `${JSON.stringify({ schemaVersion: 1, tasks }, null, 2)}\n`);
	return { action: "prepare", output, selected: tasks.length, instanceIds: tasks.map((task) => task.instanceId) };
}

function parseStringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.some(([, entry]) => typeof entry !== "string")) throw new Error(`${label} values must be strings.`);
	return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

function parseLeakageHits(value: unknown): readonly FreshBenchmarkLeakageHit[] {
	if (!Array.isArray(value)) throw new Error("--leakage-hits must contain a JSON array.");
	return value.map((entry, index) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`Leakage hit ${index + 1} must be an object.`);
		}
		const record = entry as Record<string, unknown>;
		if (
			typeof record.instanceId !== "string" ||
			typeof record.kind !== "string" ||
			typeof record.evidence !== "string"
		) {
			throw new Error(`Leakage hit ${index + 1} requires string instanceId, kind, and evidence fields.`);
		}
		return {
			instanceId: record.instanceId,
			kind: record.kind as FreshBenchmarkLeakageHit["kind"],
			evidence: record.evidence,
		};
	});
}

async function freshTrack(options: DevBenchmarkOptions) {
	if (!options.output) throw new Error("benchmark fresh-track requires --output <evidence.json>.");
	const instances = await loadDataset(options);
	const modelCutoffs = options.modelCutoffs
		? parseStringRecord(
				JSON.parse(await readFile(resolve(options.modelCutoffs), "utf8")) as unknown,
				"--model-cutoffs",
			)
		: {};
	const leakageHits = options.leakageHits
		? parseLeakageHits(JSON.parse(await readFile(resolve(options.leakageHits), "utf8")) as unknown)
		: [];
	const evidence = buildFreshBenchmarkTrack({
		instances,
		freshAfter: options.freshAfter,
		modelCutoffs,
		leakageHits,
		limit: integer(options.limit, "limit"),
	});
	const output = resolve(options.output);
	await atomicWriteNew(output, `${JSON.stringify(evidence, null, 2)}\n`, "fresh benchmark evidence");
	return { action: "fresh-track", output, ...evidence };
}

async function mintLocal(options: DevBenchmarkOptions) {
	const implementationFiles = csv(options.files);
	const testFiles = csv(options.testFiles);
	if (
		!options.repo ||
		!options.repoName ||
		!implementationFiles ||
		!testFiles ||
		!options.testCommand ||
		!options.image ||
		!options.repoCache ||
		!options.output
	) {
		throw new Error(
			"benchmark mint-local requires --repo, --repo-name, --files, --test-files, --test-command, --image, --repo-cache, and --output.",
		);
	}
	return {
		action: "mint-local",
		...(await mintLocalBenchmarkTasks({
			repoPath: options.repo,
			repoName: options.repoName,
			implementationFiles,
			testFiles,
			testCommand: options.testCommand,
			image: options.image,
			repoCacheDir: options.repoCache,
			outputPath: options.output,
			maxMutants: integer(options.limit, "limit"),
		})),
	};
}

function parsePredictions(text: string): SwebenchPrediction[] {
	if (!text.trim()) return [];
	return text
		.trim()
		.split(/\r?\n/u)
		.map((line, index) => {
			let raw: unknown;
			try {
				raw = JSON.parse(line) as unknown;
			} catch {
				throw new Error(`Invalid prediction JSONL at line ${index + 1}.`);
			}
			if (!raw || typeof raw !== "object" || Array.isArray(raw))
				throw new Error(`Prediction line ${index + 1} is not an object.`);
			const record = raw as Record<string, unknown>;
			return buildSwebenchPrediction({
				instanceId: typeof record.instance_id === "string" ? record.instance_id : "",
				modelNameOrPath: typeof record.model_name_or_path === "string" ? record.model_name_or_path : "",
				modelPatch: typeof record.model_patch === "string" ? record.model_patch : "",
			});
		});
}

async function storePrediction(options: DevBenchmarkOptions, modelPatch: string) {
	if (!options.instance || !options.model || !options.output) {
		throw new Error("A benchmark prediction requires --instance, --model, and --output <jsonl>.");
	}
	const output = resolve(options.output);
	const existing: SwebenchPrediction[] = await readFile(output, "utf8")
		.then(parsePredictions)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
	const next = buildSwebenchPrediction({
		instanceId: options.instance,
		modelNameOrPath: options.model,
		modelPatch,
	});
	const duplicate = existing.findIndex((entry) => entry.instance_id === next.instance_id);
	if (duplicate >= 0 && !options.replace)
		throw new Error(`Prediction for ${next.instance_id} already exists; pass --replace deliberately.`);
	if (duplicate >= 0) existing.splice(duplicate, 1, next);
	else existing.push(next);
	existing.sort((left, right) => left.instance_id.localeCompare(right.instance_id));
	await atomicWrite(output, serializeSwebenchPredictions(existing));
	return { output, predictionCount: existing.length, instanceId: next.instance_id };
}

async function assertPredictionWritable(options: DevBenchmarkOptions): Promise<void> {
	if (!options.instance || !options.output) return;
	const existing = await readFile(resolve(options.output), "utf8")
		.then(parsePredictions)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
	if (existing.some((entry) => entry.instance_id === options.instance) && !options.replace) {
		throw new Error(`Prediction for ${options.instance} already exists; pass --replace deliberately.`);
	}
}

async function prediction(options: DevBenchmarkOptions) {
	if (!options.patch) {
		throw new Error("benchmark prediction requires --patch <diff-file>.");
	}
	return { action: "prediction", ...(await storePrediction(options, await readFile(resolve(options.patch), "utf8"))) };
}

async function executeBenchmarkTask(input: BenchmarkTaskExecutionInput): Promise<BenchmarkTaskExecutionResult> {
	const sealed = await verifySealedBenchmarkWorkspace({ repoPath: input.workspacePath });
	const workspace = await loadWorkspaceContext(input.workspacePath, { autoCreateIfMissing: true });
	const runtimeWorkspaceId = await ensureRuntimeWorkspace(workspace.repoPath);
	const scenario = {
		id: `benchmark-${input.task.instanceId}`,
		title: `Repair ${input.task.repo} (${input.task.instanceId})`,
		prompt: input.task.prompt,
		specification: input.task.prompt,
		// Deliberately unused: the private benchmark oracle runs later in the official external grader.
		acceptanceCommand: input.acceptanceCommand,
	};
	// A pinned model on a single-slot host is legitimately BUSY for moments (a lingering review turn, a
	// decomposed child's session) — the runtime refuses the pinned start and then auto-heals on its next
	// sweep. That is queueing weather, not model absence: a campaign died at its first full-run attempt on
	// exactly this (2026-08-21, aider single-host arm) while `lms ps` showed the model loaded and IDLE.
	// Retry the start (bounded) before declaring the run dead; the runtime's start guard makes a converged
	// double-start safe (an already-running card returns its live summary as started).
	const PINNED_START_RETRIES = 5;
	const PINNED_START_RETRY_DELAY_MS = 60_000;
	let execution: Awaited<ReturnType<typeof executeDevTestScenario>>;
	let startAttempt = 0;
	for (;;) {
		startAttempt += 1;
		execution = await executeDevTestScenario({
			client: createDevRuntimeClient(runtimeWorkspaceId),
			workspaceId: runtimeWorkspaceId,
			scenario,
			baseRef: "benchmark-baseline",
			seedTaskId: input.runId,
			startInPlanMode: input.startInPlanMode,
			autoReviewEnabled: true,
			autoReviewMode: "commit",
			testEvidencePolicy: input.testEvidencePolicy,
			...(input.modelId
				? { nkleinSettings: { providerId: input.providerId?.trim() || "lmstudio", modelId: input.modelId } }
				: {}),
			...(typeof input.pollIntervalMs === "number" ? { pollIntervalMs: input.pollIntervalMs } : {}),
			...(typeof input.maxWaitMs === "number" ? { maxWaitMs: input.maxWaitMs } : {}),
		});
		const startMessage = execution.result.startMessage ?? "";
		if (
			execution.result.started ||
			!startMessage.includes("not currently selectable") ||
			startAttempt > PINNED_START_RETRIES
		) {
			break;
		}
		process.stderr.write(
			`[benchmark] pinned model momentarily unselectable (attempt ${startAttempt}/${PINNED_START_RETRIES + 1}); retrying in ${PINNED_START_RETRY_DELAY_MS / 1000}s: ${startMessage}\n`,
		);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, PINNED_START_RETRY_DELAY_MS));
	}
	if (!execution.result.started) {
		throw new Error(`!Klein benchmark task did not start: ${execution.result.startMessage ?? "unknown error"}.`);
	}
	if (execution.result.classification.outcome === "runtime_down") {
		throw new Error(`!Klein benchmark infrastructure became unavailable: ${execution.result.classification.summary}`);
	}
	if (execution.result.infrastructureFailure) {
		throw new Error(`!Klein benchmark infrastructure failed: ${execution.result.infrastructureFailure}`);
	}
	const captured = await captureBenchmarkWorkspaceResult({
		repoPath: input.workspacePath,
		baseCommit: sealed.baseCommit,
		runId: input.runId,
		taskId: input.runId,
	});
	return {
		seedTaskId: execution.seedTaskId,
		durationMs: execution.durationMs,
		workflowOutcome: execution.result.classification.outcome,
		completedCardCount: execution.result.finalCounts.completed,
		...captured,
	};
}

async function run(options: DevBenchmarkOptions, deps: DevBenchmarkCommandDeps) {
	if (
		!options.instance ||
		!options.workspaceParent ||
		!options.model ||
		!options.output ||
		!options.receipt ||
		!options.runId
	) {
		throw new Error(
			"benchmark run requires --dataset, --instance, --workspace-parent, --model, --output, --receipt, and --run-id.",
		);
	}
	const { task, acceptanceCommand } = await loadExecutionTask(options);
	const testEvidencePolicy = "externally_held_out" satisfies RuntimeTaskTestEvidencePolicy;
	if (task.source === "aider_polyglot" || task.source === "local_minted") {
		if (!options.calibration) {
			throw new Error("Held-out candidate execution requires --calibration from at least two gold repeats.");
		}
		assertCandidateCalibration(
			[task.instanceId],
			JSON.parse(await readFile(resolve(options.calibration), "utf8")) as unknown,
		);
	}
	if (!/^[A-Za-z0-9_.-]+$/u.test(options.runId)) {
		throw new Error("--run-id must contain only letters, digits, dot, underscore, or hyphen.");
	}
	if (options.runtimeHost !== undefined) {
		const host = options.runtimeHost.trim();
		if (!host) throw new Error("--runtime-host must not be empty.");
		setKanbanRuntimeHost(host);
	}
	if (options.runtimePort !== undefined) {
		setKanbanRuntimePort(integer(options.runtimePort, "runtime-port") ?? 0);
	}
	const runtimeOrigin = getKanbanRuntimeOrigin();
	const workspacePath = join(resolve(options.workspaceParent), resolveSwebenchWorkspaceName(task.instanceId));
	const receiptPath = resolve(options.receipt);
	const receiptExists = await lstat(receiptPath)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
	if (receiptExists) throw new Error(`Refusing to replace existing immutable receipt: ${receiptPath}`);
	await assertPredictionWritable(options);
	const executeTask = deps.executeBenchmarkTask ?? executeBenchmarkTask;
	const execution = await executeTask({
		workspacePath,
		task,
		acceptanceCommand,
		runId: options.runId,
		startInPlanMode: options.plan !== false,
		testEvidencePolicy,
		...(options.modelId ? { modelId: options.modelId } : {}),
		...(options.providerId ? { providerId: options.providerId } : {}),
		...(options.pollIntervalMs ? { pollIntervalMs: integer(options.pollIntervalMs, "poll-interval-ms") } : {}),
		...(options.maxWaitMs ? { maxWaitMs: integer(options.maxWaitMs, "max-wait-ms") } : {}),
	});
	const { patch, ...executionEvidence } = execution;
	const patchBytes = Buffer.byteLength(patch, "utf8");
	const receipt = {
		schemaVersion: 1,
		runId: options.runId,
		instanceId: task.instanceId,
		source: task.source,
		modelNameOrPath: options.model,
		forcedModelId: options.modelId ?? null,
		providerId: options.modelId ? options.providerId?.trim() || "lmstudio" : null,
		runtimeOrigin,
		startInPlanMode: options.plan !== false,
		testEvidencePolicy,
		workspacePath,
		predictionOutput: resolve(options.output),
		patchBytes,
		...executionEvidence,
		patch,
	};
	await atomicWriteNew(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "immutable receipt");
	const predictionResult = await storePrediction(options, patch);
	return { action: "run", receipt: receiptPath, ...executionEvidence, patchBytes, ...predictionResult };
}

async function runDockerArgs(args: readonly string[]) {
	try {
		const result = await execFile("docker", [...args], { maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000 });
		return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, infrastructureFailure: false };
	} catch (error) {
		const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
		const exitCode = typeof failure.code === "number" ? failure.code : 1;
		return {
			exitCode,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? failure.message,
			infrastructureFailure: typeof failure.code !== "number" || exitCode >= 125,
		};
	}
}

async function workspaceAiderPolyglot(options: DevBenchmarkOptions) {
	if (!options.instance || !options.corpus || !options.workspaceParent) {
		throw new Error("Aider polyglot workspace requires --dataset, --instance, --corpus, and --workspace-parent.");
	}
	const manifest = await loadAiderPolyglotManifest(options);
	const task = manifest.tasks.find((entry) => entry.instanceId === options.instance);
	if (!task) throw new Error(`Benchmark instance ${options.instance} is not present in the local manifest.`);
	const corpus = resolve(options.corpus);
	await verifyAiderPolyglotCorpus(corpus);
	const result = await materializeAiderPolyglotWorkspace({
		task,
		corpusDir: corpus,
		workspaceParentDir: resolve(options.workspaceParent),
		image: options.image ?? resolveAgentSandboxImageName(),
		runDocker: runDockerArgs,
	});
	return { action: "workspace", source: "aider_polyglot", ...result, instanceId: task.instanceId };
}

async function workspace(options: DevBenchmarkOptions) {
	if (parseSource(options.source) === "aider_polyglot") return workspaceAiderPolyglot(options);
	if (!options.instance || !options.repoCache || !options.workspaceParent) {
		throw new Error("benchmark workspace requires --dataset, --instance, --repo-cache, and --workspace-parent.");
	}
	const instances = await loadDataset(options);
	const instance = instances.find((entry) => entry.instanceId === options.instance);
	if (!instance) throw new Error(`Benchmark instance ${options.instance} is not present in the local dataset.`);
	buildLeakageSafeBenchmarkTask(instance);
	const result = await materializeSwebenchWorkspace({
		instance,
		repoCacheDir: resolve(options.repoCache),
		workspaceParentDir: resolve(options.workspaceParent),
		image: options.image ?? resolveAgentSandboxImageName(),
		runDocker: runDockerArgs,
	});
	return { action: "workspace", ...result, instanceId: instance.instanceId };
}

async function gradeAiderPolyglot(options: DevBenchmarkOptions) {
	if (
		parseSource(options.source) !== "aider_polyglot" ||
		!options.instance ||
		!options.corpus ||
		!options.predictions ||
		!options.reportDir ||
		!options.runId
	) {
		throw new Error(
			"Aider polyglot grade requires --source aider_polyglot, --dataset, --instance, --corpus, --predictions, --report-dir, and --run-id.",
		);
	}
	const manifest = await loadAiderPolyglotManifest(options);
	const task = manifest.tasks.find((entry) => entry.instanceId === options.instance);
	if (!task) throw new Error(`Benchmark instance ${options.instance} is not present in the local manifest.`);
	const corpus = resolve(options.corpus);
	await verifyAiderPolyglotCorpus(corpus);
	const exerciseDir = join(corpus, task.language, "exercises", "practice", task.exercise);
	const config = parseAiderPolyglotConfig(await readFile(join(exerciseDir, ".meta", "config.json"), "utf8"));
	if (config.solutionFiles.join("\n") !== task.solutionFiles.join("\n")) {
		throw new Error("Aider polyglot manifest solution files no longer match the pinned corpus config.");
	}
	const gold = options.predictions === "gold";
	const goldExampleFiles = [...config.exampleFiles];
	if (gold) {
		for (const solutionFile of task.solutionFiles) {
			const companion = resolveAiderPolyglotCompanionExamplePath(solutionFile);
			if (goldExampleFiles.includes(companion)) continue;
			const exists = await lstat(join(exerciseDir, companion))
				.then((stat) => stat.isFile())
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return false;
					throw error;
				});
			if (exists) goldExampleFiles.push(companion);
		}
	}
	let modelNameOrPath = "gold";
	let candidatePatch = "";
	if (!gold) {
		const predictions = parsePredictions(await readFile(resolve(options.predictions), "utf8"));
		const prediction = predictions.find((entry) => entry.instance_id === task.instanceId);
		if (!prediction) throw new Error(`Predictions do not contain ${task.instanceId}.`);
		modelNameOrPath = prediction.model_name_or_path;
		candidatePatch = prediction.model_patch;
	}
	const reportDir = resolve(options.reportDir);
	await createExclusiveReportDirectory(reportDir);
	const gradeDir = join(reportDir, "grade-workspace");
	await mkdir(gradeDir);
	let candidatePatchPath: string | undefined;
	if (!gold && candidatePatch) {
		candidatePatchPath = join(reportDir, "candidate.patch");
		await atomicWriteNew(candidatePatchPath, candidatePatch, "immutable candidate patch");
	}
	const plan = buildAiderPolyglotGradeDockerPlan({
		task,
		corpusDir: corpus,
		gradeDir,
		image: resolveAiderPolyglotGraderImage(task.language, options.image),
		uid: process.getuid?.() ?? 1000,
		gid: process.getgid?.() ?? 1000,
		mode: gold ? "gold" : "candidate",
		...(candidatePatchPath ? { candidatePatchPath } : {}),
		...(gold ? { exampleFiles: goldExampleFiles } : {}),
		testFiles: config.testFiles,
	});
	let status: BenchmarkAttemptStatus = "error";
	let log = "";
	for (let index = 0; index < plan.setupSteps.length; index += 1) {
		const result = await runDockerArgs(plan.setupSteps[index]);
		log += `setup ${index + 1}/${plan.setupSteps.length}\n${result.stdout}${result.stderr}`;
		if (result.exitCode !== 0) {
			log += "\nsetup failed\n";
			break;
		}
		if (index === plan.setupSteps.length - 1) {
			const test = await runDockerArgs(plan.testStep);
			log += `\ntest\n${test.stdout}${test.stderr}`;
			status = classifyAiderPolyglotTestResult(test);
		}
	}
	await atomicWriteNew(join(reportDir, "test.log"), log, "immutable grader log");
	const report = {
		schema_version: "aider_polyglot_v1",
		run_id: options.runId,
		corpus_commit: task.corpusCommit,
		model_name_or_path: modelNameOrPath,
		submitted_ids: [task.instanceId],
		resolved_ids: status === "resolved" ? [task.instanceId] : [],
		unresolved_ids: status === "unresolved" ? [task.instanceId] : [],
		error_ids: status === "error" ? [task.instanceId] : [],
	};
	const reportPath = join(reportDir, "results.json");
	await atomicWriteNew(reportPath, `${JSON.stringify(report, null, 2)}\n`, "immutable grader report");
	return { action: "grade", source: "aider_polyglot", instanceId: task.instanceId, status, report: reportPath };
}

async function gradeLocalMinted(options: DevBenchmarkOptions, deps: DevBenchmarkCommandDeps) {
	if (
		parseSource(options.source) !== "local_minted" ||
		!options.instance ||
		!options.repoCache ||
		!options.predictions ||
		!options.reportDir ||
		!options.runId
	) {
		throw new Error(
			"Local-minted grade requires --source local_minted, --dataset, --instance, --repo-cache, --predictions, --report-dir, and --run-id.",
		);
	}
	const instance = (await loadDataset(options)).find((entry) => entry.instanceId === options.instance);
	if (!instance) throw new Error(`Benchmark instance ${options.instance} is not present in the local dataset.`);
	if (!instance.localOracle)
		throw new Error(`Local benchmark instance ${instance.instanceId} has no held-out oracle.`);
	const gold = options.predictions === "gold";
	let modelNameOrPath = "gold";
	let patch = instance.goldPatch;
	if (gold && !patch) throw new Error(`Local benchmark instance ${instance.instanceId} has no gold patch.`);
	if (!gold) {
		const prediction = parsePredictions(await readFile(resolve(options.predictions), "utf8")).find(
			(entry) => entry.instance_id === instance.instanceId,
		);
		if (!prediction) throw new Error(`Predictions do not contain ${instance.instanceId}.`);
		modelNameOrPath = prediction.model_name_or_path;
		patch = prediction.model_patch;
	}
	const reportDir = resolve(options.reportDir);
	await createExclusiveReportDirectory(reportDir);
	let patchPath: string | undefined;
	if (patch) {
		patchPath = join(reportDir, gold ? "gold.patch" : "candidate.patch");
		await atomicWriteNew(patchPath, patch, gold ? "immutable gold patch" : "immutable candidate patch");
	}
	const grade = await gradeLocalBenchmark({
		instance,
		repoCacheDir: resolve(options.repoCache),
		workspaceParentDir: reportDir,
		...(patchPath ? { patchPath } : {}),
		mode: gold ? "gold" : "candidate",
		runDocker: deps.runBenchmarkDocker ?? runDockerArgs,
	});
	await atomicWriteNew(join(reportDir, "test.log"), grade.log, "immutable grader log");
	const report = {
		schema_version: "local_minted_v1",
		run_id: options.runId,
		model_name_or_path: modelNameOrPath,
		submitted_ids: [instance.instanceId],
		resolved_ids: grade.status === "resolved" ? [instance.instanceId] : [],
		unresolved_ids: grade.status === "unresolved" ? [instance.instanceId] : [],
		error_ids: grade.status === "error" ? [instance.instanceId] : [],
	};
	const reportPath = join(reportDir, "results.json");
	await atomicWriteNew(reportPath, `${JSON.stringify(report, null, 2)}\n`, "immutable grader report");
	return {
		action: "grade",
		source: "local_minted",
		instanceId: instance.instanceId,
		status: grade.status,
		report: reportPath,
	};
}

async function grade(options: DevBenchmarkOptions, deps: DevBenchmarkCommandDeps) {
	const source = parseSource(options.source);
	if (source === "aider_polyglot") return gradeAiderPolyglot(options);
	if (source === "local_minted") return gradeLocalMinted(options, deps);
	throw new Error(
		"benchmark grade is native only for --source aider_polyglot or local_minted; use plan --execute for official harnesses.",
	);
}

async function plan(options: DevBenchmarkOptions) {
	if (!options.predictions || !options.runId || !options.reportDir || !options.instanceIds) {
		throw new Error("benchmark plan requires --predictions, --run-id, --report-dir, and --instance-ids.");
	}
	const source = parseSource(options.source);
	const dockerArchitecture = await execFile("docker", ["info", "--format", "{{.Architecture}}"], {
		timeout: 10_000,
	}).then((result) => result.stdout.trim());
	const instanceIds = csv(options.instanceIds) ?? [];
	const pythonPath = resolve(options.python ?? "benchmark-harness/.venv/bin/python");
	const reportDir = resolve(options.reportDir);
	const candidate = options.predictions !== "gold";
	let livePredictionsPath: string | null = null;
	const evaluation = (() => {
		if (source === "swebench_live") {
			if (!options.dataset) {
				throw new Error("SWE-bench-Live grading requires --dataset <pinned-local-jsonl>.");
			}
			if (options.timeout) {
				throw new Error("The pinned native SWE-bench-Live harness has its own timeout; --timeout is unsupported.");
			}
			livePredictionsPath = candidate ? join(reportDir, "predictions.live.json") : null;
			return planOfficialSwebenchLiveEvaluation({
				pythonPath,
				harnessPath: resolve(options.liveHarness ?? "benchmark-harness/swebench-live"),
				datasetPath: resolve(options.dataset),
				predictionsPath: livePredictionsPath ?? "gold",
				instanceIds,
				reportDir,
				maxWorkers: integer(options.maxWorkers, "max-workers"),
				hostArchitecture: process.arch,
				dockerArchitecture,
			});
		}
		if (!options.datasetName) {
			throw new Error("Legacy SWE-bench grading requires --dataset-name.");
		}
		return planOfficialSwebenchEvaluation({
			pythonPath,
			datasetName: options.datasetName,
			predictionsPath: candidate ? resolve(options.predictions) : "gold",
			runId: options.runId,
			instanceIds,
			reportDir,
			...(options.split?.trim() ? { split: options.split.trim() } : {}),
			maxWorkers: integer(options.maxWorkers, "max-workers"),
			timeoutSeconds: integer(options.timeout, "timeout"),
			hostArchitecture: process.arch,
			dockerArchitecture,
		});
	})();
	if (options.execute) {
		if (candidate) {
			if (!options.calibration) {
				throw new Error("Candidate execution requires --calibration from at least two gold repeats.");
			}
			assertCandidateCalibration(
				instanceIds,
				JSON.parse(await readFile(resolve(options.calibration), "utf8")) as unknown,
			);
		}
		// Both official runners can skip already-present instance outputs. A fresh exclusive directory prevents a
		// nominally new run from silently inheriting stale reports after a reused run id or interrupted attempt.
		await createExclusiveReportDirectory(reportDir);
		if (evaluation.harness === "swebench_live") {
			await execFile(evaluation.command, [resolve("scripts/verify-swebench-live-grader.py"), evaluation.cwd ?? ""], {
				timeout: 30_000,
			});
			if (candidate && livePredictionsPath) {
				const predictions = parsePredictions(await readFile(resolve(options.predictions), "utf8"));
				await atomicWrite(livePredictionsPath, serializeSwebenchLivePredictions(predictions));
			}
		} else {
			await execFile(evaluation.command, [resolve("scripts/verify-swebench-grader.py")], { timeout: 30_000 });
		}
		await execFile(evaluation.command, [...evaluation.args], {
			cwd: evaluation.cwd ?? reportDir,
			timeout: 24 * 60 * 60_000,
			maxBuffer: 64 * 1024 * 1024,
		});
	}
	return { action: options.execute ? "execute" : "plan", evaluation };
}

function parseAttempts(text: string): BenchmarkAttempt[] {
	return text
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as BenchmarkAttempt);
}

async function calibrate(options: DevBenchmarkOptions) {
	if ((!options.attempts && !options.reports) || !options.instanceIds) {
		throw new Error("benchmark calibrate requires --instance-ids and either --attempts or --reports.");
	}
	if (options.attempts && options.reports) throw new Error("Use --attempts or --reports, not both.");
	const attempts = options.attempts
		? parseAttempts(await readFile(resolve(options.attempts), "utf8"))
		: await Promise.all(
				(csv(options.reports) ?? []).map(async (reportPath, index) => {
					const statuses = parseOfficialSwebenchRunReport(
						JSON.parse(await readFile(resolve(reportPath), "utf8")) as unknown,
					);
					return Object.entries(statuses).map(([instanceId, status]) => ({
						instanceId,
						status,
						repeat: index + 1,
					}));
				}),
			).then((rows) => rows.flat());
	const calibration = calibrateGoldAttempts(csv(options.instanceIds) ?? [], attempts);
	const output = options.output ? resolve(options.output) : undefined;
	if (output) {
		await atomicWriteNew(output, `${JSON.stringify(calibration, null, 2)}\n`, "immutable calibration");
	}
	return { action: "calibrate", ...(output ? { output } : {}), ...calibration };
}

async function gate(options: DevBenchmarkOptions) {
	if (!options.baseline || !options.current)
		throw new Error("benchmark gate requires --baseline and --current status maps.");
	const baseline = JSON.parse(await readFile(resolve(options.baseline), "utf8")) as Record<
		string,
		BenchmarkAttemptStatus
	>;
	const current = JSON.parse(await readFile(resolve(options.current), "utf8")) as Record<
		string,
		BenchmarkAttemptStatus
	>;
	const quarantined = options.quarantine
		? (JSON.parse(await readFile(resolve(options.quarantine), "utf8")) as string[])
		: undefined;
	return {
		action: "gate",
		...evaluateResolvedSetRegression({ baseline, current, quarantinedInstanceIds: quarantined }),
	};
}

function parseHumanBytes(value: string): number {
	const match = /^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?b)/iu.exec(value.trim());
	if (!match) return 0;
	const powers: Record<string, number> = { b: 0, kb: 1, mb: 2, gb: 3, tb: 4, pb: 5 };
	return Math.trunc(Number(match[1]) * 1024 ** (powers[match[2].toLowerCase()] ?? 0));
}

async function probeTerminalBenchHost(input: { harborPath: string; storagePath: string }) {
	const harborVersion = await execFile(input.harborPath, ["--version"], { timeout: 10_000 })
		.then((result) => /(\d+\.\d+\.\d+)/u.exec(`${result.stdout}\n${result.stderr}`)?.[1] ?? null)
		.catch(() => null);
	const dockerInfo = await execFile("docker", ["info", "--format", "{{.Architecture}}"], { timeout: 10_000 })
		.then((result) => ({ reachable: true, architecture: result.stdout.trim() || null }))
		.catch(() => ({ reachable: false, architecture: null }));
	const filesystem = await statfs(resolve(input.storagePath));
	const reclaimableDockerBytes = await execFile("docker", ["system", "df", "--format", "{{json .}}"], {
		timeout: 30_000,
	})
		.then((result) =>
			result.stdout
				.trim()
				.split(/\r?\n/u)
				.filter(Boolean)
				.map((line) => JSON.parse(line) as Record<string, unknown>)
				.reduce(
					(total, row) => total + (typeof row.Reclaimable === "string" ? parseHumanBytes(row.Reclaimable) : 0),
					0,
				),
		)
		.catch(() => 0);
	return {
		harborVersion,
		dockerReachable: dockerInfo.reachable,
		dockerArchitecture: dockerInfo.architecture,
		availableBytes: Number(filesystem.bavail) * Number(filesystem.bsize),
		reclaimableDockerBytes,
	};
}

async function probeTerminalBenchAgentBoundary(input: {
	pythonPath: string;
	repoPath: string;
}): Promise<TerminalBenchEnvironmentCapabilities> {
	try {
		const result = await execFile(
			input.pythonPath,
			[resolve(input.repoPath, "scripts/verify-terminal-bench-adapter.py"), "--repo", input.repoPath],
			{ cwd: input.repoPath, timeout: 30_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
		);
		return JSON.parse(result.stdout.trim()) as TerminalBenchEnvironmentCapabilities;
	} catch (error) {
		return {
			execInOwnedContainer: false,
			mutableRootFilesystem: false,
			boundedExecResults: false,
			preserveContainerAcrossTurns: false,
			harborOwnsVerification: false,
			probeError: error instanceof Error ? error.message : String(error),
		};
	}
}

async function terminalPreflight(options: DevBenchmarkOptions, deps: DevBenchmarkCommandDeps) {
	if (!options.reportDir || !options.requiredFreeGb || !options.storagePath) {
		throw new Error(
			"terminal-preflight requires --report-dir, --storage-path, and an explicit --required-free-gb pull-headroom budget.",
		);
	}
	const requiredFreeGb = integer(options.requiredFreeGb, "required-free-gb");
	if (!requiredFreeGb || requiredFreeGb < 1) throw new Error("--required-free-gb must be at least 1.");
	const harborPath = options.harborPath?.trim() || "harbor";
	const storagePath = resolve(options.storagePath);
	const repoPath = resolve(".");
	const pythonPath =
		options.python?.trim() || (harborPath.includes("/") ? resolve(dirname(harborPath), "python") : "python3");
	const probe = await (deps.probeTerminalBenchHost ?? probeTerminalBenchHost)({ harborPath, storagePath });
	const host = assessTerminalBenchHost({
		...probe,
		requiredFreeBytes: requiredFreeGb * 1024 ** 3,
	});
	const boundaryProbe = await (deps.probeTerminalBenchAgentBoundary ?? probeTerminalBenchAgentBoundary)({
		pythonPath,
		repoPath,
	});
	const agentBoundary = assessTerminalBenchAgentBoundary(boundaryProbe);
	const modelId = options.modelId?.trim();
	const baseUrl = options.baseUrl?.trim();
	const reportDir = resolve(options.reportDir);
	const oracleSmoke = planTerminalBenchOracleSmoke({
		outputDir: reportDir,
		limit: integer(options.limit, "limit") ?? 5,
		harborPath,
	});
	const agentSmoke =
		modelId && baseUrl
			? planTerminalBenchAgentSmoke({
					outputDir: resolve(reportDir, "nklein"),
					cwd: repoPath,
					modelId,
					baseUrl,
					contextWindow: 32_768,
					maxTokensPerTurn: integer(options.maxTokens, "max-tokens") ?? 4_096,
					limit: integer(options.limit, "limit") ?? 5,
					harborPath,
				})
			: null;
	const report = {
		action: "terminal-preflight",
		ready: host.ready && agentBoundary.ready,
		pinnedHarborVersion: PINNED_HARBOR_VERSION,
		storagePath,
		pythonPath,
		host,
		agentBoundary,
		oracleSmoke,
		agentSmoke,
	};
	if (!options.execute) return report;
	if (!report.ready) throw new Error("Terminal-Bench execution requires a green host and agent-boundary preflight.");
	if (!agentSmoke) throw new Error("Terminal-Bench --execute requires --model-id and --base-url for the matched run.");
	const evidenceExists = await lstat(reportDir)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
	if (evidenceExists) throw new Error(`Terminal-Bench evidence path already exists: ${reportDir}`);
	await mkdir(dirname(reportDir), { recursive: true });
	const run =
		deps.runTerminalBenchCommand ??
		(async (input: {
			command: string;
			args: readonly string[];
			cwd: string;
			env?: Readonly<Record<string, string>>;
		}) =>
			execFile(input.command, [...input.args], {
				cwd: input.cwd,
				env: { ...process.env, ...input.env },
				maxBuffer: 16 * 1024 * 1024,
			}));
	const oracleResult = await run({ ...oracleSmoke, cwd: repoPath });
	const agentResult = await run(agentSmoke);
	const tail = (value: string) => (value.length <= 8_000 ? value : value.slice(-8_000));
	return {
		...report,
		executed: true,
		execution: {
			oracle: { stdoutTail: tail(oracleResult.stdout), stderrTail: tail(oracleResult.stderr) },
			agent: { stdoutTail: tail(agentResult.stdout), stderrTail: tail(agentResult.stderr) },
		},
	};
}

async function verifyPinnedLiveCodeBenchCheckout(path: string): Promise<void> {
	const [head, status] = await Promise.all([
		execFile("git", ["-C", path, "rev-parse", "HEAD"], { timeout: 10_000 }).then((result) => result.stdout.trim()),
		execFile("git", ["-C", path, "status", "--porcelain"], { timeout: 10_000 }).then((result) =>
			result.stdout.trim(),
		),
	]);
	if (head !== PINNED_LIVECODEBENCH_COMMIT) {
		throw new Error(`LiveCodeBench checkout must be pinned at ${PINNED_LIVECODEBENCH_COMMIT}; found ${head}.`);
	}
	if (status) throw new Error("LiveCodeBench checkout must be clean.");
}

async function liveCodeBenchPlan(options: DevBenchmarkOptions) {
	if (
		!options.python ||
		!options.liveHarness ||
		!options.baseUrl ||
		!options.model ||
		!options.modelCutoff ||
		!options.startDate ||
		!options.endDate ||
		!options.output
	) {
		throw new Error(
			"livecodebench-plan requires --python, --live-harness, --base-url, --model, --model-cutoff, --start-date, --end-date, and --output.",
		);
	}
	const harnessPath = resolve(options.liveHarness);
	await verifyPinnedLiveCodeBenchCheckout(harnessPath);
	const controlPlan = planLiveCodeBenchControl({
		pythonPath: resolve(options.python),
		harnessPath,
		runnerPath: resolve("scripts/run-livecodebench-control.py"),
		apiBaseUrl: options.baseUrl,
		model: options.model,
		modelCutoff: options.modelCutoff,
		startDate: options.startDate,
		endDate: options.endDate,
		outputPath: resolve(options.output),
		maxTokens: integer(options.maxTokens, "max-tokens"),
		timeoutSeconds: integer(options.timeout, "timeout"),
		evaluationWorkers: integer(options.maxWorkers, "max-workers"),
	});
	if (!options.execute) return { action: "livecodebench-plan", plan: controlPlan };
	const reportPath = `${resolve(options.output).slice(0, -5)}_control.json`;
	const evidencePaths = [
		controlPlan.generation.outputPath,
		controlPlan.evaluation.metricsPath,
		controlPlan.evaluation.evalAllPath,
		reportPath,
	];
	for (const path of evidencePaths) {
		await lstat(path)
			.then(() => {
				throw new Error(`Refusing to replace existing LiveCodeBench evidence: ${path}`);
			})
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
	}
	for (const step of [controlPlan.generation, controlPlan.evaluation]) {
		await execFile(step.command, [...step.args], {
			cwd: step.cwd,
			env: { ...process.env, ...step.env },
			timeout: 24 * 60 * 60_000,
			maxBuffer: 64 * 1024 * 1024,
		});
	}
	const imported = await liveCodeBenchReport({
		...options,
		action: "livecodebench-report",
		predictions: controlPlan.generation.outputPath,
		reports: `${controlPlan.evaluation.metricsPath},${controlPlan.evaluation.evalAllPath}`,
		output: reportPath,
	});
	return { action: "livecodebench-execute", plan: controlPlan, imported };
}

async function sha256File(path: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

async function liveCodeBenchReport(options: DevBenchmarkOptions) {
	if (
		!options.model ||
		!options.modelCutoff ||
		!options.startDate ||
		!options.endDate ||
		!options.predictions ||
		!options.reports ||
		!options.output
	) {
		throw new Error(
			"livecodebench-report requires --model, --model-cutoff, --start-date, --end-date, --predictions, --reports <metrics,eval-all>, and --output.",
		);
	}
	const reportPaths = csv(options.reports) ?? [];
	if (reportPaths.length !== 2) throw new Error("livecodebench-report --reports must contain metrics,eval-all paths.");
	const generationPath = resolve(options.predictions);
	const metricsPath = resolve(reportPaths[0]);
	const evalAllPath = resolve(reportPaths[1]);
	const [generationSha256, metricsText, evalAllText, metricsSha256, evalAllSha256] = await Promise.all([
		sha256File(generationPath),
		readFile(metricsPath, "utf8"),
		readFile(evalAllPath, "utf8"),
		sha256File(metricsPath),
		sha256File(evalAllPath),
	]);
	const report = buildLiveCodeBenchControlReport({
		metrics: JSON.parse(metricsText) as unknown,
		evalAll: JSON.parse(evalAllText) as unknown,
		model: options.model,
		modelCutoff: options.modelCutoff,
		startDate: options.startDate,
		endDate: options.endDate,
		generationSha256,
		metricsSha256,
		evalAllSha256,
	});
	const output = resolve(options.output);
	await atomicWriteNew(output, `${JSON.stringify(report, null, 2)}\n`, "immutable LiveCodeBench control report");
	return { action: "livecodebench-report", output, report };
}

export async function runDevBenchmarkCommand(
	options: DevBenchmarkOptions,
	deps: DevBenchmarkCommandDeps = {},
): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const handlers: Record<string, (value: DevBenchmarkOptions) => Promise<unknown>> = {
		prepare,
		"fresh-track": freshTrack,
		"mint-local": mintLocal,
		prediction,
		workspace,
		run: (value) => run(value, deps),
		grade: (value) => grade(value, deps),
		plan,
		calibrate,
		gate,
		"livecodebench-plan": liveCodeBenchPlan,
		"livecodebench-report": liveCodeBenchReport,
		"terminal-preflight": (value) => terminalPreflight(value, deps),
	};
	const handler = handlers[options.action];
	if (!handler)
		throw new Error(
			"benchmark action must be prepare, fresh-track, mint-local, prediction, workspace, run, grade, plan, calibrate, gate, livecodebench-plan, livecodebench-report, or terminal-preflight.",
		);
	const result = await handler(options);
	write(`${JSON.stringify(result, null, options.json ? 2 : 2)}\n`);
}
