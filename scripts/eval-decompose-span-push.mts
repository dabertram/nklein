/**
 * F11.2d live paired evaluation: should leaf-card code spans be pushed automatically, or should the worker pull one?
 *
 * The pushed arm is not given an oracle. It receives the top-1 span selected by the production-compatible lexical
 * policy in `decompose-span-ab-eval.ts`. The pull arm sees the same repo map and may request exactly one symbol before
 * answering. Tasks are paired per model and ABBA-interleaved; devices run in parallel, models on one device run
 * sequentially so co-residency does not become a bandwidth confound.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildAbbaSchedule, summariseTrials, type Arm, type Trial } from "../src/core/ab-trial-ordering.js";
import {
	localizationMatchesTarget,
	parseDecomposeLocalizationResponse,
	selectPushedSpan,
	summarizeDecomposeSpanAb,
	type DecomposeSpanCandidate,
	type DecomposeSpanPairedResult,
} from "../src/core/decompose-span-ab-eval.js";
import { assessComparability, type HarnessCard } from "../src/core/harness-card.js";
import { assessPreRegistration } from "../src/core/minimum-detectable-effect.js";
import { findAstShapeMatches } from "../src/nklein-agent/nklein-ast-search.js";

interface CorpusTask {
	readonly id: string;
	readonly task: string;
	readonly path: string;
	readonly symbol: string;
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
	readonly arm: Arm;
	readonly passed: boolean;
	readonly selectedSymbol: string | null;
	readonly calls: number;
}

interface RecordedPair extends DecomposeSpanPairedResult {
	readonly device: string;
	readonly task: string;
	readonly target: { readonly path: string; readonly symbol: string };
	readonly pushedSpan: { readonly path: string; readonly symbol: string } | null;
	readonly pull: ArmResult;
	readonly push: ArmResult;
}

const ROOT = resolve(import.meta.dirname, "..");
const CHAT_URL = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1")
	.replace(/\/+$/, "")
	.replace(/\/chat\/completions$/, "");
const ENDPOINT = `${CHAT_URL.endsWith("/v1") ? CHAT_URL : `${CHAT_URL}/v1`}/chat/completions`;
const OUTPUT = resolve(ROOT, process.env.NKLEIN_SPAN_AB_OUTPUT ?? "docs/dev/f11.2d-span-push-ab-2026-07-21.json");
const REQUEST_TIMEOUT_MS = 180_000;
const DECLARED_MDE_POINTS = 15;

const DEFAULT_LANES: readonly ModelLane[] = [
	{ model: "qwen/qwen2.5-coder-14b", device: "m5max" },
	{ model: "phi-4-mini-instruct-m5max", device: "m5max" },
	{ model: "qwen/qwen3.6-35b-a3b", device: "m5max" },
	{ model: "qwen3.5-9b-mlx-m4", device: "m4mini" },
	{ model: "qwopus3.5-9b-coder-mtp", device: "legion5pro" },
];

const CORPUS: readonly CorpusTask[] = [
	{
		id: "paired-default-flip",
		task: "Require both a practical improvement and a significant paired McNemar result before changing a default.",
		path: "src/core/ab-significance-gate.ts",
		symbol: "decideDefaultFlip",
	},
	{
		id: "retrieval-mode-comparison",
		task: "Compare multiple retrieval rankers and identify the best mode at each recall cutoff.",
		path: "src/core/retrieval-recall-eval.ts",
		symbol: "compareRetrievalModes",
	},
	{
		id: "abba-order",
		task: "Create a balanced interleaved trial order that cancels linear thermal drift across two experiment arms.",
		path: "src/core/ab-trial-ordering.ts",
		symbol: "buildAbbaSchedule",
	},
	{
		id: "thermal-drift",
		task: "Report whether the late half of a local experiment materially slowed relative to the early half.",
		path: "src/core/ab-trial-ordering.ts",
		symbol: "detectThermalDrift",
	},
	{
		id: "harness-comparability",
		task: "Reject an A/B comparison when retry budgets differ and report every other harness dimension mismatch.",
		path: "src/core/harness-card.ts",
		symbol: "assessComparability",
	},
	{
		id: "retrieval-metrics",
		task: "Calculate recall, precision, and reciprocal-rank metrics for one retrieval strategy over labeled queries.",
		path: "src/core/retrieval-recall-eval.ts",
		symbol: "evaluateRetrievalMode",
	},
	{
		id: "safe-model-host",
		task: "Choose a fleet device for a pending model load without violating memory reserve or user budget.",
		path: "src/core/device-load-routing.ts",
		symbol: "selectDeviceForModelLoad",
	},
	{
		id: "write-scope",
		task: "Turn a card's likely-touched paths into the normalized repository write boundary for its sandbox.",
		path: "src/nklein-agent/nklein-write-scope.ts",
		symbol: "normalizeWriteScope",
	},
	{
		id: "symbol-neighborhood",
		task: "Build a bounded k-hop symbol neighborhood while pruning hub identifiers that flood the result.",
		path: "src/core/ego-graph.ts",
		symbol: "buildSymbolEgoGraph",
	},
	{
		id: "ast-shape-pure",
		task: "Find callers, definitions, references, or implementations in one TypeScript source string.",
		path: "src/nklein-agent/nklein-ast-search.ts",
		symbol: "findAstShapeMatches",
	},
	{
		id: "ast-shape-workspace",
		task: "Scan workspace source files for an exact structural query and return bounded AST matches.",
		path: "src/nklein-agent/nklein-ast-search.ts",
		symbol: "searchAstShapes",
	},
	{
		id: "tool-catalog-budget",
		task: "Keep mandatory tools and select the most role-relevant optional tools under a strict catalog cap.",
		path: "src/core/tool-catalog-retrieval-gate.ts",
		symbol: "gateToolCatalog",
	},
	{
		id: "stateful-response-adoption",
		task: "Adopt previous-response IDs only after an opt-in probe proves replay-safe stateful behavior.",
		path: "src/core/stateful-responses-gate.ts",
		symbol: "decideStatefulResponsesAdoption",
	},
	{
		id: "skill-execution-boundary",
		task: "Refuse execution of a community skill bundle when any file classification requires approval or blocking.",
		path: "src/core/skill-execution-gate.ts",
		symbol: "gateSkillBundleExecution",
	},
	{
		id: "focused-text-spans",
		task: "Extract and merge bounded windows around relevant query terms instead of returning a whole long document.",
		path: "src/core/extraction-span.ts",
		symbol: "extractRelevantSpans",
	},
	{
		id: "ast-chunk-spans",
		task: "Partition TypeScript source at declaration boundaries while respecting a per-chunk line budget.",
		path: "src/nklein-agent/nklein-ast-chunking.ts",
		symbol: "computeAstChunkSpans",
	},
	{
		id: "retrieval-next-action",
		task: "Choose whether a bounded retrieval state should plan, search, fetch, answer, or stop.",
		path: "src/core/retrieval-loop-state.ts",
		symbol: "nextRetrievalAction",
	},
	{
		id: "retrieval-driver",
		task: "Drive the complete bounded retrieval loop across query planning, search, fetch, freshness, and sufficiency.",
		path: "src/core/retrieval-loop-driver.ts",
		symbol: "runRetrievalLoop",
	},
	{
		id: "planning-system-prompt",
		task: "Compose the planning-mode system instruction with decomposition depth, acceptance, and fleet guidance.",
		path: "src/nklein-agent/nklein-task-prompt-builders.ts",
		symbol: "buildNKleinPlanningSystemPrompt",
	},
	{
		id: "leaf-card-prompt",
		task: "Render a plan leaf into a worker prompt including write scope, shared spec context, and acceptance command.",
		path: "src/nklein-agent/decomposition/plan-task-prompt.ts",
		symbol: "buildTaskPrompt",
	},
	{
		id: "prompt-family-preference",
		task: "Return the most frequently successful prompt-variant family from a model behavior profile.",
		path: "src/core/model-behavior-profile.ts",
		symbol: "preferredPromptVariantFamily",
	},
	{
		id: "reasoning-enforcement",
		task: "Decide when task difficulty and observed model reliability justify forced multi-round reasoning.",
		path: "src/core/enforced-reasoning-gate.ts",
		symbol: "decideEnforcedReasoning",
	},
	{
		id: "trajectory-quality",
		task: "Score an agent trajectory from localization speed, patch discipline, validation effort, and retry resilience.",
		path: "src/core/trajectory-quality-score.ts",
		symbol: "scoreTrajectoryQuality",
	},
	{
		id: "unified-memory-band",
		task: "Recall one ranked memory band across chat, layered records, Basic Memory, and focus-chain sources.",
		path: "src/chat/unified-memory-recall.ts",
		symbol: "recallUnifiedMemoryBand",
	},
	{
		id: "model-observation-label",
		task: "Format one evaluated model capability observation as a stable provider, model, and optional endpoint label.",
		path: "src/nklein-agent/nklein-eval-harness.ts",
		symbol: "formatModelObservation",
	},
	{
		id: "retrieval-query-plan",
		task: "Turn a task, freshness need, and knowledge debt into one primary query plus deduplicated alternates.",
		path: "src/core/retrieval-query-plan.ts",
		symbol: "buildRetrievalQueryPlan",
	},
	{
		id: "retrieval-sufficiency",
		task: "Decide whether retrieval has enough fresh sources and covers every deduplicated sub-question.",
		path: "src/core/retrieval-sufficiency.ts",
		symbol: "assessRetrievalSufficiency",
	},
	{
		id: "structural-retrieval-guidance",
		task: "Tell an agent to prefer a connected structural code graph before falling back to text search.",
		path: "src/core/structural-retrieval-guidance.ts",
		symbol: "buildStructuralRetrievalGuidance",
	},
];

function parseLanes(): readonly ModelLane[] {
	const raw = process.env.NKLEIN_SPAN_AB_MODELS?.trim();
	if (!raw) {
		return DEFAULT_LANES;
	}
	return raw.split(",").map((entry) => {
		const [device, ...modelParts] = entry.trim().split("=");
		const model = modelParts.join("=").trim();
		if (!device?.trim() || !model) {
			throw new Error(`invalid NKLEIN_SPAN_AB_MODELS entry: ${entry}; expected device=model`);
		}
		return { device: device.trim(), model };
	});
}

function definitionSnippet(content: string, task: CorpusTask): string {
	const match = findAstShapeMatches(task.path, content, { kind: "definitions", symbol: task.symbol })[0];
	if (!match) {
		throw new Error(`corpus symbol missing: ${task.path}#${task.symbol}`);
	}
	const lines = content.split("\n");
	const start = Math.max(0, match.line - 3);
	return lines.slice(start, Math.min(lines.length, start + 44)).join("\n");
}

async function loadCandidates(): Promise<readonly DecomposeSpanCandidate[]> {
	return Promise.all(
		CORPUS.map(async (task) => ({
			path: task.path,
			symbol: task.symbol,
			snippet: definitionSnippet(await readFile(resolve(ROOT, task.path), "utf8"), task),
		})),
	);
}

function repoMap(candidates: readonly DecomposeSpanCandidate[]): string {
	return candidates.map((candidate) => `- ${candidate.path} :: ${candidate.symbol}`).join("\n");
}

async function chat(model: string, messages: readonly { role: string; content: string }[]): Promise<ChatResult> {
	const started = performance.now();
	try {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model,
				messages,
				temperature: 0,
				max_tokens: 256,
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "code_localization",
						strict: true,
						schema: {
							type: "object",
							properties: {
								action: { type: "string", enum: ["pull", "final"] },
								path: { type: "string" },
								symbol: { type: "string" },
							},
							required: ["action", "path", "symbol"],
							additionalProperties: false,
						},
					},
				},
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const body = (await response.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
			error?: { message?: string } | string;
		};
		const message = body.choices?.[0]?.message;
		const content = message?.content?.trim();
		const reasoningContent = message?.reasoning_content?.trim();
		const text = content || reasoningContent || null;
		const responseChannel = content ? "content" : reasoningContent ? "reasoning_content" : null;
		const error = response.ok && text ? null : typeof body.error === "string" ? body.error : body.error?.message ?? `HTTP ${response.status}`;
		return {
			text,
			responseChannel,
			durationMs: Math.round(performance.now() - started),
			promptTokens: body.usage?.prompt_tokens ?? 0,
			completionTokens: body.usage?.completion_tokens ?? 0,
			error,
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

function basePrompt(task: CorpusTask, candidates: readonly DecomposeSpanCandidate[]): string {
	return `LOCALIZE THIS LEAF CARD to exactly one function.\n\nCARD:\n${task.task}\n\nREPO MAP:\n${repoMap(candidates)}\n\nReturn ONLY the required flat JSON object. Final answer: {"action":"final","path":"repo/relative/path.ts","symbol":"exactSymbol"}. If code is not supplied and you need one focused span, request it once with {"action":"pull","path":"","symbol":"exactSymbolFromMap"}. Do not explain.`;
}

async function runArm(
	model: string,
	arm: Arm,
	task: CorpusTask,
	candidates: readonly DecomposeSpanCandidate[],
): Promise<ArmResult> {
	const pushed = selectPushedSpan(task.task, candidates);
	const messages: Array<{ role: string; content: string }> = [
		{
			role: "system",
			content: "You are a precise code localizer. Obey the flat JSON response protocol and never invent paths or symbols.",
		},
		{
			role: "user",
			content:
				arm === "b" && pushed
					? `${basePrompt(task, candidates)}\n\nAUTOMATIC TOP-1 FOCUSED SPAN:\nPATH: ${pushed.path}\nSYMBOL: ${pushed.symbol}\n\n${pushed.snippet}`
					: basePrompt(task, candidates),
		},
	];
	const first = await chat(model, messages);
	let total = first;
	let calls = 1;
	let response = first.text ? parseDecomposeLocalizationResponse(first.text) : null;
	let selectedSymbol = arm === "b" ? pushed?.symbol ?? null : null;

	if (arm === "a" && response?.kind === "pull") {
		selectedSymbol = response.symbol;
		const selected = candidates.find((candidate) => candidate.symbol === response?.symbol);
		if (selected) {
			messages.push({ role: "assistant", content: first.text ?? "" });
			messages.push({
				role: "user",
				content: `FOCUSED SPAN RESULT (the only pull):\nPATH: ${selected.path}\nSYMBOL: ${selected.symbol}\n\n${selected.snippet}\n\nNow return ONLY the final {"action":"final","path":"...","symbol":"..."} object.`,
			});
			const second = await chat(model, messages);
			calls = 2;
			total = {
				text: second.text,
				responseChannel: second.responseChannel,
				durationMs: first.durationMs + second.durationMs,
				promptTokens: first.promptTokens + second.promptTokens,
				completionTokens: first.completionTokens + second.completionTokens,
				error: first.error ?? second.error,
			};
			response = second.text ? parseDecomposeLocalizationResponse(second.text) : null;
		}
	}

	return {
		...total,
		arm,
		passed: localizationMatchesTarget(response, task),
		selectedSymbol,
		calls,
	};
}

function orderedArmsForTask(index: number): readonly [Arm, Arm] {
	const schedule = buildAbbaSchedule(Math.ceil(CORPUS.length / 2));
	return [schedule[index * 2] ?? "a", schedule[index * 2 + 1] ?? "b"];
}

async function runModel(lane: ModelLane, candidates: readonly DecomposeSpanCandidate[]): Promise<RecordedPair[]> {
	const pairs: RecordedPair[] = [];
	for (const [index, task] of CORPUS.entries()) {
		const results = new Map<Arm, ArmResult>();
		for (const arm of orderedArmsForTask(index)) {
			const result = await runArm(lane.model, arm, task, candidates);
			results.set(arm, result);
			console.log(
				`${lane.device}/${lane.model} ${task.id} ${arm === "a" ? "pull" : "push"}: ${result.passed ? "PASS" : result.error ? "INFRA" : "FAIL"} ${result.durationMs}ms`,
			);
		}
		const pull = results.get("a");
		const push = results.get("b");
		if (!pull || !push) {
			throw new Error(`internal schedule defect for ${lane.model}/${task.id}`);
		}
		const pushed = selectPushedSpan(task.task, candidates);
		pairs.push({
			model: lane.model,
			device: lane.device,
			taskId: task.id,
			task: task.task,
			target: { path: task.path, symbol: task.symbol },
			pushedSpan: pushed ? { path: pushed.path, symbol: pushed.symbol } : null,
			pullPassed: pull.passed,
			pushPassed: push.passed,
			pull,
			push,
		});
	}
	return pairs;
}

function harnessCard(id: string, context: string): HarnessCard {
	return {
		id,
		execution: "LM Studio local OpenAI endpoint; temperature 0; max_tokens 256",
		tool: "same 24-symbol repo map; one optional focused-span pull",
		context,
		scheduling: "per-model paired ABBA; cap 1 per device",
		observability: "raw flat response, tokens, calls, latency, selected symbol, infra errors",
		verification: "exact normalized repository path and symbol",
		governance: "local-only; no writes or effectful tools; no retries",
		retryBudget: 0,
	};
}

async function main(): Promise<void> {
	const lanes = parseLanes();
	const candidates = await loadCandidates();
	const taskCount = CORPUS.length * lanes.length;
	const preRegistration = assessPreRegistration({
		declaredMdePoints: DECLARED_MDE_POINTS,
		design: { taskCount, repeats: 1 },
	});
	if (preRegistration.verdict === "underpowered_by_construction") {
		throw new Error(`refusing underpowered F11.2d run: ${preRegistration.reason}`);
	}
	const preflight = await Promise.all(
		lanes.map(async (lane) => {
			const result = await chat(lane.model, [
				{ role: "system", content: "Return the required JSON object." },
				{ role: "user", content: '{"action":"final","path":"preflight.ts","symbol":"preflight"}' },
			]);
			const parsed = result.text ? parseDecomposeLocalizationResponse(result.text) : null;
			return { lane, result, passed: parsed !== null };
		}),
	);
	const failedPreflight = preflight.filter((entry) => !entry.passed || entry.result.error !== null);
	if (failedPreflight.length > 0) {
		throw new Error(
			`fleet preflight failed before paired run: ${failedPreflight
				.map((entry) => `${entry.lane.device}/${entry.lane.model}: ${entry.result.error ?? entry.result.text ?? "invalid response"}`)
				.join(" | ")}`,
		);
	}

	const lanesByDevice = new Map<string, ModelLane[]>();
	for (const lane of lanes) {
		lanesByDevice.set(lane.device, [...(lanesByDevice.get(lane.device) ?? []), lane]);
	}
	const deviceResults = await Promise.all(
		[...lanesByDevice.values()].map(async (deviceLanes) => {
			const results: RecordedPair[] = [];
			for (const lane of deviceLanes) {
				results.push(...(await runModel(lane, candidates)));
			}
			return results;
		}),
	);
	const pairs = deviceResults.flat().sort((left, right) =>
		`${left.device}/${left.model}/${left.taskId}`.localeCompare(`${right.device}/${right.model}/${right.taskId}`),
	);
	const aggregate = summarizeDecomposeSpanAb(pairs, { minEffect: 0.05 });
	const trials: Trial[] = pairs.flatMap((pair, pairIndex) => [
		{
			arm: "a" as const,
			index: pairIndex * 2,
			passed: pair.pullPassed,
			durationMs: pair.pull.durationMs,
			infraError: pair.pull.error !== null,
		},
		{
			arm: "b" as const,
			index: pairIndex * 2 + 1,
			passed: pair.pushPassed,
			durationMs: pair.push.durationMs,
			infraError: pair.push.error !== null,
		},
	]);
	const pullCard = harnessCard("pull-on-demand", "repo map, then at most one model-selected focused span");
	const pushCard = harnessCard("lexical-push-top1", "repo map plus automatic lexical top-1 focused span");
	const artifact = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		question: "Does automatic lexical top-1 span push improve exact leaf-card localization over one model-initiated pull?",
		armA: "pull-on-demand",
		armB: "lexical-push-top1",
		declaredMdePoints: DECLARED_MDE_POINTS,
		preRegistration,
		harness: {
			pull: pullCard,
			push: pushCard,
			comparability: assessComparability(pullCard, pushCard),
		},
		lanes,
		corpusSize: CORPUS.length,
		aggregate,
		trialSummary: summariseTrials(trials),
		pairs,
	};
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	console.log(`\n${artifact.trialSummary.text}`);
	console.log(aggregate.decision.reason);
	console.log(`evidence: ${OUTPUT}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : error);
	process.exitCode = 1;
});
