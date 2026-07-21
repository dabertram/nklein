/** F11.2h paired fleet gate: code-edit prompts without versus with production-selected in-repo exemplars. */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import { decideDefaultFlip, wilsonInterval } from "../src/core/ab-significance-gate.js";
import { summariseTrials, type Trial } from "../src/core/ab-trial-ordering.js";
import { assessComparability, type HarnessCard } from "../src/core/harness-card.js";
import { assessPreRegistration } from "../src/core/minimum-detectable-effect.js";
import {
	renderFewShotExemplarBlock,
	selectWorkspaceFewShotExemplars,
	type FewShotExemplar,
} from "../src/nklein-agent/nklein-few-shot-exemplars.js";

interface EvalCase {
	readonly args: readonly unknown[];
	readonly expected: unknown;
}

interface EvalTask {
	readonly id: string;
	readonly task: string;
	readonly functionName: string;
	readonly signature: string;
	readonly cases: readonly EvalCase[];
}

interface ModelLane {
	readonly model: string;
	readonly device: string;
}

interface ChatResult {
	readonly text: string | null;
	readonly responseChannel: "content" | "reasoning_content" | null;
	readonly durationMs: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly error: string | null;
}

interface ArmResult extends ChatResult {
	readonly arm: "a" | "b";
	readonly code: string | null;
	readonly extractionError: string | null;
	passed: boolean;
	testError: string | null;
}

interface RecordedPair {
	readonly model: string;
	readonly device: string;
	readonly taskId: string;
	readonly task: string;
	readonly exemplars: readonly Pick<FewShotExemplar, "path" | "name" | "lineStart" | "lineEnd" | "score">[];
	readonly baseline: ArmResult;
	readonly treatment: ArmResult;
}

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = resolve(ROOT, process.env.NKLEIN_FEWSHOT_AB_OUTPUT ?? "docs/dev/f11.2h-few-shot-code-edit-ab-2026-07-21.json");
const CHAT_URL = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1")
	.replace(/\/+$/, "")
	.replace(/\/chat\/completions$/, "");
const ENDPOINT = `${CHAT_URL.endsWith("/v1") ? CHAT_URL : `${CHAT_URL}/v1`}/chat/completions`;
const MODELS_ENDPOINT = `${CHAT_URL.endsWith("/v1") ? CHAT_URL : `${CHAT_URL}/v1`}/models`;
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_COMPLETION_TOKENS = 512;
const DECLARED_MDE_POINTS = 25;
const TARGET_PATH = "src/core/few-shot-eval-target.ts";
const SANDBOX_IMAGE = "nklein/agent-sandbox:0.0.1";

const DEFAULT_LANES: readonly ModelLane[] = [
	{ model: "qwen/qwen2.5-coder-14b", device: "m5max" },
	{ model: "phi-4-mini-instruct-m5max", device: "m5max" },
	{ model: "qwen/qwen3.6-35b-a3b", device: "m5max" },
	{ model: "qwen3.5-9b-mlx-m4", device: "m4mini" },
	{ model: "qwopus3.5-9b-coder-mtp", device: "legion5pro" },
];

const TASKS: readonly EvalTask[] = [
	{
		id: "normalize-paths",
		task:
			"Normalize workspace source file paths by trimming outer whitespace, replacing backslashes with forward slashes, and removing leading `./` segments. Drop empty normalized values and exact duplicates while preserving first-seen order.",
		functionName: "normalizeWorkspacePaths",
		signature: "export function normalizeWorkspacePaths(values: readonly string[]): string[]",
		cases: [
			{ args: [[" ./src/a.ts ", "src\\b.ts", "", "src/a.ts"]], expected: ["src/a.ts", "src/b.ts"] },
			{ args: [[]], expected: [] },
		],
	},
	{
		id: "clamp-retry-budget",
		task:
			"Truncate a finite retry budget toward zero, then clamp it inclusively from 1 through 8. For non-finite input, use the fallback argument (default 3).",
		functionName: "clampRetryBudget",
		signature: "export function clampRetryBudget(value: number, fallback?: number): number",
		cases: [
			{ args: [4.9], expected: 4 },
			{ args: [-2], expected: 1 },
			{ args: [99], expected: 8 },
			{ args: [Number.NaN, 5], expected: 5 },
		],
	},
	{
		id: "default-on-flag",
		task: "Parse a default-on environment feature flag; only 0, false, no, and off disable it after trim/lowercase.",
		functionName: "isFeatureEnabled",
		signature: "export function isFeatureEnabled(value?: string): boolean",
		cases: [
			{ args: [], expected: true },
			{ args: [" OFF "], expected: false },
			{ args: ["0"], expected: false },
			{ args: ["yes"], expected: true },
			{ args: [""], expected: true },
		],
	},
	{
		id: "model-label",
		task:
			"Trim provider and model and format them exactly as provider/model. Trim the optional endpoint and, only when non-empty, append exactly ` @ endpoint`.",
		functionName: "formatEndpointModelLabel",
		signature: "export function formatEndpointModelLabel(provider: string, model: string, endpoint?: string): string",
		cases: [
			{ args: [" lmstudio ", " qwen ", " http://host "], expected: "lmstudio/qwen @ http://host" },
			{ args: ["local", "phi", "  "], expected: "local/phi" },
		],
	},
	{
		id: "unique-tool-names",
		task: "Collect unique tool names, trimming and dropping empty values while preserving first-seen order.",
		functionName: "collectUniqueToolNames",
		signature: "export function collectUniqueToolNames(values: readonly string[]): string[]",
		cases: [
			{ args: [[" read ", "write", "read", "", " write"]], expected: ["read", "write"] },
			{ args: [[]], expected: [] },
		],
	},
	{
		id: "retry-delay",
		task:
			"Truncate the attempt index toward zero, clamp it to a minimum of zero, and choose delays [250, 1000, 4000, 10000] milliseconds by index; all indices above 3 use 10000.",
		functionName: "retryDelayMs",
		signature: "export function retryDelayMs(attempt: number): number",
		cases: [
			{ args: [-1], expected: 250 },
			{ args: [0], expected: 250 },
			{ args: [1.9], expected: 1000 },
			{ args: [2], expected: 4000 },
			{ args: [99], expected: 10000 },
		],
	},
	{
		id: "redact-bearer",
		task:
			"Replace every case-insensitive `bearer` scheme followed by whitespace and one non-whitespace token with exactly `Bearer [REDACTED]`; leave all other text unchanged.",
		functionName: "redactBearerTokens",
		signature: "export function redactBearerTokens(text: string): string",
		cases: [
			{ args: ["Authorization: Bearer abc.def"], expected: "Authorization: Bearer [REDACTED]" },
			{ args: ["bearer one and BEARER two"], expected: "Bearer [REDACTED] and Bearer [REDACTED]" },
			{ args: ["safe"], expected: "safe" },
		],
	},
	{
		id: "partition-outcomes",
		task: "Partition task outcomes into passed and failed id arrays while preserving input order.",
		functionName: "partitionTaskOutcomes",
		signature:
			"export function partitionTaskOutcomes(rows: readonly { id: string; passed: boolean }[]): { passed: string[]; failed: string[] }",
		cases: [
			{
				args: [[{ id: "a", passed: true }, { id: "b", passed: false }, { id: "c", passed: true }]],
				expected: { passed: ["a", "c"], failed: ["b"] },
			},
			{ args: [[]], expected: { passed: [], failed: [] } },
		],
	},
	{
		id: "positive-integer",
		task:
			"After trimming, accept only a string of base-10 digits whose numeric value is positive. Return the trusted fallback for missing, empty, fractional, or non-positive input; otherwise clamp the parsed integer to maximum.",
		functionName: "parsePositiveInteger",
		signature: "export function parsePositiveInteger(value: string | undefined, fallback: number, maximum: number): number",
		cases: [
			{ args: [" 7 ", 2, 10], expected: 7 },
			{ args: ["7.9", 2, 10], expected: 2 },
			{ args: ["0", 2, 10], expected: 2 },
			{ args: ["99", 2, 10], expected: 10 },
			{ args: [undefined, 2, 10], expected: 2 },
		],
	},
	{
		id: "truncate-text",
		task:
			"Return text unchanged when its length is at most maximum. Otherwise return exactly maximum characters with `…` as the final character; return an empty string when maximum is zero or less.",
		functionName: "truncateText",
		signature: "export function truncateText(value: string, maximum: number): string",
		cases: [
			{ args: ["hello", 5], expected: "hello" },
			{ args: ["hello!", 5], expected: "hell…" },
			{ args: ["hello", 1], expected: "…" },
			{ args: ["hello", 0], expected: "" },
		],
	},
	{
		id: "summarize-counts",
		task: "Summarize task outcomes into total, passed, and failed counts without mutating the input.",
		functionName: "summarizeOutcomeCounts",
		signature:
			"export function summarizeOutcomeCounts(rows: readonly { passed: boolean }[]): { total: number; passed: number; failed: number }",
		cases: [
			{ args: [[{ passed: true }, { passed: false }, { passed: true }]], expected: { total: 3, passed: 2, failed: 1 } },
			{ args: [[]], expected: { total: 0, passed: 0, failed: 0 } },
		],
	},
	{
		id: "merge-headers",
		task: "Merge base and override HTTP headers case-insensitively, with override spelling and value winning.",
		functionName: "mergeHeaders",
		signature:
			"export function mergeHeaders(base: Readonly<Record<string, string>>, overrides: Readonly<Record<string, string>>): Record<string, string>",
		cases: [
			{
				args: [{ Accept: "json", Authorization: "old" }, { authorization: "new", Trace: "1" }],
				expected: { Accept: "json", authorization: "new", Trace: "1" },
			},
			{ args: [{}, {}], expected: {} },
		],
	},
];

function parseLanes(): readonly ModelLane[] {
	const raw = process.env.NKLEIN_FEWSHOT_AB_MODELS?.trim();
	if (!raw) return DEFAULT_LANES;
	return raw.split(",").map((entry) => {
		const [device, ...parts] = entry.trim().split("=");
		const model = parts.join("=").trim();
		if (!device?.trim() || !model) throw new Error(`invalid lane ${entry}; expected device=model`);
		return { device: device.trim(), model };
	});
}

function selectedTasks(): readonly EvalTask[] {
	const limit = Number.parseInt(process.env.NKLEIN_FEWSHOT_AB_TASK_LIMIT ?? "", 10);
	return Number.isFinite(limit) && limit > 0 ? TASKS.slice(0, limit) : TASKS;
}

async function chat(model: string, messages: readonly { role: "system" | "user"; content: string }[]): Promise<ChatResult> {
	const started = performance.now();
	try {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model, messages, temperature: 0, max_tokens: MAX_COMPLETION_TOKENS }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const body = (await response.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
			error?: { message?: string } | string;
		};
		const message = body.choices?.[0]?.message;
		const content = message?.content?.trim();
		const reasoning = message?.reasoning_content?.trim();
		const text = content || reasoning || null;
		return {
			text,
			responseChannel: content ? "content" : reasoning ? "reasoning_content" : null,
			durationMs: Math.round(performance.now() - started),
			promptTokens: body.usage?.prompt_tokens ?? 0,
			completionTokens: body.usage?.completion_tokens ?? 0,
			error:
				response.ok && text
					? null
					: typeof body.error === "string"
						? body.error
						: body.error?.message ?? `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			text: null,
			responseChannel: null,
			durationMs: Math.round(performance.now() - started),
			promptTokens: 0,
			completionTokens: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function taskPrompt(task: EvalTask, exemplarBlock: string | null): string {
	return [
		"Implement one small TypeScript code edit for the target file below.",
		"Return ONLY the complete TypeScript code for the target file (no markdown or explanation).",
		"Constraints: pure function; no imports or dependencies; no `any`; do not mutate inputs; deterministic output.",
		`Task: ${task.task}`,
		`Required signature: ${task.signature}`,
		...(exemplarBlock ? [exemplarBlock] : []),
		`Target file: ${TARGET_PATH}`,
		"// TODO: implement the required exported function",
	].join("\n\n");
}

const DANGEROUS_CODE = /\b(?:import|require|process|globalThis|eval|Function|child_process|Deno|Bun|fetch)\b/;

function extractFunctionCode(text: string | null, functionName: string): { code: string | null; error: string | null } {
	if (!text) return { code: null, error: "empty response" };
	const fenced = [...text.matchAll(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/gi)].map((match) => match[1] ?? "");
	for (const source of [...fenced, text]) {
		const file = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		for (const statement of file.statements) {
			const isNamedFunction = ts.isFunctionDeclaration(statement) && statement.name?.text === functionName;
			const isNamedVariable =
				ts.isVariableStatement(statement) &&
				statement.declarationList.declarations.some(
					(declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === functionName,
				);
			if (!isNamedFunction && !isNamedVariable) continue;
			const hasExport = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
			if (!hasExport) return { code: null, error: "required function was not exported" };
			const code = statement.getText(file);
			if (DANGEROUS_CODE.test(code)) return { code: null, error: "candidate used a forbidden runtime capability" };
			const transpiled = ts.transpileModule(code, {
				compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
				reportDiagnostics: true,
			});
			const error = transpiled.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
			if (error) return { code: null, error: ts.flattenDiagnosticMessageText(error.messageText, " ") };
			return { code: transpiled.outputText, error: null };
		}
	}
	return { code: null, error: `missing exported ${functionName}` };
}

async function runArm(model: string, task: EvalTask, arm: "a" | "b", exemplarBlock: string | null): Promise<ArmResult> {
	const response = await chat(model, [
		{ role: "system", content: "You are a precise local TypeScript coding worker. Output code only." },
		{ role: "user", content: taskPrompt(task, arm === "b" ? exemplarBlock : null) },
	]);
	const extracted = extractFunctionCode(response.text, task.functionName);
	return {
		...response,
		arm,
		code: extracted.code,
		extractionError: extracted.error,
		passed: false,
		testError: null,
	};
}

function orderedArms(modelIndex: number, taskIndex: number): readonly ("a" | "b")[] {
	return (modelIndex + taskIndex) % 2 === 0 ? ["a", "b"] : ["b", "a"];
}

async function buildExemplars(tasks: readonly EvalTask[]) {
	return await Promise.all(
		tasks.map(async (task) => {
			const exemplars = await selectWorkspaceFewShotExemplars({
				workspacePath: ROOT,
				taskText: task.task,
				targetPaths: [TARGET_PATH],
			});
			const block = renderFewShotExemplarBlock(exemplars);
			return { task, exemplars, block };
		}),
	);
}

async function runModel(
	lane: ModelLane,
	modelIndex: number,
	prepared: Awaited<ReturnType<typeof buildExemplars>>,
): Promise<RecordedPair[]> {
	const pairs: RecordedPair[] = [];
	for (const [taskIndex, entry] of prepared.entries()) {
		const results = new Map<"a" | "b", ArmResult>();
		for (const arm of orderedArms(modelIndex, taskIndex)) {
			const result = await runArm(lane.model, entry.task, arm, entry.block);
			results.set(arm, result);
			console.log(
				`${lane.device}/${lane.model} ${entry.task.id} ${arm === "a" ? "plain" : "exemplar"}: ${result.error ? "INFRA" : result.extractionError ? "INVALID" : "GENERATED"} ${result.durationMs}ms`,
			);
		}
		const baseline = results.get("a");
		const treatment = results.get("b");
		if (!baseline || !treatment) throw new Error(`internal arm schedule defect for ${lane.model}/${entry.task.id}`);
		pairs.push({
			model: lane.model,
			device: lane.device,
			taskId: entry.task.id,
			task: entry.task.task,
			exemplars: entry.exemplars.map(({ path, name, lineStart, lineEnd, score }) => ({ path, name, lineStart, lineEnd, score })),
			baseline,
			treatment,
		});
	}
	return pairs;
}

async function scoreInSandbox(pairs: readonly RecordedPair[], tasks: readonly EvalTask[]): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "nklein-fewshot-ab-"));
	try {
		const taskById = new Map(tasks.map((task) => [task.id, task]));
		const encodeRunnerValue = (value: unknown): unknown => {
			if (value === undefined) return { $undefined: true };
			if (typeof value === "number" && Number.isNaN(value)) return { $number: "NaN" };
			if (value === Number.POSITIVE_INFINITY) return { $number: "Infinity" };
			if (value === Number.NEGATIVE_INFINITY) return { $number: "-Infinity" };
			if (Array.isArray(value)) return value.map(encodeRunnerValue);
			if (value && typeof value === "object") {
				return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeRunnerValue(entry)]));
			}
			return value;
		};
		const records: Array<{ id: string; file: string; functionName: string; cases: unknown }> = [];
		const resultById = new Map<string, ArmResult>();
		for (const [pairIndex, pair] of pairs.entries()) {
			const task = taskById.get(pair.taskId);
			if (!task) throw new Error(`missing task definition ${pair.taskId}`);
			for (const result of [pair.baseline, pair.treatment]) {
				if (!result.code) continue;
				const id = `${pairIndex}-${result.arm}`;
				const file = `candidate-${id}.mjs`;
				await writeFile(join(directory, file), result.code, "utf8");
				records.push({ id, file, functionName: task.functionName, cases: encodeRunnerValue(task.cases) });
				resultById.set(id, result);
			}
		}
		const runner = [
			`const records = ${JSON.stringify(records)};`,
			"const revive = (value) => {",
			"  if (Array.isArray(value)) return value.map(revive);",
			"  if (value && typeof value === 'object') {",
			"    if (value.$undefined === true) return undefined;",
			"    if (value.$number === 'NaN') return Number.NaN;",
			"    if (value.$number === 'Infinity') return Number.POSITIVE_INFINITY;",
			"    if (value.$number === '-Infinity') return Number.NEGATIVE_INFINITY;",
			"    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, revive(entry)]));",
			"  }",
			"  return value;",
			"};",
			"const outcomes = [];",
			"for (const record of records) {",
			"  try {",
			"    const module = await import(`/work/${record.file}`);",
			"    const fn = module[record.functionName];",
			"    if (typeof fn !== 'function') throw new Error('export is not a function');",
			"    for (const testCase of revive(record.cases)) {",
			"      const actual = await fn(...testCase.args);",
			"      if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {",
			"        throw new Error(`expected ${JSON.stringify(testCase.expected)}; got ${JSON.stringify(actual)}`);",
			"      }",
			"    }",
			"    outcomes.push({ id: record.id, passed: true, error: null });",
			"  } catch (error) {",
			"    outcomes.push({ id: record.id, passed: false, error: error instanceof Error ? error.message : String(error) });",
			"  }",
			"}",
			"console.log(JSON.stringify(outcomes));",
		].join("\n");
		await writeFile(join(directory, "runner.mjs"), runner, "utf8");
		const docker = await execFileAsync(
			"docker",
			[
				"run",
				"--rm",
				"--network",
				"none",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--pids-limit",
				"64",
				"--memory",
				"512m",
				"--cpus",
				"1",
				"--tmpfs",
				"/tmp:rw,noexec,nosuid,size=64m",
				"-v",
				`${directory}:/work:ro`,
				"--entrypoint",
				"node",
				SANDBOX_IMAGE,
				"/work/runner.mjs",
			],
			{ timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
		);
		const outcomes = JSON.parse(docker.stdout.trim()) as Array<{ id: string; passed: boolean; error: string | null }>;
		for (const outcome of outcomes) {
			const result = resultById.get(outcome.id);
			if (!result) continue;
			result.passed = outcome.passed;
			result.testError = outcome.error;
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function harnessCard(id: string, context: string): HarnessCard {
	return {
		id,
		execution: `LM Studio local OpenAI endpoint; temperature 0; max_tokens ${MAX_COMPLETION_TOKENS}`,
		tool: "no tools; code-only response; semantic tests execute once in a strict local Docker sandbox",
		context,
		scheduling: "paired alternating arm order; cap 1 per device; resident models sequential per device",
		observability: "raw response/code, channel, tokens, latency, extraction/test errors, exact selected exemplars",
		verification: "required export plus deterministic held-out semantic cases",
		governance: "local-only; no egress; generated code runs with network none, read-only root, cap-drop all",
		retryBudget: 0,
	};
}

function summarizeModels(pairs: readonly RecordedPair[]) {
	const grouped = new Map<string, RecordedPair[]>();
	for (const pair of pairs) grouped.set(pair.model, [...(grouped.get(pair.model) ?? []), pair]);
	return [...grouped.entries()].map(([model, rows]) => ({
		model,
		device: rows[0]?.device ?? "unknown",
		pairs: rows.length,
		baselinePassed: rows.filter((row) => row.baseline.passed).length,
		treatmentPassed: rows.filter((row) => row.treatment.passed).length,
		better: rows.filter((row) => !row.baseline.passed && row.treatment.passed).length,
		worse: rows.filter((row) => row.baseline.passed && !row.treatment.passed).length,
		infraFailures: rows.filter((row) => row.baseline.error || row.treatment.error).length,
		meanBaselineLatencyMs: rows.reduce((sum, row) => sum + row.baseline.durationMs, 0) / Math.max(1, rows.length),
		meanTreatmentLatencyMs: rows.reduce((sum, row) => sum + row.treatment.durationMs, 0) / Math.max(1, rows.length),
		meanPromptTokenOverhead:
			rows.reduce((sum, row) => sum + row.treatment.promptTokens - row.baseline.promptTokens, 0) / Math.max(1, rows.length),
	}));
}

function summarizeTrialOrdering(pairs: readonly RecordedPair[], lanes: readonly ModelLane[]) {
	const byModel = new Map<string, RecordedPair[]>();
	for (const pair of pairs) byModel.set(pair.model, [...(byModel.get(pair.model) ?? []), pair]);
	const perModel = [...byModel.entries()].map(([model, rows]) => {
		const modelIndex = lanes.findIndex((lane) => lane.model === model);
		const trials: Trial[] = rows.flatMap((pair, taskIndex) =>
			orderedArms(modelIndex, taskIndex).map((arm, orderIndex) => {
				const result = arm === "a" ? pair.baseline : pair.treatment;
				return {
					arm,
					index: taskIndex * 2 + orderIndex,
					passed: result.passed,
					durationMs: result.durationMs,
					infraError: Boolean(result.error),
				};
			}),
		);
		return { model, device: rows[0]?.device ?? "unknown", ...summariseTrials(trials) };
	});
	const valid = pairs.filter((pair) => !pair.baseline.error && !pair.treatment.error);
	const aRate = valid.filter((pair) => pair.baseline.passed).length / Math.max(1, valid.length);
	const bRate = valid.filter((pair) => pair.treatment.passed).length / Math.max(1, valid.length);
	const infraErrorRate = (pairs.length - valid.length) / Math.max(1, pairs.length);
	const drifting = perModel.filter((entry) => entry.drift.drifting);
	return {
		armPassRate: { a: aRate, b: bRate },
		infraErrorRate,
		balanced: perModel.every((entry) => entry.balanced),
		drift: {
			drifting: drifting.length > 0,
			detail:
				drifting.length > 0
					? `within-model ordering check flagged: ${drifting.map((entry) => entry.model).join(", ")}`
					: "no within-model ordering check flagged thermal drift; heterogeneous lanes were not concatenated",
		},
		perModel,
		text: `A ${(aRate * 100).toFixed(0)}% (n=${valid.length}) vs B ${(bRate * 100).toFixed(0)}% (n=${valid.length}); infra-error rate ${(infraErrorRate * 100).toFixed(1)}%. ${drifting.length === 0 ? "No" : drifting.length} within-model lane(s) flagged thermal drift.`,
	};
}

async function reanalyzeOutput(): Promise<void> {
	const artifact = JSON.parse(await readFile(OUTPUT, "utf8")) as {
		analysisRevision?: number;
		lanes: ModelLane[];
		pairs: RecordedPair[];
		trialSummary: unknown;
	};
	artifact.analysisRevision = 2;
	artifact.trialSummary = summarizeTrialOrdering(artifact.pairs, artifact.lanes);
	await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	console.log(artifact.trialSummary);
}

async function main(): Promise<void> {
	if (process.env.NKLEIN_FEWSHOT_AB_REANALYZE === "1") {
		await reanalyzeOutput();
		return;
	}
	const lanes = parseLanes();
	const tasks = selectedTasks();
	const taskCount = lanes.length * tasks.length;
	const preRegistration = assessPreRegistration({
		declaredMdePoints: DECLARED_MDE_POINTS,
		design: { taskCount, repeats: 1 },
	});
	if (preRegistration.verdict === "underpowered_by_construction" && process.env.NKLEIN_FEWSHOT_AB_ALLOW_SMOKE !== "1") {
		throw new Error(`refusing underpowered F11.2h run: ${preRegistration.reason}`);
	}
	const modelsResponse = await fetch(MODELS_ENDPOINT, { signal: AbortSignal.timeout(15_000) });
	const modelsBody = (await modelsResponse.json()) as { data?: Array<{ id?: string }> };
	const loaded = new Set((modelsBody.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id)));
	const missing = lanes.filter((lane) => !loaded.has(lane.model));
	if (missing.length > 0) throw new Error(`fleet preflight missing resident model(s): ${missing.map((lane) => lane.model).join(", ")}`);

	const prepared = await buildExemplars(tasks);
	const byDevice = new Map<string, Array<{ lane: ModelLane; index: number }>>();
	for (const [index, lane] of lanes.entries()) byDevice.set(lane.device, [...(byDevice.get(lane.device) ?? []), { lane, index }]);
	const pairs = (
		await Promise.all(
			[...byDevice.values()].map(async (deviceLanes) => {
				const rows: RecordedPair[] = [];
				for (const { lane, index } of deviceLanes) rows.push(...(await runModel(lane, index, prepared)));
				return rows;
			}),
		)).flat();
	await scoreInSandbox(pairs, tasks);
	for (const pair of pairs) {
		console.log(
			`${pair.device}/${pair.model} ${pair.taskId}: plain=${pair.baseline.passed ? "PASS" : "FAIL"} exemplar=${pair.treatment.passed ? "PASS" : "FAIL"}`,
		);
	}
	const valid = pairs.filter((pair) => !pair.baseline.error && !pair.treatment.error);
	const outcomes = valid.map((pair) => ({ a: pair.baseline.passed, b: pair.treatment.passed }));
	const decision = decideDefaultFlip({ pairs: outcomes, minEffect: 0.1 });
	const baselinePassed = valid.filter((pair) => pair.baseline.passed).length;
	const treatmentPassed = valid.filter((pair) => pair.treatment.passed).length;
	const plainCard = harnessCard("plain-code-edit", "task contract and empty target file");
	const exemplarCard = harnessCard(
		"production-exemplar-code-edit",
		"same task/target plus production-selected style exemplar block when the selector does not abstain",
	);
	const artifact = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		question: "Do production-selected in-repo function exemplars materially improve held-out semantic code-edit success?",
		armA: "same code-edit prompt without exemplars",
		armB: "same prompt plus renderFewShotExemplarBlock(selectWorkspaceFewShotExemplars(...)) when non-empty",
		declaredMdePoints: DECLARED_MDE_POINTS,
		preRegistration,
		harness: {
			baseline: plainCard,
			treatment: exemplarCard,
			comparability: assessComparability(plainCard, exemplarCard),
			taskCount: tasks.length,
			modelCount: lanes.length,
		},
		lanes,
		aggregate: {
			pairCount: valid.length,
			selectorAbstentions: pairs.filter((pair) => pair.exemplars.length === 0).length,
			infraFailures: pairs.length - valid.length,
			baselineInterval: wilsonInterval(baselinePassed, valid.length),
			treatmentInterval: wilsonInterval(treatmentPassed, valid.length),
			meanPromptTokenOverhead:
				valid.reduce((sum, pair) => sum + pair.treatment.promptTokens - pair.baseline.promptTokens, 0) /
				Math.max(1, valid.length),
			decision,
		},
		perModel: summarizeModels(pairs),
		trialSummary: summarizeTrialOrdering(pairs, lanes),
		tasks,
		pairs,
	};
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	console.log(`\n${artifact.trialSummary.text}`);
	console.log(decision.reason);
	console.log(`evidence: ${OUTPUT}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : error);
	process.exitCode = 1;
});
