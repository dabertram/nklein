/**
 * Live LongMemEval verifier for todo §5.M.
 *
 * This script does not wire memory-scope broadening into runtime. It only validates that the already-authored benchmark
 * discriminates a real model-backed recall loop before that runtime wiring is allowed.
 */

import {
	buildInternalLongMemoryEvalFixture,
	evaluateLongMemoryBenchmark,
	type LongMemoryEvalCase,
} from "../src/core/long-memory-eval.js";
import { fetchLoadedModelIds } from "../src/core/lmstudio-loaded-models.js";
import { createDefaultLmsRunner, fetchLmsPsModels } from "../src/core/lms-ps-json.js";
import { parseLongMemorySelection, scoreLongMemoryModelAnswer } from "../src/core/long-memory-live-eval.js";

const RAW_BASE = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1").trim().replace(/\/+$/u, "");
const CHAT_URL = `${RAW_BASE.endsWith("/v1") ? RAW_BASE : `${RAW_BASE}/v1`}/chat/completions`;
const MAX_TOKENS = Number(process.env.NKLEIN_LONG_MEMORY_EVAL_MAX_TOKENS ?? "700");
const REQUEST_TIMEOUT_MS = Number(process.env.NKLEIN_LONG_MEMORY_EVAL_TIMEOUT_MS ?? "120000");

interface ChatMessage {
	role: "system" | "user";
	content: string;
}

interface ChatResponseMessage {
	content?: string;
	reasoning_content?: string;
}

interface JsonResponseSchema {
	name: string;
	schema: Record<string, unknown>;
}

const SELECTION_RESPONSE_SCHEMA: JsonResponseSchema = {
	name: "long_memory_selection",
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			memoryIds: {
				type: "array",
				items: { type: "string" },
			},
		},
		required: ["memoryIds"],
	},
};

const ANSWER_RESPONSE_SCHEMA: JsonResponseSchema = {
	name: "long_memory_answer",
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			answerable: { type: "boolean" },
			answer: { type: "string" },
		},
		required: ["answerable", "answer"],
	},
};

async function main(): Promise<void> {
	const model = await resolveModel();
	await assertResident(model);
	const fixture = buildInternalLongMemoryEvalFixture();
	const selections = new Map<string, string[]>();
	const answerPassed: boolean[] = [];

	console.log(`long-memory-eval: model=${model} base=${CHAT_URL} cases=${fixture.length}`);
	for (const case_ of fixture) {
		for (const prompt of case_.prompts) {
			const selectedIds = await selectMemories(model, case_, prompt.id);
			selections.set(key(case_.id, prompt.id), selectedIds);
			const selectedMemories = case_.memories.filter((memory) => selectedIds.includes(memory.id));
			const rawAnswer = await answerFromMemories(model, prompt.query, selectedMemories);
			const answerScore = scoreLongMemoryModelAnswer(case_, prompt, rawAnswer);
			answerPassed.push(answerScore.passed);
			console.log(
				`  ${prompt.id}: selected=[${selectedIds.join(", ") || "none"}] answer=${answerScore.passed ? "PASS" : "FAIL"} (${answerScore.reason})`,
			);
			if (answerScore.missingNeedles.length > 0) {
				console.log(`    missing: ${answerScore.missingNeedles.join(", ")}`);
			}
		}
	}

	const liveReport = evaluateLongMemoryBenchmark(fixture, ({ case_, prompt }) => selections.get(key(case_.id, prompt.id)) ?? [], {
		k: 2,
	});
	const narrowControl = evaluateLongMemoryBenchmark(fixture, narrowFirstSessionOnlyRanker, { k: 2 });
	const noisyControl = evaluateLongMemoryBenchmark(fixture, ({ case_ }) => case_.memories.map((memory) => memory.id), { k: 2 });
	const answersPassed = answerPassed.every(Boolean);
	const controlsDiscriminate = !narrowControl.passed && !noisyControl.passed;
	console.log(
		`result: recall=${liveReport.recallAtK.toFixed(3)} abstain=${liveReport.abstainAccuracy.toFixed(3)} benchmark=${liveReport.passed ? "PASS" : "FAIL"} answers=${answersPassed ? "PASS" : "FAIL"} controls=${controlsDiscriminate ? "PASS" : "FAIL"}`,
	);
	process.exit(liveReport.passed && answersPassed && controlsDiscriminate ? 0 : 3);
}

async function resolveModel(): Promise<string> {
	const configured = (process.env.NKLEIN_LONG_MEMORY_EVAL_MODEL ?? process.env.NKLEIN_VERIFY_MODEL ?? "").trim();
	if (configured) {
		return configured;
	}
	const models = await fetchLmsPsModels(createDefaultLmsRunner());
	const candidate =
		models.find((model) => !model.isEmbedding && model.status?.toLowerCase() === "idle") ??
		models.find((model) => !model.isEmbedding);
	if (!candidate) {
		throw new Error("No loaded LM Studio chat model found. Set NKLEIN_VERIFY_MODEL to an already-loaded model id.");
	}
	return candidate.identifier;
}

async function assertResident(model: string): Promise<void> {
	const [apiLoaded, psLoaded] = await Promise.all([
		fetchLoadedModelIds(RAW_BASE),
		fetchLmsPsModels(createDefaultLmsRunner()),
	]);
	const psIds = psLoaded.filter((entry) => !entry.isEmbedding).map((entry) => entry.identifier);
	if (apiLoaded.includes(model) || psIds.includes(model)) {
		return;
	}
	const observed = [...new Set([...apiLoaded, ...psIds])];
	throw new Error(
		`Model "${model}" is not confirmed resident. This verifier does not load models. Observed: ${observed.join(", ") || "none"}.`,
	);
}

async function selectMemories(model: string, case_: LongMemoryEvalCase, promptId: string): Promise<string[]> {
	const prompt = case_.prompts.find((entry) => entry.id === promptId);
	if (!prompt) {
		throw new Error(`Unknown prompt ${promptId}`);
	}
	const raw = await chatText(
		model,
		[
			{
				role: "system",
				content:
					'Select only memory IDs that directly answer the query. Use no outside knowledge. Return only JSON: {"memoryIds":["id"]}. Return {"memoryIds":[]} when none apply.',
			},
			{
				role: "user",
				content: `Query: ${prompt.query}\n\nMemories:\n${case_.memories
					.map((memory) => `- ${memory.id}: ${memory.text}`)
					.join("\n")}`,
			},
		],
		SELECTION_RESPONSE_SCHEMA,
	);
	return parseLongMemorySelection(raw, case_.memories.map((memory) => memory.id));
}

async function answerFromMemories(
	model: string,
	query: string,
	memories: ReadonlyArray<{ id: string; text: string }>,
): Promise<string> {
	const rawMemories =
		memories.length === 0 ? "(none)" : memories.map((memory) => `- ${memory.id}: ${memory.text}`).join("\n");
	return chatText(
		model,
		[
			{
				role: "system",
				content:
					'Answer only from supplied memories. Return only JSON: {"answerable":boolean,"answer":string}. If no supplied memory directly answers, use {"answerable":false,"answer":""}.',
			},
			{
				role: "user",
				content: `Query: ${query}\n\nSupplied memories:\n${rawMemories}`,
			},
		],
		ANSWER_RESPONSE_SCHEMA,
	);
}

async function chatText(model: string, messages: ChatMessage[], responseSchema: JsonResponseSchema): Promise<string> {
	const response = await fetch(CHAT_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model,
			messages,
			temperature: 0,
			max_tokens: MAX_TOKENS,
			stream: false,
			response_format: {
				type: "json_schema",
				json_schema: {
					name: responseSchema.name,
					strict: true,
					schema: responseSchema.schema,
				},
			},
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`LM Studio request failed with HTTP ${response.status}: ${text.trim()}`);
	}
	const json = JSON.parse(text) as { choices?: Array<{ message?: ChatResponseMessage }> };
	const message = json.choices?.[0]?.message;
	const content = message?.content?.trim();
	if (content) {
		return content;
	}
	return message?.reasoning_content?.trim() ?? "";
}

function narrowFirstSessionOnlyRanker({
	case_,
	prompt,
}: {
	case_: LongMemoryEvalCase;
	prompt: { relevantMemoryIds: readonly string[] };
}): string[] {
	if (prompt.relevantMemoryIds.length === 0) {
		return [];
	}
	return case_.memories.filter((memory) => memory.sessionId === "alpha-session-1").map((memory) => memory.id);
}

function key(caseId: string, promptId: string): string {
	return `${caseId}:${promptId}`;
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
