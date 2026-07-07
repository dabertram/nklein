import { type AgentLedgerEvent, selectAttempts, summarizeModelOutcomes } from "./agent-attempt-ledger";
import { summarizeModelOutcomesByRole } from "./agent-ledger-projections";
import type { RuntimeRunOutcome } from "./runtime-model-verdict";

/**
 * The per-(model, role) evidence key: the model key joined to the role by a NUL (U+0000) so it can't collide with any
 * real id. The evidence BUILDER ({@link buildLedgerEvidence}) and the LOOKUP (`blendedCapabilityForKey` in
 * start-task-session) both key by this NUL-join -- if the separators ever drifted, the role key would never match and
 * per-role evidence would silently fall back to the global rollup. Exported so the write side has one named definition.
 */
export function roleEvidenceKey(modelKey: string, role: string): string {
	return `${modelKey}${String.fromCharCode(0)}${role}`;
}

export interface LedgerEvidence {
	/** Global per-model success rate + sample count, keyed by the ledger model key. */
	successByKey: Map<string, { successRate: number; samples: number }>;
	/** Per-(model, role) success, keyed by {@link roleEvidenceKey} -- used when it has enough samples. */
	roleSuccessByKey: Map<string, { successRate: number; samples: number }>;
	/** The authoritative TOTAL-run list (runId + modelId) the runtime-verdict denominator needs. */
	verdictRuns: RuntimeRunOutcome[];
}

/**
 * Routing evidence (todo.md 5.AF/5.AL): read the agent-attempt ledger ONCE and project it into the three evidence
 * structures the start-path router blends into model capability -- the global per-model success rollup, the
 * per-(model, role) rollup, and the per-attempt run list (the runtime-verdict denominator; self-observation events fire
 * only on FAILURES, so the ledger is the only TOTAL-run source). BEST-EFFORT: any ledger read/parse failure yields EMPTY
 * structures, so the registry capability is used unchanged and routing behaves exactly as before.
 *
 * Extracted from the `handleStartTaskSession` hot path (5.U): a clear-boundary DI-injectable I/O helper -- `readLedger`
 * is injected, so the read -> project -> empty-on-error flow is deterministically testable without the ledger store.
 */
export async function buildLedgerEvidence(
	readLedger: () => Promise<readonly AgentLedgerEvent[]>,
): Promise<LedgerEvidence> {
	const successByKey = new Map<string, { successRate: number; samples: number }>();
	const roleSuccessByKey = new Map<string, { successRate: number; samples: number }>();
	const verdictRuns: RuntimeRunOutcome[] = [];
	try {
		const ledgerEvents = await readLedger();
		for (const outcome of summarizeModelOutcomes(ledgerEvents)) {
			successByKey.set(outcome.modelId, { successRate: outcome.successRate, samples: outcome.samples });
		}
		for (const outcome of summarizeModelOutcomesByRole(ledgerEvents)) {
			roleSuccessByKey.set(roleEvidenceKey(outcome.modelId, outcome.role), {
				successRate: outcome.successRate,
				samples: outcome.samples,
			});
		}
		for (const attempt of selectAttempts(ledgerEvents)) {
			if (attempt.modelId) {
				verdictRuns.push({ runId: attempt.attemptId, modelId: attempt.modelId });
			}
		}
	} catch {
		// best-effort: any ledger read failure leaves the structures empty, so registry capability is used unchanged.
	}
	return { successByKey, roleSuccessByKey, verdictRuns };
}
