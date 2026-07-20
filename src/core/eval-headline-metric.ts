/**
 * P20.5 — metric DISCIPLINE: pass^1-with-CI as the headline, pass^k for reliability, and never pass@k. PURE core.
 *
 * This module deliberately computes almost nothing. Both statistics it needs already exist —
 * `wilsonInterval` (F12.41's `ab-significance-gate.ts`) and `computePassPowerK`
 * (`model-eval-stability.ts`) — and writing a second copy of either is the duplication this project has already
 * caught three times. What did NOT exist is the part that actually prevents the mistake: **a headline that
 * refuses to be pass@k.**
 *
 * ── WHY pass@k IS BANNED FROM THE HEADLINE ──
 * `pass@k = E[1−(1−p)^k]` is monotonically INCREASING in k, so it **rewards variance**. Anything that raises
 * output diversity without raising competence — a temperature bump, more retries, more parallel samples —
 * inflates it for free. It is only meaningful given a sound independent selector; without one it is an
 * oracle-assisted UPPER BOUND, not achievable performance. And for a harness graded by the same tests it iterates
 * against, that is close to circular.
 *
 * The practical danger is not that pass@k is wrong — it is that **pass@k is the number that makes a change look
 * best**, so it is the one that gets reported when nobody has decided in advance. τ-bench's pass^8 <25% against
 * pass^1 <50% is the shape that matters for a multi-card board: the headline says "half the time" while the
 * reliability figure says "rarely, end to end".
 *
 * ── A POINT ESTIMATE WITHOUT AN INTERVAL IS NOT A RESULT ──
 * At the run counts a local fleet can afford, the interval is usually wide enough to change the conclusion. So
 * `formatHeadline` REFUSES to render a bare point estimate: the CI is not decoration appended to the number, it
 * is the part that says whether the number means anything. A headline with an interval that spans the comparison
 * is honest; the same headline without it is a claim.
 */

import { wilsonInterval } from "./ab-significance-gate";
import { computePassPowerK } from "./model-eval-stability";

export type ForbiddenMetric = "pass_at_k";

export class ForbiddenHeadlineError extends Error {}

export interface HeadlineMetric {
	/** Successes over independent runs of the SAME task. */
	readonly successes: number;
	readonly runs: number;
	/** k for the reliability figure. 4 by default — the "does it work end to end, repeatedly" question. */
	readonly reliabilityK?: number;
}

export interface HeadlineReport {
	/** pass^1: the observed rate. The headline number. */
	readonly point: number;
	readonly low: number;
	readonly high: number;
	/** Width of the interval. Wide intervals are the normal case at local-fleet run counts. */
	readonly width: number;
	/** pass^k: all k runs succeed. The reliability figure, always reported ALONGSIDE the headline. */
	readonly passPowerK: number;
	readonly k: number;
	/** True when the interval is too wide to support a directional claim. */
	readonly underpowered: boolean;
	readonly text: string;
}

/** Above this interval width, a point estimate cannot support a directional claim. */
export const UNDERPOWERED_CI_WIDTH = 0.3;

/**
 * Build the headline.
 *
 * Always emits BOTH pass^1-with-CI and pass^k, because reporting either alone misleads in a predictable
 * direction: pass^1 alone flatters a flaky system that occasionally works, and pass^k alone buries a real
 * capability under end-to-end compounding. The pair is the honest summary; neither half is.
 */
export function buildHeadline(metric: HeadlineMetric): HeadlineReport {
	const runs = Math.max(0, Math.trunc(metric.runs));
	const successes = Math.max(0, Math.min(runs, Math.trunc(metric.successes)));
	const k = Math.max(1, Math.trunc(metric.reliabilityK ?? 4));

	const interval = wilsonInterval(successes, runs);
	const width = interval.high - interval.low;
	const power = computePassPowerK(successes, runs, k);
	const underpowered = runs === 0 || width > UNDERPOWERED_CI_WIDTH;

	const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
	const text =
		runs === 0
			? "no runs — there is no result to report, and an absent measurement must not be rendered as 0%"
			: `pass^1 ${pct(interval.point)} [${pct(interval.low)}–${pct(interval.high)}], pass^${k} ${pct(power.estimate)} over ${runs} run(s)${
					underpowered
						? ` — UNDERPOWERED: the interval spans ${pct(width)}, too wide to support a directional claim. Report this as unresolved rather than as a result.`
						: ""
				}`;

	return {
		point: interval.point,
		low: interval.low,
		high: interval.high,
		width,
		passPowerK: power.estimate,
		k,
		underpowered,
		text,
	};
}

/**
 * Guard a metric name before it reaches a report.
 *
 * Throws on pass@k rather than warning. A warning would be read, acknowledged and ignored — the metric would
 * still ship in the headline, because it is the number that makes the change look best. The whole content of this
 * item is "do not headline this", so the enforcement has to be one that cannot be skimmed past.
 */
export function assertHeadlineMetricAllowed(metricName: string): void {
	const normalized = metricName.toLowerCase().replace(/[\s_-]/g, "");
	if (normalized.includes("pass@k") || /^passat\d*k?$/.test(normalized) || normalized.startsWith("passat")) {
		throw new ForbiddenHeadlineError(
			`"${metricName}" must not be a headline metric: pass@k increases monotonically in k, so it REWARDS VARIANCE — more retries or a temperature bump inflate it without any gain in competence. Without a sound independent selector it is an oracle-assisted upper bound, not achievable performance, and for a harness graded by the tests it iterates against it is close to circular. Headline pass^1 with a confidence interval; report pass^k for reliability.`,
		);
	}
}
