/**
 * F11.3 — pure, source-agnostic repository-benchmark substrate.
 *
 * SWE-bench remains a compatibility adapter, not !Klein's measurement strategy. The later P20.9 evidence policy
 * chooses the actual benchmark mix. This module owns the invariants shared by legacy SWE-bench, SWE-bench-Live and
 * private SWE-smith-style instances: no answer leakage, deterministic selection, official external grading, native
 * ARM execution, gold calibration, and resolved→unresolved regression gates.
 */

export const PINNED_SWEBENCH_VERSION = "4.1.0";
export const PINNED_SWEBENCH_LIVE_HARNESS_COMMIT = "70ec57e852e3f2d195790fe71f553e272c691833";
export const PINNED_SWEBENCH_LIVE_REPOLAUNCH_COMMIT = "7735b1e7363dd3bbc69bd0ef80db646a2ae391fd";
export const MAX_BENCHMARK_DATASET_BYTES = 256 * 1024 * 1024;
export const MAX_SWEBENCH_WORKERS = 4;

export type SwebenchDifficulty = "under_15m" | "15m_to_1h" | "1h_to_4h" | "over_4h" | "unknown";
export type RepositoryBenchmarkSource =
	| "swebench_legacy"
	| "swebench_live"
	| "swe_rebench"
	| "local_minted"
	| "aider_polyglot";

export interface LocalMintOracle {
	image: string;
	testCommand: string;
	testFiles: readonly string[];
	solutionFiles: readonly string[];
}

export interface SwebenchInstance {
	instanceId: string;
	repo: string;
	baseCommit: string;
	problemStatement: string;
	testPatch: string;
	goldPatch: string;
	hintsText: string;
	failToPass: readonly string[];
	passToPass: readonly string[];
	difficulty: SwebenchDifficulty;
	source: RepositoryBenchmarkSource;
	createdAt: string | null;
	localOracle: LocalMintOracle | null;
}

export interface LeakageSafeBenchmarkTask {
	instanceId: string;
	repo: string;
	baseCommit: string;
	prompt: string;
	source: RepositoryBenchmarkSource;
	difficulty: SwebenchDifficulty;
	createdAt: string | null;
}

export interface SwebenchPrediction {
	instance_id: string;
	model_name_or_path: string;
	model_patch: string;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`SWE-bench instance requires non-empty string field ${key}.`);
	}
	return value;
}

function optionalString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (value == null) return "";
	if (typeof value !== "string") throw new Error(`SWE-bench field ${key} must be a string when present.`);
	return value;
}

function stringList(record: Record<string, unknown>, key: string): readonly string[] {
	const raw = record[key];
	let value: unknown = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			throw new Error(`SWE-bench field ${key} must be a JSON string array.`);
		}
	}
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
		throw new Error(`SWE-bench field ${key} must be a non-empty-string array.`);
	}
	return [...new Set(value as string[])];
}

export function normalizeSwebenchDifficulty(value: unknown): SwebenchDifficulty {
	if (typeof value !== "string") return "unknown";
	const normalized = value.toLowerCase().replaceAll(" ", "").replaceAll("–", "-").replaceAll("—", "-");
	if (normalized.includes("<15min") || normalized.includes("under15min")) return "under_15m";
	if (normalized.includes("15min-1hr") || normalized.includes("15m-1h")) return "15m_to_1h";
	if (normalized.includes("1-4hr") || normalized.includes("1h-4h")) return "1h_to_4h";
	if (normalized.includes(">4hr") || normalized.includes("over4hr")) return "over_4h";
	return "unknown";
}

function parseDate(value: unknown): string | null {
	if (value == null || value === "") return null;
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new Error("SWE-bench created_at must be an ISO-compatible date string when present.");
	}
	return new Date(value).toISOString();
}

function parseLocalMintOracle(value: unknown, source: RepositoryBenchmarkSource): LocalMintOracle | null {
	if (source !== "local_minted") return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Local-minted instance requires a local_oracle object.");
	}
	const record = value as Record<string, unknown>;
	const image = requiredString(record, "image");
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(image)) {
		throw new Error("Local-minted oracle image must use a semantic-version tag or immutable digest.");
	}
	const testFiles = stringList(record, "test_files");
	if (testFiles.length === 0) throw new Error("Local-minted oracle requires at least one protected test file.");
	const solutionFiles = stringList(record, "solution_files");
	if (solutionFiles.length === 0) throw new Error("Local-minted oracle requires at least one solution file.");
	const protectedFiles = new Set(testFiles);
	if (solutionFiles.some((path) => protectedFiles.has(path))) {
		throw new Error("Local-minted oracle solution_files and test_files must not overlap.");
	}
	return {
		image,
		testCommand: requiredString(record, "test_command"),
		testFiles,
		solutionFiles,
	};
}

export function parseSwebenchInstance(
	value: unknown,
	source: RepositoryBenchmarkSource = "swebench_legacy",
): SwebenchInstance {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("SWE-bench instance must be an object.");
	const record = value as Record<string, unknown>;
	return {
		instanceId: requiredString(record, "instance_id"),
		repo: requiredString(record, "repo"),
		baseCommit: requiredString(record, "base_commit"),
		problemStatement: requiredString(record, "problem_statement"),
		testPatch: optionalString(record, "test_patch"),
		goldPatch: optionalString(record, "patch"),
		hintsText: optionalString(record, "hints_text"),
		failToPass: stringList(record, "FAIL_TO_PASS"),
		passToPass: stringList(record, "PASS_TO_PASS"),
		difficulty: normalizeSwebenchDifficulty(record.difficulty),
		source,
		createdAt: parseDate(record.created_at ?? record.createdAt),
		localOracle: parseLocalMintOracle(record.local_oracle, source),
	};
}

export function parseSwebenchDataset(
	text: string,
	source: RepositoryBenchmarkSource = "swebench_legacy",
): readonly SwebenchInstance[] {
	if (Buffer.byteLength(text, "utf8") > MAX_BENCHMARK_DATASET_BYTES) {
		throw new Error(`Benchmark dataset exceeds the ${MAX_BENCHMARK_DATASET_BYTES}-byte local ingestion limit.`);
	}
	const trimmed = text.trim();
	if (!trimmed) return [];
	let rows: unknown[];
	if (trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed)) throw new Error("Benchmark JSON root must be an array.");
		rows = parsed;
	} else {
		rows = trimmed.split(/\r?\n/u).map((line, index) => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				throw new Error(`Invalid benchmark JSONL at line ${index + 1}.`);
			}
		});
	}
	const instances = rows.map((row) => parseSwebenchInstance(row, source));
	const ids = new Set<string>();
	for (const instance of instances) {
		if (ids.has(instance.instanceId)) throw new Error(`Duplicate benchmark instance_id ${instance.instanceId}.`);
		ids.add(instance.instanceId);
	}
	return instances;
}

export function buildLeakageSafeBenchmarkTask(instance: SwebenchInstance): LeakageSafeBenchmarkTask {
	const prompt = instance.problemStatement.trim();
	for (const [name, secret] of [
		["gold patch", instance.goldPatch],
		["hints", instance.hintsText],
		["test patch", instance.testPatch],
	] as const) {
		if (secret.trim().length >= 24 && prompt.includes(secret.trim())) {
			throw new Error(`Benchmark problem_statement duplicates withheld ${name}; quarantine ${instance.instanceId}.`);
		}
	}
	return {
		instanceId: instance.instanceId,
		repo: instance.repo,
		baseCommit: instance.baseCommit,
		prompt,
		source: instance.source,
		difficulty: instance.difficulty,
		createdAt: instance.createdAt,
	};
}

export interface SwebenchSelection {
	instanceIds?: readonly string[];
	difficulties?: readonly SwebenchDifficulty[];
	freshAfter?: string;
	limit?: number;
}

export function selectSwebenchInstances(
	instances: readonly SwebenchInstance[],
	selection: SwebenchSelection,
): readonly SwebenchInstance[] {
	const requested = selection.instanceIds ? new Set(selection.instanceIds) : null;
	const difficulties = selection.difficulties ? new Set(selection.difficulties) : null;
	const freshAfter = selection.freshAfter ? Date.parse(selection.freshAfter) : null;
	if (freshAfter !== null && !Number.isFinite(freshAfter))
		throw new Error("freshAfter must be an ISO-compatible date.");
	const limit = selection.limit;
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		throw new Error("Benchmark selection limit must be a positive integer.");
	}

	const selected = [...instances]
		.filter((instance) => !requested || requested.has(instance.instanceId))
		.filter((instance) => !difficulties || difficulties.has(instance.difficulty))
		.filter(
			(instance) =>
				freshAfter === null || (instance.createdAt !== null && Date.parse(instance.createdAt) >= freshAfter),
		)
		.sort((left, right) => left.instanceId.localeCompare(right.instanceId))
		.slice(0, limit ?? instances.length);
	if (requested) {
		const found = new Set(selected.map((instance) => instance.instanceId));
		const missing = [...requested].filter((id) => !found.has(id));
		if (missing.length > 0)
			throw new Error(`Requested benchmark instance(s) unavailable after filters: ${missing.join(", ")}.`);
	}
	return selected;
}

export function buildSwebenchPrediction(input: {
	instanceId: string;
	modelNameOrPath: string;
	modelPatch: string;
}): SwebenchPrediction {
	if (!input.instanceId.trim()) throw new Error("Prediction instanceId is required.");
	if (!input.modelNameOrPath.trim()) throw new Error("Prediction modelNameOrPath is required.");
	return {
		instance_id: input.instanceId,
		model_name_or_path: input.modelNameOrPath,
		model_patch: input.modelPatch,
	};
}

export function serializeSwebenchPredictions(predictions: readonly SwebenchPrediction[]): string {
	const ids = new Set<string>();
	for (const prediction of predictions) {
		if (ids.has(prediction.instance_id)) throw new Error(`Duplicate prediction for ${prediction.instance_id}.`);
		ids.add(prediction.instance_id);
	}
	return predictions.map((prediction) => JSON.stringify(prediction)).join("\n") + (predictions.length > 0 ? "\n" : "");
}

/** The native Live harness consumes one JSON object keyed by instance id, not standard SWE-bench JSONL. */
export function serializeSwebenchLivePredictions(predictions: readonly SwebenchPrediction[]): string {
	const entries = [...predictions]
		.sort((left, right) => left.instance_id.localeCompare(right.instance_id))
		.map((prediction) => [
			prediction.instance_id,
			{
				model_patch: prediction.model_patch,
				model_name_or_path: prediction.model_name_or_path,
			},
		]);
	if (new Set(entries.map(([instanceId]) => instanceId)).size !== entries.length) {
		throw new Error("Duplicate prediction in SWE-bench-Live patch map.");
	}
	return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

function normalizeArchitecture(value: string): "arm64" | "x64" | "unknown" {
	const normalized = value.toLowerCase();
	if (normalized === "arm64" || normalized === "aarch64") return "arm64";
	if (normalized === "x64" || normalized === "x86_64" || normalized === "amd64") return "x64";
	return "unknown";
}

export interface OfficialSwebenchEvaluationPlan {
	command: string;
	args: readonly string[];
	nativeArchitecture: boolean;
	warnings: readonly string[];
	cwd?: string;
	harness?: "swebench_legacy" | "swebench_live";
}

export function planOfficialSwebenchEvaluation(input: {
	pythonPath: string;
	datasetName: string;
	predictionsPath: string | "gold";
	runId: string;
	instanceIds: readonly string[];
	reportDir: string;
	split?: string;
	maxWorkers?: number;
	timeoutSeconds?: number;
	hostArchitecture: string;
	dockerArchitecture: string;
}): OfficialSwebenchEvaluationPlan {
	const maxWorkers = input.maxWorkers ?? 2;
	if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > MAX_SWEBENCH_WORKERS) {
		throw new Error(
			`maxWorkers must be between 1 and ${MAX_SWEBENCH_WORKERS}; benchmark parallelism is deliberately low.`,
		);
	}
	const timeout = input.timeoutSeconds ?? 900;
	if (!Number.isInteger(timeout) || timeout < 30)
		throw new Error("Benchmark timeoutSeconds must be an integer >= 30.");
	if (!/^[a-zA-Z0-9._-]+$/u.test(input.runId))
		throw new Error("runId may contain only letters, numbers, dot, underscore and dash.");
	if (input.instanceIds.length === 0)
		throw new Error("Official SWE-bench evaluation requires at least one instance id.");

	const host = normalizeArchitecture(input.hostArchitecture);
	const docker = normalizeArchitecture(input.dockerArchitecture);
	const nativeArchitecture = host !== "unknown" && host === docker;
	const warnings: string[] = [];
	if (!nativeArchitecture) {
		warnings.push(
			`Docker architecture ${docker} differs from host ${host}; results are QEMU/emulation-tainted and not regression-comparable.`,
		);
	}

	const args = [
		"-m",
		"swebench.harness.run_evaluation",
		"--dataset_name",
		input.datasetName,
		"--split",
		input.split ?? "test",
		"--predictions_path",
		input.predictionsPath,
		"--max_workers",
		String(maxWorkers),
		"--run_id",
		input.runId,
		"--timeout",
		String(timeout),
		"--report_dir",
		input.reportDir,
		"--instance_ids",
		...input.instanceIds,
	];
	if (host === "arm64") {
		// Official SWE-bench guidance: empty namespace forces local, native image builds on M-series hosts.
		args.push("--namespace", "");
	}
	return { command: input.pythonPath, args, nativeArchitecture, warnings, harness: "swebench_legacy" };
}

/** Plan the distinct official SWE-bench-Live evaluator; its arbitrary repositories are not supported by swebench 4.x. */
export function planOfficialSwebenchLiveEvaluation(input: {
	pythonPath: string;
	harnessPath: string;
	datasetPath: string;
	predictionsPath: string | "gold";
	instanceIds: readonly string[];
	reportDir: string;
	maxWorkers?: number;
	hostArchitecture: string;
	dockerArchitecture: string;
}): OfficialSwebenchEvaluationPlan {
	const maxWorkers = input.maxWorkers ?? 1;
	if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > MAX_SWEBENCH_WORKERS) {
		throw new Error(
			`maxWorkers must be between 1 and ${MAX_SWEBENCH_WORKERS}; benchmark parallelism is deliberately low.`,
		);
	}
	if (input.instanceIds.length === 0) {
		throw new Error("Official SWE-bench-Live evaluation requires at least one instance id.");
	}
	for (const [name, path] of [
		["harnessPath", input.harnessPath],
		["datasetPath", input.datasetPath],
		["reportDir", input.reportDir],
	] as const) {
		if (!path.startsWith("/")) throw new Error(`${name} must be absolute.`);
	}
	const host = normalizeArchitecture(input.hostArchitecture);
	const docker = normalizeArchitecture(input.dockerArchitecture);
	// The official Live Linux corpus publishes only x86_64 instance images. An ARM Docker daemon can emulate them,
	// but such runs are useful smoke evidence only and must never become a regression baseline.
	const nativeArchitecture = host === "x64" && docker === "x64";
	const warnings = nativeArchitecture
		? []
		: [
				`SWE-bench-Live publishes x86_64 Linux images; host ${host} with Docker ${docker} is QEMU/emulation-tainted and not regression-comparable.`,
			];
	return {
		command: input.pythonPath,
		args: [
			"-m",
			"evaluation.evaluation",
			"--dataset",
			input.datasetPath,
			"--platform",
			"linux",
			"--patch_dir",
			input.predictionsPath,
			"--output_dir",
			input.reportDir,
			"--workers",
			String(maxWorkers),
			"--overwrite",
			"0",
			"--instance_ids",
			...input.instanceIds,
		],
		nativeArchitecture,
		warnings,
		cwd: input.harnessPath,
		harness: "swebench_live",
	};
}

export type BenchmarkAttemptStatus = "resolved" | "unresolved" | "error";
export interface BenchmarkAttempt {
	instanceId: string;
	repeat: number;
	status: BenchmarkAttemptStatus;
}

function reportIdList(record: Record<string, unknown>, key: string): readonly string[] {
	const value = record[key] ?? [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
		throw new Error(`Official SWE-bench report field ${key} must be a string array.`);
	}
	return value as string[];
}

/** Convert the official schema-v2 run report into the only status map the delta gate consumes. */
export function parseOfficialSwebenchRunReport(value: unknown): Readonly<Record<string, BenchmarkAttemptStatus>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Official SWE-bench report must be an object.");
	const record = value as Record<string, unknown>;
	const isLegacy = record.schema_version === 2;
	const isLive = record.schema_version === undefined && Array.isArray(record.success_ids);
	const isHeldOutLocal = record.schema_version === "aider_polyglot_v1" || record.schema_version === "local_minted_v1";
	if (!isLegacy && !isLive && !isHeldOutLocal) {
		throw new Error(
			"Benchmark report must be SWE-bench schema-v2, native SWE-bench-Live results JSON, Aider polyglot v1, or local-minted v1.",
		);
	}
	const usesLegacyStatusKeys = isLegacy || isHeldOutLocal;
	const groups: readonly [BenchmarkAttemptStatus, readonly string[]][] = [
		["resolved", reportIdList(record, usesLegacyStatusKeys ? "resolved_ids" : "success_ids")],
		[
			"unresolved",
			[
				...reportIdList(record, usesLegacyStatusKeys ? "unresolved_ids" : "failure_ids"),
				...reportIdList(record, "empty_patch_ids"),
			],
		],
		["error", [...reportIdList(record, "error_ids"), ...reportIdList(record, "incomplete_ids")]],
	];
	const statuses: Record<string, BenchmarkAttemptStatus> = {};
	for (const [status, ids] of groups) {
		for (const id of ids) {
			if (statuses[id]) throw new Error(`Official SWE-bench report classifies ${id} more than once.`);
			statuses[id] = status;
		}
	}
	for (const id of reportIdList(record, "submitted_ids")) {
		if (!statuses[id]) statuses[id] = "error";
	}
	return statuses;
}

export interface GoldCalibration {
	stableInstanceIds: readonly string[];
	quarantined: Readonly<Record<string, string>>;
}

export function assertCandidateCalibration(instanceIds: readonly string[], value: unknown): void {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Calibration file must be an object.");
	const stableInstanceIds = (value as Record<string, unknown>).stableInstanceIds;
	if (!Array.isArray(stableInstanceIds)) throw new Error("Calibration file lacks stableInstanceIds.");
	const stable = new Set(stableInstanceIds.filter((id): id is string => typeof id === "string"));
	const uncalibrated = instanceIds.filter((id) => !stable.has(id));
	if (uncalibrated.length > 0) {
		throw new Error(`Candidate execution contains uncalibrated/quarantined instance(s): ${uncalibrated.join(", ")}.`);
	}
}

export function calibrateGoldAttempts(
	instanceIds: readonly string[],
	attempts: readonly BenchmarkAttempt[],
	minimumRepeats = 2,
): GoldCalibration {
	if (!Number.isInteger(minimumRepeats) || minimumRepeats < 2)
		throw new Error("Gold calibration requires at least two repeats.");
	for (const attempt of attempts) {
		if (!Number.isInteger(attempt.repeat) || attempt.repeat < 1) {
			throw new Error(`Gold attempt for ${attempt.instanceId} has an invalid repeat number.`);
		}
		if (attempt.status !== "resolved" && attempt.status !== "unresolved" && attempt.status !== "error") {
			throw new Error(`Gold attempt for ${attempt.instanceId} has an invalid status.`);
		}
	}
	const stable: string[] = [];
	const quarantined: Record<string, string> = {};
	for (const instanceId of [...new Set(instanceIds)].sort()) {
		const rows = attempts.filter((attempt) => attempt.instanceId === instanceId);
		const repeats = new Set(rows.map((row) => row.repeat));
		if (rows.length < minimumRepeats || repeats.size < minimumRepeats) {
			quarantined[instanceId] = `only ${repeats.size}/${minimumRepeats} distinct gold repeats completed`;
			continue;
		}
		if (rows.some((row) => row.status === "error")) {
			quarantined[instanceId] = "gold evaluation produced an infrastructure/grader error";
			continue;
		}
		if (rows.some((row) => row.status !== "resolved")) {
			quarantined[instanceId] = "gold patch was unresolved or flip-flopped";
			continue;
		}
		stable.push(instanceId);
	}
	return { stableInstanceIds: stable, quarantined };
}

export interface BenchmarkRegressionGate {
	verdict: "pass" | "regression" | "inconclusive";
	regressedInstanceIds: readonly string[];
	inconclusiveInstanceIds: readonly string[];
}

export function evaluateResolvedSetRegression(input: {
	baseline: Readonly<Record<string, BenchmarkAttemptStatus>>;
	current: Readonly<Record<string, BenchmarkAttemptStatus>>;
	quarantinedInstanceIds?: readonly string[];
}): BenchmarkRegressionGate {
	for (const [label, statuses] of [
		["baseline", input.baseline],
		["current", input.current],
	] as const) {
		for (const [instanceId, status] of Object.entries(statuses)) {
			if (status !== "resolved" && status !== "unresolved" && status !== "error") {
				throw new Error(`${label} status for ${instanceId} is invalid.`);
			}
		}
	}
	const quarantine = new Set(input.quarantinedInstanceIds ?? []);
	const regressed: string[] = [];
	const inconclusive: string[] = [];
	for (const [instanceId, baselineStatus] of Object.entries(input.baseline).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		if (quarantine.has(instanceId) || baselineStatus !== "resolved") continue;
		const currentStatus = input.current[instanceId];
		if (currentStatus === "unresolved") regressed.push(instanceId);
		else if (currentStatus !== "resolved") inconclusive.push(instanceId);
	}
	return {
		verdict: regressed.length > 0 ? "regression" : inconclusive.length > 0 ? "inconclusive" : "pass",
		regressedInstanceIds: regressed,
		inconclusiveInstanceIds: inconclusive,
	};
}
