import { type AgentLedgerEvent, selectAttempts } from "./agent-attempt-ledger.js";
import type { ContextTimingObservation } from "./context-size-recommender.js";

/**
 * F4.9 — project the §5.AF attempt ledger into {@link ContextTimingObservation}s per model, so `recommendContextCap`
 * can be run over real evidence (mount / Settings). Each attempt that recorded a context load AND a start+end time
 * contributes one observation: `contextTokens` = the attempt's context load, `wallTimeMs` = `completedAt − startedAt`,
 * `success` = a success outcome, `stalled` = a loop/timeout outcome. Attempts missing the context load or timing are
 * skipped (they carry no size-vs-speed signal). Grouped by `modelId` because the recommendation is per-host/model.
 *
 * PURE + deterministic.
 */

/** Outcome kinds that indicate the turn stalled (a no-progress / timeout signal against that context size). */
const STALL_OUTCOMES = new Set(["loop", "timeout", "aborted_no_output"]);

export function buildContextTimingObservationsByModel(
	events: readonly AgentLedgerEvent[],
): Map<string, ContextTimingObservation[]> {
	const byModel = new Map<string, ContextTimingObservation[]>();
	for (const attempt of selectAttempts(events)) {
		if (
			attempt.contextTokens === null ||
			attempt.startedAt === null ||
			attempt.completedAt === null ||
			attempt.completedAt < attempt.startedAt
		) {
			continue;
		}
		const observation: ContextTimingObservation = {
			contextTokens: attempt.contextTokens,
			wallTimeMs: attempt.completedAt - attempt.startedAt,
			success: attempt.outcome === "success",
			stalled: STALL_OUTCOMES.has(attempt.outcome),
		};
		const list = byModel.get(attempt.modelId) ?? [];
		list.push(observation);
		byModel.set(attempt.modelId, list);
	}
	return byModel;
}
