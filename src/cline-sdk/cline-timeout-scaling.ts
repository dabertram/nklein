import { isLocalProvider } from "./cline-local-only-policy";
import {
	buildClineModelRegistryKey,
	type ClineModelRegistrySnapshot,
	type ClineModelRegistrySpeedStats,
} from "./cline-model-registry";

const CLINE_TIMEOUT_SPEED_BUFFER_MS = 60 * 1000;
const CLINE_TIMEOUT_SPEED_MULTIPLIER = 3;
const CLINE_TIMEOUT_OUTPUT_TOKENS_ESTIMATE = 1_000;
const CLINE_TIMEOUT_COLD_START_PREFILL_TOKENS_PER_SECOND_PRIOR = 25;
const CLINE_TIMEOUT_COLD_START_DECODE_TOKENS_PER_SECOND_PRIOR = 4;

export interface ClineTimeoutSettings {
	timeoutMode: "normal" | "long" | "extended" | "unlimited";
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	timeoutProfile?: "cloud" | "local" | "custom";
}

export interface ClineTimeoutLaunchModel {
	providerId: string;
	modelId?: string | null;
	baseUrl?: string | null;
}

function normalizePositiveTimeoutEstimate(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.trunc(value);
}

function maxPositiveTimeoutEstimate(values: Array<number | null | undefined>): number | null {
	let max: number | null = null;
	for (const value of values) {
		const normalized = normalizePositiveTimeoutEstimate(value);
		if (normalized === null) {
			continue;
		}
		max = max === null ? normalized : Math.max(max, normalized);
	}
	return max;
}

function scaleObservedDurationForTimeout(value: number | null): number | null {
	if (value === null) {
		return null;
	}
	return Math.trunc(value * CLINE_TIMEOUT_SPEED_MULTIPLIER + CLINE_TIMEOUT_SPEED_BUFFER_MS);
}

function raisePositiveTimeout(value: number | null, minimum: number | null): number | null {
	if (value === null || value === 0 || minimum === null) {
		return value;
	}
	return Math.max(value, minimum);
}

function estimateModelRequestDurationMs(input: {
	speed: ClineModelRegistrySpeedStats;
	promptTokens: number;
	outputTokens: number;
}): number | null {
	const promptTokens = Math.max(0, Math.trunc(input.promptTokens));
	const outputTokens = Math.max(0, Math.trunc(input.outputTokens));
	const promptEvalFromWallMsPer1k =
		input.speed.wallTimeMsPer1kPromptTokensEwma && promptTokens > 0
			? input.speed.wallTimeMsPer1kPromptTokensEwma * (promptTokens / 1000)
			: null;
	const promptEvalFromPrefillTps =
		input.speed.prefillTokensPerSecondEwma && promptTokens > 0
			? (promptTokens / input.speed.prefillTokensPerSecondEwma) * 1000
			: null;
	const decodeFromTps =
		input.speed.decodeTokensPerSecondEwma && outputTokens > 0
			? (outputTokens / input.speed.decodeTokensPerSecondEwma) * 1000
			: null;
	const scaledWallTime =
		input.speed.wallTimeMsEwma && input.speed.promptTokensEwma && promptTokens > 0
			? input.speed.wallTimeMsEwma * Math.max(1, promptTokens / input.speed.promptTokensEwma)
			: input.speed.wallTimeMsEwma;
	const componentTotal = maxPositiveTimeoutEstimate([input.speed.ttftMsEwma, promptEvalFromPrefillTps, decodeFromTps])
		? (normalizePositiveTimeoutEstimate(input.speed.ttftMsEwma) ?? 0) +
			(normalizePositiveTimeoutEstimate(promptEvalFromPrefillTps) ?? 0) +
			(normalizePositiveTimeoutEstimate(decodeFromTps) ?? 0)
		: null;

	return maxPositiveTimeoutEstimate([promptEvalFromWallMsPer1k, scaledWallTime, componentTotal]);
}

function estimateModelFirstTokenDurationMs(input: {
	speed: ClineModelRegistrySpeedStats;
	promptTokens: number;
}): number | null {
	const promptTokens = Math.max(0, Math.trunc(input.promptTokens));
	const promptEvalFromWallMsPer1k =
		input.speed.wallTimeMsPer1kPromptTokensEwma && promptTokens > 0
			? input.speed.wallTimeMsPer1kPromptTokensEwma * (promptTokens / 1000)
			: null;
	const promptEvalFromPrefillTps =
		input.speed.prefillTokensPerSecondEwma && promptTokens > 0
			? (promptTokens / input.speed.prefillTokensPerSecondEwma) * 1000
			: null;
	const scaledWallTime =
		input.speed.wallTimeMsEwma && input.speed.promptTokensEwma && promptTokens > 0
			? input.speed.wallTimeMsEwma * Math.max(1, promptTokens / input.speed.promptTokensEwma)
			: null;
	const firstTokenComponent =
		(normalizePositiveTimeoutEstimate(input.speed.ttftMsEwma) ?? 0) +
		(normalizePositiveTimeoutEstimate(promptEvalFromPrefillTps) ?? 0);
	return maxPositiveTimeoutEstimate([
		promptEvalFromWallMsPer1k,
		scaledWallTime,
		firstTokenComponent > 0 ? firstTokenComponent : null,
	]);
}

function estimateColdStartRequestDurationMs(input: {
	contextWindow: number | null | undefined;
	promptTokens: number;
	outputTokens: number;
}): number | null {
	const contextWindow =
		typeof input.contextWindow === "number" && Number.isFinite(input.contextWindow) && input.contextWindow > 0
			? Math.trunc(input.contextWindow)
			: null;
	if (contextWindow === null) {
		return null;
	}
	const promptTokens = Math.max(
		Math.trunc(input.promptTokens),
		Math.min(contextWindow, Math.round(contextWindow * 0.5)),
	);
	const outputTokens = Math.max(0, Math.trunc(input.outputTokens));
	const prefillMs = (promptTokens / CLINE_TIMEOUT_COLD_START_PREFILL_TOKENS_PER_SECOND_PRIOR) * 1000;
	const decodeMs = (outputTokens / CLINE_TIMEOUT_COLD_START_DECODE_TOKENS_PER_SECOND_PRIOR) * 1000;
	return normalizePositiveTimeoutEstimate(prefillMs + decodeMs);
}

export function applyMcsrAwareLocalTimeoutScaling<TTimeouts extends ClineTimeoutSettings>(input: {
	timeouts: TTimeouts;
	launchConfig: ClineTimeoutLaunchModel;
	modelRegistry: ClineModelRegistrySnapshot;
	promptTokens: number;
}): TTimeouts {
	if (
		input.timeouts.timeoutMode === "unlimited" ||
		!isLocalProvider(input.launchConfig.providerId, input.launchConfig.baseUrl) ||
		!input.launchConfig.modelId
	) {
		return input.timeouts;
	}
	const modelKey = buildClineModelRegistryKey({
		providerId: input.launchConfig.providerId,
		modelId: input.launchConfig.modelId,
		endpoint: input.launchConfig.baseUrl ?? null,
	});
	const speed = input.modelRegistry.models[modelKey]?.speed ?? null;
	if (!speed || speed.samples <= 0) {
		const coldStartMinimumMs = scaleObservedDurationForTimeout(
			estimateColdStartRequestDurationMs({
				contextWindow: input.modelRegistry.models[modelKey]?.contextWindow.effective,
				promptTokens: input.promptTokens,
				outputTokens: CLINE_TIMEOUT_OUTPUT_TOKENS_ESTIMATE,
			}),
		);
		return {
			...input.timeouts,
			requestTimeoutMs: raisePositiveTimeout(input.timeouts.requestTimeoutMs, coldStartMinimumMs),
			streamTimeoutMs: raisePositiveTimeout(input.timeouts.streamTimeoutMs, coldStartMinimumMs),
			toolTimeoutMs: raisePositiveTimeout(input.timeouts.toolTimeoutMs, coldStartMinimumMs),
			agentTimeoutMs: raisePositiveTimeout(input.timeouts.agentTimeoutMs, coldStartMinimumMs),
			conversationTimeoutMs: raisePositiveTimeout(input.timeouts.conversationTimeoutMs, coldStartMinimumMs),
		};
	}
	const requestMinimumMs = scaleObservedDurationForTimeout(
		estimateModelRequestDurationMs({
			speed,
			promptTokens: input.promptTokens,
			outputTokens: CLINE_TIMEOUT_OUTPUT_TOKENS_ESTIMATE,
		}),
	);
	const firstTokenMinimumMs = scaleObservedDurationForTimeout(
		estimateModelFirstTokenDurationMs({
			speed,
			promptTokens: input.promptTokens,
		}),
	);

	return {
		...input.timeouts,
		requestTimeoutMs: raisePositiveTimeout(input.timeouts.requestTimeoutMs, requestMinimumMs),
		streamTimeoutMs: raisePositiveTimeout(input.timeouts.streamTimeoutMs, firstTokenMinimumMs),
		toolTimeoutMs: raisePositiveTimeout(input.timeouts.toolTimeoutMs, firstTokenMinimumMs),
		agentTimeoutMs: raisePositiveTimeout(input.timeouts.agentTimeoutMs, requestMinimumMs),
		conversationTimeoutMs: raisePositiveTimeout(input.timeouts.conversationTimeoutMs, requestMinimumMs),
	};
}
