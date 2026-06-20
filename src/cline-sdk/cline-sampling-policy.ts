import type { LocalLlmSamplingOptions } from "./cline-local-llm-client";
import { isSmallLocalModelId } from "./cline-model-tool-routing";

/**
 * Per-model / per-role sampling policy for the !Klein-owned local model path.
 *
 * Small/quantized models run far more reliably for agentic coding with deterministic, loop-resistant
 * sampling than with chat defaults (often temperature ≈0.7): low temperature for correctness, `min_p` to keep
 * the distribution coherent (arXiv:2407.01082), and a light `repetition_penalty` to suppress the degenerate
 * loops weak models fall into. Planning/architect work gets a slightly higher temperature for exploration.
 *
 * This only governs the direct `LocalLlmClient` path (the Cline SDK loop can't accept these levers). Pure and
 * unit-tested; callers may override any field.
 */

export type ClineSamplingRole = "architect" | "worker" | "reviewer" | "planner" | "structured" | "unknown";

export interface ResolveSamplingPolicyInput {
	modelId?: string | null;
	role?: ClineSamplingRole | null;
	/** Caller overrides win over every computed default. */
	override?: Partial<LocalLlmSamplingOptions>;
}

/** Deterministic baseline good for code edits and structured/tool output. */
const CODING_BASELINE: LocalLlmSamplingOptions = {
	temperature: 0.15,
	topP: 0.95,
	minP: 0.05,
	repetitionPenalty: 1.05,
};

/** Slightly more exploratory for planning/decomposition where some breadth helps. */
const PLANNING_BASELINE: LocalLlmSamplingOptions = {
	temperature: 0.3,
	topP: 0.95,
	minP: 0.05,
	repetitionPenalty: 1.05,
};

/** Near-greedy for structured/JSON generation where validity matters most. */
const STRUCTURED_BASELINE: LocalLlmSamplingOptions = {
	temperature: 0.1,
	topP: 0.9,
	minP: 0.05,
	repetitionPenalty: 1.05,
};

function baselineForRole(role: ClineSamplingRole): LocalLlmSamplingOptions {
	switch (role) {
		case "architect":
		case "planner":
			return { ...PLANNING_BASELINE };
		case "structured":
			return { ...STRUCTURED_BASELINE };
		default:
			return { ...CODING_BASELINE };
	}
}

export function resolveLocalSamplingOptions(input: ResolveSamplingPolicyInput = {}): LocalLlmSamplingOptions {
	const role = input.role ?? "unknown";
	const baseline = baselineForRole(role);
	// Small/quantized families are the most loop- and incoherence-prone: tighten temperature and penalty.
	if (isSmallLocalModelId(input.modelId)) {
		baseline.temperature = Math.min(
			baseline.temperature ?? 0.15,
			role === "architect" || role === "planner" ? 0.25 : 0.12,
		);
		baseline.repetitionPenalty = Math.max(baseline.repetitionPenalty ?? 1.05, 1.08);
	}
	return { ...baseline, ...stripUndefined(input.override) };
}

function stripUndefined(override: Partial<LocalLlmSamplingOptions> | undefined): Partial<LocalLlmSamplingOptions> {
	if (!override) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(override).filter(([, value]) => value !== undefined),
	) as Partial<LocalLlmSamplingOptions>;
}
