/** F11.2e paired fleet gate: lexical code-hit ranking versus a same-resident-model relevance discriminator. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { decideDefaultFlip, wilsonInterval } from "../src/core/ab-significance-gate.js";
import { summariseTrials, type Trial } from "../src/core/ab-trial-ordering.js";
import { assessPreRegistration } from "../src/core/minimum-detectable-effect.js";
import {
	applyRetrievalDiscriminator,
	buildRetrievalDiscriminatorPrompt,
	parseRetrievalDiscriminatorDecision,
	type RetrievalDiscriminatorCandidate,
} from "../src/core/retrieval-discriminator.js";
import { rerankByRelevance } from "../src/core/retrieval-rerank.js";
import { findAstShapeMatches } from "../src/nklein-agent/nklein-ast-search.js";

interface CorpusTask {
	readonly id: string;
	readonly task: string;
	readonly path: string;
	readonly symbol: string;
}

interface CodeCandidate extends RetrievalDiscriminatorCandidate {
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

const ROOT = resolve(import.meta.dirname, "..");
const PRIOR_CORPUS = resolve(ROOT, "docs/dev/f11.2d-span-push-ab-2026-07-21.json");
const OUTPUT = resolve(ROOT, process.env.NKLEIN_RERANK_AB_OUTPUT ?? "docs/dev/f11.2e-retrieval-rerank-ab-2026-07-21.json");
const CHAT_URL = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1")
	.replace(/\/+$/, "")
	.replace(/\/chat\/completions$/, "");
const ENDPOINT = `${CHAT_URL.endsWith("/v1") ? CHAT_URL : `${CHAT_URL}/v1`}/chat/completions`;
const REQUEST_TIMEOUT_MS = 180_000;
const DECLARED_MDE_POINTS = 15;
const CANDIDATES_PER_TASK = 8;

const DEFAULT_LANES: readonly ModelLane[] = [
	{ model: "qwen/qwen2.5-coder-14b", device: "m5max" },
	{ model: "phi-4-mini-instruct-m5max", device: "m5max" },
	{ model: "qwen/qwen3.6-35b-a3b", device: "m5max" },
	{ model: "qwen3.5-9b-mlx-m4", device: "m4mini" },
	{ model: "qwopus3.5-9b-coder-mtp", device: "legion5pro" },
];

function parseLanes(): readonly ModelLane[] {
	const raw = process.env.NKLEIN_RERANK_AB_MODELS?.trim();
	if (!raw) return DEFAULT_LANES;
	return raw.split(",").map((entry) => {
		const [device, ...modelParts] = entry.trim().split("=");
		const model = modelParts.join("=").trim();
		if (!device?.trim() || !model) throw new Error(`invalid lane ${entry}; expected device=model`);
		return { device: device.trim(), model };
	});
}

async function loadCorpus(): Promise<readonly CorpusTask[]> {
	const artifact = JSON.parse(await readFile(PRIOR_CORPUS, "utf8")) as {
		pairs?: Array<{ taskId: string; task: string; target: { path: string; symbol: string } }>;
	};
	const unique = new Map<string, CorpusTask>();
	for (const pair of artifact.pairs ?? []) {
		unique.set(pair.taskId, { id: pair.taskId, task: pair.task, path: pair.target.path, symbol: pair.target.symbol });
	}
	if (unique.size < 24) throw new Error(`F11.2e corpus unexpectedly small: ${unique.size}`);
	return [...unique.values()];
}

async function loadCandidatePool(corpus: readonly CorpusTask[]): Promise<readonly CodeCandidate[]> {
	return Promise.all(
		corpus.map(async (task, index) => {
			const content = await readFile(resolve(ROOT, task.path), "utf8");
			const match = findAstShapeMatches(task.path, content, { kind: "definitions", symbol: task.symbol })[0];
			if (!match) throw new Error(`corpus symbol missing: ${task.path}#${task.symbol}`);
			const lines = content.split("\n");
			const start = Math.max(0, match.line - 3);
			const snippet = lines.slice(start, Math.min(lines.length, start + 44)).join("\n");
			return {
				id: `c${index}`,
				path: task.path,
				symbol: task.symbol,
				text: `PATH: ${task.path}\nSYMBOL: ${task.symbol}\n${snippet}`,
			};
		}),
	);
}

function taskCandidates(task: CorpusTask, pool: readonly CodeCandidate[]): readonly CodeCandidate[] {
	const ranked = rerankByRelevance(task.task, pool).map((hit) => pool.find((candidate) => candidate.id === hit.id) as CodeCandidate);
	const target = pool.find((candidate) => candidate.path === task.path && candidate.symbol === task.symbol);
	if (!target) throw new Error(`target absent from candidate pool: ${task.id}`);
	const selected = ranked.slice(0, CANDIDATES_PER_TASK);
	if (!selected.some((candidate) => candidate.id === target.id)) selected[selected.length - 1] = target;
	return selected;
}

async function chat(model: string, prompt: string): Promise<ChatResult> {
	const started = performance.now();
	try {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: "You are a precise code-search relevance discriminator. Return only the required JSON." },
					{ role: "user", content: prompt },
				],
				temperature: 0,
				max_tokens: 1_024,
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "retrieval_rerank",
						strict: true,
						schema: {
							type: "object",
							properties: {
								ranked_ids: { type: "array", items: { type: "string" } },
								keep_ids: { type: "array", items: { type: "string" } },
							},
							required: ["ranked_ids", "keep_ids"],
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

async function runModel(lane: ModelLane, corpus: readonly CorpusTask[], pool: readonly CodeCandidate[]) {
	const outcomes = [];
	for (const task of corpus) {
		const candidates = taskCandidates(task, pool);
		const baselineRanking = rerankByRelevance(task.task, candidates).map((hit) => hit.id);
		const response = await chat(lane.model, buildRetrievalDiscriminatorPrompt({ query: task.task, candidates }));
		const decision = response.text ? parseRetrievalDiscriminatorDecision(response.text) : null;
		const applied = applyRetrievalDiscriminator(candidates, decision, { minKeep: 2, maxKeep: 4 });
		const target = candidates.find((candidate) => candidate.path === task.path && candidate.symbol === task.symbol) as CodeCandidate;
		const baselinePassed = baselineRanking[0] === target.id;
		const discriminatorPassed = decision?.rankedIds[0] === target.id && applied.applied;
		outcomes.push({
			model: lane.model,
			device: lane.device,
			taskId: task.id,
			task: task.task,
			target: { id: target.id, path: target.path, symbol: target.symbol },
			candidates: candidates.map(({ id, path, symbol }) => ({ id, path, symbol })),
			baselineRanking,
			baselinePassed,
			discriminatorRanking: decision?.rankedIds ?? [],
			discriminatorKeepIds: decision?.keepIds ?? [],
			discriminatorPassed,
			targetRetained: applied.applied && applied.kept.some((candidate) => candidate.id === target.id),
			keptCount: applied.applied ? applied.kept.length : candidates.length,
			prunedCount: applied.pruned.length,
			applied: applied.applied,
			response,
		});
		console.log(
			`${lane.device}/${lane.model} ${task.id}: lexical=${baselinePassed ? "PASS" : "FAIL"} model=${discriminatorPassed ? "PASS" : response.error || !applied.applied ? "INFRA" : "FAIL"} ${response.durationMs}ms`,
		);
	}
	return outcomes;
}

type RecordedOutcome = Awaited<ReturnType<typeof runModel>>[number];

function buildTrials(outcomes: readonly RecordedOutcome[]): Trial[] {
	return outcomes.flatMap((outcome, index) => {
		const infraError = outcome.response.error !== null || !outcome.applied;
		return [
			{ arm: "a" as const, index: index * 2, passed: outcome.baselinePassed, durationMs: 0, infraError: false },
			{
				arm: "b" as const,
				index: index * 2 + 1,
				passed: !infraError && outcome.discriminatorPassed,
				durationMs: outcome.response.durationMs,
				infraError,
			},
		];
	});
}

function summarizeModels(outcomes: readonly RecordedOutcome[]) {
	const byModel = new Map<string, RecordedOutcome[]>();
	for (const outcome of outcomes) byModel.set(outcome.model, [...(byModel.get(outcome.model) ?? []), outcome]);
	return [...byModel.entries()].map(([model, rows]) => ({
		model,
		device: rows[0]?.device ?? "unknown",
		count: rows.length,
		baselineCorrect: rows.filter((row) => row.baselinePassed).length,
		discriminatorCorrect: rows.filter((row) => row.discriminatorPassed).length,
		targetRetained: rows.filter((row) => row.targetRetained).length,
		infraFailures: rows.filter((row) => row.response.error !== null || !row.applied).length,
		better: rows.filter((row) => !row.baselinePassed && row.discriminatorPassed).length,
		worse: rows.filter((row) => row.baselinePassed && !row.discriminatorPassed && row.response.error === null && row.applied)
			.length,
		meanLatencyMs: rows.reduce((sum, row) => sum + row.response.durationMs, 0) / Math.max(1, rows.length),
		meanKept: rows.reduce((sum, row) => sum + row.keptCount, 0) / Math.max(1, rows.length),
	}));
}

async function main(): Promise<void> {
	if (process.env.NKLEIN_RERANK_RESUMMARIZE === "1") {
		const existing = JSON.parse(await readFile(OUTPUT, "utf8")) as {
			outcomes: RecordedOutcome[];
			[key: string]: unknown;
		};
		existing.trialSummary = summariseTrials(buildTrials(existing.outcomes));
		existing.perModel = summarizeModels(existing.outcomes);
		await writeFile(OUTPUT, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
		console.log(`resummarized evidence: ${OUTPUT}`);
		return;
	}
	const lanes = parseLanes();
	const corpus = await loadCorpus();
	const pool = await loadCandidatePool(corpus);
	const preRegistration = assessPreRegistration({
		declaredMdePoints: DECLARED_MDE_POINTS,
		design: { taskCount: corpus.length * lanes.length, repeats: 1 },
	});
	if (preRegistration.verdict === "underpowered_by_construction") {
		throw new Error(`refusing underpowered F11.2e run: ${preRegistration.reason}`);
	}
	const preflight = await Promise.all(
		lanes.map(async (lane) => {
			const candidates = pool.slice(0, 2);
			const response = await chat(lane.model, buildRetrievalDiscriminatorPrompt({ query: corpus[0].task, candidates }));
			const decision = response.text ? parseRetrievalDiscriminatorDecision(response.text) : null;
			return { lane, response, passed: applyRetrievalDiscriminator(candidates, decision).applied };
		}),
	);
	const failed = preflight.filter((entry) => !entry.passed || entry.response.error);
	if (failed.length) {
		throw new Error(`fleet preflight failed: ${failed.map((entry) => `${entry.lane.device}/${entry.lane.model}: ${entry.response.error ?? entry.response.text}`).join(" | ")}`);
	}

	const byDevice = new Map<string, ModelLane[]>();
	for (const lane of lanes) byDevice.set(lane.device, [...(byDevice.get(lane.device) ?? []), lane]);
	const outcomes = (
		await Promise.all(
			[...byDevice.values()].map(async (deviceLanes) => {
				const deviceOutcomes = [];
				for (const lane of deviceLanes) deviceOutcomes.push(...(await runModel(lane, corpus, pool)));
				return deviceOutcomes;
			}),
		)
	).flat();
	const valid = outcomes.filter((outcome) => outcome.response.error === null && outcome.applied);
	const decision = decideDefaultFlip({
		pairs: valid.map((outcome) => ({ a: outcome.baselinePassed, b: outcome.discriminatorPassed })),
		minEffect: 0.05,
	});
	const trials = buildTrials(outcomes);
	const aggregate = {
		pairCount: valid.length,
		infraFailures: outcomes.length - valid.length,
		baselineInterval: wilsonInterval(valid.filter((outcome) => outcome.baselinePassed).length, valid.length),
		discriminatorInterval: wilsonInterval(valid.filter((outcome) => outcome.discriminatorPassed).length, valid.length),
		targetRetentionRate: valid.filter((outcome) => outcome.targetRetained).length / Math.max(1, valid.length),
		meanKept: valid.reduce((sum, outcome) => sum + outcome.keptCount, 0) / Math.max(1, valid.length),
		decision,
	};
	const artifact = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		question: "Does a same-resident local-model discriminator improve exact top-1 code-hit ranking over lexical relevance while safely pruning distractors?",
		armA: "existing lexical relevance ranking",
		armB: "same-resident local-model discriminator over the same eight bounded candidates",
		declaredMdePoints: DECLARED_MDE_POINTS,
		preRegistration,
		harness: {
			execution: "LM Studio local OpenAI endpoint; temperature 0; max_tokens 1024; no retries",
			context: "same task and same eight real-symbol code candidates; only arm B receives model scoring",
			scheduling: "cap 1 per device; resident models sequential per device; devices parallel",
			verification: "exact target candidate at rank 1; secondary target retention under min-2/max-4 pruning",
			governance: "local-only, read-only, no tools or egress",
		},
		lanes,
		corpusSize: corpus.length,
		aggregate,
		perModel: summarizeModels(outcomes),
		trialSummary: summariseTrials(trials),
		outcomes,
	};
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	console.log(`\n${artifact.trialSummary.text}`);
	console.log(decision.reason);
	console.log(`retention ${(aggregate.targetRetentionRate * 100).toFixed(1)}%; mean kept ${aggregate.meanKept.toFixed(2)}/8`);
	console.log(`evidence: ${OUTPUT}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : error);
	process.exitCode = 1;
});
