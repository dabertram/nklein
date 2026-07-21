/**
 * Live LongMemEval verifier for todo §5.M.
 *
 * It exercises the exact production recall composer, asks the selected resident reader model to answer only from that
 * returned context, proves the controls still discriminate, and retains the pair verdict consumed by runtime scope.
 */

import { resolveLoadedChatMemoryEmbedder, type ChatMemoryEmbedder } from "../src/chat/chat-memory-embedding.js";
import type { ChatMemory } from "../src/chat/chat-memory-store.js";
import { recallUnifiedMemoryBand } from "../src/chat/unified-memory-recall.js";
import {
	buildLongMemoryEvalRetainedVerdict,
	buildLongMemoryEvalRetentionEvent,
	buildLongMemoryStoreProfile,
	buildInternalLongMemoryEvalFixture,
	evaluateLongMemoryBenchmark,
	type LongMemoryEvalCase,
	type LongMemoryEvalPrompt,
} from "../src/core/long-memory-eval.js";
import { fetchLoadedModelIds } from "../src/core/lmstudio-loaded-models.js";
import { createDefaultLmsRunner, fetchLmsPsModels } from "../src/core/lms-ps-json.js";
import { scoreLongMemoryModelAnswer } from "../src/core/long-memory-live-eval.js";
import { hashWorkspacePathForLedger } from "../src/nklein-agent/nklein-ledger-attempt.js";
import { appendAgentLedgerEvent } from "../src/state/agent-attempt-ledger-store.js";

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
	const preferredEmbeddingModel = process.env.NKLEIN_LONG_MEMORY_EMBEDDING_MODEL?.trim() || null;
	const embedder = await resolveLoadedChatMemoryEmbedder({
		baseUrl: RAW_BASE,
		preferredModelId: preferredEmbeddingModel,
		failSoft: false,
	});
	if (preferredEmbeddingModel && !embedder) {
		throw new Error(`Embedding model "${preferredEmbeddingModel}" is not confirmed resident.`);
	}
	const storeProfile = buildLongMemoryStoreProfile(embedder?.modelId ?? null);
	const fixture = buildInternalLongMemoryEvalFixture();
	const selections = new Map<string, string[]>();
	const answerPassed: boolean[] = [];

	console.log(`long-memory-eval: model=${model} store=${storeProfile} base=${CHAT_URL} cases=${fixture.length}`);
	for (const case_ of fixture) {
		const storedMemories = await buildStoredMemories(case_, embedder);
		for (const prompt of case_.prompts) {
			const selectedIds = await retrieveWithProductionStack(case_, prompt, storedMemories, embedder);
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
	const verdict = buildLongMemoryEvalRetainedVerdict({
		modelId: model,
		storeProfile,
		report: liveReport,
		answersPassed,
		controlsDiscriminate,
		evaluatedAt: Date.now(),
	});
	await appendAgentLedgerEvent(
		buildLongMemoryEvalRetentionEvent({
			workspacePathHash: hashWorkspacePathForLedger(process.cwd()),
			verdict,
		}),
	);
	console.log(
		`result: recall=${liveReport.recallAtK.toFixed(3)} abstain=${liveReport.abstainAccuracy.toFixed(3)} dimensions=${JSON.stringify(liveReport.dimensionPassRate)} benchmark=${liveReport.passed ? "PASS" : "FAIL"} answers=${answersPassed ? "PASS" : "FAIL"} controls=${controlsDiscriminate ? "PASS" : "FAIL"} retained=${verdict.passed ? "PASS" : "FAIL"}`,
	);
	process.exit(verdict.passed ? 0 : 3);
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

async function buildStoredMemories(
	case_: LongMemoryEvalCase,
	embedder: ChatMemoryEmbedder | null,
): Promise<ChatMemory[]> {
	const memories: ChatMemory[] = [];
	for (const memory of case_.memories) {
		const embedding = embedder ? await embedder.embed(memory.text) : null;
		if (embedder && !embedding) throw new Error(`Embedding failed for fixture memory ${memory.id}.`);
		memories.push({
			schemaVersion: 1,
			id: memory.id,
			sessionId: `${memory.namespace}:${memory.sessionId}`,
			shared: false,
			text: memory.text,
			embedding,
			embeddingModelId: embedding ? embedder?.modelId ?? null : null,
			createdAt: memory.recordedAt,
		});
	}
	return memories;
}

async function retrieveWithProductionStack(
	case_: LongMemoryEvalCase,
	prompt: LongMemoryEvalPrompt,
	memories: readonly ChatMemory[],
	embedder: ChatMemoryEmbedder | null,
): Promise<string[]> {
	const recalled = await recallUnifiedMemoryBand(
		{
			query: prompt.query,
			sessionId: `${case_.id}:eval-driver`,
			chatMemories: memories,
			allProjects: true,
			chatMemoryLimit: 2,
			bandOptions: { maxRecords: 2, perSourceFloor: 0 },
		},
		embedder ? { embed: embedder.embed, embeddingModelId: embedder.modelId, requireEmbedding: true } : {},
	);
	return recalled.band.flatMap((record) => (record.source === "session" ? [record.id.replace(/^session:/u, "")] : []));
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
