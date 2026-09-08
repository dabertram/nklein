/**
 * Model-liveness ledger (P0.POOLLOSS leg 2, live 2026-09-04).
 *
 * ── WHY LISTING ≠ LIVENESS ──
 * The fleet gateway KEEPS a remote model in `/v1/models` after its relay/host dies, and QUEUES
 * requests for it forever (90s+, zero bytes, no error). So both start-path residency validation and
 * the wedge classifier's absence check read a green signal off a corpse: the v31 drain fed a wedged
 * card back to the same dead model every ~15 min for 3 hours because every lens said "present".
 *
 * The only fact that establishes liveness is a served token (or its refusal). This ledger is where
 * that fact lands: the zero-token wedge classifier marks a model dead (absent from its listing, or
 * listed but failing a 1-token probe), the start path EXCLUDES marked models from routing candidates,
 * and recovery is TTL re-admission (a still-dead model just gets re-marked by the next victim's
 * classifier — bounded damage) plus an explicit clear when a recovery probe sees the model serve.
 *
 * Process-wide by design: the runtime server and the start path share one process; a restart clears
 * the ledger, which is correct (fresh boot re-establishes facts, at worst one wedge cycle re-marks).
 *
 * ── KEYED BY (MODEL, ENDPOINT) ── (P0.AUDIT0904 leg 8, 2026-09-08)
 * Liveness is a property of a model ON A HOST, not of a model id. The mark always carried its `endpoint` but the
 * ledger keyed by `modelId` alone, so proving `dirk-qwen3.8-27b` dead behind one relay excluded the SAME model id
 * resident on another host — the fleet deliberately serves one model from several endpoints (direct and via the tee
 * proxy, or two machines). A query WITHOUT an endpoint stays conservative (dead on ANY endpoint counts as dead), so
 * callers that genuinely cannot name their endpoint keep the old fail-closed behaviour; callers that know it get the
 * precise answer. TTL escalation is per (model, endpoint) too: one host being dead all day must not escalate the
 * other host's re-admission delay.
 */

export interface DeadModelMark {
	readonly modelId: string;
	readonly endpoint: string;
	readonly reason: "absent_from_listing" | "listed_but_dead";
	readonly markedAtMs: number;
	readonly expiresAtMs: number;
}

const DEFAULT_DEAD_MODEL_TTL_MS = 15 * 60_000;
const MAX_DEAD_MODEL_TTL_MS = 4 * 60 * 60_000;

/** modelId → endpoint → mark. */
const deadModelMarksByModelId = new Map<string, Map<string, DeadModelMark>>();
// Survives TTL expiry on purpose: a host that has been dead for hours keeps getting re-proven dead by
// fresh victims (live 2026-09-04: 15 min re-admitted a relay that had been gone all day). Each re-mark
// doubles the TTL up to the cap; only an explicit clear (the model demonstrably SERVED) resets it.
const deadMarkCountByModelEndpoint = new Map<string, number>();

/** How a caller asks about a mark: a bare `nowMs` (legacy) or `{ endpoint, nowMs }`. */
export interface DeadModelMarkQuery {
	/** The endpoint the caller is about to use. Omitted ⇒ "dead on ANY endpoint" (conservative). */
	readonly endpoint?: string;
	readonly nowMs?: number;
}

function normalizeQuery(query?: number | DeadModelMarkQuery): { nowMs: number; endpoint: string | undefined } {
	if (typeof query === "number") {
		return { nowMs: query, endpoint: undefined };
	}
	return { nowMs: query?.nowMs ?? Date.now(), endpoint: query?.endpoint };
}

/** Drop expired marks for one model; returns its live marks (and prunes the model when none remain). */
function liveMarksFor(modelId: string, nowMs: number): Map<string, DeadModelMark> | undefined {
	const byEndpoint = deadModelMarksByModelId.get(modelId);
	if (!byEndpoint) {
		return undefined;
	}
	for (const [endpoint, mark] of byEndpoint) {
		if (mark.expiresAtMs <= nowMs) {
			byEndpoint.delete(endpoint);
		}
	}
	if (byEndpoint.size === 0) {
		deadModelMarksByModelId.delete(modelId);
		return undefined;
	}
	return byEndpoint;
}

export function markModelDead(input: {
	modelId: string;
	endpoint: string;
	reason: DeadModelMark["reason"];
	nowMs?: number;
	ttlMs?: number;
}): DeadModelMark {
	const nowMs = input.nowMs ?? Date.now();
	const countKey = `${input.modelId}\u0000${input.endpoint}`;
	const markCount = (deadMarkCountByModelEndpoint.get(countKey) ?? 0) + 1;
	deadMarkCountByModelEndpoint.set(countKey, markCount);
	const escalatedTtlMs = Math.min(DEFAULT_DEAD_MODEL_TTL_MS * 2 ** (markCount - 1), MAX_DEAD_MODEL_TTL_MS);
	const mark: DeadModelMark = {
		modelId: input.modelId,
		endpoint: input.endpoint,
		reason: input.reason,
		markedAtMs: nowMs,
		expiresAtMs: nowMs + (input.ttlMs ?? escalatedTtlMs),
	};
	const byEndpoint = deadModelMarksByModelId.get(input.modelId) ?? new Map<string, DeadModelMark>();
	byEndpoint.set(input.endpoint, mark);
	deadModelMarksByModelId.set(input.modelId, byEndpoint);
	return mark;
}

/**
 * A live mark for the model, or undefined (expired marks are dropped on read). With `endpoint` the answer is about
 * THAT host; without one it is "dead on any endpoint" — the conservative reading for callers that cannot name theirs.
 */
export function getModelDeadMark(modelId: string, query?: number | DeadModelMarkQuery): DeadModelMark | undefined {
	const { nowMs, endpoint } = normalizeQuery(query);
	const byEndpoint = liveMarksFor(modelId, nowMs);
	if (!byEndpoint) {
		return undefined;
	}
	if (endpoint !== undefined) {
		return byEndpoint.get(endpoint);
	}
	// No endpoint named: any live mark answers (deterministic — the earliest-expiring one).
	return [...byEndpoint.values()].sort((left, right) => left.expiresAtMs - right.expiresAtMs)[0];
}

export function isModelMarkedDead(modelId: string, query?: number | DeadModelMarkQuery): boolean {
	return getModelDeadMark(modelId, query) !== undefined;
}

/**
 * Explicit re-admission (a recovery probe saw the model serve, or the operator intervened). With `endpoint` only
 * that host is re-admitted; without one every endpoint's mark for the model is cleared.
 */
export function clearModelDeadMark(modelId: string, endpoint?: string): boolean {
	const byEndpoint = deadModelMarksByModelId.get(modelId);
	if (!byEndpoint) {
		return false;
	}
	if (endpoint === undefined) {
		for (const knownEndpoint of byEndpoint.keys()) {
			deadMarkCountByModelEndpoint.delete(`${modelId}\u0000${knownEndpoint}`);
		}
		return deadModelMarksByModelId.delete(modelId);
	}
	deadMarkCountByModelEndpoint.delete(`${modelId}\u0000${endpoint}`);
	const removed = byEndpoint.delete(endpoint);
	if (byEndpoint.size === 0) {
		deadModelMarksByModelId.delete(modelId);
	}
	return removed;
}

export function listModelDeadMarks(nowMs = Date.now()): DeadModelMark[] {
	const marks: DeadModelMark[] = [];
	for (const modelId of [...deadModelMarksByModelId.keys()]) {
		const byEndpoint = liveMarksFor(modelId, nowMs);
		if (byEndpoint) {
			marks.push(...byEndpoint.values());
		}
	}
	return marks;
}

/** Test seam: drop every mark. */
export function resetModelLivenessLedgerForTests(): void {
	deadModelMarksByModelId.clear();
	deadMarkCountByModelEndpoint.clear();
}
