/**
 * Attempt idempotency-key derivation + dedup (todo.md §5.AF — the durable scheduler / Agent Attempt Ledger).
 *
 * WHAT: pure, deterministic derivation of the **idempotency key** the `scheduler` ledger event already carries
 * (`AgentSchedulerEvent.idempotencyKey`, `BuildSchedulerEventInput.idempotencyKey`) but which nothing yet COMPUTES —
 * today the field is only ever passed through or defaulted to `null`. §5.AF's schema calls out "idempotency keys" as a
 * first-class part of the scheduler/lease event family precisely so a dispatch can be **at-most-once** and a replay can
 * **dedup** duplicate logical attempts. This module is that missing derivation, plus the dedup query over it.
 *
 * WHY: the durable-run controller's core invariant is **persist-before-dispatch** (`durable-run-controller.commit()`:
 * the lease `scheduler` event is appended BEFORE the worker is dispatched) — which means a crash/restart between
 * "logged the lease" and "the worker actually started" is legal, and `resume()` will reclaim + re-lease + re-dispatch
 * the same logical unit of work. Without a stable key derived from the WORK's identity (not a fresh uuid per dispatch),
 * the sink cannot tell "the same attempt, dispatched again after a restart" from "a genuinely new attempt", so it can
 * neither dedup a double-start nor collapse two ledger rows describing one logical attempt on replay. A `randomUUID()`
 * lease/worker id is deliberately fresh per dispatch (it identifies THIS lease); the idempotency key is its opposite —
 * **stable across re-dispatches of the same work** — so it must be DERIVED from the intrinsic identity, not minted.
 *
 * The identity of "one logical attempt at one point in the retry ladder" is: which run (`workflowId`), which card
 * (`taskId`), in which workspace (`workspacePathHash` — never a host path, #2), at which retry rung (`attempt`), on
 * which model + endpoint (a retry that switches model/endpoint is a genuinely DIFFERENT attempt and must NOT dedup
 * against the previous rung), optionally scoped by a caller-supplied `variant` discriminator (e.g. a swarm member id or
 * a prompt-strategy label, when the same rung fans out several genuinely-distinct dispatches).
 *
 * PURE CORE: no I/O, no clock, no randomness — the key is a `sha256` over a **canonical, key-order-independent**
 * serialization of that identity (mirroring `nklein-tool-call-fingerprint`'s `stableSerialize` + the
 * `protected-test-approval-store` composite-key idiom), so the SAME work derives the SAME key on every machine and every
 * replay, and any change to the identity changes the key by construction. Host-side control-plane, local-only (#1/#2).
 */

import { createHash } from "node:crypto";

/**
 * The intrinsic identity of one logical scheduled attempt — everything that distinguishes it from a *different* attempt,
 * and nothing that merely distinguishes one *dispatch* of it from another (no lease id, no worker id, no clock). Two
 * dispatches of the same work carry the same fields here and so derive the same key; a different rung / model / endpoint
 * / variant is a different attempt and derives a different key.
 */
export interface AttemptIdentity {
	/** The durable run/workflow handle the attempt belongs to (the ledger envelope's `workflowId`). */
	readonly workflowId: string;
	/** The card/task the attempt is toward (the ledger envelope's `taskId`). */
	readonly taskId: string;
	/** The workspace-path HASH the attempt runs in — never the host path (#2). The ledger envelope's `workspacePathHash`. */
	readonly workspacePathHash: string;
	/**
	 * The retry-ladder rung (0 = first try). A re-dispatch after a crash reuses the SAME rung (so it dedups); a genuine
	 * next retry uses a higher rung (so it does not). Non-finite/negative values are normalized to 0.
	 */
	readonly attempt: number;
	/**
	 * The canonical model identity in play (`provider:model:endpoint`, per the ledger's `modelId`). A retry that
	 * *switches models* is a different attempt — so the model is part of the key. Optional/empty ⇒ folded as `""`.
	 */
	readonly modelId?: string | null;
	/** The endpoint in play (the ledger's `endpoint`). A switch of endpoint is likewise a distinct attempt. Optional. */
	readonly endpoint?: string | null;
	/**
	 * An optional extra discriminator for when the SAME (workflow, task, rung, model, endpoint) legitimately fans out
	 * into several distinct dispatches that must NOT dedup against each other — e.g. a swarm-member id, or a
	 * prompt-strategy label when several strategies race at the same rung. Omit for the common single-dispatch case.
	 */
	readonly variant?: string | null;
}

/**
 * Deterministic, key-order-independent serialization of a plain identity record. Sorting keys means cosmetic
 * field-population-order churn between two otherwise-identical identities never reads as "different work" — the same
 * discipline `nklein-tool-call-fingerprint.stableSerialize` uses so a fingerprint is order-stable.
 */
function stableSerializeIdentity(record: Record<string, string>): string {
	const keys = Object.keys(record).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(record[key])}`).join(",")}}`;
}

/** Normalize a possibly-null/undefined string field to a trimmed value, or `""` when absent — so absent === empty. */
function normalizeField(value: string | null | undefined): string {
	return value?.trim() ?? "";
}

/** Normalize the rung to a non-negative integer; any non-finite/negative value folds to the first-try rung 0. */
function normalizeAttempt(attempt: number): number {
	if (!Number.isFinite(attempt)) {
		return 0;
	}
	return Math.max(0, Math.trunc(attempt));
}

/** How many hex chars of the sha256 digest the composite key carries (128 bits — collision-safe for this domain). */
const DIGEST_LENGTH = 32;

/**
 * Derive the stable idempotency key for one logical scheduled attempt. Deterministic and pure: the SAME identity always
 * yields the SAME key (on any machine, across restarts + replay), and ANY change to the identity — a new rung, a
 * switched model/endpoint, a different variant — yields a different key. The result is a composite
 * `<workflowId>:<taskId>:<sha256(canonical identity)[:32]>` — the `protected-test-approval-store` composite-key shape,
 * so the human-legible run+card prefix is scannable in a log while the digest carries the full discriminating identity.
 *
 * Use it to fill `BuildSchedulerEventInput.idempotencyKey` on the `lease` event, so a re-dispatch after a restart
 * derives the identical key and the sink can drop the duplicate (at-most-once), and so `dedupeSchedulerEventsByIdempotencyKey`
 * can collapse duplicate rows on replay.
 */
export function deriveAttemptIdempotencyKey(identity: AttemptIdentity): string {
	const canonical = stableSerializeIdentity({
		workflowId: normalizeField(identity.workflowId),
		taskId: normalizeField(identity.taskId),
		workspacePathHash: normalizeField(identity.workspacePathHash),
		attempt: String(normalizeAttempt(identity.attempt)),
		modelId: normalizeField(identity.modelId),
		endpoint: normalizeField(identity.endpoint),
		variant: normalizeField(identity.variant),
	});
	const digest = createHash("sha256").update(canonical).digest("hex").slice(0, DIGEST_LENGTH);
	// Legible prefix (run + card) for log-scanning; the digest carries the full discriminating identity.
	return `${normalizeField(identity.workflowId)}:${normalizeField(identity.taskId)}:${digest}`;
}

/** Result of a dedup pass — the kept events plus the ids of the duplicates that were dropped (for audit/telemetry). */
export interface SchedulerEventDedupResult<T> {
	/** The events to keep, in first-seen (input) order; every non-null idempotency key appears at most once. */
	readonly kept: readonly T[];
	/** The `eventId`s of the events dropped as duplicates (a later event whose non-null key was already seen). */
	readonly droppedEventIds: readonly string[];
}

/**
 * The minimal shape `dedupeSchedulerEventsByIdempotencyKey` reads — a structural subset of `AgentSchedulerEvent`, so a
 * caller can pass real ledger scheduler events directly WITHOUT this module importing the ledger schema (keeping this a
 * dependency-free pure core, mirroring how `operator-task-state` stays decoupled via a minimal structural view).
 */
export interface IdempotentSchedulerEventView {
	/** Stable per-event id (the envelope's `eventId`) — reported when the event is dropped as a duplicate. */
	readonly eventId: string;
	/** The derived idempotency key; `null`/absent events are never deduped (they carry no dedup identity). */
	readonly idempotencyKey?: string | null;
}

/**
 * Collapse duplicate scheduler events that share a non-null idempotency key to the FIRST occurrence, preserving input
 * order. This is the replay/read side of the key: after a crash + `resume()` re-dispatches the same work, the ledger can
 * hold two `lease` rows with the same derived key; a projection that must count "distinct logical attempts" (the §5.Z
 * matrix, retry-budget accounting) runs this first so the re-dispatch isn't double-counted. Events with a `null`/absent
 * key carry no dedup identity and are ALWAYS kept (e.g. a `heartbeat`, or a legacy row written before the key existed).
 * Pure + total: never throws; returns the kept events plus the dropped duplicates' `eventId`s for audit.
 */
export function dedupeSchedulerEventsByIdempotencyKey<T extends IdempotentSchedulerEventView>(
	events: readonly T[],
): SchedulerEventDedupResult<T> {
	const seenKeys = new Set<string>();
	const kept: T[] = [];
	const droppedEventIds: string[] = [];
	for (const event of events) {
		const key = event.idempotencyKey;
		if (key === null || key === undefined) {
			kept.push(event);
			continue;
		}
		if (seenKeys.has(key)) {
			droppedEventIds.push(event.eventId);
			continue;
		}
		seenKeys.add(key);
		kept.push(event);
	}
	return { kept, droppedEventIds };
}
