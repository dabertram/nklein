/**
 * F3.36 (b) — the SWARM/SDK path of the mid-turn reasoning-budget breach. An {@link AgentModel} decorator that
 * watches the streamed reasoning channel and, the moment the per-turn reasoning budget is breached, aborts the
 * provider call and fails the turn TYPED — so the §5.AA recovery ladder (adaptive-swarm-recovery-model.ts) can
 * take its `thinking_disable` rung at once with the little-coder nudge appended, instead of letting the model burn
 * the whole completion budget on `reasoning_content` and only classifying the corpse.
 *
 * Placement mirrors the runaway interrupt: UNDER the recovery wrapper, on a DERIVED AbortSignal chained to the
 * caller's, so the provider sees a normal cancellation and a caller-initiated abort is never re-attributed. Never
 * fires once a tool-call delta appeared (an in-flight tool call must not be orphaned) and never on visible text —
 * only the reasoning channel counts toward the budget. Default-OFF behind NKLEIN_REASONING_BREACH; the caller
 * decides eligibility (a reasoning model with a verified thinking soft switch — forcing thinking off on a model
 * without one would silently do nothing and waste the retry).
 */
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import {
	createReasoningBudgetTracker,
	DEFAULT_REASONING_BUDGET_TOKENS,
	type ReasoningBudgetTracker,
} from "../core/reasoning-budget-breach";

export class ReasoningBudgetBreachError extends Error {
	readonly spentTokens: number;
	readonly budgetTokens: number;
	constructor(spentTokens: number, budgetTokens: number) {
		super(
			`Reasoning budget breached mid-stream: ~${spentTokens} reasoning tokens against a ${budgetTokens}-token per-turn budget.`,
		);
		this.name = "ReasoningBudgetBreachError";
		this.spentTokens = spentTokens;
		this.budgetTokens = budgetTokens;
	}
}

export interface ReasoningBreachModelOptions {
	readonly budgetTokens?: number;
	/** Test seam / policy override; defaults to the shared tracker. */
	readonly createTracker?: (budgetTokens: number) => ReasoningBudgetTracker;
	readonly onBreach?: (error: ReasoningBudgetBreachError) => void;
}

/** Wrap `base` so a mid-stream reasoning-budget breach aborts the provider call and fails the turn typed. */
export function createReasoningBreachModel(base: AgentModel, options: ReasoningBreachModelOptions = {}): AgentModel {
	const budgetTokens = options.budgetTokens ?? DEFAULT_REASONING_BUDGET_TOKENS;
	const createTracker = options.createTracker ?? ((budget: number) => createReasoningBudgetTracker(budget));
	return {
		stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
			return guardedStream(base, request, budgetTokens, createTracker, options.onBreach);
		},
	};
}

async function* guardedStream(
	base: AgentModel,
	request: AgentModelRequest,
	budgetTokens: number,
	createTracker: (budgetTokens: number) => ReasoningBudgetTracker,
	onBreach: ReasoningBreachModelOptions["onBreach"],
): AsyncIterable<AgentModelEvent> {
	const outerSignal = request.signal;
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(outerSignal?.reason);
	if (outerSignal?.aborted) {
		forwardAbort();
	} else {
		outerSignal?.addEventListener("abort", forwardAbort, { once: true });
	}
	const tracker = createTracker(budgetTokens);
	let sawToolCall = false;
	try {
		const iterable = await base.stream({ ...request, signal: controller.signal });
		for await (const event of iterable) {
			if (event.type === "tool-call-delta") {
				sawToolCall = true;
			}
			yield event;
			if (
				!sawToolCall &&
				event.type === "reasoning-delta" &&
				event.text.length > 0 &&
				tracker.addReasoningDelta(event.text.length)
			) {
				const error = new ReasoningBudgetBreachError(tracker.spentTokens(), budgetTokens);
				onBreach?.(error);
				controller.abort(error);
				throw error;
			}
		}
	} finally {
		outerSignal?.removeEventListener("abort", forwardAbort);
	}
}
