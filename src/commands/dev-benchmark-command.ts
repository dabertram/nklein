import { execFile as execFileCallback } from "node:child_process";
import { link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	assertCandidateCalibration,
	type BenchmarkAttempt,
	type BenchmarkAttemptStatus,
	buildLeakageSafeBenchmarkTask,
	buildSwebenchPrediction,
	calibrateGoldAttempts,
	evaluateResolvedSetRegression,
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
import { resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox-docker";
import { materializeSwebenchWorkspace } from "../nklein-agent/nklein-swebench-workspace";
import { loadWorkspaceContext } from "../state/workspace-state";
import {
	captureBenchmarkWorkspaceResult,
	verifySealedBenchmarkWorkspace,
} from "../workspace/repository-benchmark-result";
import { createDevRuntimeClient, executeDevTestScenario } from "./dev-project-execution";

const execFile = promisify(execFileCallback);

export interface DevBenchmarkOptions {
	action: string;
	dataset?: string;
	datasetName?: string;
	split?: string;
	source?: string;
	output?: string;
	instance?: string;
	instanceIds?: string;
	difficulty?: string;
	freshAfter?: string;
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
	maxWorkers?: string;
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
	plan?: boolean;
	execute?: boolean;
	replace?: boolean;
	json?: boolean;
	write?: (text: string) => void;
}

export interface BenchmarkTaskExecutionInput {
	workspacePath: string;
	task: ReturnType<typeof buildLeakageSafeBenchmarkTask>;
	runId: string;
	modelId?: string;
	providerId?: string;
	startInPlanMode: boolean;
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
	if (source === "swebench_legacy" || source === "swebench_live" || source === "local_minted") return source;
	throw new Error("--source must be swebench_legacy, swebench_live, or local_minted.");
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

function selectionFromOptions(options: DevBenchmarkOptions) {
	return {
		instanceIds: csv(options.instanceIds),
		difficulties: parseDifficulties(options.difficulty),
		freshAfter: options.freshAfter,
		limit: integer(options.limit, "limit"),
	};
}

async function prepare(options: DevBenchmarkOptions) {
	if (!options.output) throw new Error("benchmark prepare requires --output <manifest.json>.");
	const selected = selectSwebenchInstances(await loadDataset(options), selectionFromOptions(options));
	const tasks = selected.map(buildLeakageSafeBenchmarkTask);
	const output = resolve(options.output);
	await atomicWrite(output, `${JSON.stringify({ schemaVersion: 1, tasks }, null, 2)}\n`);
	return { action: "prepare", output, selected: tasks.length, instanceIds: tasks.map((task) => task.instanceId) };
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
	const scenario = {
		id: `benchmark-${input.task.instanceId}`,
		title: `Repair ${input.task.repo} (${input.task.instanceId})`,
		prompt: input.task.prompt,
		specification: input.task.prompt,
		// Deliberately unused: the private benchmark oracle runs later in the official external grader.
		acceptanceCommand: "",
	};
	const execution = await executeDevTestScenario({
		client: createDevRuntimeClient(workspace.workspaceId),
		workspaceId: workspace.workspaceId,
		scenario,
		baseRef: "benchmark-baseline",
		seedTaskId: input.runId,
		startInPlanMode: input.startInPlanMode,
		...(input.modelId
			? { nkleinSettings: { providerId: input.providerId?.trim() || "lmstudio", modelId: input.modelId } }
			: {}),
		...(typeof input.pollIntervalMs === "number" ? { pollIntervalMs: input.pollIntervalMs } : {}),
		...(typeof input.maxWaitMs === "number" ? { maxWaitMs: input.maxWaitMs } : {}),
	});
	if (!execution.result.started) {
		throw new Error(`!Klein benchmark task did not start: ${execution.result.startMessage ?? "unknown error"}.`);
	}
	if (execution.result.classification.outcome !== "acceptance_not_run") {
		throw new Error(`!Klein benchmark workflow did not complete: ${execution.result.classification.summary}`);
	}
	const captured = await captureBenchmarkWorkspaceResult({
		repoPath: input.workspacePath,
		baseCommit: sealed.baseCommit,
		runId: input.runId,
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
	const instances = await loadDataset(options);
	const instance = instances.find((entry) => entry.instanceId === options.instance);
	if (!instance) throw new Error(`Benchmark instance ${options.instance} is not present in the local dataset.`);
	const task = buildLeakageSafeBenchmarkTask(instance);
	if (!/^[A-Za-z0-9_.-]+$/u.test(options.runId)) {
		throw new Error("--run-id must contain only letters, digits, dot, underscore, or hyphen.");
	}
	const workspacePath = join(resolve(options.workspaceParent), resolveSwebenchWorkspaceName(instance.instanceId));
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
		runId: options.runId,
		startInPlanMode: options.plan !== false,
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
		startInPlanMode: options.plan !== false,
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

async function workspace(options: DevBenchmarkOptions) {
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
		runDocker: async (args) => {
			try {
				const result = await execFile("docker", [...args], { maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000 });
				return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
			} catch (error) {
				const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
				return {
					exitCode: typeof failure.code === "number" ? failure.code : 1,
					stdout: failure.stdout ?? "",
					stderr: failure.stderr ?? failure.message,
				};
			}
		},
	});
	return { action: "workspace", ...result, instanceId: instance.instanceId };
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

export async function runDevBenchmarkCommand(
	options: DevBenchmarkOptions,
	deps: DevBenchmarkCommandDeps = {},
): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const handlers: Record<string, (value: DevBenchmarkOptions) => Promise<unknown>> = {
		prepare,
		prediction,
		workspace,
		run: (value) => run(value, deps),
		plan,
		calibrate,
		gate,
	};
	const handler = handlers[options.action];
	if (!handler)
		throw new Error("benchmark action must be prepare, prediction, workspace, run, plan, calibrate, or gate.");
	const result = await handler(options);
	write(`${JSON.stringify(result, null, options.json ? 2 : 2)}\n`);
}
