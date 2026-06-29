import { describe, expect, it } from "vitest";
import { buildAttemptEvent, buildSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
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
