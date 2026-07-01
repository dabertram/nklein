import { describe, expect, it } from "vitest";
import {
	type AttemptIdentity,
	dedupeSchedulerEventsByIdempotencyKey,
	deriveAttemptIdempotencyKey,
	type IdempotentSchedulerEventView,
} from "../../../src/core/attempt-idempotency-key";

// A canonical single-dispatch identity the tests vary one field at a time from.
const base: AttemptIdentity = {
	workflowId: "wf-1",
	taskId: "card-42",
	workspacePathHash: "ws-hash",
	attempt: 0,
	modelId: "lmstudio:qwen3-8b:native",
	endpoint: "http://localhost:1234",
	variant: null,
};

describe("deriveAttemptIdempotencyKey", () => {
	it("is deterministic — the same identity yields the same key", () => {
		expect(deriveAttemptIdempotencyKey(base)).toBe(deriveAttemptIdempotencyKey(base));
	});

	it("is a stable, machine-independent value (pinned so a change to the derivation is caught)", () => {
		// A literal pin: if the canonicalization or hashing ever changes, an existing persisted key would no longer
		// dedup against a freshly-derived one, so this MUST break loudly.
		expect(deriveAttemptIdempotencyKey(base)).toBe("wf-1:card-42:30efa36caf1bda90beb1279cd93625d6");
	});

	it("carries a legible <workflowId>:<taskId>:<digest> composite shape", () => {
		const key = deriveAttemptIdempotencyKey(base);
		expect(key.startsWith("wf-1:card-42:")).toBe(true);
		const digest = key.slice("wf-1:card-42:".length);
		expect(digest).toMatch(/^[0-9a-f]{32}$/);
	});

	it("is independent of field-population order (key-order-independent canonicalization)", () => {
		// Build the identity object with the keys inserted in a different order — the sorted canonical serialization
		// must make this irrelevant.
		const reordered: AttemptIdentity = {
			variant: null,
			endpoint: "http://localhost:1234",
			modelId: "lmstudio:qwen3-8b:native",
			attempt: 0,
			workspacePathHash: "ws-hash",
			taskId: "card-42",
			workflowId: "wf-1",
		};
		expect(deriveAttemptIdempotencyKey(reordered)).toBe(deriveAttemptIdempotencyKey(base));
	});

	// --- Each identity component is discriminating: a change to it must change the key. ---
	it("changes when the retry rung changes (a genuine next retry is a distinct attempt)", () => {
		expect(deriveAttemptIdempotencyKey({ ...base, attempt: 1 })).not.toBe(deriveAttemptIdempotencyKey(base));
	});

	it("changes when the model switches (a retry on a different model is a distinct attempt)", () => {
		expect(deriveAttemptIdempotencyKey({ ...base, modelId: "lmstudio:qwen3-27b:native" })).not.toBe(
			deriveAttemptIdempotencyKey(base),
		);
	});

	it("changes when the endpoint switches", () => {
		expect(deriveAttemptIdempotencyKey({ ...base, endpoint: "http://localhost:5678" })).not.toBe(
			deriveAttemptIdempotencyKey(base),
		);
	});

	it("changes when the workflow, task, or workspace differs", () => {
		const key = deriveAttemptIdempotencyKey(base);
		expect(deriveAttemptIdempotencyKey({ ...base, workflowId: "wf-2" })).not.toBe(key);
		expect(deriveAttemptIdempotencyKey({ ...base, taskId: "card-99" })).not.toBe(key);
		expect(deriveAttemptIdempotencyKey({ ...base, workspacePathHash: "other-ws" })).not.toBe(key);
	});

	it("changes when a variant discriminator is set (same rung, distinct fan-out dispatches don't dedup)", () => {
		const a = deriveAttemptIdempotencyKey({ ...base, variant: "swarm-member-a" });
		const b = deriveAttemptIdempotencyKey({ ...base, variant: "swarm-member-b" });
		expect(a).not.toBe(deriveAttemptIdempotencyKey(base));
		expect(a).not.toBe(b);
	});

	// --- Normalization: absent === empty, whitespace-trimmed, rung folded to a non-negative integer. ---
	it("treats an absent optional field the same as an explicit null/empty", () => {
		const withNulls: AttemptIdentity = {
			workflowId: "wf-1",
			taskId: "card-42",
			workspacePathHash: "ws-hash",
			attempt: 0,
		};
		const explicit: AttemptIdentity = { ...withNulls, modelId: null, endpoint: null, variant: null };
		const empty: AttemptIdentity = { ...withNulls, modelId: "", endpoint: "", variant: "" };
		const key = deriveAttemptIdempotencyKey(withNulls);
		expect(deriveAttemptIdempotencyKey(explicit)).toBe(key);
		expect(deriveAttemptIdempotencyKey(empty)).toBe(key);
	});

	it("trims surrounding whitespace on string fields so cosmetic padding doesn't fork the key", () => {
		expect(deriveAttemptIdempotencyKey({ ...base, modelId: "  lmstudio:qwen3-8b:native  " })).toBe(
			deriveAttemptIdempotencyKey(base),
		);
	});

	it("folds a non-finite or negative rung to the first-try rung 0", () => {
		const rung0 = deriveAttemptIdempotencyKey({ ...base, attempt: 0 });
		expect(deriveAttemptIdempotencyKey({ ...base, attempt: Number.NaN })).toBe(rung0);
		expect(deriveAttemptIdempotencyKey({ ...base, attempt: -3 })).toBe(rung0);
		expect(deriveAttemptIdempotencyKey({ ...base, attempt: Number.POSITIVE_INFINITY })).toBe(rung0);
	});

	it("truncates a fractional rung (2.9 → rung 2), matching the scheduler's Math.trunc discipline", () => {
		expect(deriveAttemptIdempotencyKey({ ...base, attempt: 2.9 })).toBe(
			deriveAttemptIdempotencyKey({ ...base, attempt: 2 }),
		);
	});

	it("does not collide across the near-miss fields it must keep distinct (workflow vs task vs variant swaps)", () => {
		// Guard against a naive `${a}:${b}` derivation where moving a delimiter's worth of text between fields collides.
		const keyA = deriveAttemptIdempotencyKey({ ...base, workflowId: "a:b", taskId: "c" });
		const keyB = deriveAttemptIdempotencyKey({ ...base, workflowId: "a", taskId: "b:c" });
		expect(keyA).not.toBe(keyB);
	});
});

describe("dedupeSchedulerEventsByIdempotencyKey", () => {
	// Terse view builder.
	const ev = (eventId: string, idempotencyKey?: string | null): IdempotentSchedulerEventView => ({
		eventId,
		idempotencyKey,
	});

	it("keeps a single occurrence of each non-null key, first-seen wins", () => {
		const result = dedupeSchedulerEventsByIdempotencyKey([ev("e1", "k1"), ev("e2", "k1"), ev("e3", "k2")]);
		expect(result.kept.map((e) => e.eventId)).toEqual(["e1", "e3"]);
		expect(result.droppedEventIds).toEqual(["e2"]);
	});

	it("preserves input order among the kept events", () => {
		const result = dedupeSchedulerEventsByIdempotencyKey([
			ev("e1", "k1"),
			ev("e2", "k2"),
			ev("e3", "k1"),
			ev("e4", "k3"),
		]);
		expect(result.kept.map((e) => e.eventId)).toEqual(["e1", "e2", "e4"]);
		expect(result.droppedEventIds).toEqual(["e3"]);
	});

	it("never dedups events with a null or absent key (heartbeats / legacy rows are always kept)", () => {
		const result = dedupeSchedulerEventsByIdempotencyKey([
			ev("e1", null),
			ev("e2", null),
			ev("e3"), // absent
			ev("e4", undefined),
		]);
		expect(result.kept.map((e) => e.eventId)).toEqual(["e1", "e2", "e3", "e4"]);
		expect(result.droppedEventIds).toEqual([]);
	});

	it("mixes keyed and unkeyed events correctly (unkeyed pass through, keyed dedup)", () => {
		const result = dedupeSchedulerEventsByIdempotencyKey([
			ev("e1", "k1"),
			ev("e2", null),
			ev("e3", "k1"), // dup of e1
			ev("e4", null),
			ev("e5", "k2"),
		]);
		expect(result.kept.map((e) => e.eventId)).toEqual(["e1", "e2", "e4", "e5"]);
		expect(result.droppedEventIds).toEqual(["e3"]);
	});

	it("returns an empty, well-formed result for an empty input", () => {
		const result = dedupeSchedulerEventsByIdempotencyKey([]);
		expect(result.kept).toEqual([]);
		expect(result.droppedEventIds).toEqual([]);
	});

	it("dedups a real re-dispatch: two lease events derived from the SAME identity collapse to one", () => {
		// The end-to-end contract: a crash re-dispatches the same work → the derivation gives the same key → dedup
		// collapses the duplicate, so a "distinct logical attempts" count is 1, not 2.
		const key = deriveAttemptIdempotencyKey(base);
		const firstDispatch = ev("lease-ev-1", key);
		const reDispatchAfterRestart = ev("lease-ev-2", key);
		const nextRetry = ev("lease-ev-3", deriveAttemptIdempotencyKey({ ...base, attempt: 1 }));
		const result = dedupeSchedulerEventsByIdempotencyKey([firstDispatch, reDispatchAfterRestart, nextRetry]);
		expect(result.kept.map((e) => e.eventId)).toEqual(["lease-ev-1", "lease-ev-3"]);
		expect(result.droppedEventIds).toEqual(["lease-ev-2"]);
	});
});
