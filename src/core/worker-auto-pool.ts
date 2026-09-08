/**
 * The worker AUTO-POOL: widening a configured worker pool with the other models that happen to be loaded.
 *
 * ── WHY IT EXISTS ──
 * A card whose role has a configured model pool can only run on that pool. On a fleet where someone has loaded a
 * capable model that nobody added to the config, the card queues behind a busy configured model while an idle
 * capable one sits unused. The auto-pool absorbs those, so "what is loaded" widens "what was configured" without
 * replacing it — the configured pool always comes FIRST, because the operator's choice is a preference, not a
 * coincidence of what is running.
 *
 * ── WHY IT IS A CORE (P0.AUDIT0904 leg 25) ──
 * This ran inline inside `handleStartTaskSession`, a function long enough that the widening could only be
 * exercised by starting a real task against a real fleet. Two decisions live here — which loaded models are
 * eligible, and how they join the pool — and both are pure.
 */

/** The shape the auto-pool needs from a routing candidate; everything else on it is carried through untouched. */
export interface AutoPoolCandidate {
	/** The role this candidate is configured for, or null when it is loaded but unassigned. */
	role: string | null;
	entry: { key: string; modelId: string };
}

export interface AutoPoolEligibilityOptions {
	/** The auto-pool feature itself. Disabled ⇒ no candidate is eligible and the configured pool stands alone. */
	enabled: boolean;
	/** Machines the operator will accept auto-pooled models from. EMPTY means every machine, not none. */
	hostAllowlist: ReadonlySet<string>;
	/** Which machine each loaded model is on; a model missing from the map is treated as local. */
	machineIdByModelId: ReadonlyMap<string, string>;
}

/**
 * Which loaded models may join a pool.
 *
 * Only candidates with NO configured role: a model configured for the reviewer role is not spare capacity, it is
 * someone else's model, and absorbing it into the worker pool would quietly re-purpose a deliberate assignment.
 */
export function selectAutoPoolCandidates<T extends AutoPoolCandidate>(
	candidates: readonly T[],
	options: AutoPoolEligibilityOptions,
): T[] {
	if (!options.enabled) {
		return [];
	}
	return candidates.filter(
		(candidate) =>
			candidate.role === null &&
			(options.hostAllowlist.size === 0 ||
				options.hostAllowlist.has(options.machineIdByModelId.get(candidate.entry.modelId) ?? "local")),
	);
}

export interface WidenedWorkerPool<T> {
	/** The pool to route over: the configured candidates first, then the absorbed ones. */
	pool: T[];
	/** Only what the auto-pool ADDED — empty when it changed nothing, which is what the evidence record gates on. */
	absorbed: T[];
}

/**
 * Widen a configured pool with eligible loaded models, de-duplicated by candidate key.
 *
 * Order is part of the contract: the configured pool comes first, so a downstream selector that prefers earlier
 * candidates keeps honouring the operator's configuration and only reaches the absorbed ones when it must.
 */
export function widenWorkerPoolWithAutoPool<T extends AutoPoolCandidate>(
	configured: readonly T[],
	autoCandidates: readonly T[],
): WidenedWorkerPool<T> {
	if (autoCandidates.length === 0) {
		return { pool: [...configured], absorbed: [] };
	}
	const configuredKeys = new Set(configured.map((candidate) => candidate.entry.key));
	const seenAbsorbed = new Set<string>();
	const absorbed: T[] = [];
	for (const candidate of autoCandidates) {
		if (configuredKeys.has(candidate.entry.key) || seenAbsorbed.has(candidate.entry.key)) {
			continue;
		}
		seenAbsorbed.add(candidate.entry.key);
		absorbed.push(candidate);
	}
	return { pool: [...configured, ...absorbed], absorbed };
}
