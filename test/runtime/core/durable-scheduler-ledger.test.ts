import { describe, expect, it } from "vitest";
import {
	type BuildSchedulerEventInput,
	buildAttemptEvent,
	buildSchedulerEvent,
} from "../../../src/core/agent-attempt-ledger";
import {
	buildDurableJobGraph,
	type DurableSchedulerLogEntry,
	replayDurableJobs,
} from "../../../src/core/durable-scheduler";
import {
	type DurableLedgerEnvelope,
	durableLogEntryToSchedulerEvent,
	readDurableSchedulerLog,
} from "../../../src/core/durable-scheduler-ledger";

const env: DurableLedgerEnvelope = { workflowId: "wf-1", workspacePathHash: "hash", eventId: "ev" };

// Terse persisted-scheduler-event builder (mirrors the shuffled-stream test's full-field calls). The default
// `workflowId: "wf"` matches the existing ordering/filtering test, so a default (unscoped) read keeps every event.
const sched = (over: Partial<BuildSchedulerEventInput> & Pick<BuildSchedulerEventInput, "event">) =>
	buildSchedulerEvent({ workflowId: "wf", taskId: "a", workspacePathHash: "h", ...over });

describe("durableLogEntryToSchedulerEvent", () => {
	it("maps each action + completion to the right scheduler event, carrying the durable fields", () => {
		const lease = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 100, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 200 } },
			env,
		);
		expect(lease).toMatchObject({
			kind: "scheduler",
			event: "lease_acquired",
			taskId: "a",
			workerId: "w1",
			detail: "200",
			recordedAt: 100,
		});

		const reclaim = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 300, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			env,
		);
		expect(reclaim).toMatchObject({ event: "reclaimed", detail: "lease_expired", recordedAt: 300 });

		const unblock = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 310, action: { type: "unblock", jobId: "b" } },
			env,
		);
		expect(unblock).toMatchObject({ event: "dependency_unblocked", taskId: "b", recordedAt: 310 });

		const fail = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 320, action: { type: "fail", jobId: "c", reason: "dependency_failed" } },
			env,
		);
		expect(fail).toMatchObject({ event: "cancelled", taskId: "c", detail: "dependency_failed" });

		const completed = durableLogEntryToSchedulerEvent(
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ ...env, recordedAt: 250 },
		);
		expect(completed).toMatchObject({ event: "completed", taskId: "a", detail: "succeeded", recordedAt: 250 });
	});

	// T1 — a `completed` entry has no `now`, so with no `recordedAt` override the write side falls back to a wall clock.
	it("falls back to a real wall-clock recordedAt for a completed entry when no override is given", () => {
		const before = Date.now();
		const ev = durableLogEntryToSchedulerEvent(
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ workflowId: "wf-1", workspacePathHash: "hash", eventId: "ev" }, // no recordedAt
		);
		const after = Date.now();
		expect(ev.event).toBe("completed");
		expect(ev.detail).toBe("succeeded");
		expect(Number.isFinite(ev.recordedAt)).toBe(true);
		expect(ev.recordedAt).toBeGreaterThanOrEqual(before);
		expect(ev.recordedAt).toBeLessThanOrEqual(after);
	});

	// T2 — an omitted eventId mints a fresh random uuid each time (never a fixed default); also pins the action-arm
	// recordedAt fallback to `entry.now` when no override is given.
	it("mints a fresh non-empty eventId per call when none is supplied, and uses entry.now as recordedAt", () => {
		const entry: DurableSchedulerLogEntry = {
			kind: "scheduled",
			now: 100,
			action: { type: "unblock", jobId: "b" },
		};
		const envelope: DurableLedgerEnvelope = { workflowId: "wf-1", workspacePathHash: "hash" }; // no eventId, no recordedAt
		const first = durableLogEntryToSchedulerEvent(entry, envelope);
		const second = durableLogEntryToSchedulerEvent(entry, envelope);
		expect(typeof first.eventId).toBe("string");
		expect(first.eventId.length).toBeGreaterThan(0);
		expect(typeof second.eventId).toBe("string");
		expect(second.eventId.length).toBeGreaterThan(0);
		expect(first.eventId).not.toBe(second.eventId);
		expect(first.recordedAt).toBe(100); // action arm: recordedAt ?? entry.now
	});

	// T3 — a `scheduled` entry uses `entry.now` as recordedAt when the override is absent (distinct, non-default value).
	it("uses entry.now as recordedAt for a scheduled entry when no override is given", () => {
		const ev = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 777, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ workflowId: "wf-1", workspacePathHash: "hash", eventId: "ev" }, // no recordedAt
		);
		expect(ev).toMatchObject({ event: "reclaimed", detail: "lease_expired", recordedAt: 777 });
	});
});

describe("readDurableSchedulerLog", () => {
	it("round-trips a durable log through ledger events (write → read = identity, now via recordedAt)", () => {
		const log: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 100 } },
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ kind: "scheduled", now: 110, action: { type: "unblock", jobId: "b" } },
			{ kind: "scheduled", now: 110, action: { type: "lease", jobId: "b", workerId: "w2", expiresAt: 210 } },
		];
		// Persist each entry; completion needs an explicit recordedAt (it has no `now`).
		const events = log.map((entry, i) =>
			durableLogEntryToSchedulerEvent(entry, {
				...env,
				eventId: `ev-${i}`,
				...(entry.kind === "completed" ? { recordedAt: 105 } : {}),
			}),
		);
		expect(readDurableSchedulerLog(events)).toEqual(log);
	});

	it("round-trips a transient_retry completion (write → read = identity) — §5.AF", () => {
		const entry: DurableSchedulerLogEntry = { kind: "completed", jobId: "a", outcome: "transient_retry" };
		const event = durableLogEntryToSchedulerEvent(entry, { ...env, eventId: "ev-tr", recordedAt: 105 });
		expect(event).toMatchObject({ event: "completed", taskId: "a", detail: "transient_retry" });
		expect(readDurableSchedulerLog([event])).toEqual([entry]);
	});

	it("orders by recordedAt regardless of input order, and ignores foreign families + informational events", () => {
		// A deliberately-shuffled, mixed stream.
		const shuffled = [
			buildSchedulerEvent({
				workflowId: "wf",
				taskId: "a",
				workspacePathHash: "h",
				event: "dependency_unblocked",
				recordedAt: 30,
			}),
			buildAttemptEvent({
				workflowId: "wf",
				taskId: "a",
				workspacePathHash: "h",
				attemptId: "x",
				modelId: "m",
				outcome: "success",
				recordedAt: 25,
			}), // foreign family
			buildSchedulerEvent({
				workflowId: "wf",
				taskId: "a",
				workspacePathHash: "h",
				event: "heartbeat",
				recordedAt: 5,
			}), // informational
			buildSchedulerEvent({
				workflowId: "wf",
				taskId: "a",
				workspacePathHash: "h",
				event: "lease_acquired",
				workerId: "w",
				detail: "99",
				recordedAt: 10,
			}),
		];
		const log = readDurableSchedulerLog(shuffled);
		expect(log).toEqual([
			{ kind: "scheduled", now: 10, action: { type: "lease", jobId: "a", workerId: "w", expiresAt: 99 } },
			{ kind: "scheduled", now: 30, action: { type: "unblock", jobId: "a" } },
		]);
	});

	it("scopes to one run's workflowId when many runs share the ledger", () => {
		const mine = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 10, action: { type: "unblock", jobId: "a" } },
			{ workflowId: "wf-mine", workspacePathHash: "h", eventId: "m1" },
		);
		const other = durableLogEntryToSchedulerEvent(
			{ kind: "scheduled", now: 5, action: { type: "unblock", jobId: "z" } },
			{ workflowId: "wf-other", workspacePathHash: "h", eventId: "o1" },
		);
		expect(readDurableSchedulerLog([other, mine], { workflowId: "wf-mine" })).toEqual([
			{ kind: "scheduled", now: 10, action: { type: "unblock", jobId: "a" } },
		]);
	});

	it("the read log replays to the same state as the original (ledger-backed boot-replay)", () => {
		const initial = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [{ fromTaskId: "b", toTaskId: "a" }] });
		const log: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 100 } },
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ kind: "scheduled", now: 110, action: { type: "unblock", jobId: "b" } },
			{ kind: "scheduled", now: 110, action: { type: "lease", jobId: "b", workerId: "w2", expiresAt: 210 } },
		];
		const events = log.map((entry, i) =>
			durableLogEntryToSchedulerEvent(entry, {
				...env,
				eventId: `e${i}`,
				...(entry.kind === "completed" ? { recordedAt: 105 } : {}),
			}),
		);
		const direct = replayDurableJobs(initial, log, { reclaimBackoffMs: 50 });
		const viaLedger = replayDurableJobs(initial, readDurableSchedulerLog(events), { reclaimBackoffMs: 50 });
		expect(viaLedger).toEqual(direct);
		expect(viaLedger.find((j) => j.jobId === "b")).toMatchObject({
			state: "leased",
			lease: { workerId: "w2", expiresAt: 210 },
		});
	});
});

// The private read-side mapper is exercised only through readDurableSchedulerLog (the module's public boot-replay seam),
// matching the existing tests' approach. These pin the defensive branches: malformed/ambiguous persisted scheduler events
// either fall back to a default or are silently dropped. They PIN CURRENT BEHAVIOR — they assert what the unmodified
// source does today, including the three suspected bugs flagged inline below.
describe("schedulerEventToDurableLogEntry (read-side fallbacks, via readDurableSchedulerLog)", () => {
	// T4 — lease_acquired with a non-finite detail (Number("not-a-number") === NaN) fails the finite check → dropped.
	it("drops a lease_acquired whose detail is not a finite number", () => {
		// SUSPECTED BUG SB#1 (MED): malformed lease_acquired (non-finite detail / null workerId) silently dropped.
		// A worker DID acquire a lease per the persisted event, but the replay yields no lease entry, so on boot the
		// job looks un-leased.
		const ev = sched({ event: "lease_acquired", workerId: "w", detail: "not-a-number", recordedAt: 10 });
		expect(readDurableSchedulerLog([ev])).toEqual([]);
	});

	// T5 — lease_acquired with workerId === null is dropped even when detail is finite ("200"), isolating the second
	// disjunct of the skip from the finite check.
	it("drops a lease_acquired whose workerId is null even with a finite detail", () => {
		// SUSPECTED BUG SB#1 (MED): malformed lease_acquired (non-finite detail / null workerId) silently dropped.
		const ev = sched({ event: "lease_acquired", detail: "200", recordedAt: 10 }); // workerId defaults to null
		expect(readDurableSchedulerLog([ev])).toEqual([]);
	});

	// T6 — boundary: a padded ("  200  ") or exponential ("1e3") detail still parses via Number() and maps (robustness).
	it("accepts a finite lease detail with surrounding whitespace or exponent notation", () => {
		const events = [
			sched({ event: "lease_acquired", workerId: "w1", detail: "  200  ", recordedAt: 10 }),
			sched({ event: "lease_acquired", taskId: "b", workerId: "w2", detail: "1e3", recordedAt: 20 }),
		];
		expect(readDurableSchedulerLog(events)).toEqual([
			{ kind: "scheduled", now: 10, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 200 } },
			{ kind: "scheduled", now: 20, action: { type: "lease", jobId: "b", workerId: "w2", expiresAt: 1000 } },
		]);
	});

	// T7 — cancelled with an unrecognized reason is coerced to "max_attempts" (it is not in FAIL_REASONS).
	it("defaults a cancelled with an unrecognized detail to reason max_attempts", () => {
		// SUSPECTED BUG SB#2 (LOW): cancelled with an unknown/null detail fabricates reason "max_attempts".
		const ev = sched({ event: "cancelled", detail: "operator_abort", recordedAt: 10 });
		expect(readDurableSchedulerLog([ev])).toEqual([
			{ kind: "scheduled", now: 10, action: { type: "fail", jobId: "a", reason: "max_attempts" } },
		]);
	});

	// T8 — cancelled with the (otherwise-untested) recognized reason "max_attempts" round-trips as itself.
	it("round-trips a cancelled with the recognized reason max_attempts", () => {
		const ev = sched({ event: "cancelled", detail: "max_attempts", recordedAt: 15 });
		expect(readDurableSchedulerLog([ev])).toEqual([
			{ kind: "scheduled", now: 15, action: { type: "fail", jobId: "a", reason: "max_attempts" } },
		]);
	});

	// T9 — cancelled with no detail (null) also defaults to "max_attempts" (FAIL_REASONS.has(null) is false).
	it("defaults a cancelled with a null detail to reason max_attempts", () => {
		// SUSPECTED BUG SB#2 (LOW): cancelled with an unknown/null detail fabricates reason "max_attempts".
		const ev = sched({ event: "cancelled", recordedAt: 12 }); // detail defaults to null
		expect(readDurableSchedulerLog([ev])).toEqual([
			{ kind: "scheduled", now: 12, action: { type: "fail", jobId: "a", reason: "max_attempts" } },
		]);
	});

	// T10 — completed with an out-of-domain outcome string folds to the fail-safe TERMINAL `failed` (SB#3 fix): a terminal
	// report must never be dropped (dropping → revert to leased → re-run already-finished work).
	it("folds a completed with an out-of-domain outcome to terminal failed (SB#3 fix)", () => {
		// SB#3 FIXED (§5.AF): an unparseable `completed` detail is mapped to `failed` (terminal) — never re-run, never
		// fabricate success. Distinct from the informational default arm, which is correctly skipped.
		const ev = sched({ event: "completed", detail: "cancelled_by_user", recordedAt: 10 });
		expect(readDurableSchedulerLog([ev])).toEqual([{ kind: "completed", jobId: "a", outcome: "failed" }]);
	});

	// T11 — completed with no detail (null) folds via the same fail-safe arm to terminal `failed` (distinct input from T10).
	it("folds a completed whose detail is null to terminal failed (SB#3 fix)", () => {
		// SB#3 FIXED (§5.AF): an unparseable `completed` detail is mapped to `failed` (terminal) — never re-run, never
		// fabricate success.
		const ev = sched({ event: "completed", recordedAt: 10 }); // detail defaults to null
		expect(readDurableSchedulerLog([ev])).toEqual([{ kind: "completed", jobId: "a", outcome: "failed" }]);
	});

	// T12 — reclaimed ignores its persisted detail entirely; the reason is hard-coded "lease_expired".
	it("ignores a reclaimed detail and hard-codes reason lease_expired", () => {
		const ev = sched({ event: "reclaimed", detail: "something_else", recordedAt: 40 });
		expect(readDurableSchedulerLog([ev])).toEqual([
			{ kind: "scheduled", now: 40, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
		]);
	});

	// T13 — every informational event name hits the default arm and is skipped; a real dependency_unblocked survives.
	it("skips every informational event name (default arm) while keeping a valid event", () => {
		const informational = (["queued", "dequeued", "lease_expired", "retry_backoff"] as const).map((event, i) =>
			sched({ event, recordedAt: i }),
		);
		expect(readDurableSchedulerLog(informational)).toEqual([]);

		const mixed = [...informational, sched({ event: "dependency_unblocked", recordedAt: 99 })];
		expect(readDurableSchedulerLog(mixed)).toEqual([
			{ kind: "scheduled", now: 99, action: { type: "unblock", jobId: "a" } },
		]);
	});

	// T14 — stable tie-break: on EQUAL recordedAt, output order tracks INPUT order (comparator's `a.index - b.index`),
	// proven by feeding the same two events in both orders.
	it("preserves input order as the tie-break when recordedAt is equal", () => {
		const e1 = sched({ event: "dependency_unblocked", taskId: "first", recordedAt: 50 });
		const e2 = sched({ event: "dependency_unblocked", taskId: "second", recordedAt: 50 });
		expect(readDurableSchedulerLog([e1, e2])).toEqual([
			{ kind: "scheduled", now: 50, action: { type: "unblock", jobId: "first" } },
			{ kind: "scheduled", now: 50, action: { type: "unblock", jobId: "second" } },
		]);
		expect(readDurableSchedulerLog([e2, e1])).toEqual([
			{ kind: "scheduled", now: 50, action: { type: "unblock", jobId: "second" } },
			{ kind: "scheduled", now: 50, action: { type: "unblock", jobId: "first" } },
		]);
	});

	// T15 — with no workflowId option, events from ANY workflow survive (no scoping); complements the scoped test.
	it("keeps events from any workflow when no workflowId is given", () => {
		const events = [
			sched({ event: "dependency_unblocked", taskId: "a", recordedAt: 1 }), // workflowId "wf"
			buildSchedulerEvent({
				workflowId: "wf-other",
				taskId: "z",
				workspacePathHash: "h",
				event: "dependency_unblocked",
				recordedAt: 2,
			}),
		];
		expect(readDurableSchedulerLog(events)).toEqual([
			{ kind: "scheduled", now: 1, action: { type: "unblock", jobId: "a" } },
			{ kind: "scheduled", now: 2, action: { type: "unblock", jobId: "z" } },
		]);
	});

	// T16 — the canonical corrupted-ledger replay: a shuffled stream where THREE records (a bad lease, a foreign attempt
	// event, an informational heartbeat) vanish, while the malformed `completed` is FOLDED to terminal `failed` (SB#3 fix:
	// a terminal report is never dropped). Survivors are ordered by recordedAt.
	it("drops malformed-lease/foreign/informational entries but folds a malformed completed to terminal failed", () => {
		// SB#3 FIXED (§5.AF): the malformed `completed` (@40) is no longer dropped — it folds to terminal `failed`, so the
		// finished card stays terminal on boot-replay (no re-run). The non-finite lease / foreign family / informational
		// heartbeat are still correctly dropped (those drops are not terminal-state-bearing).
		const stream = [
			sched({ event: "completed", detail: "bogus", recordedAt: 40 }), // fold → terminal failed (SB#3 fix)
			sched({ event: "lease_acquired", workerId: "w", detail: "nope", recordedAt: 10 }), // drop (non-finite detail)
			sched({ event: "lease_acquired", workerId: "w", detail: "100", recordedAt: 20 }), // keep
			buildAttemptEvent({
				workflowId: "wf",
				taskId: "a",
				workspacePathHash: "h",
				attemptId: "x",
				modelId: "m",
				outcome: "success",
				recordedAt: 15,
			}), // drop (foreign family)
			sched({ event: "heartbeat", recordedAt: 5 }), // drop (informational)
			sched({ event: "completed", taskId: "a", detail: "succeeded", recordedAt: 30 }), // keep
		];
		expect(readDurableSchedulerLog(stream)).toEqual([
			{ kind: "scheduled", now: 20, action: { type: "lease", jobId: "a", workerId: "w", expiresAt: 100 } },
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ kind: "completed", jobId: "a", outcome: "failed" },
		]);
	});
});

describe("readDurableSchedulerLog → replayDurableJobs (boot-replay consequence)", () => {
	// T17 — the run-level proof of the SB#3 fix: a good completed makes the job succeed; a CORRUPTED completed now folds to
	// terminal `failed`, so the job stays terminal on boot-replay (no re-lease) — the controller never re-dispatches the
	// already-finished card. (Pre-fix this reverted to `leased` and re-ran completed work.)
	it("keeps a finished card terminal (failed, not re-leased) when its completed event is corrupted (SB#3 fix)", () => {
		// SB#3 FIXED (§5.AF): an unparseable terminal completion folds to `failed` (fail-safe) instead of being dropped, so
		// boot-replay never reverts a finished card to `leased`. Fail-visible: the operator sees a failure, not silent re-run.
		const initial = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] }); // `a` is ready
		const leaseEntry: DurableSchedulerLogEntry = {
			kind: "scheduled",
			now: 0,
			action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 100 },
		};
		const leaseEvent = durableLogEntryToSchedulerEvent(leaseEntry, { ...env, eventId: "e-lease" });

		// Good: the completion is persisted with a valid outcome.
		const goodCompleted = durableLogEntryToSchedulerEvent(
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ ...env, eventId: "e-done", recordedAt: 50 },
		);
		// Corrupted: a future/renamed/garbled outcome string a newer or buggy writer might persist.
		const corruptedCompleted = buildSchedulerEvent({
			workflowId: env.workflowId,
			taskId: "a",
			workspacePathHash: env.workspacePathHash,
			eventId: "e-done",
			event: "completed",
			detail: "done",
			recordedAt: 50,
		});

		const good = replayDurableJobs(initial, readDurableSchedulerLog([leaseEvent, goodCompleted]), {
			reclaimBackoffMs: 50,
		});
		const corrupted = replayDurableJobs(initial, readDurableSchedulerLog([leaseEvent, corruptedCompleted]), {
			reclaimBackoffMs: 50,
		});

		expect(good.find((j) => j.jobId === "a")).toMatchObject({ state: "succeeded", lease: null });
		// The corrupted completion now folds to terminal `failed` (lease released) — terminal on boot, never re-leased.
		expect(corrupted.find((j) => j.jobId === "a")).toMatchObject({ state: "failed", lease: null });
		expect(good).not.toEqual(corrupted);
	});
});
