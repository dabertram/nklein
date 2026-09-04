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
 */

export interface DeadModelMark {
	readonly modelId: string;
	readonly endpoint: string;
	readonly reason: "absent_from_listing" | "listed_but_dead";
	readonly markedAtMs: number;
	readonly expiresAtMs: number;
}

const DEFAULT_DEAD_MODEL_TTL_MS = 15 * 60_000;

const deadModelMarksByModelId = new Map<string, DeadModelMark>();

export function markModelDead(input: {
	modelId: string;
	endpoint: string;
	reason: DeadModelMark["reason"];
	nowMs?: number;
	ttlMs?: number;
}): DeadModelMark {
	const nowMs = input.nowMs ?? Date.now();
	const mark: DeadModelMark = {
		modelId: input.modelId,
		endpoint: input.endpoint,
		reason: input.reason,
		markedAtMs: nowMs,
		expiresAtMs: nowMs + (input.ttlMs ?? DEFAULT_DEAD_MODEL_TTL_MS),
	};
	deadModelMarksByModelId.set(input.modelId, mark);
	return mark;
}

/** A live mark for the model id, or undefined (expired marks are dropped on read). */
export function getModelDeadMark(modelId: string, nowMs = Date.now()): DeadModelMark | undefined {
	const mark = deadModelMarksByModelId.get(modelId);
	if (!mark) {
		return undefined;
	}
	if (mark.expiresAtMs <= nowMs) {
		deadModelMarksByModelId.delete(modelId);
		return undefined;
	}
	return mark;
}

export function isModelMarkedDead(modelId: string, nowMs = Date.now()): boolean {
	return getModelDeadMark(modelId, nowMs) !== undefined;
}

/** Explicit re-admission (a recovery probe saw the model serve, or the operator intervened). */
export function clearModelDeadMark(modelId: string): boolean {
	return deadModelMarksByModelId.delete(modelId);
}

export function listModelDeadMarks(nowMs = Date.now()): DeadModelMark[] {
	const marks: DeadModelMark[] = [];
	for (const [modelId, mark] of deadModelMarksByModelId) {
		if (mark.expiresAtMs <= nowMs) {
			deadModelMarksByModelId.delete(modelId);
			continue;
		}
		marks.push(mark);
	}
	return marks;
}

/** Test seam: drop every mark. */
export function resetModelLivenessLedgerForTests(): void {
	deadModelMarksByModelId.clear();
}
