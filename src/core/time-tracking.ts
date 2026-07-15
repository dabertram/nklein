/**
 * F1.40 — per-card and per-project TIME tracking (pure). Derived from data the runtime already records: the §5.Q
 * model-performance observations (per session run: `startedAt`, `wallTimeMs`, `timeToLastOutputMs`, `outcome`) and the
 * board card `createdAt`. No new recording seam — a projection.
 *
 * Four metrics per entity:
 *   - `ageTotalMs`     — wall-clock lifespan: `now − createdAt` (capped at `completedAt` once the entity is done).
 *   - `activeMs`       — time !Klein was actually running work on it: the UNION (overlaps merged, never double-counted)
 *                        of the entity's run wall spans `[startedAt, startedAt + wallTimeMs]`.
 *   - `llmTotalMs`     — total LLM processing: the SUM of every run's `timeToLastOutputMs` — the duration from the
 *                        prompt being sent to the LLM until its response finished streaming (David's definition, 2026-07-15).
 *   - `llmSuccessfulMs`— the same sum restricted to runs whose outcome is a success (`completed`).
 *
 * `llmTotalMs` sums per-run LLM time (parallel runs count additively); `activeMs` merges overlap, so `activeMs` ≤
 * `ageTotalMs` always. Runs missing a timing field contribute to neither the LLM sum nor the active union.
 */

export interface TimeTrackingActivity {
	/** Run start (ms epoch), or null for legacy rows without timing. */
	startedAt: number | null;
	/** Run wall-clock end (`startedAt + wallTimeMs`), or null when unknown; used for the active-time union. */
	endedAt: number | null;
	/** Prompt-sent → response-streaming-ended, in ms (`timeToLastOutputMs`), or null when unmeasured. */
	llmMs: number | null;
	/** Whether the run succeeded (outcome `completed`) — for the successful-LLM total. */
	successful: boolean;
}

export interface TimeTrackingMetrics {
	ageTotalMs: number;
	activeMs: number;
	llmTotalMs: number;
	llmSuccessfulMs: number;
}

interface Span {
	start: number;
	end: number;
}

/** A well-formed `[start, end]` wall span for a run, or null when it lacks timing / ends before it starts. */
function activitySpan(activity: TimeTrackingActivity): Span | null {
	if (activity.startedAt === null || activity.endedAt === null || activity.endedAt < activity.startedAt) {
		return null;
	}
	return { start: activity.startedAt, end: activity.endedAt };
}

/** Total length of the UNION of the given spans (overlaps merged once). */
function unionDurationMs(spans: readonly Span[]): number {
	const [first, ...rest] = [...spans].sort((a, b) => a.start - b.start);
	if (!first) {
		return 0;
	}
	let total = 0;
	let currentStart = first.start;
	let currentEnd = first.end;
	for (const span of rest) {
		if (span.start <= currentEnd) {
			currentEnd = Math.max(currentEnd, span.end);
		} else {
			total += currentEnd - currentStart;
			currentStart = span.start;
			currentEnd = span.end;
		}
	}
	return total + (currentEnd - currentStart);
}

/** LLM-time (total + successful-only) folded over the runs. */
function llmDurations(activities: readonly TimeTrackingActivity[]): { total: number; successful: number } {
	let total = 0;
	let successful = 0;
	for (const activity of activities) {
		if (activity.llmMs === null || activity.llmMs < 0) {
			continue;
		}
		total += activity.llmMs;
		if (activity.successful) {
			successful += activity.llmMs;
		}
	}
	return { total, successful };
}

/** Compute the four time metrics for one entity (a card, or a project via its earliest createdAt). */
export function computeTimeTracking(input: {
	createdAt: number;
	/** When set, the entity is done and its age is measured to completion, not to `now`. */
	completedAt?: number | null;
	activities: readonly TimeTrackingActivity[];
	now: number;
}): TimeTrackingMetrics {
	const ageEnd = input.completedAt ?? input.now;
	const spans = input.activities.map(activitySpan).filter((span): span is Span => span !== null);
	const { total, successful } = llmDurations(input.activities);
	return {
		ageTotalMs: Math.max(0, ageEnd - input.createdAt),
		activeMs: unionDurationMs(spans),
		llmTotalMs: total,
		llmSuccessfulMs: successful,
	};
}

/**
 * Project-level metrics: age runs from the EARLIEST card's `createdAt`; active + LLM times aggregate across ALL the
 * project's runs (the union merges overlap across cards, so two cards working at once don't double-count active time).
 * An empty project (no cards) reports zero age but still folds any stray runs.
 */
export function computeProjectTimeTracking(input: {
	cards: readonly { createdAt: number; completedAt?: number | null }[];
	activities: readonly TimeTrackingActivity[];
	now: number;
}): TimeTrackingMetrics {
	if (input.cards.length === 0) {
		const spans = input.activities.map(activitySpan).filter((span): span is Span => span !== null);
		const { total, successful } = llmDurations(input.activities);
		return { ageTotalMs: 0, activeMs: unionDurationMs(spans), llmTotalMs: total, llmSuccessfulMs: successful };
	}
	const earliestCreatedAt = Math.min(...input.cards.map((card) => card.createdAt));
	return computeTimeTracking({ createdAt: earliestCreatedAt, activities: input.activities, now: input.now });
}
