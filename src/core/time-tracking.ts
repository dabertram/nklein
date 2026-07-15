/**
 * F1.40 — per-card and per-project TIME tracking (pure). Derived entirely from data the runtime already records: the
 * §5.AF attempt ledger (`startedAt`/`completedAt`/`outcome` per attempt) and the board card timestamps. No new recording
 * seam — this is a projection.
 *
 * Four metrics per entity:
 *   - `ageTotalMs`     — wall-clock lifespan: `now − createdAt` (capped at `completedAt` once the entity is done).
 *   - `activeMs`       — time !Klein was actually working on it: the UNION (overlaps merged, never double-counted) of
 *                        the entity's attempt `[startedAt, completedAt]` spans.
 *   - `llmTotalMs`     — total LLM processing: the SUM of every attempt's `completedAt − startedAt`.
 *   - `llmSuccessfulMs`— the same sum restricted to attempts whose outcome is a success.
 *
 * `llmTotalMs` ≥ `activeMs` whenever attempts overlap (parallel work), and `activeMs` ≤ `ageTotalMs` always. Attempts
 * missing a start or end timestamp (legacy rows) contribute to neither the LLM sum nor the active union.
 */

/** The single success outcome kind (mirrors `ModelOutcomeKind`'s `"success"`). */
const SUCCESS_OUTCOME = "success";

export interface TimeTrackingAttempt {
	/** Attempt start (ms epoch), or null for legacy rows without timing. */
	startedAt: number | null;
	/** Attempt completion (ms epoch), or null when unknown/still-running. */
	completedAt: number | null;
	/** The classified outcome; `"success"` counts toward the successful LLM total. */
	outcome: string;
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

/** A well-formed `[start, end]` span for an attempt, or null when it lacks timing / ends before it starts. */
function attemptSpan(attempt: TimeTrackingAttempt): Span | null {
	if (attempt.startedAt === null || attempt.completedAt === null || attempt.completedAt < attempt.startedAt) {
		return null;
	}
	return { start: attempt.startedAt, end: attempt.completedAt };
}

/** Total length of the UNION of the given spans (overlaps merged once). */
function unionDurationMs(spans: readonly Span[]): number {
	if (spans.length === 0) {
		return 0;
	}
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

/** LLM-time (total + successful-only) folded over the attempts. */
function llmDurations(attempts: readonly TimeTrackingAttempt[]): { total: number; successful: number } {
	let total = 0;
	let successful = 0;
	for (const attempt of attempts) {
		const span = attemptSpan(attempt);
		if (!span) {
			continue;
		}
		const duration = span.end - span.start;
		total += duration;
		if (attempt.outcome === SUCCESS_OUTCOME) {
			successful += duration;
		}
	}
	return { total, successful };
}

/** Compute the four time metrics for one entity (a card, or a project via its earliest createdAt). */
export function computeTimeTracking(input: {
	createdAt: number;
	/** When set, the entity is done and its age is measured to completion, not to `now`. */
	completedAt?: number | null;
	attempts: readonly TimeTrackingAttempt[];
	now: number;
}): TimeTrackingMetrics {
	const ageEnd = input.completedAt ?? input.now;
	const spans = input.attempts.map(attemptSpan).filter((span): span is Span => span !== null);
	const { total, successful } = llmDurations(input.attempts);
	return {
		ageTotalMs: Math.max(0, ageEnd - input.createdAt),
		activeMs: unionDurationMs(spans),
		llmTotalMs: total,
		llmSuccessfulMs: successful,
	};
}

/**
 * Project-level metrics: age runs from the EARLIEST card's `createdAt`; active + LLM times aggregate across ALL the
 * project's attempts (the union merges overlap across cards, so two cards working at once don't double-count active
 * time). An empty project (no cards) reports zero age but still folds any stray attempts.
 */
export function computeProjectTimeTracking(input: {
	cards: readonly { createdAt: number; completedAt?: number | null }[];
	attempts: readonly TimeTrackingAttempt[];
	now: number;
}): TimeTrackingMetrics {
	if (input.cards.length === 0) {
		const spans = input.attempts.map(attemptSpan).filter((span): span is Span => span !== null);
		const { total, successful } = llmDurations(input.attempts);
		return { ageTotalMs: 0, activeMs: unionDurationMs(spans), llmTotalMs: total, llmSuccessfulMs: successful };
	}
	const earliestCreatedAt = Math.min(...input.cards.map((card) => card.createdAt));
	return computeTimeTracking({ createdAt: earliestCreatedAt, attempts: input.attempts, now: input.now });
}
