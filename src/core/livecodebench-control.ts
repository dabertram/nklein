import { assertLocalModelBaseUrl } from "./local-model-base-url";

export { assertLocalModelBaseUrl } from "./local-model-base-url";

export const PINNED_LIVECODEBENCH_COMMIT = "28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24";
export const PINNED_LIVECODEBENCH_RELEASE = "release_v6";
export const LIVECODEBENCH_CONTROL_SCENARIO = "codegeneration";

export type LiveCodeBenchCutoffStatus = "post_cutoff" | "mixed_cutoff" | "pre_or_at_cutoff";

export interface LiveCodeBenchControlPlan {
	schemaVersion: 1;
	kind: "model_capability_control";
	harnessCommit: string;
	release: string;
	scenario: string;
	model: string;
	modelCutoff: string;
	startDate: string;
	endDate: string;
	cutoffStatus: LiveCodeBenchCutoffStatus;
	claim: string;
	generation: {
		command: string;
		args: readonly string[];
		cwd: string;
		env: Readonly<Record<string, string>>;
		outputPath: string;
	};
	evaluation: {
		command: string;
		args: readonly string[];
		cwd: string;
		env: Readonly<Record<string, string>>;
		metricsPath: string;
		evalAllPath: string;
	};
}

export interface LiveCodeBenchControlReport {
	schemaVersion: 1;
	kind: "model_capability_control";
	harnessCommit: string;
	release: string;
	scenario: string;
	model: string;
	modelCutoff: string;
	startDate: string;
	endDate: string;
	cutoffStatus: LiveCodeBenchCutoffStatus;
	claim: string;
	totalProblems: number;
	resolvedProblems: number;
	passAt1: number;
	generationSha256: string;
	metricsSha256: string;
	evalAllSha256: string;
}

function date(value: string, label: string): { day: string; time: number } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
	const time = Date.parse(`${value}T00:00:00.000Z`);
	if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
		throw new Error(`${label} must be a real calendar date.`);
	}
	return { day: value, time };
}

function safeAbsolutePath(value: string, label: string): string {
	if (!value.startsWith("/") || value.includes("\0") || value.includes("\n")) {
		throw new Error(`${label} must be a safe absolute path.`);
	}
	return value;
}

function safeValue(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized || normalized.includes("\0") || normalized.includes("\n")) {
		throw new Error(`${label} must be a non-empty single-line value.`);
	}
	return normalized;
}

export function classifyLiveCodeBenchWindow(input: { modelCutoff: string; startDate: string; endDate: string }): {
	modelCutoff: string;
	startDate: string;
	endDate: string;
	status: LiveCodeBenchCutoffStatus;
	claim: string;
} {
	const cutoff = date(input.modelCutoff, "modelCutoff");
	const start = date(input.startDate, "startDate");
	const end = date(input.endDate, "endDate");
	if (start.time > end.time) throw new Error("LiveCodeBench startDate must not be after endDate.");
	const status: LiveCodeBenchCutoffStatus =
		start.time > cutoff.time ? "post_cutoff" : end.time > cutoff.time ? "mixed_cutoff" : "pre_or_at_cutoff";
	const claim =
		status === "post_cutoff"
			? "Post-cutoff direct coding-capability control; never a repository-agent or workflow score."
			: "Contamination-limited direct coding-capability control; use only as a matched control, never as fresh or repository-agent evidence.";
	return { modelCutoff: cutoff.day, startDate: start.day, endDate: end.day, status, claim };
}

export function planLiveCodeBenchControl(input: {
	pythonPath: string;
	harnessPath: string;
	runnerPath: string;
	apiBaseUrl: string;
	model: string;
	modelCutoff: string;
	startDate: string;
	endDate: string;
	outputPath: string;
	maxTokens?: number;
	timeoutSeconds?: number;
	evaluationWorkers?: number;
}): LiveCodeBenchControlPlan {
	const pythonPath = safeAbsolutePath(input.pythonPath, "pythonPath");
	const harnessPath = safeAbsolutePath(input.harnessPath, "harnessPath");
	const runnerPath = safeAbsolutePath(input.runnerPath, "runnerPath");
	const outputPath = safeAbsolutePath(input.outputPath, "outputPath");
	if (!outputPath.endsWith(".json")) throw new Error("LiveCodeBench outputPath must end in .json.");
	const apiBaseUrl = assertLocalModelBaseUrl(input.apiBaseUrl);
	const model = safeValue(input.model, "model");
	const window = classifyLiveCodeBenchWindow(input);
	const maxTokens = input.maxTokens ?? 4_096;
	const timeoutSeconds = input.timeoutSeconds ?? 300;
	const evaluationWorkers = input.evaluationWorkers ?? 4;
	for (const [label, value] of [
		["maxTokens", maxTokens],
		["timeoutSeconds", timeoutSeconds],
		["evaluationWorkers", evaluationWorkers],
	] as const) {
		if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
	}
	const outputStem = outputPath.slice(0, -5);
	const env = { HF_DATASETS_OFFLINE: "1", HF_HUB_OFFLINE: "1" } as const;
	return {
		schemaVersion: 1,
		kind: "model_capability_control",
		harnessCommit: PINNED_LIVECODEBENCH_COMMIT,
		release: PINNED_LIVECODEBENCH_RELEASE,
		scenario: LIVECODEBENCH_CONTROL_SCENARIO,
		model,
		modelCutoff: window.modelCutoff,
		startDate: window.startDate,
		endDate: window.endDate,
		cutoffStatus: window.status,
		claim: window.claim,
		generation: {
			command: pythonPath,
			args: [
				runnerPath,
				"--harness",
				harnessPath,
				"--api-base-url",
				apiBaseUrl,
				"--model",
				model,
				"--release-version",
				PINNED_LIVECODEBENCH_RELEASE,
				"--start-date",
				window.startDate,
				"--end-date",
				window.endDate,
				"--max-tokens",
				String(maxTokens),
				"--request-timeout",
				String(timeoutSeconds),
				"--output",
				outputPath,
			],
			cwd: harnessPath,
			env,
			outputPath,
		},
		evaluation: {
			command: pythonPath,
			args: [
				"-m",
				"lcb_runner.runner.custom_evaluator",
				"--custom_output_file",
				outputPath,
				"--scenario",
				LIVECODEBENCH_CONTROL_SCENARIO,
				"--release_version",
				PINNED_LIVECODEBENCH_RELEASE,
				"--start_date",
				window.startDate,
				"--end_date",
				window.endDate,
				"--num_process_evaluate",
				String(evaluationWorkers),
			],
			cwd: harnessPath,
			env,
			metricsPath: `${outputStem}_codegeneration_output_eval.json`,
			evalAllPath: `${outputStem}_codegeneration_output_eval_all.json`,
		},
	};
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

export function buildLiveCodeBenchControlReport(input: {
	metrics: unknown;
	evalAll: unknown;
	model: string;
	modelCutoff: string;
	startDate: string;
	endDate: string;
	generationSha256: string;
	metricsSha256: string;
	evalAllSha256: string;
}): LiveCodeBenchControlReport {
	if (!Array.isArray(input.metrics) || input.metrics.length < 1) {
		throw new Error("LiveCodeBench official metrics must be a non-empty array.");
	}
	const summary = record(input.metrics[0], "LiveCodeBench metrics summary");
	const passAt1 = summary["pass@1"];
	if (typeof passAt1 !== "number" || !Number.isFinite(passAt1) || passAt1 < 0 || passAt1 > 1) {
		throw new Error("LiveCodeBench official pass@1 must be a finite fraction from 0 to 1.");
	}
	if (!Array.isArray(input.evalAll) || input.evalAll.length === 0) {
		throw new Error("LiveCodeBench eval-all report must contain at least one problem.");
	}
	const ids = new Set<string>();
	let resolvedProblems = 0;
	for (const [index, raw] of input.evalAll.entries()) {
		const item = record(raw, `LiveCodeBench eval-all item ${index}`);
		const questionId = item.question_id;
		if ((typeof questionId !== "string" && typeof questionId !== "number") || String(questionId).length === 0) {
			throw new Error(`LiveCodeBench eval-all item ${index} has no question_id.`);
		}
		const id = String(questionId);
		if (ids.has(id)) throw new Error(`LiveCodeBench eval-all contains duplicate question_id ${id}.`);
		ids.add(id);
		const grades = item.graded_list;
		if (!Array.isArray(grades) || grades.length !== 1 || typeof grades[0] !== "boolean") {
			throw new Error(`LiveCodeBench eval-all item ${id} must contain exactly one boolean grade.`);
		}
		if (grades[0]) resolvedProblems += 1;
	}
	const observedPassAt1 = resolvedProblems / input.evalAll.length;
	if (Math.abs(observedPassAt1 - passAt1) > 1e-12) {
		throw new Error(
			`LiveCodeBench metrics mismatch: official pass@1=${passAt1}, eval-all implies ${observedPassAt1}.`,
		);
	}
	const hashes = [input.generationSha256, input.metricsSha256, input.evalAllSha256];
	if (hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
		throw new Error("LiveCodeBench evidence hashes must be SHA-256 hex.");
	const window = classifyLiveCodeBenchWindow(input);
	return {
		schemaVersion: 1,
		kind: "model_capability_control",
		harnessCommit: PINNED_LIVECODEBENCH_COMMIT,
		release: PINNED_LIVECODEBENCH_RELEASE,
		scenario: LIVECODEBENCH_CONTROL_SCENARIO,
		model: safeValue(input.model, "model"),
		modelCutoff: window.modelCutoff,
		startDate: window.startDate,
		endDate: window.endDate,
		cutoffStatus: window.status,
		claim: window.claim,
		totalProblems: input.evalAll.length,
		resolvedProblems,
		passAt1,
		generationSha256: input.generationSha256,
		metricsSha256: input.metricsSha256,
		evalAllSha256: input.evalAllSha256,
	};
}
