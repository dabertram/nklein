/**
 * F12.27 tool-role QUANTIZATION FLOOR + adaptive THINKING BUDGET (inference levers, feeds H7.32) — PURE core.
 *
 * Two findings, one module, because both are levers pulled at the same moment — when a card is about to be handed
 * to a model:
 *
 *  1. QUANT FLOOR. Aggressive quantization degrades TOOL-CALL reliability well before it degrades chat quality: a
 *     Q3 model still writes plausible prose while emitting malformed arguments and hallucinated tool names. The
 *     practical floor for a tool-using role is Q4_K_M — 4 bits AND a k-quant of at least medium tier. A legacy
 *     `q4_0` at the same bit width is NOT equivalent and is flagged.
 *     Note for !Klein specifically: architect, worker and reviewer are ALL tool-driven (the harness has no
 *     chat-only role), so this floor is effectively global here rather than role-conditional. The role is still an
 *     input because the SEVERITY differs — a worker mangling an edit tool corrupts files, while a reviewer
 *     mangling `submit_review` merely stalls.
 *
 *  2. THINKING BUDGET. Reasoning tokens help hard cards, but triggering a tool MID-chain-of-thought can CUT
 *     accuracy — the model commits to a plan, then acts on a half-finished one. So the budget scales with card
 *     difficulty and is PULLED BACK when the turn is expected to be tool-dense.
 *
 * Honesty stance: an id that carries no quant token yields `"unknown"`, never `"ok"`. Most served ids genuinely
 * omit the quant (`qwen2.5-coder-14b`), so unknown must not BLOCK — but it also must not be recorded as a pass.
 * It is reported as unverified, which is what it is.
 */

import { parseModelAttributes } from "./model-attributes";
import type { SwarmRole } from "./role-model-class";

/** Bit width at or above which tool-calling is considered reliable. */
const FLOOR_BITS = 4;

/**
 * Ranked GGUF k-quant variant tiers. Used only to break ties WITHIN a bit width — `q4_k_m` clears the floor while
 * the legacy `q4_0` at the same width does not. Anything unlisted ranks 0 (treated as legacy/unknown tier).
 */
const VARIANT_TIER: Readonly<Record<string, number>> = {
	xxs: 1,
	xs: 2,
	s: 3,
	m: 4,
	l: 5,
	xl: 6,
	xxl: 7,
};

export interface QuantizationReading {
	/** Normalized quant label as parsed from the id, or null when the id carries none. */
	readonly quant: string | null;
	/** Bit width, or null when it cannot be read. */
	readonly bits: number | null;
	/** Variant tier rank within the bit width (0 = legacy/none). */
	readonly variantTier: number;
	/** True for a GGUF k-quant (`q4_k_m`); false for `@Nbit` aliases and legacy `q4_0`. */
	readonly kQuant: boolean;
}

/**
 * Read the quantization of a model id into comparable parts. Returns nulls rather than guesses — the id is the
 * only evidence available and it is frequently silent.
 */
export function readQuantization(modelId: string): QuantizationReading {
	const quant = parseModelAttributes(modelId).quant ?? null;
	if (quant === null) {
		return { quant: null, bits: null, variantTier: 0, kQuant: false };
	}
	const bitAlias = quant.match(/^(\d{1,2})bit$/);
	if (bitAlias) {
		// An `@4bit` MLX alias states a width but no k-quant tier; treat the tier as unstated, not as legacy-bad.
		return { quant, bits: Number.parseInt(bitAlias[1], 10), variantTier: 0, kQuant: false };
	}
	const gguf = quant.match(/^i?q(\d)((?:_[a-z0-9]+)*)$/);
	if (!gguf) {
		return { quant, bits: null, variantTier: 0, kQuant: false };
	}
	const parts = gguf[2].split("_").filter((part) => part.length > 0);
	const kQuant = parts.includes("k");
	const tier = parts.reduce((best, part) => Math.max(best, VARIANT_TIER[part] ?? 0), 0);
	return { quant, bits: Number.parseInt(gguf[1], 10), variantTier: tier, kQuant };
}

export type QuantFloorVerdict = "ok" | "below_floor" | "unknown";

export interface QuantFloorAssessment {
	readonly verdict: QuantFloorVerdict;
	readonly reading: QuantizationReading;
	/** How bad a tool-call failure is for this role — drives how loudly the caller should surface a breach. */
	readonly severity: "high" | "medium";
	readonly reason: string;
}

/** A worker's malformed tool call writes bad bytes; a reviewer's merely stalls the card. */
function severityForRole(role: SwarmRole): "high" | "medium" {
	return role === "reviewer" ? "medium" : "high";
}

/**
 * Assess a model id against the tool-role quantization floor (Q4_K_M). Never throws; an unreadable id is
 * `"unknown"`, which the caller should record but must not treat as a pass or as a block.
 */
export function assessQuantizationFloor(input: {
	readonly modelId: string;
	readonly role: SwarmRole;
}): QuantFloorAssessment {
	const reading = readQuantization(input.modelId);
	const severity = severityForRole(input.role);
	if (reading.bits === null) {
		return {
			verdict: "unknown",
			reading,
			severity,
			reason:
				reading.quant === null
					? `"${input.modelId}" carries no quant token — the Q4_K_M tool-call floor could NOT be verified (unverified, not cleared)`
					: `quant "${reading.quant}" is not a recognized width — the Q4_K_M floor could NOT be verified`,
		};
	}
	if (reading.bits < FLOOR_BITS) {
		return {
			verdict: "below_floor",
			reading,
			severity,
			reason: `${reading.quant} is ${reading.bits}-bit — below the Q4_K_M floor, where tool-call reliability degrades before chat quality does`,
		};
	}
	// At exactly the floor width, a GGUF k-quant must also reach medium tier; `q4_0`/`q4_k_s` fall short.
	if (reading.bits === FLOOR_BITS && reading.quant?.startsWith("q") && !reading.quant.includes("bit")) {
		if (!reading.kQuant || reading.variantTier < VARIANT_TIER.m) {
			return {
				verdict: "below_floor",
				reading,
				severity,
				reason: `${reading.quant} is 4-bit but below the K_M tier — the floor is Q4_K_M, and a legacy/small 4-bit variant is not equivalent at the same width`,
			};
		}
	}
	return {
		verdict: "ok",
		reading,
		severity,
		reason: `${reading.quant} clears the Q4_K_M tool-call floor`,
	};
}

export interface ThinkingBudgetInput {
	/** Card difficulty 0..1 (higher = harder). Non-finite is treated as maximally hard. */
	readonly difficulty: number;
	/** Expected tool calls this turn. Tool-dense turns get LESS thinking, not more. */
	readonly expectedToolCalls: number;
	/** True when the model exposes a reasoning channel at all; false disables the lever entirely. */
	readonly supportsThinking: boolean;
}

export type ThinkingBudgetLevel = "none" | "low" | "medium" | "high";

export interface ThinkingBudgetPlan {
	readonly level: ThinkingBudgetLevel;
	readonly reason: string;
}

/** Above this many expected tool calls, a turn is "tool-dense" and deep thinking starts to hurt. */
const TOOL_DENSE = 3;

/**
 * Budget reasoning tokens for one turn. Deliberately conservative in the tool-dense case: the failure mode there
 * is not "thought too little" but "acted on a half-formed plan mid-thought", and that failure is invisible in the
 * output — it looks like a confident wrong edit.
 */
export function planThinkingBudget(input: ThinkingBudgetInput): ThinkingBudgetPlan {
	if (!input.supportsThinking) {
		return { level: "none", reason: "model exposes no reasoning channel — the lever does not apply" };
	}
	const difficulty = Number.isFinite(input.difficulty) ? Math.max(0, Math.min(1, input.difficulty)) : 1;
	const toolCalls = Number.isFinite(input.expectedToolCalls) ? Math.max(0, input.expectedToolCalls) : TOOL_DENSE + 1;

	if (toolCalls > TOOL_DENSE) {
		// Hard AND tool-dense still gets SOME thinking — but capped, because the chain will be interrupted.
		const level: ThinkingBudgetLevel = difficulty > 0.75 ? "low" : "none";
		return {
			level,
			reason: `${toolCalls} expected tool calls — a tool triggered mid-chain-of-thought cuts accuracy, so thinking is held to "${level}" despite difficulty ${difficulty.toFixed(2)}`,
		};
	}
	if (difficulty > 0.75) {
		return {
			level: "high",
			reason: `hard card (${difficulty.toFixed(2)}) with a short tool chain — thinking pays here`,
		};
	}
	if (difficulty > 0.4) {
		return { level: "medium", reason: `moderate card (${difficulty.toFixed(2)}) — a bounded reasoning budget` };
	}
	return {
		level: "low",
		reason: `easy card (${difficulty.toFixed(2)}) — reasoning tokens buy little and cost latency`,
	};
}

/**
 * Map a planned budget onto the provider-facing `reasoningEffort` enum (`low`/`medium`/`high`/`xhigh`).
 *
 * `"none"` maps to `null`, NOT to `"low"`: that enum has no off switch, so the only faithful expression of "do not
 * spend reasoning tokens here" is to send no override and let the provider default stand. Collapsing it to `"low"`
 * would silently turn a recommendation to ABSTAIN into a recommendation to think a little.
 */
export function toReasoningEffort(level: ThinkingBudgetLevel): "low" | "medium" | "high" | null {
	return level === "none" ? null : level;
}

/**
 * F12.71 quant-by-ROLE policy — refines the flat Q4_K_M floor above with the COMPOUNDING argument.
 *
 * A per-step error rate that looks negligible does not stay negligible over a long chain: at ~0.5%/step (Q4_K_M)
 * a 50-step card ends up above 10% cumulative, while ~0.2%/step (Q6) lands near 4% for roughly 1.5× the VRAM.
 * Code and math are the most quant-sensitive domains, which is precisely what this harness does all day.
 *
 * So the floor is a FLOOR, not a target: short ephemeral work is fine at it, and long-horizon work should climb.
 */

/** Published per-step error rates by quant tier. Approximate and sourced from the backlog note, not measured here. */
const PER_STEP_ERROR: Readonly<Record<QuantTarget, number>> = {
	q4_k_m: 0.005,
	q5_k_m: 0.003,
	q6_k: 0.002,
};

export type QuantTarget = "q4_k_m" | "q5_k_m" | "q6_k";

/**
 * Probability that at least one step goes wrong across `steps` independent steps at `perStep` error rate.
 * This is the whole argument for the policy, expressed rather than asserted.
 */
export function compoundedErrorRate(perStep: number, steps: number): number {
	if (!Number.isFinite(perStep) || !Number.isFinite(steps) || steps <= 0) {
		return 0;
	}
	const rate = Math.max(0, Math.min(1, perStep));
	return 1 - (1 - rate) ** Math.max(0, steps);
}

export interface QuantPolicyInput {
	readonly role: SwarmRole;
	/** Expected steps/turns this card will run. Long horizons are what make a small per-step rate matter. */
	readonly expectedSteps: number;
	/** Whether there is VRAM headroom for a heavier quant. `"unknown"` is NOT treated as tight. */
	readonly vramHeadroom: "ample" | "tight" | "unknown";
}

export interface QuantPolicy {
	readonly targetQuant: QuantTarget;
	/** Below Q6, an imatrix build is a free 10–30% perplexity win — worth requesting whenever we land under Q6. */
	readonly preferImatrix: boolean;
	/** Projected cumulative error at the RECOMMENDED quant over the expected horizon. */
	readonly projectedCompoundedError: number;
	/** True when tight VRAM forced a quant below what the horizon warrants — an accepted, NAMED risk. */
	readonly riskAccepted: boolean;
	readonly reason: string;
}

/** Cumulative-error thresholds at which the policy climbs off the floor. */
const CLIMB_TO_Q5 = 0.05;
const CLIMB_TO_Q6 = 0.1;

/**
 * Recommend a quant for a role×horizon. Advisory only — nothing here allocates VRAM or loads a model (the standing
 * no-auto-load constraint), so the caller may always overrule it.
 *
 * Honesty stance: when VRAM headroom is `"tight"` the recommendation is pinned to the floor, but `riskAccepted` is
 * set and the reason SAYS the horizon warranted more. Downgrading silently would turn a resource constraint into
 * an invisible quality decision. `"unknown"` headroom does NOT downgrade — the safer quant is the expensive one
 * here, so treating unverified headroom as tight would resolve uncertainty in the direction that compounds error.
 */
export function recommendQuantForRole(input: QuantPolicyInput): QuantPolicy {
	const steps = Number.isFinite(input.expectedSteps) ? Math.max(1, input.expectedSteps) : 1;
	const floorRisk = compoundedErrorRate(PER_STEP_ERROR.q4_k_m, steps);

	const warranted: QuantTarget = floorRisk > CLIMB_TO_Q6 ? "q6_k" : floorRisk > CLIMB_TO_Q5 ? "q5_k_m" : "q4_k_m";
	const tight = input.vramHeadroom === "tight";
	const targetQuant: QuantTarget = tight ? "q4_k_m" : warranted;
	const riskAccepted = tight && warranted !== "q4_k_m";

	const horizon = `${steps}-step ${input.role} card projects ${(floorRisk * 100).toFixed(1)}% cumulative error at the Q4_K_M floor`;
	const reason = riskAccepted
		? `${horizon} — ${warranted} is warranted, but VRAM headroom is tight, so the floor stands and the added risk is ACCEPTED, not resolved`
		: targetQuant === "q4_k_m"
			? `${horizon} — short enough that the floor holds`
			: `${horizon} — climbing to ${targetQuant}${input.vramHeadroom === "unknown" ? " (VRAM headroom unverified — confirm before loading)" : ""}`;

	return {
		targetQuant,
		preferImatrix: targetQuant !== "q6_k",
		projectedCompoundedError: compoundedErrorRate(PER_STEP_ERROR[targetQuant], steps),
		riskAccepted,
		reason,
	};
}
