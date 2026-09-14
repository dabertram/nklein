/**
 * "A SERVED TOKEN is the only fact that establishes liveness" — the model-liveness ledger's own doctrine, applied
 * in the other direction. PURE core.
 *
 * ── WHY THIS EXISTS (measured 2026-09-14) ──
 * The zero-token wedge classifier decides a listed model is `listed_but_dead` when a 1-token probe does not answer
 * within twelve seconds. That threshold encodes an assumption — "a live model answers a trivial prompt fast" —
 * which is false for any endpoint whose answer latency is long by design. The HITL model seat
 * (`bin/hitl-model-server.py`) is an AGENT answering at roughly 1.5 minutes per turn, so EVERY probe timed out:
 * `claude-hitl` was marked dead 14 times across 2026-09-07..11, routing then excluded it, every subsequent start
 * failed `pinned_model_unavailable`, and 17 cards were paused after five failures each — each pause a card that
 * stops moving until an operator resumes it. From the outside this reads as "the model seat went idle" while the
 * seat was answering steadily.
 *
 * `isModelBusyPerLmsPs` already encodes the BUSY ≠ DEAD distinction, but only for LM Studio models (`lms ps`); a
 * custom provider has no equivalent lens. This core is the provider-agnostic one, and it uses the fact the ledger
 * itself calls decisive: another session on the SAME (model, endpoint) served a token inside the window, so the
 * endpoint is demonstrably serving and this wedge is about the session, not the model.
 *
 * ── FAIL-SAFE DIRECTION ──
 * A wrong "dead" mark costs the whole fleet a model (and pauses cards); a wrong "alive" reading costs one more
 * wedge cycle, whose own classifier re-examines the model minutes later. So every uncertain case reads as ALIVE:
 * an endpoint known on only one side still matches on the model id, and a witness with no timestamp is ignored
 * rather than treated as evidence of death.
 */

/** What a session can testify to: which model/endpoint it ran on, and when it last produced anything. */
export interface ModelTokenWitness {
	readonly taskId: string;
	readonly modelId?: string | null;
	readonly endpoint?: string | null;
	/** When this session last received a token (the decisive fact). */
	readonly lastTokenAt?: number | null;
	/** When it last produced output — a coarser proxy, used only when no token timestamp exists. */
	readonly lastOutputAt?: number | null;
}

/**
 * How recently a token must have been served to refute a probe timeout. Generous on purpose: the mark it withholds
 * lasts 15 minutes at minimum and DOUBLES on every re-mark (up to four hours), so the asymmetry runs the other way.
 */
export const RECENT_TOKEN_EVIDENCE_WINDOW_MS = 15 * 60_000;

export interface RecentTokenEvidence {
	/** The session that proves the endpoint is serving. */
	readonly taskId: string;
	readonly servedAtMs: number;
	/** True when the witness matched on model id alone because one side named no endpoint. */
	readonly endpointAssumed: boolean;
}

function normalize(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/** The most recent moment this witness demonstrably produced something, or null when it never did. */
function servedAt(witness: ModelTokenWitness): number | null {
	const candidates = [witness.lastTokenAt, witness.lastOutputAt].filter(
		(value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
	);
	return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * Evidence that this (model, endpoint) served a token recently — i.e. that a probe timeout is slowness, not death.
 * The wedged session itself is excluded via `excludeTaskId`: it is token-less by definition and can never be its
 * own witness. Returns the most recent witness, so the observation can name what refuted the verdict.
 */
export function findRecentTokenEvidence(input: {
	readonly modelId: string;
	readonly endpoint?: string | null;
	readonly witnesses: readonly ModelTokenWitness[];
	readonly excludeTaskId?: string;
	readonly nowMs: number;
	readonly windowMs?: number;
}): RecentTokenEvidence | null {
	const modelId = normalize(input.modelId);
	if (!modelId) {
		return null;
	}
	const endpoint = normalize(input.endpoint);
	const windowMs = input.windowMs ?? RECENT_TOKEN_EVIDENCE_WINDOW_MS;
	const oldestAcceptable = input.nowMs - windowMs;
	let best: RecentTokenEvidence | null = null;
	for (const witness of input.witnesses) {
		if (input.excludeTaskId !== undefined && witness.taskId === input.excludeTaskId) {
			continue;
		}
		if (normalize(witness.modelId) !== modelId) {
			continue;
		}
		const witnessEndpoint = normalize(witness.endpoint);
		// Both sides named an endpoint and they disagree ⇒ a different host's copy, which proves nothing here.
		// Either side missing ⇒ match on the model id (the fail-safe direction: uncertainty reads as ALIVE).
		const endpointAssumed = endpoint === null || witnessEndpoint === null;
		if (!endpointAssumed && witnessEndpoint !== endpoint) {
			continue;
		}
		const at = servedAt(witness);
		if (at === null || at < oldestAcceptable || at > input.nowMs) {
			continue;
		}
		if (!best || at > best.servedAtMs) {
			best = { taskId: witness.taskId, servedAtMs: at, endpointAssumed };
		}
	}
	return best;
}
