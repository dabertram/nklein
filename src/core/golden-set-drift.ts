/**
 * Golden-set drift watch (F12.49 final slice) — PURE core.
 *
 * A regression corpus rots silently: the live task distribution moves (new models, new difficulty mix, new failure
 * modes) while the corpus keeps replaying yesterday's cases. This core measures COVERAGE — for each comparison
 * dimension, how much of the recent live attempt mass falls in categories the corpus has at least one example of —
 * and alerts when coverage drops below threshold. Coverage (not divergence) is the actionable form: the uncovered
 * categories ARE the mining shortlist for the next `dev golden-set --promote` round. Pure: the caller reads the
 * ledger + corpus file and hands in facts; corpus cases are joined back to their ledger attempts by taskId so the
 * corpus file stays lean (taskId/kind/reason only).
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";

export interface GoldenSetDriftOptions {
	/** Live window: attempts newer than now - windowMs count as "recent live traffic" (default 14 days). */
	readonly windowMs?: number;
	/** Clock injection. */
	readonly now: number;
	/** Per-dimension coverage below this alerts (default 0.7). */
	readonly coverageThreshold?: number;
}

export interface UncoveredCategory {
	readonly category: string;
	/** Share of recent live attempts in this category (0-1). */
	readonly liveShare: number;
}

export interface DimensionDrift {
	readonly dimension: "model" | "difficulty" | "flow" | "outcome";
	/** Share of live mass in categories the corpus covers (0-1); 1 when the corpus spans everything live does. */
	readonly coverage: number;
	readonly drifted: boolean;
	/** Live categories with zero corpus examples, largest live share first — the mining shortlist. */
	readonly uncovered: readonly UncoveredCategory[];
}

export interface GoldenSetDriftReport {
	readonly liveAttempts: number;
	readonly corpusAttempts: number;
	readonly dimensions: readonly DimensionDrift[];
	readonly drifted: boolean;
	readonly summary: string;
}

const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_COVERAGE_THRESHOLD = 0.7;

type AttemptEvent = Extract<AgentLedgerEvent, { kind: "attempt" }>;

function categoryOf(attempt: AttemptEvent, dimension: DimensionDrift["dimension"]): string {
	switch (dimension) {
		case "model":
			return attempt.modelId;
		case "difficulty":
			return attempt.difficulty ?? "unknown";
		case "flow":
			return attempt.flow ?? "unknown";
		case "outcome":
			return attempt.outcome;
	}
}

function shareByCategory(
	attempts: readonly AttemptEvent[],
	dimension: DimensionDrift["dimension"],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const attempt of attempts) {
		const category = categoryOf(attempt, dimension);
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	const total = attempts.length;
	const shares = new Map<string, number>();
	for (const [category, count] of counts) {
		shares.set(category, count / total);
	}
	return shares;
}

/**
 * Compare the recent live attempt distribution against the corpus's attempt features (corpus cases joined back to
 * ledger attempts by taskId). Deterministic; zero live attempts or an empty corpus yields an honest non-alert report
 * (nothing to compare ≠ drift).
 */
export function assessGoldenSetDrift(
	events: readonly AgentLedgerEvent[],
	corpusTaskIds: readonly string[],
	options: GoldenSetDriftOptions,
): GoldenSetDriftReport {
	const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
	const threshold = options.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD;
	const attempts = events.filter((event): event is AttemptEvent => event.kind === "attempt");
	const cutoff = options.now - windowMs;
	const live = attempts.filter((attempt) => (attempt.completedAt ?? attempt.startedAt ?? 0) >= cutoff);
	const corpusIds = new Set(corpusTaskIds);
	const corpus = attempts.filter((attempt) => corpusIds.has(attempt.taskId));
	if (live.length === 0 || corpus.length === 0) {
		return {
			liveAttempts: live.length,
			corpusAttempts: corpus.length,
			dimensions: [],
			drifted: false,
			summary:
				corpus.length === 0
					? "No corpus cases resolvable in the ledger — promote cases via `dev golden-set --promote` first."
					: "No live attempts in the window — nothing to compare.",
		};
	}
	const dimensions: DimensionDrift[] = (["model", "difficulty", "flow", "outcome"] as const).map((dimension) => {
		const liveShares = shareByCategory(live, dimension);
		const corpusCategories = new Set(corpus.map((attempt) => categoryOf(attempt, dimension)));
		let coverage = 0;
		const uncovered: UncoveredCategory[] = [];
		for (const [category, share] of liveShares) {
			if (corpusCategories.has(category)) {
				coverage += share;
			} else {
				uncovered.push({ category, liveShare: share });
			}
		}
		uncovered.sort((a, b) => b.liveShare - a.liveShare || a.category.localeCompare(b.category));
		return { dimension, coverage, drifted: coverage < threshold, uncovered };
	});
	const driftedDimensions = dimensions.filter((entry) => entry.drifted);
	return {
		liveAttempts: live.length,
		corpusAttempts: corpus.length,
		dimensions,
		drifted: driftedDimensions.length > 0,
		summary:
			driftedDimensions.length === 0
				? `Corpus covers the live distribution (${dimensions.map((entry) => `${entry.dimension} ${Math.round(entry.coverage * 100)}%`).join(", ")}).`
				: `DRIFT: ${driftedDimensions
						.map(
							(entry) =>
								`${entry.dimension} coverage ${Math.round(entry.coverage * 100)}% — top uncovered: ${entry.uncovered
									.slice(0, 3)
									.map((u) => `${u.category} (${Math.round(u.liveShare * 100)}%)`)
									.join(", ")}`,
						)
						.join("; ")} — mine + promote from these categories.`,
	};
}
