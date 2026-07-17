/**
 * Cost-per-resolve + Pareto frontier (F12.48) — PURE ledger projection.
 *
 * Complements `summarizeSwarmEfficiency` (per-model waste scoreboard) with the two things it lacks: the ROLE
 * dimension and PER-RESOLVE normalization — cost only means something divided by delivered outcomes (HAL: higher
 * reasoning effort often LOWERED accuracy, a trade-off invisible without cost-per-resolve). `paretoFrontierOf` then
 * names the models that are NOT dominated (no other row is both more accurate and cheaper) — the defensible routing
 * set per role. Pure + deterministic over the persisted attempt events.
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";

export interface CostPerResolveRow {
	readonly modelId: string;
	readonly role: string;
	readonly attempts: number;
	readonly resolvedTasks: number;
	/** Successful attempts / all attempts (0-1). */
	readonly resolveRate: number;
	/** Mean wall-clock ms per RESOLVED task (all attempts' wall time amortized over resolves); null when 0 resolves. */
	readonly wallMsPerResolve: number | null;
	/** Mean context tokens per RESOLVED task; null when 0 resolves. */
	readonly tokensPerResolve: number | null;
}

type AttemptEvent = Extract<AgentLedgerEvent, { kind: "attempt" }>;

function roleOf(attempt: AttemptEvent): string {
	return (attempt.flow ?? "worker").toString();
}

/** Roll attempts up into per-(model, role) cost-per-resolve rows, most attempts first. */
export function computeCostPerResolve(events: readonly AgentLedgerEvent[]): CostPerResolveRow[] {
	const buckets = new Map<
		string,
		{
			modelId: string;
			role: string;
			attempts: number;
			wallMs: number;
			tokens: number;
			resolvedTaskIds: Set<string>;
			successes: number;
		}
	>();
	for (const event of events) {
		if (event.kind !== "attempt") {
			continue;
		}
		const role = roleOf(event);
		const key = `${event.modelId} ${role}`;
		const bucket = buckets.get(key) ?? {
			modelId: event.modelId,
			role,
			attempts: 0,
			wallMs: 0,
			tokens: 0,
			resolvedTaskIds: new Set<string>(),
			successes: 0,
		};
		bucket.attempts += 1;
		if (event.startedAt !== null && event.completedAt !== null && event.completedAt > event.startedAt) {
			bucket.wallMs += event.completedAt - event.startedAt;
		}
		bucket.tokens += event.contextTokens ?? 0;
		if (event.outcome === "success") {
			bucket.successes += 1;
			bucket.resolvedTaskIds.add(event.taskId);
		}
		buckets.set(key, bucket);
	}
	return [...buckets.values()]
		.map((bucket) => {
			const resolvedTasks = bucket.resolvedTaskIds.size;
			return {
				modelId: bucket.modelId,
				role: bucket.role,
				attempts: bucket.attempts,
				resolvedTasks,
				resolveRate: bucket.attempts === 0 ? 0 : bucket.successes / bucket.attempts,
				wallMsPerResolve: resolvedTasks === 0 ? null : bucket.wallMs / resolvedTasks,
				tokensPerResolve: resolvedTasks === 0 ? null : bucket.tokens / resolvedTasks,
			};
		})
		.sort((a, b) => b.attempts - a.attempts || a.modelId.localeCompare(b.modelId));
}

/**
 * The Pareto-optimal subset per role: a row is DOMINATED when another row of the same role has >= resolveRate AND
 * <= wallMsPerResolve with at least one strict inequality. Rows with zero resolves cannot sit on the frontier (their
 * cost is undefined). Order: by role, then resolveRate desc.
 */
export function paretoFrontierOf(rows: readonly CostPerResolveRow[]): CostPerResolveRow[] {
	const candidates = rows.filter((row) => row.resolvedTasks > 0 && row.wallMsPerResolve !== null);
	const frontier = candidates.filter(
		(row) =>
			!candidates.some(
				(other) =>
					other !== row &&
					other.role === row.role &&
					other.resolveRate >= row.resolveRate &&
					(other.wallMsPerResolve ?? Number.POSITIVE_INFINITY) <=
						(row.wallMsPerResolve ?? Number.POSITIVE_INFINITY) &&
					(other.resolveRate > row.resolveRate ||
						(other.wallMsPerResolve ?? Number.POSITIVE_INFINITY) <
							(row.wallMsPerResolve ?? Number.POSITIVE_INFINITY)),
			),
	);
	return frontier.sort((a, b) => a.role.localeCompare(b.role) || b.resolveRate - a.resolveRate);
}
