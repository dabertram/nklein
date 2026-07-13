import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import { latestRunState } from "../../../src/core/agent-ledger-selectors";
import {
	type DurableRunConfig,
	DurableRunController,
	type DurableRunPorts,
} from "../../../src/core/durable-run-controller";
import {
	buildDurableJobGraph,
	type DurableJob,
	type DurableSchedulerInput,
	type DurableSchedulerLogEntry,
	decideDurableSchedulerActions,
	renewDurableLease,
} from "../../../src/core/durable-scheduler";

// Regression tests for the 5 defects the durable/ledger reliability bug-hunt confirmed (2026-07-05).
// (bug #4 — the jsonl-store dropping a forward-incompatible terminal event — is collected, not fixed: speculative /
// design decision. The remaining acceptance-workspace race is tracked by todo.md P0.7.)

const job = (over: Partial<DurableJob> & { jobId: string }): DurableJob => ({
	state: "ready",
	dependsOn: [],
	lease: null,
	attempts: 0,
	nextEligibleAt: 0,
	...over,
});

const input = (jobs: DurableJob[], over: Partial<DurableSchedulerInput> = {}): DurableSchedulerInput => ({
	jobs,
	now: 1000,
	maxConcurrentLeases: 2,
	leaseDurationMs: 100,
	maxAttempts: 3,
	reclaimBackoffMs: 50,
	mintWorkerId: () => "w1",
	...over,
});

describe("bug #2 — a non-finite clock makes no time-based decision (no mass-reclaim, no over-subscribe)", () => {
	it("with now=NaN, neither reclaims a live/expired lease NOR leases a ready job", () => {
		const jobs = [
			job({ jobId: "leased-live", state: "leased", lease: { workerId: "x", expiresAt: 9_999 }, attempts: 1 }),
			job({ jobId: "ready-a" }),
		];
		const actions = decideDurableSchedulerActions(input(jobs, { now: Number.NaN }));
		expect(actions).toEqual([]); // no reclaim, no fail, no assign — the leased job is preserved
	});

	it("a FINITE clock still reclaims an expired lease (the guard blocks only the NaN case)", () => {
		const jobs = [job({ jobId: "expired", state: "leased", lease: { workerId: "x", expiresAt: 500 }, attempts: 1 })];
		const actions = decideDurableSchedulerActions(input(jobs, { now: 1_000 }));
		expect(actions.some((a) => a.type === "reclaim" && a.jobId === "expired")).toBe(true);
	});
});

describe("bug #3 — renewDurableLease is monotonic (a heartbeat only pushes the deadline OUT)", () => {
	const leased = [job({ jobId: "a", state: "leased", lease: { workerId: "x", expiresAt: 1_000_000 }, attempts: 1 })];

	it("a backward clock does NOT shorten a live lease", () => {
		const next = renewDurableLease(leased, "a", 999_100); // earlier than 1_000_000
		expect(next[0].lease?.expiresAt).toBe(1_000_000);
	});

	it("a later heartbeat DOES extend the lease", () => {
		const next = renewDurableLease(leased, "a", 1_000_500);
		expect(next[0].lease?.expiresAt).toBe(1_000_500);
	});

	it("a non-finite newExpiresAt is ignored (keeps the current expiry, can't poison the reclaim compare)", () => {
		const next = renewDurableLease(leased, "a", Number.NaN);
		expect(next[0].lease?.expiresAt).toBe(1_000_000);
	});
});

describe("bug #5 — latestRunState is order-independent on equal recordedAt (stable eventId tiebreak)", () => {
	const transition = (to: string, recordedAt: number, eventId: string): AgentLedgerEvent =>
		({ kind: "transition", to, recordedAt, eventId, workflowId: "w1" }) as unknown as AgentLedgerEvent;

	it("two same-millisecond transitions resolve to the SAME state regardless of array order", () => {
		const a = transition("stateA", 100, "e1");
		const b = transition("stateB", 100, "e2");
		expect(latestRunState([a, b], "w1")).toBe(latestRunState([b, a], "w1"));
	});
});

describe("bug #1 — reportCompletion is a no-op for a non-leased (post-transient-retry) job", () => {
	const config: DurableRunConfig = {
		maxConcurrentLeases: 2,
		leaseDurationMs: 100,
		maxAttempts: 3,
		reclaimBackoffMs: 0,
	};
	const fakePorts = () => {
		let clock = 1_000;
		let counter = 0;
		const log: DurableSchedulerLogEntry[] = [];
		const ports: DurableRunPorts = {
			now: () => clock,
			mintWorkerId: () => `w${++counter}`,
			appendLog: (entry) => {
				log.push(entry);
			},
			dispatch: () => {},
		};
		return { ports, log, advance: (ms: number) => (clock += ms) };
	};

	it("a late/duplicate report after a transient retry returned the card to `ready` is NOT applied again", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);

		await controller.tick(); // a → leased
		await controller.reportCompletion("a", "failed", new Error("Body Timeout Error")); // transient → a back to ready
		const completedAfterFirst = log.filter((e) => e.kind === "completed").length;

		// a is now `ready` (not leased). A late/duplicate report must be ignored.
		await controller.reportCompletion("a", "failed", new Error("Body Timeout Error"));
		await controller.reportCompletion("a", "succeeded");
		const completedAfterSecond = log.filter((e) => e.kind === "completed").length;

		expect(completedAfterFirst).toBe(1);
		expect(completedAfterSecond).toBe(1); // no second `completed` event appended — the at-most-once-per-lease guard held
	});
});
