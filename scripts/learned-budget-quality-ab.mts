/**
 * F4.11 live paired proof: near-overflow transcript versus the production learned-budget compaction of that transcript.
 * Uses resident LM Studio chat models only; it never loads, unloads, downloads, or changes residency.
 *
 * Optional env:
 *   NKLEIN_LEARNED_BUDGET_AB_MODELS=model-a,model-b
 *   NKLEIN_LEARNED_BUDGET_AB_CASES=delivery-contract,implementation-contract
 *   NKLEIN_LEARNED_BUDGET_AB_SMALL_MODELS=model-a
 *   NKLEIN_LEARNED_BUDGET_AB_CAPABLE_MODELS=model-b
 *   NKLEIN_LEARNED_BUDGET_AB_BASE_URL=http://127.0.0.1:1234/v1
 *   NKLEIN_LEARNED_BUDGET_AB_TIMEOUT_MS=300000
 *   NKLEIN_LEARNED_BUDGET_AB_MAX_TOKENS=1200
 *   NKLEIN_LEARNED_BUDGET_AB_ARM_ORDER=alternate|overflow-first|compacted-first
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseModelAttributes } from "../src/core/model-attributes.js";
import {
	buildLearnedBudgetQualityCases,
	buildLearnedBudgetQualityPair,
	countLearnedBudgetArmTokens,
	type LearnedBudgetModelTier,
	type LearnedBudgetQualityArm,
	type LearnedBudgetQualityObservation,
	scoreLearnedBudgetQualityAnswer,
	summarizeLearnedBudgetQualityAb,
} from "../src/nklein-agent/nklein-learned-budget-quality-ab.js";
import type { NKleinSdkPersistedMessage } from "../src/nklein-agent/sdk-runtime-boundary.js";

const RAW_BASE = (process.env.NKLEIN_LEARNED_BUDGET_AB_BASE_URL ?? "http://127.0.0.1:1234/v1")
	.trim()
	.replace(/\/+$/u, "");
const API_BASE = RAW_BASE.endsWith("/v1") ? RAW_BASE : `${RAW_BASE}/v1`;
const REQUEST_TIMEOUT_MS = Math.max(
	30_000,
	Number(process.env.NKLEIN_LEARNED_BUDGET_AB_TIMEOUT_MS ?? "300000"),
);
const MAX_COMPLETION_TOKENS = Math.max(
	300,
	Number(process.env.NKLEIN_LEARNED_BUDGET_AB_MAX_TOKENS ?? "1200"),
);

type ArmOrder = "alternate" | "overflow-first" | "compacted-first";

interface RawObservation {
	modelId: string;
	modelTier: LearnedBudgetModelTier;
	caseId: string;
	arm: LearnedBudgetQualityArm;
	latencyMs: number;
	promptTokens: number | null;
	completionTokens: number | null;
	finishReason: string | null;
	response: string;
	reasoning: string;
	score: ReturnType<typeof scoreLearnedBudgetQualityAnswer>;
}

interface FailedObservation {
	modelId: string;
	caseId: string | null;
	arm: LearnedBudgetQualityArm | "discovery";
	error: string;
}

function parseList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function requestedArmOrder(): ArmOrder {
	const value = (process.env.NKLEIN_LEARNED_BUDGET_AB_ARM_ORDER ?? "alternate").trim().toLowerCase();
	if (value === "alternate" || value === "overflow-first" || value === "compacted-first") return value;
	throw new Error(
		`NKLEIN_LEARNED_BUDGET_AB_ARM_ORDER must be alternate, overflow-first, or compacted-first; received ${JSON.stringify(value)}`,
	);
}

async function residentModels(): Promise<string[]> {
	const response = await fetch(`${API_BASE}/models`, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) throw new Error(`LM Studio model discovery failed: HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	const resident = (payload.data ?? []).flatMap((entry) =>
		entry.id && !entry.id.toLocaleLowerCase("en-US").includes("embed") ? [entry.id] : [],
	);
	const requested = parseList(process.env.NKLEIN_LEARNED_BUDGET_AB_MODELS);
	if (requested.length === 0) return resident;
	const missing = requested.filter((modelId) => !resident.includes(modelId));
	if (missing.length > 0) {
		throw new Error(`Requested model(s) are not resident at ${API_BASE}: ${missing.join(", ")}`);
	}
	return requested;
}

function requestedCases(): ReturnType<typeof buildLearnedBudgetQualityCases> {
	const available = buildLearnedBudgetQualityCases();
	const requested = parseList(process.env.NKLEIN_LEARNED_BUDGET_AB_CASES);
	if (requested.length === 0) return available;
	const byId = new Map(available.map((case_) => [case_.id, case_]));
	const missing = requested.filter((caseId) => !byId.has(caseId));
	if (missing.length > 0) throw new Error(`Unknown F4.11 case(s): ${missing.join(", ")}`);
	return requested.map((caseId) => byId.get(caseId)).filter((case_) => case_ !== undefined);
}

function classifyModel(modelId: string): LearnedBudgetModelTier {
	const explicitSmall = new Set(parseList(process.env.NKLEIN_LEARNED_BUDGET_AB_SMALL_MODELS));
	const explicitCapable = new Set(parseList(process.env.NKLEIN_LEARNED_BUDGET_AB_CAPABLE_MODELS));
	if (explicitSmall.has(modelId) && explicitCapable.has(modelId)) {
		throw new Error(`${modelId} cannot be both a small and capable F4.11 model.`);
	}
	if (explicitSmall.has(modelId)) return "small";
	if (explicitCapable.has(modelId)) return "capable";
	const paramB = parseModelAttributes(modelId).paramB;
	if (paramB === undefined) {
		throw new Error(
			`Cannot infer the F4.11 tier for ${modelId}; list it in NKLEIN_LEARNED_BUDGET_AB_SMALL_MODELS or NKLEIN_LEARNED_BUDGET_AB_CAPABLE_MODELS.`,
		);
	}
	return paramB < 14 ? "small" : "capable";
}

function toChatMessages(messages: readonly NKleinSdkPersistedMessage[]): Array<{ role: string; content: string }> {
	return messages.map((message) => {
		if (typeof message.content !== "string") {
			throw new Error("The F4.11 fixture unexpectedly produced structured content; refusing a lookalike serialization.");
		}
		return { role: message.role, content: message.content };
	});
}

async function runArm(input: {
	modelId: string;
	modelTier: LearnedBudgetModelTier;
	caseId: string;
	arm: LearnedBudgetQualityArm;
	messages: readonly NKleinSdkPersistedMessage[];
	case_: ReturnType<typeof buildLearnedBudgetQualityCases>[number];
}): Promise<RawObservation> {
	const startedAt = Date.now();
	const response = await fetch(`${API_BASE}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: input.modelId,
			messages: toChatMessages(input.messages),
			temperature: 0,
			max_tokens: MAX_COMPLETION_TOKENS,
			stream: false,
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const body = await response.text();
	let payload: {
		choices?: Array<{ finish_reason?: string | null; message?: { content?: string; reasoning_content?: string } }>;
		usage?: { prompt_tokens?: number; completion_tokens?: number };
		error?: unknown;
	};
	try {
		payload = JSON.parse(body) as typeof payload;
	} catch {
		throw new Error(`${input.modelId}/${input.caseId}/${input.arm}: malformed JSON: ${body.slice(0, 500)}`);
	}
	if (!response.ok || payload.error) {
		const errorMessage =
			typeof payload.error === "object" && payload.error !== null && "message" in payload.error
				? String(payload.error.message)
				: payload.error
					? JSON.stringify(payload.error)
					: body.slice(0, 500);
		throw new Error(
			`${input.modelId}/${input.caseId}/${input.arm}: HTTP ${response.status}: ${errorMessage}`,
		);
	}
	const choice = payload.choices?.[0];
	const answer = choice?.message?.content?.trim() ?? "";
	return {
		modelId: input.modelId,
		modelTier: input.modelTier,
		caseId: input.caseId,
		arm: input.arm,
		latencyMs: Date.now() - startedAt,
		promptTokens: payload.usage?.prompt_tokens ?? null,
		completionTokens: payload.usage?.completion_tokens ?? null,
		finishReason: choice?.finish_reason ?? null,
		response: answer,
		reasoning: choice?.message?.reasoning_content?.trim() ?? "",
		score: scoreLearnedBudgetQualityAnswer(answer, input.case_),
	};
}

async function main(): Promise<void> {
	const models = await residentModels();
	if (models.length === 0) throw new Error(`No resident chat models found at ${API_BASE}.`);
	const cases = requestedCases();
	const pairs = new Map(cases.map((case_) => [case_.id, buildLearnedBudgetQualityPair(case_)]));
	const modelTierById = Object.fromEntries(models.map((modelId) => [modelId, classifyModel(modelId)])) as Record<
		string,
		LearnedBudgetModelTier
	>;
	const armOrder = requestedArmOrder();
	const raw: RawObservation[] = [];
	const failures: FailedObservation[] = [];
	const outputRoot = process.env.NKLEIN_LEARNED_BUDGET_AB_OUTPUT_DIR ?? join(process.cwd(), ".real-runs");
	await mkdir(outputRoot, { recursive: true });
	const outputPath = join(outputRoot, `learned-budget-quality-ab-${Date.now()}.json`);

	const writeCheckpoint = async (): Promise<ReturnType<typeof summarizeLearnedBudgetQualityAb>> => {
		const observations: LearnedBudgetQualityObservation[] = [];
		for (const modelId of models) {
			for (const case_ of cases) {
				const overflowThreshold = raw.find(
					(row) => row.modelId === modelId && row.caseId === case_.id && row.arm === "overflow_threshold",
				);
				const learnedCompacted = raw.find(
					(row) => row.modelId === modelId && row.caseId === case_.id && row.arm === "learned_compacted",
				);
				if (overflowThreshold && learnedCompacted) {
					observations.push({
						modelId,
						modelTier: modelTierById[modelId],
						caseId: case_.id,
						overflowThreshold: overflowThreshold.score,
						learnedCompacted: learnedCompacted.score,
					});
				}
			}
		}
		const measuredVerdict = summarizeLearnedBudgetQualityAb(observations);
		const expectedPairs = models.length * cases.length;
		const verdict =
			failures.length === 0 && observations.length === expectedPairs
				? measuredVerdict
				: { ...measuredVerdict, decision: "inconclusive" as const };
		await writeFile(
			outputPath,
			`${JSON.stringify(
				{
					createdAt: new Date().toISOString(),
					apiBase: API_BASE,
					models,
					modelTierById,
					armOrder,
					maxCompletionTokens: MAX_COMPLETION_TOKENS,
					residencyMode: "resident-only-no-lifecycle-mutation",
					pairs: [...pairs.values()].map((pair) => ({
						caseId: pair.caseId,
						learnedBudgetTokens: pair.learnedBudgetTokens,
						originalProjectedTokens: pair.plan.originalProjectedTokens,
						compactedProjectedTokens: pair.plan.projectedTokens,
						overflowThresholdMessageTokens: countLearnedBudgetArmTokens(pair.overflowThresholdMessages),
						learnedCompactedMessageTokens: countLearnedBudgetArmTokens(pair.learnedCompactedMessages),
					})),
					raw,
					failures,
					observations,
					verdict,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		return verdict;
	};

	await writeCheckpoint();
	let pairIndex = 0;
	for (const modelId of models) {
		const modelTier = modelTierById[modelId];
		for (const case_ of cases) {
			const pair = pairs.get(case_.id);
			if (!pair) throw new Error(`Missing F4.11 pair for ${case_.id}.`);
			const overflowFirst = armOrder === "overflow-first" || (armOrder === "alternate" && pairIndex % 2 === 0);
			const arms: LearnedBudgetQualityArm[] = overflowFirst
				? ["overflow_threshold", "learned_compacted"]
				: ["learned_compacted", "overflow_threshold"];
			pairIndex += 1;
			for (const arm of arms) {
				process.stderr.write(`[learned-budget-ab] ${modelId} (${modelTier}) ${case_.id}/${arm}\n`);
				try {
					const observation = await runArm({
						modelId,
						modelTier,
						caseId: case_.id,
						arm,
						messages:
							arm === "overflow_threshold"
								? pair.overflowThresholdMessages
								: pair.learnedCompactedMessages,
						case_,
					});
					raw.push(observation);
					process.stderr.write(
						`[learned-budget-ab] score=${observation.score.score.toFixed(2)} pass=${observation.score.passed} ` +
							`prompt=${observation.promptTokens ?? "?"} finish=${observation.finishReason ?? "?"} latency=${observation.latencyMs}ms\n`,
					);
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					failures.push({
						modelId,
						caseId: case_.id,
						arm,
						error: errorMessage,
					});
					process.stderr.write(`[learned-budget-ab] ERROR ${errorMessage}\n`);
				}
				await writeCheckpoint();
				if (failures.some((failure) => failure.modelId === modelId && failure.caseId === case_.id)) break;
			}
		}
	}
	const verdict = await writeCheckpoint();
	console.log(JSON.stringify({ outputPath, models, modelTierById, failures, verdict }, null, 2));
	process.exitCode = verdict.decision === "fail" ? 3 : failures.length > 0 || verdict.decision === "inconclusive" ? 2 : 0;
}

void main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exitCode = 1;
});
