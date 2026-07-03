import { describe, expect, it } from "vitest";
import { deriveAttemptIdempotencyKey } from "../../../src/core/attempt-idempotency-key";
import { keyDurableLeaseActions } from "../../../src/core/durable-lease-idempotency";
import type { DurableJob, DurableSchedulerAction } from "../../../src/core/durable-scheduler";

function job(jobId: string, overrides: Partial<DurableJob> = {}): DurableJob {
	return {
		jobId,
		state: "ready",
		dependsOn: [],
		lease: null,
		attempts: 0,
		nextEligibleAt: 0,
		...overrides,
	};
}

function lease(jobId: string, workerId = "w1", expiresAt = 1000): DurableSchedulerAction {
	return { type: "lease", jobId, workerId, expiresAt };
}

const identity = { workflowId: "run-1", workspacePathHash: "ws-hash" };

describe("keyDurableLeaseActions (§5.AF lease-event idempotency key)", () => {
	it("derives a key for each lease action and skips non-lease actions", () => {
		const jobs = [job("a"), job("b")];
		const actions: DurableSchedulerAction[] = [
			{ type: "reclaim", jobId: "x", reason: "lease_expired" },
			lease("a"),
			lease("b"),
		];
		const keyed = keyDurableLeaseActions(actions, jobs, identity);
		expect(keyed.map((k) => k.action.jobId)).toEqual(["a", "b"]);
		expect(keyed.every((k) => k.idempotencyKey.length > 0)).toBe(true);
	});

	it("is STABLE across a re-dispatch: the same snapshot + identity derives the identical key (dedups a crash re-run)", () => {
		const jobs = [job("a", { attempts: 0 })];
		const first = keyDurableLeaseActions([lease("a", "worker-fresh-1")], jobs, identity);
		// a crash re-runs the decision against the SAME snapshot (attempts unchanged) with a FRESHLY minted worker id.
		const redispatch = keyDurableLeaseActions([lease("a", "worker-fresh-2")], jobs, identity);
		expect(redispatch[0]?.idempotencyKey).toBe(first[0]?.idempotencyKey);
	});

	it("a genuine reclaim→re-lease (attempts bumped) derives a DIFFERENT key", () => {
		const firstTry = keyDurableLeaseActions([lease("a")], [job("a", { attempts: 0 })], identity);
		const retry = keyDurableLeaseActions([lease("a")], [job("a", { attempts: 1 })], identity);
		expect(retry[0]?.idempotencyKey).not.toBe(firstTry[0]?.idempotencyKey);
	});

	it("a switched model derives a different key (a switched model is a distinct attempt)", () => {
		const jobs = [job("a")];
		const onA = keyDurableLeaseActions([lease("a")], jobs, {
			...identity,
			modelIdForJob: () => "provider:model-a:endpoint",
		});
		const onB = keyDurableLeaseActions([lease("a")], jobs, {
			...identity,
			modelIdForJob: () => "provider:model-b:endpoint",
		});
		expect(onA[0]?.idempotencyKey).not.toBe(onB[0]?.idempotencyKey);
	});

	it("a variant fans out: same job/attempt/model but different variant does NOT dedup", () => {
		const jobs = [job("a")];
		const memberA = keyDurableLeaseActions([lease("a")], jobs, { ...identity, variantForJob: () => "swarm-1" });
		const memberB = keyDurableLeaseActions([lease("a")], jobs, { ...identity, variantForJob: () => "swarm-2" });
		expect(memberA[0]?.idempotencyKey).not.toBe(memberB[0]?.idempotencyKey);
	});

	it("distinct jobs derive distinct keys (taskId discriminates)", () => {
		const jobs = [job("a"), job("b")];
		const keyed = keyDurableLeaseActions([lease("a"), lease("b")], jobs, identity);
		expect(keyed[0]?.idempotencyKey).not.toBe(keyed[1]?.idempotencyKey);
	});

	it("a lease whose job is absent from the snapshot defensively derives at rung 0", () => {
		const keyed = keyDurableLeaseActions([lease("ghost")], [], identity);
		const expected = deriveAttemptIdempotencyKey({
			workflowId: "run-1",
			taskId: "ghost",
			workspacePathHash: "ws-hash",
			attempt: 0,
			modelId: null,
			endpoint: null,
			variant: null,
		});
		expect(keyed[0]?.idempotencyKey).toBe(expected);
	});

	it("the composition is FAITHFUL — the key equals a direct derivation with the same identity", () => {
		const jobs = [job("a", { attempts: 2 })];
		const keyed = keyDurableLeaseActions([lease("a")], jobs, {
			...identity,
			modelIdForJob: () => "provider:m:e",
			endpointForJob: () => "http://endpoint",
		});
		const direct = deriveAttemptIdempotencyKey({
			workflowId: "run-1",
			taskId: "a",
			workspacePathHash: "ws-hash",
			attempt: 2,
			modelId: "provider:m:e",
			endpoint: "http://endpoint",
			variant: null,
		});
		expect(keyed[0]?.idempotencyKey).toBe(direct);
	});
});
