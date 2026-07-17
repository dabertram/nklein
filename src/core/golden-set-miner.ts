/**
 * Ledger-mined golden-set candidate selection (F12.49 slice) — PURE core.
 *
 * Static eval sets rot as the live task distribution drifts; the ledger already holds the cases that MATTER — real
 * failures (something regressed once) and LUCKY wins (brittle passes that pass/fail can't distinguish, per the
 * F12.42 trajectory scorer). This core selects and dedupes the corpus CANDIDATES from the persisted attempts; a
 * human (or a reviewer pass) promotes candidates into the versioned CI corpus, so the set stays curated rather than
 * auto-polluted. Composes with F11.4 (aimock replay makes a promoted case deterministic).
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";
import { projectTrajectorySignals } from "./trajectory-quality-projection";
import { scoreTrajectoryQuality } from "./trajectory-quality-score";

export type GoldenCandidateKind = "failure" | "lucky_win";

export interface GoldenSetCandidate {
	readonly taskId: string;
	readonly modelId: string;
	readonly kind: GoldenCandidateKind;
	/** Why this case earns a corpus slot (the failure outcome, or the lucky-win diagnosis). */
	readonly reason: string;
	/** Dedup key: task identity — one corpus slot per task, preferring the FAILURE kind. */
	readonly dedupKey: string;
}

export interface GoldenSetMinerOptions {
	/** Cap on returned candidates (default 50 — curation is human time). */
	readonly limit?: number;
}

/**
 * Mine corpus candidates from the ledger. Selection: every non-success terminal attempt is a `failure` candidate;
 * every PASSING attempt the F12.42 scorer classifies `lucky` is a `lucky_win` candidate. One candidate per task
 * (failures outrank lucky wins for the slot — a task that both failed and lucked out is most valuable replayed as
 * its failure). Deterministic order: failures first, then lucky wins, each newest-first by position.
 */
export function mineGoldenSetCandidates(
	events: readonly AgentLedgerEvent[],
	options: GoldenSetMinerOptions = {},
): GoldenSetCandidate[] {
	const limit = options.limit ?? 50;
	const byTask = new Map<string, GoldenSetCandidate>();
	for (const event of events) {
		if (event.kind !== "attempt") {
			continue;
		}
		if (event.outcome !== "success") {
			byTask.set(event.taskId, {
				taskId: event.taskId,
				modelId: event.modelId,
				kind: "failure",
				reason: `terminal outcome ${event.outcome} — a real regression case.`,
				dedupKey: event.taskId,
			});
			continue;
		}
		const score = scoreTrajectoryQuality(projectTrajectorySignals(event));
		if (score.classification === "lucky" && byTask.get(event.taskId)?.kind !== "failure") {
			byTask.set(event.taskId, {
				taskId: event.taskId,
				modelId: event.modelId,
				kind: "lucky_win",
				reason: score.reason,
				dedupKey: event.taskId,
			});
		}
	}
	const candidates = [...byTask.values()];
	const failures = candidates.filter((candidate) => candidate.kind === "failure").reverse();
	const lucky = candidates.filter((candidate) => candidate.kind === "lucky_win").reverse();
	return [...failures, ...lucky].slice(0, limit);
}
