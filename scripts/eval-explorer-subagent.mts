/** F11.2j live fleet gate: direct worker exploration versus a compact handoff from the smaller resident explorer. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { decideDefaultFlip, wilsonInterval } from "../src/core/ab-significance-gate.js";
import { assessPreRegistration } from "../src/core/minimum-detectable-effect.js";
import {
	buildExplorerSeedPrompt,
	nkleinExplorerSubmissionSchema,
	renderExplorerResultForWorker,
	type NKleinExplorerResult,
} from "../src/nklein-agent/nklein-explorer-tool.js";
import { listSourceFiles } from "../src/nklein-agent/source-file-scan.js";

interface EvalTask {
	readonly id: string;
	readonly question: string;
	readonly expectedPath: string;
}

interface ModelLane {
	readonly device: string;
	readonly model: string;
	readonly taskLimit: number;
}

interface ChatMessage {
	readonly role: "system" | "user" | "assistant" | "tool";
	readonly content: string | null;
	readonly tool_calls?: readonly ToolCall[];
	readonly tool_call_id?: string;
	readonly reasoning_content?: string;
}

interface ToolCall {
	readonly id: string;
	readonly type: "function";
	readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatTurn {
	readonly message: ChatMessage | null;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly durationMs: number;
	readonly error: string | null;
}

interface ExplorationResult {
	readonly findings: NKleinExplorerResult | null;
	readonly calls: number;
	readonly peakPromptTokens: number;
	readonly completionTokens: number;
	readonly durationMs: number;
	readonly error: string | null;
	readonly transcript: readonly ChatMessage[];
}

interface CompactResult {
	readonly findings: NKleinExplorerResult | null;
	readonly responseText: string | null;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly durationMs: number;
	readonly error: string | null;
}

interface PairResult {
	readonly device: string;
	readonly model: string;
	readonly taskId: string;
	readonly expectedPath: string;
	readonly explorerModel: string;
	readonly explorer: ExplorationResult;
	readonly baseline: ExplorationResult;
	readonly treatment: CompactResult;
	readonly baselinePassed: boolean;
	readonly treatmentPassed: boolean;
	readonly mainPromptTokenSavings: number | null;
}

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = resolve(ROOT, process.env.NKLEIN_EXPLORER_AB_OUTPUT ?? "docs/dev/f11.2j-explorer-ab-2026-07-21.json");
const BASE_URL = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
const CHAT_URL = `${BASE_URL.endsWith("/v1") ? BASE_URL : `${BASE_URL}/v1`}/chat/completions`;
const MODELS_URL = `${BASE_URL.endsWith("/v1") ? BASE_URL : `${BASE_URL}/v1`}/models`;
const EXPLORER_MODEL = process.env.NKLEIN_EXPLORER_AB_EXPLORER_MODEL ?? "qwopus3.5-9b-coder-mtp";
const MAX_TURNS = 8;
const MAX_COMPLETION_TOKENS = 512;
const REQUEST_TIMEOUT_MS = 120_000;
const DECLARED_MDE_POINTS = 45;

const DEFAULT_LANES: readonly ModelLane[] = [
	{ device: "m5max", model: "qwen/qwen2.5-coder-14b", taskLimit: 8 },
	{ device: "m4mini", model: "qwen3.5-9b-mlx-m4", taskLimit: 2 },
	{ device: "legion5pro", model: "qwopus3.5-9b-coder-mtp", taskLimit: 8 },
];

const TASKS: readonly EvalTask[] = [
	{
		id: "explorer-budget",
		question: "Inside createExplorerRunner, where is deps.runBudget enforced, and is exploreQueriesUsed scoped to one worker session?",
		expectedPath: "src/nklein-agent/nklein-explorer-runner.ts",
	},
	{
		id: "loaded-model-identity",
		question: "Where does the loaded-model parser distinguish runtime aliases from publisher model keys and loaded context?",
		expectedPath: "src/core/lmstudio-loaded-model-descriptors.ts",
	},
	{
		id: "source-scan-exclusions",
		question: "Where does listSourceFiles apply SKIPPED_DIRS to exclude generated and dependency directories from repository source scanning?",
		expectedPath: "src/nklein-agent/source-file-scan.ts",
	},
	{
		id: "few-shot-overlap",
		question: "Where does in-repo few-shot retrieval score task overlap and abstain below its relevance floor?",
		expectedPath: "src/nklein-agent/nklein-few-shot-exemplars.ts",
	},
	{
		id: "repo-verify-recursion",
		question: "Where is repository verification prevented from recursively activating inside an acceptance child?",
		expectedPath: "src/nklein-agent/nklein-acceptance-gate.ts",
	},
	{
		id: "monorepo-scope",
		question: "Where is the deepest matching monorepo package selected for a task's likely files?",
		expectedPath: "src/core/monorepo-task-scope.ts",
	},
	{
		id: "context-reanchor",
		question: "Where is the canonical ACCEPTANCE CRITERIA field rendered into a long-task context re-anchor?",
		expectedPath: "src/core/context-reanchor.ts",
	},
	{
		id: "explorer-contract",
		question: "Where is the citation-only explorer handoff schema and worker-visible rendering defined?",
		expectedPath: "src/nklein-agent/nklein-explorer-tool.ts",
	},
];

const TOOLS = [
	{
		type: "function",
		function: {
			name: "search_code",
			description: "Search repository source text. Returns workspace-relative path:line matches.",
			parameters: {
				type: "object",
				properties: { query: { type: "string" } },
				required: ["query"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read_files",
			description: "Read one focused line range from a workspace-relative source file.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					startLine: { type: "integer", minimum: 1 },
					endLine: { type: "integer", minimum: 1 },
				},
				required: ["path", "startLine", "endLine"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "submit_citations",
			description: "Submit the final short answer and 1-12 exact repository citations.",
			parameters: {
				type: "object",
				properties: {
					answer: { type: "string" },
					citations: {
						type: "array",
						minItems: 1,
						maxItems: 12,
						items: {
							type: "object",
							properties: {
								path: { type: "string" },
								line: { type: ["integer", "null"] },
								note: { type: "string" },
							},
							required: ["path", "note"],
							additionalProperties: false,
						},
					},
				},
				required: ["answer", "citations"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "repo_map",
			description: "List the bounded repository source layout for orientation.",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
	{
		type: "function",
		function: {
			name: "ast_search",
			description: "Locate a symbol or concept in parsed source; returns path:line candidates.",
			parameters: {
				type: "object",
				properties: { nodeId: { type: "string" } },
				required: ["nodeId"],
				additionalProperties: false,
			},
		},
	},
] as const;

function parseLanes(): readonly ModelLane[] {
	const raw = process.env.NKLEIN_EXPLORER_AB_MODELS?.trim();
	if (!raw) return DEFAULT_LANES;
	return raw.split(",").map((entry) => {
		const [device, model, rawLimit] = entry.split("=").map((part) => part.trim());
		const taskLimit = Number.parseInt(rawLimit ?? "", 10);
		if (!device || !model || !Number.isFinite(taskLimit) || taskLimit < 1) {
			throw new Error(`invalid lane ${entry}; expected device=model=taskLimit`);
		}
		return { device, model, taskLimit };
	});
}

function safeArguments(raw: string): Record<string, unknown> {
	try {
		const value = JSON.parse(raw) as unknown;
		return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

async function chat(
	model: string,
	messages: readonly ChatMessage[],
	tools: readonly unknown[],
	toolChoice: "auto" | "required" | "none",
): Promise<ChatTurn> {
	const started = performance.now();
	try {
		const response = await fetch(CHAT_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model, messages, tools, tool_choice: toolChoice, temperature: 0, max_tokens: MAX_COMPLETION_TOKENS }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const body = (await response.json()) as {
			choices?: Array<{ message?: ChatMessage }>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
			error?: { message?: string } | string;
		};
		return {
			message: body.choices?.[0]?.message ?? null,
			promptTokens: body.usage?.prompt_tokens ?? 0,
			completionTokens: body.usage?.completion_tokens ?? 0,
			durationMs: Math.round(performance.now() - started),
			error: response.ok
				? null
				: typeof body.error === "string"
					? body.error
					: body.error?.message ?? `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			message: null,
			promptTokens: 0,
			completionTokens: 0,
			durationMs: Math.round(performance.now() - started),
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function buildCorpus(): Promise<Map<string, string>> {
	const paths = await listSourceFiles(ROOT, 5_000);
	const corpus = new Map<string, string>();
	for (const path of paths) {
		try {
			corpus.set(relative(ROOT, path), await readFile(path, "utf8"));
		} catch {
			// Best-effort read-only benchmark corpus.
		}
	}
	return corpus;
}

const STOP_WORDS = new Set(["where", "does", "that", "this", "from", "with", "into", "what", "when", "code"]);

function searchCorpus(corpus: ReadonlyMap<string, string>, query: string): string {
	const tokens = [
		...new Set(
			query
				.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
				.toLowerCase()
				.split(/[^a-z0-9_]+/)
				.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
		),
	];
	if (tokens.length === 0) return "No searchable tokens.";
	const hits: Array<{ score: number; path: string; line: number; text: string }> = [];
	for (const [path, content] of corpus) {
		for (const [index, line] of content.split("\n").entries()) {
			const normalizedPath = path.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
			const normalizedLine = line.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
			const score = tokens.reduce(
				(sum, token) =>
					sum + (normalizedPath.includes(token) ? 2 : 0) + (normalizedLine.includes(token) ? 1 : 0),
				0,
			);
			if (score > 0) hits.push({ score, path, line: index + 1, text: line.trim().slice(0, 240) });
		}
	}
	hits.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line);
	return hits.slice(0, 30).map((hit) => `${hit.path}:${hit.line}: ${hit.text}`).join("\n") || "No matches.";
}

function readFocused(corpus: ReadonlyMap<string, string>, args: Record<string, unknown>): string {
	const path = typeof args.path === "string" ? args.path : "";
	const content = corpus.get(path);
	if (!content) return `Unknown or unscanned source path: ${path}`;
	const lines = content.split("\n");
	const start = Math.max(1, Math.trunc(typeof args.startLine === "number" ? args.startLine : 1));
	const requestedEnd = Math.trunc(typeof args.endLine === "number" ? args.endLine : start + 79);
	const end = Math.min(lines.length, Math.max(start, requestedEnd), start + 119);
	return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
}

function parseSubmission(args: Record<string, unknown>): NKleinExplorerResult | null {
	const parsed = nkleinExplorerSubmissionSchema.safeParse(args);
	if (!parsed.success) return null;
	return {
		answer: parsed.data.answer,
		citations: parsed.data.citations.map((citation) => ({ ...citation, line: citation.line ?? null })),
	};
}

async function explore(model: string, task: EvalTask, corpus: ReadonlyMap<string, string>): Promise<ExplorationResult> {
	const messages: ChatMessage[] = [
		{ role: "system", content: "You are a precise local read-only code explorer. Use tools; never invent citations." },
		{ role: "user", content: buildExplorerSeedPrompt(task.question) },
	];
	let peakPromptTokens = 0;
	let completionTokens = 0;
	let durationMs = 0;
	for (let turnIndex = 0; turnIndex < MAX_TURNS; turnIndex += 1) {
		const forceSubmit = turnIndex >= 5;
		const turn = await chat(model, messages, forceSubmit ? [TOOLS[2]] : TOOLS, forceSubmit ? "required" : "auto");
		peakPromptTokens = Math.max(peakPromptTokens, turn.promptTokens);
		completionTokens += turn.completionTokens;
		durationMs += turn.durationMs;
		if (turn.error || !turn.message) {
			return { findings: null, calls: turnIndex + 1, peakPromptTokens, completionTokens, durationMs, error: turn.error ?? "empty message", transcript: messages };
		}
		messages.push(turn.message);
		const calls = turn.message.tool_calls ?? [];
		if (calls.length === 0) {
			messages.push({ role: "user", content: "Use the available read-only tools, then call submit_citations. Do not answer in prose." });
			continue;
		}
		for (const call of calls) {
			const args = safeArguments(call.function.arguments);
			if (call.function.name === "submit_citations") {
				const findings = parseSubmission(args);
				if (findings) {
					return { findings, calls: turnIndex + 1, peakPromptTokens, completionTokens, durationMs, error: null, transcript: messages };
				}
				messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: "Invalid submission. Call submit_citations again with a non-empty answer and citations containing path, line, and note.",
				});
				continue;
			}
			const content = call.function.name === "search_code"
				? searchCorpus(corpus, typeof args.query === "string" ? args.query : "")
				: call.function.name === "read_files"
					? readFocused(corpus, args)
					: call.function.name === "ast_search"
						? searchCorpus(corpus, typeof args.nodeId === "string" ? args.nodeId.replaceAll("_", " ") : "")
						: call.function.name === "repo_map"
							? "Repository source roots: src/core (pure policy), src/nklein-agent (agent runtime and tools), src/server, src/trpc, src/chat, web-ui/src. Use search_code with exact symbols from the question, then read_files on returned paths."
					: `Unknown tool ${call.function.name}`;
			messages.push({ role: "tool", tool_call_id: call.id, content: content.slice(0, 12_000) });
		}
	}
	return { findings: null, calls: MAX_TURNS, peakPromptTokens, completionTokens, durationMs, error: "turn budget exhausted", transcript: messages };
}

async function compactHandoff(model: string, task: EvalTask, findings: NKleinExplorerResult | null): Promise<CompactResult> {
	if (!findings) return { findings: null, responseText: null, promptTokens: 0, completionTokens: 0, durationMs: 0, error: "explorer produced no handoff" };
	const turn = await chat(
		model,
		[
			{ role: "system", content: "Answer from the verified explorer handoff. Do not search or invent citations." },
			{ role: "user", content: `Question: ${task.question}\n\n${renderExplorerResultForWorker(findings)}` },
		],
		[],
		"none",
	);
	const responseText = turn.message?.content?.trim() || turn.message?.reasoning_content?.trim() || null;
	return {
		findings,
		responseText,
		promptTokens: turn.promptTokens,
		completionTokens: turn.completionTokens,
		durationMs: turn.durationMs,
		error: turn.error,
	};
}

function passes(findings: NKleinExplorerResult | null, expectedPath: string): boolean {
	return findings?.citations.some((citation) => citation.path === expectedPath) ?? false;
}

async function runLane(
	lane: ModelLane,
	laneIndex: number,
	tasks: readonly EvalTask[],
	corpus: ReadonlyMap<string, string>,
	explorerByTask: ReadonlyMap<string, ExplorationResult>,
): Promise<PairResult[]> {
	const pairs: PairResult[] = [];
	for (const [taskIndex, task] of tasks.slice(0, lane.taskLimit).entries()) {
		const explorer = explorerByTask.get(task.id);
		if (!explorer) throw new Error(`missing explorer result for ${task.id}`);
		let baseline: ExplorationResult;
		let treatment: CompactResult;
		if ((laneIndex + taskIndex) % 2 === 0) {
			baseline = await explore(lane.model, task, corpus);
			treatment = await compactHandoff(lane.model, task, explorer.findings);
		} else {
			treatment = await compactHandoff(lane.model, task, explorer.findings);
			baseline = await explore(lane.model, task, corpus);
		}
		const baselinePassed = passes(baseline.findings, task.expectedPath);
		const treatmentPassed = passes(explorer.findings, task.expectedPath);
		const savings = baseline.peakPromptTokens > 0 && treatment.promptTokens > 0
			? 1 - treatment.promptTokens / baseline.peakPromptTokens
			: null;
		console.log(`${lane.device}/${lane.model} ${task.id}: direct=${baselinePassed ? "PASS" : "FAIL"} compact=${treatmentPassed ? "PASS" : "FAIL"} savings=${savings === null ? "n/a" : `${(savings * 100).toFixed(1)}%`}`);
		pairs.push({ device: lane.device, model: lane.model, taskId: task.id, expectedPath: task.expectedPath, explorerModel: EXPLORER_MODEL, explorer, baseline, treatment, baselinePassed, treatmentPassed, mainPromptTokenSavings: savings });
	}
	return pairs;
}

async function main(): Promise<void> {
	const lanes = parseLanes();
	const rawTaskLimit = Number.parseInt(process.env.NKLEIN_EXPLORER_AB_TASK_LIMIT ?? "", 10);
	const tasks = Number.isFinite(rawTaskLimit) && rawTaskLimit > 0 ? TASKS.slice(0, rawTaskLimit) : TASKS;
	const pairCount = lanes.reduce((sum, lane) => sum + Math.min(lane.taskLimit, tasks.length), 0);
	const preRegistration = assessPreRegistration({ declaredMdePoints: DECLARED_MDE_POINTS, design: { taskCount: pairCount, repeats: 1 } });
	if (preRegistration.verdict === "underpowered_by_construction" && process.env.NKLEIN_EXPLORER_AB_ALLOW_SMOKE !== "1") {
		throw new Error(`refusing underpowered explorer run: ${preRegistration.reason}`);
	}
	const modelsResponse = await fetch(MODELS_URL, { signal: AbortSignal.timeout(15_000) });
	const modelsBody = (await modelsResponse.json()) as { data?: Array<{ id?: string }> };
	const loaded = new Set((modelsBody.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id)));
	const required = [EXPLORER_MODEL, ...lanes.map((lane) => lane.model)];
	const missing = required.filter((model) => !loaded.has(model));
	if (missing.length > 0) throw new Error(`fleet preflight missing resident model(s): ${missing.join(", ")}`);

	const corpus = await buildCorpus();
	const explorerByTask = new Map<string, ExplorationResult>();
	for (const task of tasks) {
		const result = await explore(EXPLORER_MODEL, task, corpus);
		explorerByTask.set(task.id, result);
		console.log(`explorer/${EXPLORER_MODEL} ${task.id}: ${passes(result.findings, task.expectedPath) ? "PASS" : "FAIL"} (${result.calls} calls, ${result.peakPromptTokens} peak prompt tokens)`);
	}
	const pairs = (await Promise.all(lanes.map((lane, index) => runLane(lane, index, tasks, corpus, explorerByTask)))).flat();
	const outcomes = pairs.map((pair) => ({ a: pair.baselinePassed, b: pair.treatmentPassed }));
	const qualityDecision = decideDefaultFlip({ pairs: outcomes, minEffect: 0 });
	const baselinePassed = pairs.filter((pair) => pair.baselinePassed).length;
	const treatmentPassed = pairs.filter((pair) => pair.treatmentPassed).length;
	const savings = pairs.flatMap((pair) => pair.mainPromptTokenSavings === null ? [] : [pair.mainPromptTokenSavings]);
	const meanSavings = savings.reduce((sum, value) => sum + value, 0) / Math.max(1, savings.length);
	const explorerPasses = [...explorerByTask.entries()].filter(([taskId, result]) => {
		const task = tasks.find((entry) => entry.id === taskId);
		return task ? passes(result.findings, task.expectedPath) : false;
	}).length;
	const defaultGate = {
		pass:
			treatmentPassed >= baselinePassed &&
			meanSavings >= 0.4 &&
			explorerPasses === tasks.length &&
			savings.length === pairs.length,
		reason: `compact citation quality ${treatmentPassed}/${pairs.length} vs direct ${baselinePassed}/${pairs.length}; mean main-context savings ${(meanSavings * 100).toFixed(1)}% across ${savings.length}/${pairs.length} measured pairs; explorer localization ${explorerPasses}/${tasks.length}`,
	};
	const artifact = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		question: "Can a smaller resident read-only explorer preserve citation localization while reducing the worker's main-context prompt?",
		preRegistration,
		declaredMdePoints: DECLARED_MDE_POINTS,
		protocol: {
			baseline: "worker model searches/reads directly and submits citations in its own context",
			treatment: "phi-4-mini explorer searches/reads in a fresh context; worker receives only renderExplorerResultForWorker and submits from that handoff",
			tools: ["search_code", "read_files", "submit_citations"],
			maxTurns: MAX_TURNS,
			maxCompletionTokens: MAX_COMPLETION_TOKENS,
			localOnly: true,
			writes: false,
			armOrder: "alternating per lane",
		},
		lanes,
		explorerModel: EXPLORER_MODEL,
		tasks,
		aggregate: {
			pairCount: pairs.length,
			baselinePassed,
			treatmentPassed,
			baselineInterval: wilsonInterval(baselinePassed, pairs.length),
			treatmentInterval: wilsonInterval(treatmentPassed, pairs.length),
			qualityDecision,
			meanMainPromptTokenSavings: meanSavings,
			explorerPasses,
			defaultGate,
		},
		pairs,
	};
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	console.log(`\n${defaultGate.reason}`);
	console.log(`default gate: ${defaultGate.pass ? "PASS" : "KEEP OPT-IN"}`);
	console.log(`evidence: ${OUTPUT}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : error);
	process.exitCode = 1;
});
