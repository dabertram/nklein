/**
 * Projections that bridge the Agent Attempt Ledger (§5.AF — the ONE evidence stream) to the learning/selection layers,
 * so those become QUERIES over the ledger instead of parallel persisted stores. The ledger now has a live writer
 * (terminal task runs append `attempt` events), so these projections operate on real data.
 *
 * `summarizeModelOutcomes` (per-model outcome counts) lives in the ledger core; this module adds the richer
 * `ModelBehaviorProfile` (§5.AA) projection — folding each model's attempts through the same online-learning update the
 * adaptive retry engine reads, so "what works per model" is derived from the durable record, not a second store.
 */

import {
	type AgentLedgerEvent,
	type ModelOutcomeRollup,
	selectAttempts,
	summarizeModelOutcomes,
} from "./agent-attempt-ledger";
import {
	emptyModelBehaviorProfile,
	type ModelAttemptOutcome,
	type ModelBehaviorProfile,
	recordModelBehaviorOutcome,
} from "./model-behavior-profile";

/**
 * Derive a `ModelBehaviorProfile` per model by folding that model's ledger attempts (chronologically) through the
 * §5.AA online-learning update. Pure; returns one profile per model, sorted by samples desc then modelId. The
 * terminal-run writer is coarse (no per-tool-call format / quality grading yet), so `toolCallFormat` is absent and
 * `toolCount` is only supplied when the attempt recorded an offered tool set — a richer writer fills these later.
 */
export function buildModelBehaviorProfilesFromLedger(
	events: readonly AgentLedgerEvent[],
	options?: { alpha?: number },
): ModelBehaviorProfile[] {
	const attempts = [...selectAttempts(events)].sort((left, right) => left.recordedAt - right.recordedAt);
	const byModel = new Map<string, ModelBehaviorProfile>();
	for (const attempt of attempts) {
		const current = byModel.get(attempt.modelId) ?? emptyModelBehaviorProfile(attempt.modelId, attempt.recordedAt);
		const outcome: ModelAttemptOutcome = {
			kind: attempt.outcome,
			retries: attempt.retriesBefore,
			...(attempt.contextTokens !== null ? { contextTokens: attempt.contextTokens } : {}),
			...(attempt.qualityOk !== null ? { qualityOk: attempt.qualityOk } : {}),
			...(attempt.toolSetOffered.length > 0 ? { toolCount: attempt.toolSetOffered.length } : {}),
		};
		byModel.set(
			attempt.modelId,
			recordModelBehaviorOutcome(current, outcome, { alpha: options?.alpha, now: () => attempt.recordedAt }),
		);
	}
	return [...byModel.values()].sort(
		(left, right) => right.samples - left.samples || left.modelId.localeCompare(right.modelId),
	);
}

/** A one-shot display rollup of the whole ledger — for the operator read surfaces (`nklein dev ledger`). */
export interface LedgerDisplaySummary {
	totalEvents: number;
	totalAttempts: number;
	/** Per-model outcome counts + success rate (the §5.Z matrix seed). */
	outcomes: ModelOutcomeRollup[];
	/** Per-model learned behaviour profiles (§5.AA) derived from the ledger. */
	profiles: ModelBehaviorProfile[];
}

/** Project the ledger into the operator display summary (pure; composes the two model projections). */
export function summarizeLedgerForDisplay(events: readonly AgentLedgerEvent[]): LedgerDisplaySummary {
	return {
		totalEvents: events.length,
		totalAttempts: selectAttempts(events).length,
		outcomes: summarizeModelOutcomes(events),
		profiles: buildModelBehaviorProfilesFromLedger(events),
	};
}
