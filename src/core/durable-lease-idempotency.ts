/**
 * The COMPOSITION adapter that stamps a durable-scheduler `lease` action with its at-most-once idempotency key (todo
 * §5.AF). {@link deriveAttemptIdempotencyKey} produces a stable key from an attempt's intrinsic identity, and the
 * ledger's `scheduler` event already carries an `idempotencyKey` field — but the two were never joined: the durable
 * scheduler decides leases against a snapshot with no notion of workflow/model identity, so its `lease` actions reach
 * the ledger write site with nothing to fill that field (it defaulted to null). This bridges them: given a tick's
 * scheduler actions + the job snapshot they were decided against + the run's identity context, it derives the key for
 * each `lease` action so the runtime stamps the `lease_acquired` event instead of leaving it null.
 *
 * The stability hinges on WHERE it runs: against the DECISION-time snapshot (the same one
 * {@link module:core/durable-scheduler#decideDurableSchedulerActions} used), whose `attempts` is the PRE-lease count
 * (`applyDurableSchedulerActions` bumps `attempts` only on apply). So a persist-before-dispatch re-run after a crash
 * re-decides against the identical snapshot → identical `attempts` → identical key (the sink drops the duplicate); a
 * genuine reclaim→re-lease has already bumped `attempts` → a higher rung → a different key. Pure/deterministic —
 * composes the derivation + the scheduler types by import and edits neither.
 */

import { deriveAttemptIdempotencyKey } from "./attempt-idempotency-key";
import type { DurableJob, DurableSchedulerAction } from "./durable-scheduler";

/** A `lease` action (the only durable-scheduler action that dispatches work and needs an at-most-once key). */
type LeaseAction = Extract<DurableSchedulerAction, { type: "lease" }>;

/**
 * The run-level identity a lease's idempotency key is derived against. `workflowId` + `workspacePathHash` are run-wide;
 * the optional per-job resolvers let a switched model/endpoint/variant produce a DIFFERENT key (a genuinely different
 * attempt shape), while leaving them unset keeps the key to the (workflow, task, rung) identity.
 */
export interface DurableRunLeaseIdentity {
	readonly workflowId: string;
	/** The workspace-path HASH (never the host path, prime directive #2). */
	readonly workspacePathHash: string;
	/** Optional per-job canonical model id — a switched model is a distinct attempt. */
	readonly modelIdForJob?: (jobId: string) => string | null | undefined;
	/** Optional per-job endpoint — a switched endpoint is a distinct attempt. */
	readonly endpointForJob?: (jobId: string) => string | null | undefined;
	/** Optional per-job extra discriminator (swarm-member / prompt-strategy) for dispatches that must NOT dedup together. */
	readonly variantForJob?: (jobId: string) => string | null | undefined;
}

/** A `lease` action paired with the at-most-once key the ledger `lease_acquired` event should carry. */
export interface KeyedLeaseAction {
	readonly action: LeaseAction;
	readonly idempotencyKey: string;
}

/**
 * Derive the at-most-once idempotency key for every `lease` action a durable-scheduler tick produced (pure). Each key
 * is taken over the leased job's identity — `workflowId` / `taskId=jobId` / `workspacePathHash` / `attempt` (the
 * snapshot's PRE-lease `attempts`, so a re-dispatch dedups but a real retry does not) plus the optional resolved
 * model / endpoint / variant. Non-`lease` actions (reclaim / fail / unblock) carry no work dispatch and are skipped; a
 * lease whose job is absent from the snapshot defensively derives at rung 0. Feed the result to the ledger write site
 * so the `lease_acquired` event's `idempotencyKey` is filled instead of null.
 */
export function keyDurableLeaseActions(
	actions: readonly DurableSchedulerAction[],
	jobs: readonly DurableJob[],
	identity: DurableRunLeaseIdentity,
): KeyedLeaseAction[] {
	const attemptsByJob = new Map<string, number>();
	for (const job of jobs) {
		attemptsByJob.set(job.jobId, job.attempts);
	}

	const keyed: KeyedLeaseAction[] = [];
	for (const action of actions) {
		if (action.type !== "lease") {
			continue;
		}
		const idempotencyKey = deriveAttemptIdempotencyKey({
			workflowId: identity.workflowId,
			taskId: action.jobId,
			workspacePathHash: identity.workspacePathHash,
			attempt: attemptsByJob.get(action.jobId) ?? 0,
			modelId: identity.modelIdForJob?.(action.jobId) ?? null,
			endpoint: identity.endpointForJob?.(action.jobId) ?? null,
			variant: identity.variantForJob?.(action.jobId) ?? null,
		});
		keyed.push({ action, idempotencyKey });
	}
	return keyed;
}
