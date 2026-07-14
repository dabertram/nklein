/**
 * PROACTIVE answer-budget sizing (todo §5.AD "Size UP-FRONT"). The chat/agent path historically requested a FIXED
 * `max_tokens = 1024` and relied purely on the §5.AA reactive `raise_token_budget` ladder to recover after a
 * truncation. On the all-reasoning resident tier that first-attempt truncation + recovery round-trip is pure waste —
 * and expensive on the slow 27B. This core sizes the budget UP-FRONT instead: the token budget is not a constant, it
 * is a function of (model reasoning-profile × task class × output mode), clamped so `inputTokens + maxTokens` never
 * exceeds the model window. The §5.AA ladder stays as the safety net for the tail this prior under-shoots.
 *
 * Grounded in the 2026-07-01 live probes: reasoning models burn VARIABLE reasoning tokens before any answer
 * (qwen3.5-9b ~257–301 on a realistic single-tool turn, the 27B ~922–966; harder turns more), a FORCED native tool
 * call is cheap (~55–199 total), and non-reasoning models burn ~0 reasoning. So the budget = a per-task-class ANSWER
 * size + (for reasoning models, not forced tool calls) a REASONING headroom — the learned per-model burn when known,
 * else a task-scaled default. Pure/deterministic: a property of the inputs alone (no I/O, no clock).
 */

/** The task's answer-size class — each a distinct up-front prior (trivial reply → long generation). */
export type AnswerTaskClass = "trivial_reply" | "single_tool" | "multi_tool" | "decomposition" | "long_generation";

/** The output mode — a forced native tool call needs little; structured + free generation need the answer budget. */
export type AnswerOutputMode = "forced_tool_call" | "structured" | "free_generation";

export interface AnswerBudgetPriorInput {
	/** The model's reasoning profile — reasoning models burn variable reasoning tokens BEFORE any answer; non-reasoning ~0. */
	readonly reasoning: boolean;
	/** The task class — each has a distinct answer-size prior. */
	readonly taskClass: AnswerTaskClass;
	/** The output mode — a forced native tool call needs little; free/structured generation needs the answer budget. */
	readonly outputMode: AnswerOutputMode;
	/** The model's usable context window in tokens (≥32k floor per prime directive). Non-finite / ≤0 ⇒ treated as unbounded. */
	readonly contextWindow: number;
	/** Tokens already occupied by the prompt/input — the budget is clamped so `inputTokens + maxTokens ≤ contextWindow`. */
	readonly inputTokens: number;
	/**
	 * Learned per-model reasoning-token burn (from the §5.AA ModelBehaviorProfile / §5.AF ledger), when an observation
	 * exists — overrides the task-scaled default. Used only for reasoning models on a non-forced-tool-call turn.
	 */
	readonly learnedReasoningTokens?: number;
	/** Floor so a proactive size never drops below the reactive ladder's first rung. Default 256. */
	readonly minBudget?: number;
}

export interface AnswerBudgetPrior {
	/** The proactively-sized `max_tokens` to request up-front (already clamped to the window). */
	readonly maxTokens: number;
	/** The reasoning-token headroom component (0 for non-reasoning models and for forced tool calls). */
	readonly reasoningHeadroom: number;
	/** The answer-size component (task class, or the small forced-tool-call size). */
	readonly answerSize: number;
	/** True when the window clamp reduced the prior (input + prior would have exceeded the window). */
	readonly clampedToWindow: boolean;
	readonly reason: string;
}

/** Per-task-class ANSWER (prose / tool-args / plan) size prior — the visible output, excluding hidden reasoning. */
const ANSWER_SIZE: Record<AnswerTaskClass, number> = {
	trivial_reply: 256,
	single_tool: 512,
	multi_tool: 1024,
	decomposition: 2048,
	long_generation: 4096,
};

/** Per-task-class REASONING headroom prior for reasoning models when no learned burn is available (probe-grounded). */
const REASONING_PRIOR: Record<AnswerTaskClass, number> = {
	trivial_reply: 512,
	single_tool: 768,
	multi_tool: 1280,
	decomposition: 1792,
	long_generation: 2560,
};

/** A forced native tool call emits only bounded call-args — cheap regardless of task class (probe: ~55–199 total). */
const FORCED_TOOL_CALL_SIZE = 256;

const DEFAULT_MIN_BUDGET = 256;

function nonNegative(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Size the up-front `max_tokens` for a turn (pure). The budget is `answerSize + reasoningHeadroom`, floored at
 * `minBudget`, then clamped so `inputTokens + maxTokens ≤ contextWindow`. A FORCED tool call uses a small fixed answer
 * size and ZERO reasoning headroom (the native call is cheap). A reasoning model on a free/structured turn adds the
 * reasoning headroom — the learned per-model burn when supplied, else the task-scaled default; a non-reasoning model
 * adds none. When `contextWindow ≤ 0` the window is treated as unbounded (no clamp), leaving the ≥32k-floor guarantee
 * to the caller that supplies the real window.
 */
export function answerBudgetPrior(input: AnswerBudgetPriorInput): AnswerBudgetPrior {
	const forced = input.outputMode === "forced_tool_call";
	const answerSize = forced ? FORCED_TOOL_CALL_SIZE : ANSWER_SIZE[input.taskClass];

	// A reasoning model emits `reasoning_content` BEFORE any output — including before a native/forced tool call (live
	// 2026-07-14: qwen3.6-35b-a3b burned 179–484 reasoning tokens even for a trivial `submit_review`, more on a real
	// review prompt). So a reasoning model needs its reasoning HEADROOM regardless of output mode; the earlier
	// `!forced` guard starved forced-tool-call turns (e.g. second-opinion review) and TRUNCATED them before the call,
	// which surfaced as `no_verdict` → held deliveries. The ANSWER size stays forced-small (the call itself is cheap);
	// only the hidden reasoning burn is added back.
	let reasoningHeadroom = 0;
	if (input.reasoning) {
		const learned = nonNegative(input.learnedReasoningTokens);
		reasoningHeadroom = learned > 0 ? learned : REASONING_PRIOR[input.taskClass];
	}

	const minBudget = Math.max(0, Math.floor(nonNegative(input.minBudget) || DEFAULT_MIN_BUDGET));
	const prior = Math.max(answerSize + reasoningHeadroom, minBudget);

	const window = nonNegative(input.contextWindow);
	const available = window > 0 ? Math.max(0, Math.floor(window - nonNegative(input.inputTokens))) : prior;
	const maxTokens = Math.min(prior, available);
	const clampedToWindow = window > 0 && prior > available;

	const reason = forced
		? `forced tool call → small ${answerSize}-token answer${
				reasoningHeadroom > 0 ? ` + reasoning ${reasoningHeadroom} (reasoning model thinks before the call)` : ""
			}${clampedToWindow ? ` (clamped to ${maxTokens} by the window)` : ""}`
		: `${input.taskClass}/${input.outputMode}: answer ${answerSize}${
				reasoningHeadroom > 0 ? ` + reasoning ${reasoningHeadroom}` : ""
			}${clampedToWindow ? ` (clamped to ${maxTokens} by the window)` : ""}`;

	return { maxTokens, reasoningHeadroom, answerSize, clampedToWindow, reason };
}
