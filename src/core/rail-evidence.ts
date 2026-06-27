/**
 * §5.AI dev-test rail evidence: the shared report shape (persisted as `rail-*.json` by the rail/daemon) plus a pure
 * cross-run AGGREGATION. The aggregation is the first half of "auto-collect → feed the todos": it reduces a pile of
 * harvested run reports to a per-project scorecard (delivery rate, failure/anomaly counts) so the worst-performing
 * scenarios surface first — that's what a reviewer (or the agent-driven analysis pass) reads to propose todo items.
 * Pure + deterministic so the rollup is one tested place, independent of how the reports were collected.
 */

export interface RailLaneEvidence {
	label: string;
	workspaceId: string;
	startedOk: boolean;
	startError: string | null;
	verdict: "delivered" | "failed_to_start" | "failed" | "non_terminal";
	cards: number;
	decomposed: boolean;
	wsFrames: number;
	sessionStates: Record<string, string>;
	toolCalls: Record<string, number>;
	totalToolCalls: number;
	narrationLeaks: number;
	hotRepeats: number;
}

export interface RailEvidenceReport {
	schemaVersion: 1;
	at: string;
	model: string;
	maxWaitMs: number;
	concurrency: number;
	projectCount: number;
	delivered: number;
	anomalyProjects: number;
	lanes: RailLaneEvidence[];
}

export interface RailProjectAggregate {
	/** The project/preset label (`RailLaneEvidence.label`). */
	project: string;
	runs: number;
	delivered: number;
	/** delivered / runs (0 when no runs). Lower = needs attention. */
	deliveryRate: number;
	failedToStart: number;
	failed: number;
	nonTerminal: number;
	/** Runs that showed a narration leak or hot-repeat anomaly. */
	anomalyRuns: number;
	totalNarrationLeaks: number;
	totalHotRepeats: number;
}

export interface RailEvidenceAggregate {
	totalReports: number;
	totalRuns: number;
	models: string[];
	/** Per-project rollup, WORST-FIRST (lowest delivery rate, then most anomaly runs) so attention-worthy ones lead. */
	byProject: RailProjectAggregate[];
}

/**
 * Roll up a set of harvested rail reports into a per-project scorecard, sorted worst-first (lowest delivery rate, ties
 * broken by most anomaly runs) so a reviewer immediately sees the scenarios that need work.
 */
export function aggregateRailEvidence(reports: readonly RailEvidenceReport[]): RailEvidenceAggregate {
	const byProject = new Map<string, RailProjectAggregate>();
	const models = new Set<string>();
	let totalRuns = 0;

	for (const report of reports) {
		models.add(report.model);
		for (const lane of report.lanes) {
			totalRuns += 1;
			const current =
				byProject.get(lane.label) ??
				({
					project: lane.label,
					runs: 0,
					delivered: 0,
					deliveryRate: 0,
					failedToStart: 0,
					failed: 0,
					nonTerminal: 0,
					anomalyRuns: 0,
					totalNarrationLeaks: 0,
					totalHotRepeats: 0,
				} satisfies RailProjectAggregate);
			current.runs += 1;
			if (lane.verdict === "delivered") {
				current.delivered += 1;
			} else if (lane.verdict === "failed_to_start") {
				current.failedToStart += 1;
			} else if (lane.verdict === "failed") {
				current.failed += 1;
			} else {
				current.nonTerminal += 1;
			}
			if (lane.narrationLeaks > 0 || lane.hotRepeats > 0) {
				current.anomalyRuns += 1;
			}
			current.totalNarrationLeaks += lane.narrationLeaks;
			current.totalHotRepeats += lane.hotRepeats;
			byProject.set(lane.label, current);
		}
	}

	const aggregates = [...byProject.values()].map((aggregate) => ({
		...aggregate,
		deliveryRate: aggregate.runs > 0 ? aggregate.delivered / aggregate.runs : 0,
	}));
	aggregates.sort((left, right) => left.deliveryRate - right.deliveryRate || right.anomalyRuns - left.anomalyRuns);

	return {
		totalReports: reports.length,
		totalRuns,
		models: [...models].sort((left, right) => left.localeCompare(right)),
		byProject: aggregates,
	};
}
