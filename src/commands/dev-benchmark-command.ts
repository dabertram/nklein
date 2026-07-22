import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
	type RepositoryBenchmarkSource,
	type SwebenchDifficulty,
	type SwebenchPrediction,
	selectSwebenchInstances,
	serializeSwebenchPredictions,
} from "../core/swebench-benchmark";
import { resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox-docker";
import { materializeSwebenchWorkspace } from "../nklein-agent/nklein-swebench-workspace";

const execFile = promisify(execFileCallback);

export interface DevBenchmarkOptions {
	action: string;
	dataset?: string;
	datasetName?: string;
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
	maxWorkers?: string;
	timeout?: string;
	attempts?: string;
	reports?: string;
	baseline?: string;
	current?: string;
	quarantine?: string;
	calibration?: string;
	execute?: boolean;
	replace?: boolean;
	json?: boolean;
	write?: (text: string) => void;
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

async function prediction(options: DevBenchmarkOptions) {
	if (!options.instance || !options.model || !options.patch || !options.output) {
		throw new Error("benchmark prediction requires --instance, --model, --patch <diff-file>, and --output <jsonl>.");
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
		modelPatch: await readFile(resolve(options.patch), "utf8"),
	});
	const duplicate = existing.findIndex((entry) => entry.instance_id === next.instance_id);
	if (duplicate >= 0 && !options.replace)
		throw new Error(`Prediction for ${next.instance_id} already exists; pass --replace deliberately.`);
	if (duplicate >= 0) existing.splice(duplicate, 1, next);
	else existing.push(next);
	existing.sort((left, right) => left.instance_id.localeCompare(right.instance_id));
	await atomicWrite(output, serializeSwebenchPredictions(existing));
	return { action: "prediction", output, predictionCount: existing.length, instanceId: next.instance_id };
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
	if (!options.datasetName || !options.predictions || !options.runId || !options.reportDir || !options.instanceIds) {
		throw new Error(
			"benchmark plan requires --dataset-name, --predictions, --run-id, --report-dir, and --instance-ids.",
		);
	}
	const dockerArchitecture = await execFile("docker", ["info", "--format", "{{.Architecture}}"], {
		timeout: 10_000,
	}).then((result) => result.stdout.trim());
	const instanceIds = csv(options.instanceIds) ?? [];
	const evaluation = planOfficialSwebenchEvaluation({
		pythonPath: resolve(options.python ?? "benchmark-harness/.venv/bin/python"),
		datasetName: options.datasetName,
		predictionsPath: options.predictions === "gold" ? "gold" : resolve(options.predictions),
		runId: options.runId,
		instanceIds,
		reportDir: resolve(options.reportDir),
		maxWorkers: integer(options.maxWorkers, "max-workers"),
		timeoutSeconds: integer(options.timeout, "timeout"),
		hostArchitecture: process.arch,
		dockerArchitecture,
	});
	if (options.execute) {
		if (options.predictions !== "gold") {
			if (!options.calibration) {
				throw new Error("Candidate execution requires --calibration from at least two gold repeats.");
			}
			assertCandidateCalibration(
				instanceIds,
				JSON.parse(await readFile(resolve(options.calibration), "utf8")) as unknown,
			);
		}
		await execFile(evaluation.command, [resolve("scripts/verify-swebench-grader.py")], { timeout: 30_000 });
		await mkdir(resolve(options.reportDir), { recursive: true });
		await execFile(evaluation.command, [...evaluation.args], {
			cwd: resolve(options.reportDir),
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
	return {
		action: "calibrate",
		...calibrateGoldAttempts(csv(options.instanceIds) ?? [], attempts),
	};
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

export async function runDevBenchmarkCommand(options: DevBenchmarkOptions): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const handlers: Record<string, (value: DevBenchmarkOptions) => Promise<unknown>> = {
		prepare,
		prediction,
		workspace,
		plan,
		calibrate,
		gate,
	};
	const handler = handlers[options.action];
	if (!handler) throw new Error("benchmark action must be prepare, prediction, workspace, plan, calibrate, or gate.");
	const result = await handler(options);
	write(`${JSON.stringify(result, null, options.json ? 2 : 2)}\n`);
}
