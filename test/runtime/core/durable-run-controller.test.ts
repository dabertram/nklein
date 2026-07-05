import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type DurableDispatch,
	type DurableRunConfig,
	DurableRunController,
	type DurableRunPorts,
} from "../../../src/core/durable-run-controller";
import {
	buildDurableJobGraph,
	type DurableSchedulerLogEntry,
	replayDurableJobs,
} from "../../../src/core/durable-scheduler";

const config: DurableRunConfig = { maxConcurrentLeases: 2, leaseDurationMs: 100, maxAttempts: 3, reclaimBackoffMs: 0 };

/** A fake runtime: a movable clock, a deterministic worker-id mint, and recorders for the log + dispatches. */
function fakePorts(over: Partial<DurableRunPorts> & { startNow?: number } = {}) {
	let clock = over.startNow ?? 1000;
	let counter = 0;
	const log: DurableSchedulerLogEntry[] = [];
	const dispatches: DurableDispatch[] = [];
	const ports: DurableRunPorts = {
		now: () => clock,
		mintWorkerId: () => `w${++counter}`,
		appendLog: (entry) => {
			log.push(entry);
		},
		dispatch: (dispatch) => dispatches.push(dispatch),
		...over,
	};
	return { ports, log, dispatches, advance: (ms: number) => (clock += ms), setClock: (t: number) => (clock = t) };
}

/** A promise plus its settle handles, so a test can resolve/reject an in-flight `appendLog` at a chosen moment. */
type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };
function makeDeferred(): Deferred {
	let resolve: () => void = () => {};
	let reject: (e: unknown) => void = () => {};
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * Drain all queued microtasks (a macrotask boundary). `commit` awaits each `appendLog` sequentially, so after this the
 * append loop has advanced as far as the currently-resolved deferreds allow and no dispatch can be pending unseen.
 */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The ordered-tape label for a log entry: `<action-or-kind>:<jobId>` (e.g. `lease:a`, `completed:a`). */
function entryLabel(entry: DurableSchedulerLogEntry): string {
	const kind = entry.kind === "scheduled" ? entry.action.type : entry.kind;
	const jobId = entry.kind === "scheduled" ? entry.action.jobId : entry.jobId;
	return `${kind}:${jobId}`;
}

/**
 * Async ports whose `appendLog` returns a promise the test resolves by hand, with ONE shared `events` tape recording
 * both appends (`append:<label>`) and dispatches (`dispatch:<jobId>`) in real arrival order. This is what makes the
 * persist-before-dispatch `await` observable: a deferred append cannot resolve "for free" in the same microtask, so a
 * dispatch that fires before its append resolves shows up out of order on the tape.
 */
function deferredAppendPorts(over: { startNow?: number } = {}) {
	let clock = over.startNow ?? 0;
	let counter = 0;
	const events: string[] = [];
	const log: DurableSchedulerLogEntry[] = [];
	const dispatches: DurableDispatch[] = [];
	const pending: Deferred[] = [];
	const ports: DurableRunPorts = {
		now: () => clock,
		mintWorkerId: () => `w${++counter}`,
		appendLog: (entry) => {
			const deferred = makeDeferred();
			pending.push(deferred);
			log.push(entry);
			events.push(`append:${entryLabel(entry)}`);
			return deferred.promise;
		},
		dispatch: (dispatch) => {
			dispatches.push(dispatch);
			events.push(`dispatch:${dispatch.jobId}`);
		},
	};
	return {
		ports,
		events,
		log,
		dispatches,
		pending,
		advance: (ms: number) => (clock += ms),
		setClock: (t: number) => (clock = t),
	};
}

/**
 * Ports whose `appendLog` rejects on its `failOnIndex`-th (0-based) call WITHOUT recording it, so a test can drive a
 * mid-commit append failure and assert how much was persisted before the throw.
 */
function rejectingAppendPorts(failOnIndex: number, over: { startNow?: number } = {}) {
	let clock = over.startNow ?? 0;
	let counter = 0;
	let calls = 0;
	const log: DurableSchedulerLogEntry[] = [];
	const dispatches: DurableDispatch[] = [];
	const boom = new Error("ledger append failed");
	const ports: DurableRunPorts = {
		now: () => clock,
		mintWorkerId: () => `w${++counter}`,
		appendLog: (entry) => {
			const index = calls++;
			if (index === failOnIndex) {
				return Promise.reject(boom);
			}
			log.push(entry);
		},
		dispatch: (dispatch) => dispatches.push(dispatch),
	};
	return { ports, log, dispatches, boom, setClock: (t: number) => (clock = t) };
}

describe("DurableRunController", () => {
	it("drives a dependency chain to completion via tick + reportCompletion, dispatching each ready card", async () => {
		const graph = buildDurableJobGraph({
			taskIds: ["a", "b", "c"],
			dependencies: [
				{ fromTaskId: "b", toTaskId: "a" },
				{ fromTaskId: "c", toTaskId: "b" },
			],
		});
		const { ports, log, dispatches } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);

		// a is the only ready job → leased + dispatched.
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a"]);

		// a finishes → b unblocks on the next tick.
		await controller.reportCompletion("a", "succeeded");
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a", "b"]);

		await controller.reportCompletion("b", "succeeded");
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a", "b", "c"]);

		await controller.reportCompletion("c", "succeeded");
		await controller.tick();
		expect(controller.isComplete()).toBe(true);
		expect(controller.jobsSnapshot().every((j) => j.state === "succeeded")).toBe(true);
		// The persisted log replays to the same terminal state (restart-survivable).
		expect(replayDurableJobs(graph, log, { reclaimBackoffMs: 0 })).toEqual(controller.jobsSnapshot());
	});

	it("a TRANSIENT failure retries the card (back to ready, re-dispatched) instead of parking it (§5.AF)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log, dispatches } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick(); // a leased + dispatched (attempts 1)
		expect(dispatches.map((d) => d.jobId)).toEqual(["a"]);

		// Worker reports failed with a transient (body-timeout) error → recorded transient_retry → a returns to ready.
		await controller.reportCompletion("a", "failed", new Error("Body Timeout Error"));
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "ready", attempts: 2 });

		await controller.tick(); // re-dispatched
		expect(dispatches.map((d) => d.jobId)).toEqual(["a", "a"]);
		// Replays to the same state (the transient_retry entry is in the log).
		expect(replayDurableJobs(graph, log, { reclaimBackoffMs: 0, maxAttempts: config.maxAttempts })).toEqual(
			controller.jobsSnapshot(),
		);
	});

	it("heartbeat extends a running lease so a slow-but-alive worker is NOT reclaimed", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = fakePorts({ startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);
		await controller.tick(); // a leased; expiresAt = 0 + leaseDurationMs(100) = 100
		fake.setClock(90);
		controller.heartbeat("a"); // extend to 90 + 100 = 190
		fake.setClock(150); // past the ORIGINAL 100, before the renewed 190
		const actions = await controller.tick();
		expect(actions.some((x) => x.type === "reclaim")).toBe(false);
		expect(controller.jobsSnapshot()[0]?.state).toBe("leased");
	});

	it("a NON-transient failure parks the card (failed)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();
		await controller.reportCompletion("a", "failed", new Error("Type validation failed"));
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed" });
	});

	it("reclaims an expired lease and re-dispatches the card within the attempt budget", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = fakePorts({ startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);

		await controller.tick(); // lease a (worker w1), expires at 100
		expect(fake.dispatches).toHaveLength(1);
		fake.setClock(200); // past expiry, worker never reported
		await controller.tick(); // reclaim → re-lease (backoff 0) → re-dispatch
		expect(fake.dispatches).toHaveLength(2);
		expect(fake.dispatches[1]?.jobId).toBe("a");
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "leased", attempts: 2 });
	});

	it("resume() reclaims an orphaned in-flight lease so the next tick re-dispatches it", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [{ fromTaskId: "b", toTaskId: "a" }] });
		// A prior process leased `a` and crashed before it reported.
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "old", expiresAt: 100 } },
		];
		const fake = fakePorts({ startNow: 5000 });
		const controller = await DurableRunController.resume(graph, priorLog, config, fake.ports);

		// On resume, `a` was leased → reclaimed (orphaned), logged.
		expect(controller.jobsSnapshot().find((j) => j.jobId === "a")).toMatchObject({ state: "ready", attempts: 1 });
		expect(fake.log.some((e) => e.kind === "scheduled" && e.action.type === "reclaim")).toBe(true);
		// Next tick re-dispatches `a`.
		await controller.tick();
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]);
	});

	it("fails an orphaned lease on resume when its attempt budget is already spent", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		// Three prior leases (attempts exhausted at maxAttempts=3), still leased at crash.
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 10 } },
			{ kind: "scheduled", now: 20, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ kind: "scheduled", now: 20, action: { type: "lease", jobId: "a", workerId: "w2", expiresAt: 30 } },
			{ kind: "scheduled", now: 40, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ kind: "scheduled", now: 40, action: { type: "lease", jobId: "a", workerId: "w3", expiresAt: 50 } },
		];
		const fake = fakePorts({ startNow: 9000 });
		const controller = await DurableRunController.resume(graph, priorLog, config, fake.ports);
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed", attempts: 3 });
		expect(controller.isComplete()).toBe(true);
	});

	// --- §1: persist-before-dispatch ordering (the crash-safety invariant) ---

	it("DRC-08 withholds a single lease's dispatch until its appendLog resolves", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = deferredAppendPorts({ startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);

		const p = controller.tick();
		await flushMicrotasks();
		// Load-bearing: the append happened but NO dispatch yet (delete the `await` on commit and this would already
		// hold dispatch:a).
		expect(fake.dispatches).toEqual([]);
		expect(fake.events).toEqual(["append:lease:a"]);

		fake.pending[0]?.resolve();
		await p;
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]);
		expect(fake.events).toEqual(["append:lease:a", "dispatch:a"]);
	});

	it("DRC-09 awaits ALL appends of a multi-action commit before ANY dispatch, in decision order", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [] });
		const fake = deferredAppendPorts({ startNow: 0 });
		const controller = new DurableRunController(graph, { ...config, maxConcurrentLeases: 2 }, fake.ports);

		const p = controller.tick();
		await flushMicrotasks();
		// commit awaits each append in turn, so only the FIRST is queued so far — and crucially, no dispatch.
		expect(fake.events).toEqual(["append:lease:a"]);
		expect(fake.dispatches).toEqual([]);

		// Resolve only the FIRST append. The loop advances to QUEUE the second append — it does NOT dispatch `a`.
		fake.pending[0]?.resolve();
		await flushMicrotasks();
		// Load-bearing: `a`'s append has fully resolved, yet STILL zero dispatches (the dispatch loop runs only after
		// the LAST append). Delete the `await` in commit and dispatch:a would already be on the tape here.
		expect(fake.events).toEqual(["append:lease:a", "append:lease:b"]);
		expect(fake.dispatches).toEqual([]);

		fake.pending[1]?.resolve();
		await p;
		expect(fake.events).toEqual(["append:lease:a", "append:lease:b", "dispatch:a", "dispatch:b"]);
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a", "b"]);
	});

	it("DRC-10 holds appendLog ordering for a mixed reclaim+lease tick (only the lease dispatches)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = deferredAppendPorts({ startNow: 0 });
		const controller = new DurableRunController(graph, { ...config, maxConcurrentLeases: 1 }, fake.ports);

		// First tick: lease a (expires at 100). Resolve its append so the lease is recorded + dispatched.
		const first = controller.tick();
		await flushMicrotasks();
		fake.pending[0]?.resolve();
		await first;
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]);

		// Expire the lease, then the second tick decides [reclaim a, lease a].
		fake.setClock(200);
		const second = controller.tick();
		await flushMicrotasks();
		// The reclaim append is queued first (decision order); no new dispatch.
		expect(fake.events).toEqual(["append:lease:a", "dispatch:a", "append:reclaim:a"]);
		expect(fake.dispatches).toHaveLength(1);

		// Resolving the reclaim append advances the loop to the lease append — still no new dispatch.
		fake.pending[1]?.resolve();
		await flushMicrotasks();
		expect(fake.events).toEqual(["append:lease:a", "dispatch:a", "append:reclaim:a", "append:lease:a"]);
		expect(fake.dispatches).toHaveLength(1);

		fake.pending[2]?.resolve();
		await second;
		// Exactly one new dispatch:a, after BOTH appends; reclaim is persisted+applied but never dispatched.
		expect(fake.events).toEqual(["append:lease:a", "dispatch:a", "append:reclaim:a", "append:lease:a", "dispatch:a"]);
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a", "a"]);
	});

	// --- §2: appendLog rejection mid-commit (pins CURRENT behavior; see commit()'s contract comment) ---

	it("DRC-11 aborts the commit on an appendLog rejection: error propagates, no state applied, no dispatch", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = rejectingAppendPorts(0, { startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);

		await expect(controller.tick()).rejects.toThrow("ledger append failed");
		// applyDurableSchedulerActions never ran → mirror is untouched.
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "ready", attempts: 0, lease: null });
		// Dispatch loop never reached; the rejecting append did not record.
		expect(fake.dispatches).toEqual([]);
		expect(fake.log).toEqual([]);
	});

	it("DRC-12 on a 2nd-action rejection persists the first append but does NOT advance the in-memory mirror", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [] });
		const fake = rejectingAppendPorts(1, { startNow: 0 });
		const controller = new DurableRunController(graph, { ...config, maxConcurrentLeases: 2 }, fake.ports);

		await expect(controller.tick()).rejects.toThrow("ledger append failed");
		// Action-0 persisted before the action-1 reject; action-1 never recorded.
		expect(fake.log).toHaveLength(1);
		expect(fake.log[0]).toMatchObject({ kind: "scheduled", action: { type: "lease", jobId: "a" } });
		// apply never ran → even `a` is still ready in memory despite its log entry.
		expect(controller.jobsSnapshot()).toMatchObject([
			{ jobId: "a", state: "ready", attempts: 0 },
			{ jobId: "b", state: "ready", attempts: 0 },
		]);
		expect(fake.dispatches).toEqual([]);
		// The DURABLE log diverges from the LIVE snapshot: replay folds the logged lease, so `a` is leased on disk.
		const replayed = replayDurableJobs(graph, fake.log, { reclaimBackoffMs: 0, maxAttempts: config.maxAttempts });
		expect(replayed.find((j) => j.jobId === "a")).toMatchObject({ state: "leased" });
		expect(replayed.find((j) => j.jobId === "b")).toMatchObject({ state: "ready" });
	});

	// --- §3: reportCompletion error-classification & early-return branches ---

	it("DRC-13 parks the card when reportCompletion(failed) carries no error (the interrupt path)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();

		await controller.reportCompletion("a", "failed");
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed" });
		// effectiveOutcome stayed "failed" (isTransientNetworkError(undefined) === false), not transient_retry.
		expect(log.at(-1)).toEqual({ kind: "completed", jobId: "a", outcome: "failed" });
	});

	it("DRC-14 parks the card when reportCompletion(failed) carries an explicit null error", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();

		await controller.reportCompletion("a", "failed", null);
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed" });
		expect(log.at(-1)).toEqual({ kind: "completed", jobId: "a", outcome: "failed" });
	});

	it("DRC-15 treats reportCompletion on an unknown jobId as a no-op (no append, no mutation)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();
		const before = controller.jobsSnapshot();
		const logLenBefore = log.length;

		await expect(controller.reportCompletion("does-not-exist", "succeeded")).resolves.toBeUndefined();
		expect(log.length).toBe(logLenBefore);
		expect(controller.jobsSnapshot()).toEqual(before);
	});

	it("DRC-16 treats reportCompletion on an already-succeeded job as a no-op", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();
		await controller.reportCompletion("a", "succeeded");
		const logLenBefore = log.length;

		await controller.reportCompletion("a", "succeeded");
		await controller.reportCompletion("a", "failed");
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "succeeded" });
		expect(log.length).toBe(logLenBefore);
	});

	it("DRC-17 treats reportCompletion on an already-failed job as a no-op (cannot be revived)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();
		await controller.reportCompletion("a", "failed");
		const logLenBefore = log.length;

		await controller.reportCompletion("a", "succeeded");
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed" });
		expect(log.length).toBe(logLenBefore);
	});

	it("DRC-18 still succeeds a succeeded report even when its error arg looks transient", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();

		await controller.reportCompletion("a", "succeeded", new Error("Body Timeout Error"));
		// The `outcome === "failed" &&` guard short-circuits before isTransientNetworkError → no remap.
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "succeeded" });
		expect(log.at(-1)).toEqual({ kind: "completed", jobId: "a", outcome: "succeeded" });
	});

	it("DRC-19 burns transient retries up to maxAttempts, then parks (no infinite loop)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, dispatches } = fakePorts();
		const controller = new DurableRunController(graph, { ...config, maxAttempts: 3 }, ports);

		// Each lease AND each transient report burns one attempt, so the budget (3) is reached after two rounds.
		await controller.tick(); // lease → attempts 1
		await controller.reportCompletion("a", "failed", new Error("ECONNRESET")); // transient → ready, attempts 2
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "ready", attempts: 2 });

		await controller.tick(); // re-lease → attempts 3
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "leased", attempts: 3 });
		await controller.reportCompletion("a", "failed", new Error("ECONNRESET")); // transient at budget → parks
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed", attempts: 3 });
		expect(controller.isComplete()).toBe(true);

		// A flaky endpoint cannot loop forever: once parked, further ticks do nothing.
		const dispatchesBefore = dispatches.length;
		const actions = await controller.tick();
		expect(actions).toEqual([]);
		expect(dispatches.length).toBe(dispatchesBefore);
	});

	// --- §4: heartbeat, reclaimOrphanedLeases idempotency, the maxAttempts clamp ---

	it("DRC-20 treats heartbeat on a non-leased (ready) job as a no-op", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		const before = controller.jobsSnapshot();

		controller.heartbeat("a");
		expect(controller.jobsSnapshot()).toEqual(before);
		expect(log).toEqual([]); // heartbeat is in-memory only (not logged)
	});

	it("DRC-21 treats heartbeat on a blocked job and on an unknown jobId as no-ops", () => {
		const graph = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [{ fromTaskId: "b", toTaskId: "a" }],
		});
		const { ports } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		const before = controller.jobsSnapshot();

		controller.heartbeat("b"); // blocked
		controller.heartbeat("zzz"); // unknown
		expect(controller.jobsSnapshot()).toEqual(before);
	});

	it("DRC-22 rescues a leased job from reclaim across repeated heartbeats, advancing expiry each beat", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = fakePorts({ startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);
		await controller.tick(); // lease a, expiresAt = 100

		fake.setClock(90);
		controller.heartbeat("a"); // expiresAt = 90 + 100 = 190
		expect(controller.jobsSnapshot()[0]?.lease?.expiresAt).toBe(190);

		fake.setClock(180);
		controller.heartbeat("a"); // expiresAt = 180 + 100 = 280
		expect(controller.jobsSnapshot()[0]?.lease?.expiresAt).toBe(280);

		fake.setClock(250); // past 190, before 280
		const actions = await controller.tick();
		expect(actions.some((x) => x.type === "reclaim")).toBe(false);
		expect(controller.jobsSnapshot()[0]?.state).toBe("leased");
	});

	it("DRC-23 treats reclaimOrphanedLeases as a no-op when nothing is leased (idempotent re-call)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports, log, dispatches } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();
		await controller.reportCompletion("a", "succeeded"); // nothing leased now
		const logLenBefore = log.length;
		const dispatchesBefore = dispatches.length;
		const before = controller.jobsSnapshot();

		await controller.reclaimOrphanedLeases();
		await controller.reclaimOrphanedLeases();
		expect(log.length).toBe(logLenBefore);
		expect(dispatches.length).toBe(dispatchesBefore);
		expect(controller.jobsSnapshot()).toEqual(before);
	});

	it("DRC-24 reclaims an orphaned lease once across a double reclaimOrphanedLeases call, then no-ops", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "old", expiresAt: 100 } },
		];
		const replayed = replayDurableJobs(graph, priorLog, { reclaimBackoffMs: 0, maxAttempts: config.maxAttempts });
		const { ports, log, dispatches } = fakePorts({ startNow: 5000 });
		const controller = new DurableRunController(replayed, config, ports);

		await controller.reclaimOrphanedLeases();
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "ready", attempts: 1 });
		const reclaimEntries = log.filter((e) => e.kind === "scheduled" && e.action.type === "reclaim");
		expect(reclaimEntries).toHaveLength(1);
		const logLenAfterFirst = log.length;

		await controller.reclaimOrphanedLeases();
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "ready" });
		expect(log.length).toBe(logLenAfterFirst); // no second reclaim
		expect(dispatches).toEqual([]); // reclaim isn't a lease → no dispatch
	});

	it("DRC-25 fails an orphaned lease whose budget is spent on a direct reclaimOrphanedLeases call", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 10 } },
			{ kind: "scheduled", now: 20, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ kind: "scheduled", now: 20, action: { type: "lease", jobId: "a", workerId: "w2", expiresAt: 30 } },
			{ kind: "scheduled", now: 40, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ kind: "scheduled", now: 40, action: { type: "lease", jobId: "a", workerId: "w3", expiresAt: 50 } },
		];
		const replayed = replayDurableJobs(graph, priorLog, { reclaimBackoffMs: 0, maxAttempts: config.maxAttempts });
		const { ports, log, dispatches } = fakePorts({ startNow: 9000 });
		const controller = new DurableRunController(replayed, config, ports);

		await controller.reclaimOrphanedLeases();
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed", attempts: 3 });
		expect(controller.isComplete()).toBe(true);
		const failEntry = log.find((e) => e.kind === "scheduled" && e.action.type === "fail");
		expect(failEntry).toMatchObject({ kind: "scheduled", action: { type: "fail", reason: "max_attempts" } });
		expect(dispatches).toEqual([]);
	});

	it("DRC-26 clamps a degenerate maxAttempts (0 / 0.9 / NaN) so a budget-1 orphan FAILS, never immortal", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 10 } },
		];
		// All three degenerate values must clamp to an effective minimum of 1 → a job at attempts:1 is over budget.
		// (Only NaN distinguishes the fix: pre-fix `Math.max(1, NaN) === NaN` would reclaim forever instead of fail.)
		for (const maxAttempts of [0, 0.9, Number.NaN]) {
			const replayed = replayDurableJobs(graph, priorLog, { reclaimBackoffMs: 0, maxAttempts });
			const { ports } = fakePorts({ startNow: 5000 });
			const controller = new DurableRunController(replayed, { ...config, maxAttempts }, ports);

			await controller.reclaimOrphanedLeases();
			expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed", attempts: 1 });
		}
	});

	// --- §5: resume boot-replay (beyond existing tests 6 & 7) ---

	it("DRC-27 resumes from an empty log with no reclaim, then leases the ready root on the first tick", async () => {
		const graph = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [{ fromTaskId: "b", toTaskId: "a" }],
		});
		const { ports, log, dispatches } = fakePorts({ startNow: 5000 });
		const controller = await DurableRunController.resume(graph, [], config, ports);

		expect(log.some((e) => e.kind === "scheduled" && e.action.type === "reclaim")).toBe(false);
		expect(controller.jobsSnapshot().find((j) => j.jobId === "a")).toMatchObject({ state: "ready" });
		expect(controller.jobsSnapshot().find((j) => j.jobId === "b")).toMatchObject({ state: "blocked" });

		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a"]);
		expect(replayDurableJobs(graph, log, { reclaimBackoffMs: 0, maxAttempts: config.maxAttempts })).toEqual(
			controller.jobsSnapshot(),
		);
	});

	it("DRC-28 resumes by reclaiming MULTIPLE orphaned leases in one boot, then re-dispatches all", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [] });
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "oldA", expiresAt: 100 } },
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "b", workerId: "oldB", expiresAt: 100 } },
		];
		const { ports, log, dispatches } = fakePorts({ startNow: 5000 });
		const controller = await DurableRunController.resume(
			graph,
			priorLog,
			{ ...config, maxConcurrentLeases: 2 },
			ports,
		);

		expect(controller.jobsSnapshot()).toMatchObject([
			{ jobId: "a", state: "ready", attempts: 1 },
			{ jobId: "b", state: "ready", attempts: 1 },
		]);
		const reclaimEntries = log.filter((e) => e.kind === "scheduled" && e.action.type === "reclaim");
		expect(reclaimEntries).toHaveLength(2);

		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a", "b"]);
		expect(controller.jobsSnapshot()).toMatchObject([
			{ jobId: "a", state: "leased", attempts: 2 },
			{ jobId: "b", state: "leased", attempts: 2 },
		]);
	});

	it("DRC-29 does not settle resume() until the reclaim append is persisted (the await on line 94)", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "old", expiresAt: 100 } },
		];
		const fake = deferredAppendPorts({ startNow: 5000 });

		const resumeP = DurableRunController.resume(graph, priorLog, config, fake.ports);
		await flushMicrotasks();
		expect(fake.pending).toHaveLength(1); // the reclaim append is in-flight
		const settled = await Promise.race([resumeP.then(() => "done"), Promise.resolve("pending")]);
		expect(settled).toBe("pending"); // resume has NOT returned yet

		fake.pending[0]?.resolve();
		const controller = await resumeP;
		expect(controller).toBeInstanceOf(DurableRunController);
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "ready" });
	});

	// --- §6: jobsSnapshot defensive copy / isComplete boundary ---

	it("DRC-30 returns a defensive jobsSnapshot copy: mutating the result does not corrupt the controller", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const { ports } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);
		await controller.tick();

		const snap = controller.jobsSnapshot();
		const first = snap[0];
		if (first) {
			first.state = "failed";
			first.attempts = 999;
		}
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "leased", attempts: 1 });
	});

	it("DRC-31 reports isComplete true for an empty graph and false for an all-blocked cyclic graph", async () => {
		const empty = buildDurableJobGraph({ taskIds: [], dependencies: [] });
		const emptyPorts = fakePorts();
		const emptyController = new DurableRunController(empty, config, emptyPorts.ports);
		expect(emptyController.isComplete()).toBe(true);
		expect(await emptyController.tick()).toEqual([]);
		expect(emptyPorts.dispatches).toEqual([]);

		const cyclic = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [
				{ fromTaskId: "a", toTaskId: "b" },
				{ fromTaskId: "b", toTaskId: "a" },
			],
		});
		const cyclicPorts = fakePorts();
		const cyclicController = new DurableRunController(cyclic, config, cyclicPorts.ports);
		await cyclicController.tick();
		expect(cyclicController.isComplete()).toBe(false);
		expect(cyclicPorts.dispatches).toEqual([]);
		expect(cyclicController.jobsSnapshot().every((j) => j.state === "blocked")).toBe(true);
	});

	// --- §7: loop-level integration of the persist-before-dispatch invariant ---

	it("DRC-32 never dispatches a dependent before its lease is logged, across a completion→unblock→lease cascade", async () => {
		const graph = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [{ fromTaskId: "b", toTaskId: "a" }],
		});
		const fake = deferredAppendPorts({ startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);

		// 1. lease a (resolve its append → dispatched).
		const t1 = controller.tick();
		await flushMicrotasks();
		fake.pending[0]?.resolve();
		await t1;
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]);

		// 2. a succeeds (resolve the completed append).
		const rc = controller.reportCompletion("a", "succeeded");
		await flushMicrotasks();
		fake.pending[1]?.resolve();
		await rc;

		// 3. tick decides [unblock b, lease b]. commit awaits each append in turn, so only `unblock b` is queued so
		//    far — and `b` is NOT dispatched.
		const t2 = controller.tick();
		await flushMicrotasks();
		expect(fake.events.slice(-1)).toEqual(["append:unblock:b"]);
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]);

		// Resolving the unblock append advances the loop to QUEUE `lease b` — still no dispatch of `b`.
		fake.pending[2]?.resolve();
		await flushMicrotasks();
		expect(fake.events.slice(-2)).toEqual(["append:unblock:b", "append:lease:b"]);
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]); // b not dispatched until its lease persists

		// 4. resolve the lease append → b dispatched, after both appends.
		fake.pending[3]?.resolve();
		await t2;
		expect(fake.events.slice(-3)).toEqual(["append:unblock:b", "append:lease:b", "dispatch:b"]);
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a", "b"]);
	});
});

describe("DurableRunController — DURABLE_DEPTH_PRIORITY lease ordering (§5.AF, opt-in)", () => {
	const FLAG = "DURABLE_DEPTH_PRIORITY";
	let savedFlag: string | undefined;
	beforeEach(() => {
		savedFlag = process.env[FLAG];
		delete process.env[FLAG];
	});
	afterEach(() => {
		if (savedFlag === undefined) {
			delete process.env[FLAG];
		} else {
			process.env[FLAG] = savedFlag;
		}
	});

	// "leaf" sits FIRST in input order but unblocks nothing; "hub" sits later but unblocks x, y, z. Both are ready with
	// no dependencies of their own, and only ONE slot is free — so which one leases reveals the ordering policy.
	const fanOutGraph = () =>
		buildDurableJobGraph({
			taskIds: ["leaf", "hub", "x", "y", "z"],
			dependencies: [
				{ fromTaskId: "x", toTaskId: "hub" },
				{ fromTaskId: "y", toTaskId: "hub" },
				{ fromTaskId: "z", toTaskId: "hub" },
			],
		});
	const oneSlot: DurableRunConfig = { ...config, maxConcurrentLeases: 1 };

	it("flag=0 (explicit disable) ⇒ leases in raw input order — the earliest ready job (leaf) wins the slot", async () => {
		process.env[FLAG] = "0";
		const { ports, dispatches } = fakePorts();
		const controller = new DurableRunController(fanOutGraph(), oneSlot, ports);
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["leaf"]); // input-order FIFO
	});

	it("DEFAULT (unset, David 2026-07-04) ⇒ depth-priority ON: the high-fan-out hub wins the slot", async () => {
		// The flag now defaults ON, so an unset env leases the fan-out prerequisite first, same as flag=1.
		const { ports, dispatches } = fakePorts();
		const controller = new DurableRunController(fanOutGraph(), oneSlot, ports);
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["hub"]);
	});

	it("flag ON ⇒ leases the high-fan-out prerequisite (hub) first, ahead of the cheaper leaf", async () => {
		process.env[FLAG] = "1";
		const { ports, dispatches } = fakePorts();
		const controller = new DurableRunController(fanOutGraph(), oneSlot, ports);
		await controller.tick();
		// hub unblocks 3 dependents ⇒ orderReadyJobs ranks it first ⇒ it wins the single slot despite its later input slot.
		expect(dispatches.map((d) => d.jobId)).toEqual(["hub"]);
	});

	describe("lease idempotency keys (§5.AF at-most-once)", () => {
		const identity = { workflowId: "wf-1", workspacePathHash: "hash-1" };
		const leaseKeyOf = (log: readonly DurableSchedulerLogEntry[]): string | undefined => {
			const entry = log.find((e) => e.kind === "scheduled" && e.action.type === "lease");
			return entry && entry.kind === "scheduled" ? entry.idempotencyKey : undefined;
		};

		it("stamps a non-null key on a lease when an identity is supplied; leaves it undefined without one", async () => {
			const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
			const keyed = fakePorts();
			await new DurableRunController(graph, config, keyed.ports, identity).tick();
			expect(typeof leaseKeyOf(keyed.log)).toBe("string");

			const bare = fakePorts();
			await new DurableRunController(graph, config, bare.ports).tick();
			expect(leaseKeyOf(bare.log)).toBeUndefined(); // byte-identical to before the composition
		});

		it("keys the SAME lease (workflow x task x attempt) identically across runs — so a crash re-dispatch dedups on replay", async () => {
			const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
			const run1 = fakePorts();
			await new DurableRunController(graph, config, run1.ports, identity).tick();
			const run2 = fakePorts();
			await new DurableRunController(graph, config, run2.ports, identity).tick();
			const key1 = leaseKeyOf(run1.log);
			expect(key1).toBeDefined();
			expect(key1).toBe(leaseKeyOf(run2.log));
		});
	});
});
