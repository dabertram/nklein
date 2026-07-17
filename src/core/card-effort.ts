/**
 * F12.58 per-card cost/effort meter — PURE core.
 *
 * Parallel agents multiply token spend and wall time invisibly; the operator sees lanes, not cost. This projection
 * folds the persisted per-run summaries (`task-run-summary-store`: token usage + wall span per terminal run) into a
 * per-card effort ledger + a board rollup, and assesses an optional soft token cap (advisory tiers — the pause/
 * escalate reaction belongs to the caller's policy, not this projection). No new recording seam.
 */

export interface CardEffortRun {
	readonly taskId: string;
	readonly startedAt: number | null;
	readonly endedAt: number;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly totalTokens: number | null;
	readonly modelId: string | null;
}

export interface CardEffort {
	readonly taskId: string;
	readonly runs: number;
	/** Sum of totalTokens across runs that reported it (prompt+completion fallback when total is absent). */
	readonly totalTokens: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	/** Runs with NO usable token telemetry — the honesty counter (spend is UNDER-counted when > 0). */
	readonly untrackedRuns: number;
	/** Sum of wall spans (endedAt − startedAt) where known, ms. */
	readonly wallMs: number;
	readonly models: readonly string[];
}

export interface BoardEffortRollup {
	readonly cards: readonly CardEffort[];
	readonly boardTotalTokens: number;
	readonly boardWallMs: number;
	readonly boardUntrackedRuns: number;
}

/** Fold run summaries into per-card effort, most-expensive card first. */
export function computeCardEffort(runs: readonly CardEffortRun[]): BoardEffortRollup {
	const byTask = new Map<string, { runs: CardEffortRun[] }>();
	for (const run of runs) {
		const entry = byTask.get(run.taskId) ?? { runs: [] };
		entry.runs.push(run);
		byTask.set(run.taskId, entry);
	}
	const cards: CardEffort[] = [...byTask.entries()].map(([taskId, entry]) => {
		let totalTokens = 0;
		let promptTokens = 0;
		let completionTokens = 0;
		let untrackedRuns = 0;
		let wallMs = 0;
		const models = new Set<string>();
		for (const run of entry.runs) {
			const total =
				run.totalTokens ??
				(run.promptTokens !== null || run.completionTokens !== null
					? (run.promptTokens ?? 0) + (run.completionTokens ?? 0)
					: null);
			if (total === null) {
				untrackedRuns += 1;
			} else {
				totalTokens += total;
				promptTokens += run.promptTokens ?? 0;
				completionTokens += run.completionTokens ?? 0;
			}
			if (run.startedAt !== null && run.endedAt > run.startedAt) {
				wallMs += run.endedAt - run.startedAt;
			}
			if (run.modelId) {
				models.add(run.modelId);
			}
		}
		return {
			taskId,
			runs: entry.runs.length,
			totalTokens,
			promptTokens,
			completionTokens,
			untrackedRuns,
			wallMs,
			models: [...models].sort(),
		};
	});
	cards.sort((a, b) => b.totalTokens - a.totalTokens || b.wallMs - a.wallMs || a.taskId.localeCompare(b.taskId));
	return {
		cards,
		boardTotalTokens: cards.reduce((sum, card) => sum + card.totalTokens, 0),
		boardWallMs: cards.reduce((sum, card) => sum + card.wallMs, 0),
		boardUntrackedRuns: cards.reduce((sum, card) => sum + card.untrackedRuns, 0),
	};
}

export type EffortBudgetTier = "within" | "approaching" | "over";

export interface EffortBudgetVerdict {
	readonly tier: EffortBudgetTier;
	/** Spend as a fraction of the cap (>1 = over). */
	readonly fraction: number;
	readonly note: string;
}

/**
 * Advisory soft-cap assessment: ≥100% over, ≥75% approaching. The REACTION (pause / escalate / just badge) is the
 * caller's policy — this stays a measurement so flipping the reaction later never rewrites the meter.
 */
export function assessEffortBudget(effort: Pick<CardEffort, "totalTokens">, capTokens: number): EffortBudgetVerdict {
	if (capTokens <= 0) {
		return { tier: "within", fraction: 0, note: "no cap set." };
	}
	const fraction = effort.totalTokens / capTokens;
	if (fraction >= 1) {
		return {
			tier: "over",
			fraction,
			note: `spend is ${Math.round(fraction * 100)}% of the soft cap — pause or escalate.`,
		};
	}
	if (fraction >= 0.75) {
		return { tier: "approaching", fraction, note: `spend is ${Math.round(fraction * 100)}% of the soft cap.` };
	}
	return { tier: "within", fraction, note: `spend is ${Math.round(fraction * 100)}% of the soft cap.` };
}
