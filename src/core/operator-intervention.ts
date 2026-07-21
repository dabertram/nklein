/**
 * Operator INTERVENTION recording + metrics. PURE core. Serves **P16.5** (the Field Report's highest-value
 * content) and **P20.10** (the go/no-go intervention metric) from ONE taxonomy — deliberately, because two
 * definitions of "intervention" would make the report and the metric disagree about the same event.
 *
 * ── WHY INTERVENTIONS ARE THE MOST INFORMATIVE EVENT ──
 * A crash is easy to see and already logged. The genuinely informative moment is when the HUMAN steps in: an
 * override, a re-run, a rejected review, a hand-edit. Those are precisely the harness's blind spots — the cases
 * where it believed it was doing fine and a person disagreed. That makes them the charter §5 build-vs-intent gap
 * made observable, and the only signal a maintainer cannot synthesise from their own machine.
 *
 * ── WHY THE TAXONOMY IS SEVERITY-CLASSIFIED, NOT A COUNT ──
 * California's autonomous-vehicle disengagement reports are the cautionary analogue: a bare count, with an
 * operator-chosen denominator and no severity weighting, became a number everyone published and nobody could
 * interpret — the DMV itself states the data is not intended to compare companies, and Waymo said outright that
 * it "does not provide relevant insights into the capabilities of the Waymo driver". A single
 * "interventions per task" figure would repeat that mistake exactly. So severity is recorded at capture time,
 * and a ratio is never emitted without its task-mix denominator.
 */

export type InterventionSeverity =
	/** Typed guidance, no code changed. The mildest: the agent was steered, not corrected. */
	| "nudge"
	/** The user submitted review feedback identifying output that needs correction. */
	| "correction"
	/** The user stopped the agent but retained the card/work to take control themselves. */
	| "takeover"
	/** The user abandoned an already-started card to Trash. The strongest negative signal available. */
	| "abort";

/** Ascending severity — the single place the ordering is defined. */
const SEVERITY_RANK: Readonly<Record<InterventionSeverity, number>> = {
	nudge: 0,
	correction: 1,
	takeover: 2,
	abort: 3,
};

export interface InterventionEvent {
	readonly taskId: string;
	readonly severity: InterventionSeverity;
	/** Wall-clock seconds the human spent, MEASURED by the harness — never estimated afterwards (see below). */
	readonly humanSeconds: number | null;
	readonly at: number;
}

export interface InterventionMetrics {
	readonly total: number;
	readonly bySeverity: Readonly<Record<InterventionSeverity, number>>;
	/** Tasks that received at least one intervention. */
	readonly tasksTouched: number;
	/** Consecutive most-recent tasks with ZERO interventions — a pass^k analogue for operator effort. */
	readonly autonomousStreak: number;
	/** Human seconds summed over events that MEASURED it; null when none did. */
	readonly measuredHumanSeconds: number | null;
	/** Events whose human time was not measured — named, so the total is never read as complete. */
	readonly unmeasuredEvents: number;
	readonly summary: string;
}

export interface InterventionMetricsInput {
	readonly events: readonly InterventionEvent[];
	/**
	 * Task ids in completion order, newest LAST. Required: a ratio without its denominator is the disengagement
	 * mistake, and the streak cannot be computed without knowing which tasks ran at all.
	 */
	readonly completedTaskIdsInOrder: readonly string[];
}

/**
 * Compute intervention metrics. Never emits a bare "interventions per task" number — every ratio is reported
 * alongside the task set it was computed over.
 */
export function computeInterventionMetrics(input: InterventionMetricsInput): InterventionMetrics {
	const bySeverity: Record<InterventionSeverity, number> = { nudge: 0, correction: 0, takeover: 0, abort: 0 };
	const touched = new Set<string>();
	let measured = 0;
	let measuredCount = 0;
	let unmeasured = 0;

	for (const event of input.events) {
		bySeverity[event.severity] += 1;
		touched.add(event.taskId);
		if (event.humanSeconds !== null && Number.isFinite(event.humanSeconds)) {
			measured += event.humanSeconds;
			measuredCount += 1;
		} else {
			unmeasured += 1;
		}
	}

	// Streak: walk BACKWARD from the newest completed task until one was intervened on.
	let streak = 0;
	for (let index = input.completedTaskIdsInOrder.length - 1; index >= 0; index -= 1) {
		const taskId = input.completedTaskIdsInOrder[index];
		if (taskId === undefined || touched.has(taskId)) {
			break;
		}
		streak += 1;
	}

	const tasks = input.completedTaskIdsInOrder.length;
	const summary = [
		tasks === 0
			? "No completed tasks — no intervention rate can be computed."
			: `${input.events.length} intervention(s) across ${touched.size} of ${tasks} completed task(s).`,
		`Severity: ${bySeverity.nudge} nudge, ${bySeverity.correction} correction, ${bySeverity.takeover} takeover, ${bySeverity.abort} abort.`,
		streak > 0 ? `Current autonomous streak: ${streak} task(s).` : "No current autonomous streak.",
		unmeasured > 0
			? `⚠️ ${unmeasured} event(s) have NO measured human time — the ${Math.round(measured)}s total is a FLOOR, not the real cost.`
			: "",
		"Any rate here is only meaningful WITH this task set: an intervention count without its denominator and severity mix is the autonomous-vehicle disengagement mistake.",
	]
		.filter((part) => part.length > 0)
		.join(" ");

	return {
		total: input.events.length,
		bySeverity,
		tasksTouched: touched.size,
		autonomousStreak: streak,
		measuredHumanSeconds: measuredCount > 0 ? measured : null,
		unmeasuredEvents: unmeasured,
		summary,
	};
}

/**
 * The Field Report's headline section (P16.5): the interventions, worst-first.
 *
 * Ordering by severity rather than recency is deliberate — a maintainer reading one report should see the
 * takeovers and aborts before the nudges, because those are the cases where the harness was most confidently
 * wrong.
 */
export function rankInterventionsForReport(events: readonly InterventionEvent[]): readonly InterventionEvent[] {
	return [...events].sort(
		(left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] || right.at - left.at,
	);
}
