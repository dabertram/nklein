/**
 * P0.POOLLOSS — the PROACTIVE fleet pool sweep. PURE core + the runtime-level presence ledger.
 *
 * ── THE FAILURE (live 2026-09-03) ──
 * `dirk@iq4_xs` crashed at 03:41 (one 500, then 400s) and the unpinned worker pool routed around it for 17 hours
 * with no observation and no board notice; David noticed the idle m4 himself. The two legs shipped on 09-04 only
 * ever learned about a loss from a VICTIM: a session had to wedge token-less on the vanished model before the
 * watchdog probed it. A pool member that simply stops being routed to never produces a victim.
 *
 * ── WHAT THIS DOES ──
 * Every sweep diffs the configured role pools (each role's primary model + its `additionalModels`) against what
 * each endpoint currently reports LOADED. A member absent on `missesToDeclare` CONSECUTIVE sweeps is declared
 * lost; the first sweep that lists it again declares it recovered. The caller marks the model dead in the
 * liveness ledger on loss (routing excludes it at once), clears the mark on recovery, records both, and the
 * board notice reads {@link listFleetPoolLosses}.
 *
 * ── WHAT IT REFUSES TO CONCLUDE ──
 * A probe that fails or comes back EMPTY is uncertainty, never evidence that every model disappeared (the
 * fleet-change resharder's doctrine): members on that endpoint keep their state and their miss count. One miss
 * is a transient LM Link omission or a model reload, not a loss — hence the two-observation gate. Presence in a
 * listing is not liveness either (a relay can advertise a dead host); that case stays with the wedge classifier's
 * served-token doctrine. This sweep answers exactly one question: "is a configured pool member still loaded?"
 *
 * Pure + total: the transition function takes the previous state and returns the next; no clock, no I/O.
 */

export interface FleetPoolMember {
	readonly role: string;
	readonly primary: boolean;
	/** The invoked model id (the launch config's `modelId`). */
	readonly modelId: string;
	/** The OpenAI-style base URL the role invokes it on. */
	readonly endpoint: string;
}

export interface FleetEndpointListing {
	readonly endpoint: string;
	/** Every id the endpoint reports loaded (runtime aliases AND real keys); `null` = the probe failed or was empty. */
	readonly loadedModelIds: readonly string[] | null;
}

export interface FleetPoolMemberPresence {
	readonly modelId: string;
	readonly endpoint: string;
	/** Every role that lists this (model, endpoint) — one pool member can serve several roles. */
	readonly roles: readonly string[];
	readonly state: "present" | "absent" | "unknown";
	readonly lastSeenAtMs: number | null;
	/** When the current run of misses started (null while present/unknown). */
	readonly absentSinceMs: number | null;
	readonly consecutiveMisses: number;
	/** Set once the miss run reached the gate; cleared on recovery. */
	readonly lossDeclaredAtMs: number | null;
}

export type FleetPoolPresenceState = ReadonlyMap<string, FleetPoolMemberPresence>;

export interface FleetPoolLoss {
	readonly modelId: string;
	readonly endpoint: string;
	readonly roles: readonly string[];
	readonly lastSeenAtMs: number | null;
	readonly absentSinceMs: number;
	readonly declaredAtMs: number;
}

export interface FleetPoolRecovery {
	readonly modelId: string;
	readonly endpoint: string;
	readonly roles: readonly string[];
	readonly lostForMs: number;
	readonly recoveredAtMs: number;
}

export interface FleetPoolSweepInput {
	readonly previous: FleetPoolPresenceState;
	readonly members: readonly FleetPoolMember[];
	readonly listings: readonly FleetEndpointListing[];
	readonly nowMs: number;
	/** Consecutive misses before a loss is declared. Default {@link FLEET_POOL_LOSS_MISSES}. */
	readonly missesToDeclare?: number;
}

export interface FleetPoolSweepResult {
	readonly state: FleetPoolPresenceState;
	readonly losses: readonly FleetPoolLoss[];
	readonly recoveries: readonly FleetPoolRecovery[];
}

/** Two consecutive sweeps: one miss is a transient listing omission or a reload, not a loss. */
export const FLEET_POOL_LOSS_MISSES = 2;

export function normalizeFleetEndpoint(endpoint: string): string {
	return endpoint.trim().replace(/\/+$/u, "");
}

/**
 * The (model, endpoint) identity. A single space separates the two: a base URL cannot contain a literal space and
 * model ids are path-like (`@`, `/` and `:` all occur in them, so none of those would do).
 */
export function fleetPoolPresenceKey(modelId: string, endpoint: string): string {
	return `${modelId.trim()} ${normalizeFleetEndpoint(endpoint)}`;
}

export function advanceFleetPoolPresence(input: FleetPoolSweepInput): FleetPoolSweepResult {
	const missesToDeclare = Math.max(1, Math.floor(input.missesToDeclare ?? FLEET_POOL_LOSS_MISSES));
	const listingByEndpoint = new Map<string, readonly string[] | null>();
	for (const listing of input.listings) {
		listingByEndpoint.set(normalizeFleetEndpoint(listing.endpoint), listing.loadedModelIds);
	}
	// Group the configured members by (model, endpoint); roles merge.
	const rolesByKey = new Map<string, { modelId: string; endpoint: string; roles: string[] }>();
	for (const member of input.members) {
		const modelId = member.modelId.trim();
		const endpoint = normalizeFleetEndpoint(member.endpoint);
		if (!modelId || !endpoint) {
			continue;
		}
		const key = fleetPoolPresenceKey(modelId, endpoint);
		const grouped = rolesByKey.get(key) ?? { modelId, endpoint, roles: [] };
		if (!grouped.roles.includes(member.role)) {
			grouped.roles.push(member.role);
		}
		rolesByKey.set(key, grouped);
	}
	const next = new Map<string, FleetPoolMemberPresence>();
	const losses: FleetPoolLoss[] = [];
	const recoveries: FleetPoolRecovery[] = [];
	for (const [key, grouped] of rolesByKey) {
		const before = input.previous.get(key);
		const listing = listingByEndpoint.get(grouped.endpoint);
		if (listing === undefined || listing === null) {
			// Uncertainty: carry the previous state (roles refreshed); a member never seen stays unknown.
			next.set(key, {
				modelId: grouped.modelId,
				endpoint: grouped.endpoint,
				roles: grouped.roles,
				state: before?.state ?? "unknown",
				lastSeenAtMs: before?.lastSeenAtMs ?? null,
				absentSinceMs: before?.absentSinceMs ?? null,
				consecutiveMisses: before?.consecutiveMisses ?? 0,
				lossDeclaredAtMs: before?.lossDeclaredAtMs ?? null,
			});
			continue;
		}
		if (listing.includes(grouped.modelId)) {
			if (before?.lossDeclaredAtMs != null) {
				recoveries.push({
					modelId: grouped.modelId,
					endpoint: grouped.endpoint,
					roles: grouped.roles,
					lostForMs: Math.max(0, input.nowMs - (before.absentSinceMs ?? before.lossDeclaredAtMs)),
					recoveredAtMs: input.nowMs,
				});
			}
			next.set(key, {
				modelId: grouped.modelId,
				endpoint: grouped.endpoint,
				roles: grouped.roles,
				state: "present",
				lastSeenAtMs: input.nowMs,
				absentSinceMs: null,
				consecutiveMisses: 0,
				lossDeclaredAtMs: null,
			});
			continue;
		}
		const consecutiveMisses = (before?.consecutiveMisses ?? 0) + 1;
		const absentSinceMs = before?.absentSinceMs ?? input.nowMs;
		let lossDeclaredAtMs = before?.lossDeclaredAtMs ?? null;
		if (lossDeclaredAtMs === null && consecutiveMisses >= missesToDeclare) {
			lossDeclaredAtMs = input.nowMs;
			losses.push({
				modelId: grouped.modelId,
				endpoint: grouped.endpoint,
				roles: grouped.roles,
				lastSeenAtMs: before?.lastSeenAtMs ?? null,
				absentSinceMs,
				declaredAtMs: input.nowMs,
			});
		}
		next.set(key, {
			modelId: grouped.modelId,
			endpoint: grouped.endpoint,
			roles: grouped.roles,
			state: "absent",
			lastSeenAtMs: before?.lastSeenAtMs ?? null,
			absentSinceMs,
			consecutiveMisses,
			lossDeclaredAtMs,
		});
	}
	// Members no longer configured drop out silently: an operator removing a model from a pool is not a loss.
	return { state: next, losses, recoveries };
}

// ── The runtime-level ledger: one presence state per process, read by the board notice's query. ──
let currentState: FleetPoolPresenceState = new Map();
let lastSweptAtMs: number | null = null;

export function getFleetPoolPresenceState(): FleetPoolPresenceState {
	return currentState;
}

export function commitFleetPoolSweep(state: FleetPoolPresenceState, sweptAtMs: number): void {
	currentState = state;
	lastSweptAtMs = sweptAtMs;
}

export function fleetPoolLastSweptAtMs(): number | null {
	return lastSweptAtMs;
}

/** Every member currently declared lost, oldest loss first. */
export function listFleetPoolLosses(): FleetPoolLoss[] {
	const losses: FleetPoolLoss[] = [];
	for (const presence of currentState.values()) {
		if (presence.lossDeclaredAtMs !== null && presence.absentSinceMs !== null) {
			losses.push({
				modelId: presence.modelId,
				endpoint: presence.endpoint,
				roles: presence.roles,
				lastSeenAtMs: presence.lastSeenAtMs,
				absentSinceMs: presence.absentSinceMs,
				declaredAtMs: presence.lossDeclaredAtMs,
			});
		}
	}
	return losses.sort((left, right) => left.declaredAtMs - right.declaredAtMs);
}

export function resetFleetPoolPresenceForTests(): void {
	currentState = new Map();
	lastSweptAtMs = null;
}
