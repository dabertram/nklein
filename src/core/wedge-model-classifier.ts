/**
 * Is a model that has produced no tokens BUSY, or is it dead?
 *
 * ── WHY THIS IS A CORE ──
 * P0.BUSYWEDGE (live 2026-09-04): a single-slot m4mini serving a 2-bit quant spent 15+ minutes prefilling a 35k
 * prompt. It could not answer the runtime's 1-token liveness probe — that probe queued behind the very request it
 * was probing — so the wedge sweep marked it `listed_but_dead` three times, to the strike cap, and killed a turn
 * that was working. `lms ps` knew the truth the whole time: the instance was PROCESSING.
 *
 * Two sweeps ask this question (the zero-token wedge and the silent-running sweep), and they must not answer it
 * differently — "busy" meaning one thing here and another there is how a model gets interrupted by one path while
 * another waits for it. So the definition lives here, once, and the probe is injected so it can be tested without
 * a fleet.
 *
 * ── THE FAIL DIRECTION IS DELIBERATE ──
 * An unreachable or empty listing reads as NOT busy. That is the safe direction: "busy" suppresses the wedge
 * handling, so claiming it on no evidence would let a genuinely dead model hold a card forever, and a wedge that
 * is never handled is worse than a slow turn that is interrupted once. Absence of evidence must not become
 * evidence of life.
 */

/** The shape this module needs from an `lms ps` row; anything else on the row is ignored. */
export interface WedgeModelListingRow {
	identifier?: string | null;
	status?: unknown;
}

/** `lms ps` reports work in progress as one of these; matched case-insensitively anywhere in the status text. */
const BUSY_STATUS = /processing|generating/iu;

/**
 * Pure: does this listing show the named model actively working?
 *
 * Any instance of the identifier being busy makes it busy — a model served by several instances is alive if one of
 * them is working, and the wedge only asks whether the endpoint is capable of answering at all.
 */
export function isModelBusyInListing(models: readonly WedgeModelListingRow[], modelId: string): boolean {
	if (!modelId) {
		return false;
	}
	return models.some((model) => model.identifier === modelId && BUSY_STATUS.test(String(model.status ?? "")));
}

/**
 * The effectful wrapper both sweeps call: probe the listing, classify, and treat any failure as NOT busy.
 *
 * Kept beside the pure predicate rather than at each call site so the swallow-and-say-not-busy behaviour is part of
 * the definition, not a `.catch(() => false)` a future caller might forget or write differently.
 */
export async function classifyModelBusy(
	modelId: string,
	probeListing: () => Promise<readonly WedgeModelListingRow[]>,
): Promise<boolean> {
	try {
		return isModelBusyInListing(await probeListing(), modelId);
	} catch {
		return false;
	}
}
