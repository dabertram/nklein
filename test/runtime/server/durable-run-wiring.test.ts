import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent, AgentSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	createDurableRunWiring,
	type DurableRunBoardView,
	type DurableRunWiringDeps,
	durableJobGraphInputFromBoard,
} from "../../../src/server/durable-run-wiring";

/** A board: `spec` maps columnId → card ids; `deps` are {fromTaskId depends on toTaskId} edges. */
function board(
	spec: Record<string, string[]>,
	deps: Array<{ fromTaskId: string; toTaskId: string }> = [],
): DurableRunBoardView {
	return {
		columns: Object.entries(spec).map(([id, ids]) => ({ id, cards: ids.map((cardId) => ({ id: cardId })) })),
		dependencies: deps,
	};
}

/** A harness capturing the injected effects (ledger appends + card dispatches), with deterministic clock + worker ids. */
function harness(overrides: Partial<DurableRunWiringDeps> = {}) {
	const ledger: AgentSchedulerEvent[] = [];
	const dispatches: Array<{ workspaceId: string; taskId: string }> = [];
	let workerSeq = 0;
	const deps: DurableRunWiringDeps = {
		enabled: true,
		appendEvent: (event) => {
			ledger.push(event);
		},
		startCard: (workspaceId, taskId) => {
			dispatches.push({ workspaceId, taskId });
		},
		hashWorkspacePath: (path) => `hash:${path}`,
		workflowIdFor: (workspaceId) => `run:${workspaceId}`,
		now: () => 1_000_000,
		mintWorkerId: () => {
			workerSeq += 1;
			return `worker-${workerSeq}`;
		},
		...overrides,
	};
	return { wiring: createDurableRunWiring(deps), ledger, dispatches, deps };
}

describe("durableJobGraphInputFromBoard", () => {
	it("maps non-trash cards to jobs; ONLY completed = succeeded (review is non-terminal); trash excluded; deps pass through", () => {
		const input = durableJobGraphInputFromBoard(
			board(
				{
					backlog: ["a", "b"],
					in_progress: ["c"],
					review: ["d"],
					completed: ["e"],
					trash: ["z"],
				},
				[{ fromTaskId: "b", toTaskId: "a" }],
			),
		);
		expect(input.taskIds.sort()).toEqual(["a", "b", "c", "d", "e"]);
		// a `review` card (d) is NOT succeeded — review can bounce it back — so its dependents must not start prematurely.
		expect(input.succeededTaskIds.sort()).toEqual(["e"]);
		expect(input.dependencies).toEqual([{ fromTaskId: "b", toTaskId: "a" }]);
	});

	it("does NOT start a dependent of a review-lane card on resume (review is not terminal)", () => {
		// x is in review, y (backlog) depends on x. With review NOT succeeded, y stays blocked (not started).
		const input = durableJobGraphInputFromBoard(
			board({ review: ["x"], backlog: ["y"] }, [{ fromTaskId: "y", toTaskId: "x" }]),
		);
		expect(input.succeededTaskIds).toEqual([]);
	});
});

describe("createDurableRunWiring", () => {
	it("is fully inert when disabled (byte-identical default): no run, no dispatch, no ledger writes", async () => {
		const { wiring, ledger, dispatches } = harness({ enabled: false });
		const created = await wiring.ensureRun("ws1", "/w", board({ backlog: ["a"] }));
		expect(created).toBe(false);
		expect(wiring.hasRun("ws1")).toBe(false);
		await wiring.observeSummary("ws1", "a", "awaiting_review");
		await wiring.tickAll();
		expect(dispatches).toEqual([]);
		expect(ledger).toEqual([]);
	});

	it("ensureRun leases + dispatches the dependency-free cards, not the blocked ones", async () => {
		const { wiring, dispatches } = harness();
		// b depends on a; a and c are ready.
		const created = await wiring.ensureRun(
			"ws1",
			"/w",
			board({ backlog: ["a", "b", "c"] }, [{ fromTaskId: "b", toTaskId: "a" }]),
		);
		expect(created).toBe(true);
		expect(wiring.hasRun("ws1")).toBe(true);
		expect(dispatches.map((d) => d.taskId).sort()).toEqual(["a", "c"]);
	});

	it("completing a prerequisite cascades: the newly-unblocked dependent is dispatched", async () => {
		const { wiring, dispatches } = harness();
		await wiring.ensureRun("ws1", "/w", board({ backlog: ["a", "b"] }, [{ fromTaskId: "b", toTaskId: "a" }]));
		expect(dispatches.map((d) => d.taskId)).toEqual(["a"]); // b blocked

		await wiring.observeSummary("ws1", "a", "awaiting_review"); // a's agent-job succeeded
		expect(dispatches.map((d) => d.taskId)).toEqual(["a", "b"]); // b now dispatched
	});

	it("a running summary heartbeats the lease (no new dispatch)", async () => {
		const { wiring, dispatches } = harness();
		await wiring.ensureRun("ws1", "/w", board({ backlog: ["a"] }));
		const before = dispatches.length;
		await wiring.observeSummary("ws1", "a", "running");
		expect(dispatches.length).toBe(before);
	});

	it("disposes the run once every job is terminal (a fully-completed board never registers a live run)", async () => {
		const { wiring, dispatches } = harness();
		const created = await wiring.ensureRun("ws1", "/w", board({ completed: ["a", "b"] }));
		expect(created).toBe(true); // a run was constructed...
		expect(wiring.hasRun("ws1")).toBe(false); // ...but it was immediately complete and disposed
		expect(dispatches).toEqual([]);
		expect(wiring.activeWorkspaceIds()).toEqual([]);
	});

	it("honors the concurrency cap: fewer leases than ready jobs this tick", async () => {
		const { wiring, dispatches } = harness({ config: { maxConcurrentLeases: 1 } });
		await wiring.ensureRun("ws1", "/w", board({ backlog: ["a", "b"] })); // both ready, cap 1
		expect(dispatches.length).toBe(1);
	});

	it("ensureRun is idempotent: a second call while a run exists does not re-register or re-dispatch", async () => {
		const { wiring, dispatches } = harness();
		await wiring.ensureRun("ws1", "/w", board({ backlog: ["a"] }));
		const afterFirst = dispatches.length;
		const secondCreated = await wiring.ensureRun("ws1", "/w", board({ backlog: ["a"] }));
		expect(secondCreated).toBe(false);
		expect(dispatches.length).toBe(afterFirst);
	});

	it("dispose drops the workspace's run (so the registry does not leak on workspace teardown)", async () => {
		const { wiring } = harness();
		await wiring.ensureRun("ws1", "/w", board({ backlog: ["a", "b"] }, [{ fromTaskId: "b", toTaskId: "a" }]));
		expect(wiring.hasRun("ws1")).toBe(true);
		wiring.dispose("ws1");
		expect(wiring.hasRun("ws1")).toBe(false);
		expect(wiring.activeWorkspaceIds()).toEqual([]);
	});

	it("serializes concurrent controller access per workspace (no double-lease under a summary/tick race)", async () => {
		const { wiring, dispatches } = harness({ config: { maxConcurrentLeases: 1 } });
		await wiring.ensureRun("ws1", "/w", board({ backlog: ["a", "b"] })); // cap 1 ⇒ one dispatched
		// Fire a summary (completes a) and a timer tick CONCURRENTLY — serialization must prevent a double-lease.
		await Promise.all([
			wiring.observeSummary("ws1", dispatches[0]?.taskId ?? "a", "awaiting_review"),
			wiring.tickAll(),
		]);
		// Exactly the two cards start once each, never more (a double-lease would push dispatches past 2).
		expect(dispatches.map((d) => d.taskId).sort()).toEqual(["a", "b"]);
	});

	it("RESUME (restart-survivability): a run whose worker died mid-lease re-dispatches the orphaned card on boot", async () => {
		// --- process 1: start the run; `a` gets leased + dispatched, then the process 'crashes' (never completes). ---
		const persistedLedger: AgentSchedulerEvent[] = [];
		const first = createDurableRunWiring({
			enabled: true,
			appendEvent: (e) => {
				persistedLedger.push(e);
			},
			startCard: () => {},
			hashWorkspacePath: (p) => `hash:${p}`,
			workflowIdFor: (ws) => `run:${ws}`,
			now: () => 1_000_000,
			mintWorkerId: () => "worker-1",
		});
		await first.ensureRun("ws1", "/w", board({ backlog: ["a", "b"] }, [{ fromTaskId: "b", toTaskId: "a" }]));
		expect(persistedLedger.length).toBeGreaterThan(0); // a's lease was persisted BEFORE dispatch

		// --- process 2 (restart): a fresh wiring reads the persisted ledger and resumes. ---
		const redispatched: string[] = [];
		let nowMs = 2_000_000;
		const second = createDurableRunWiring({
			enabled: true,
			appendEvent: () => {},
			startCard: (_ws, taskId) => {
				redispatched.push(taskId);
			},
			readLedger: (): AgentLedgerEvent[] => persistedLedger,
			hashWorkspacePath: (p) => `hash:${p}`,
			workflowIdFor: (ws) => `run:${ws}`,
			now: () => nowMs,
			mintWorkerId: () => "worker-2",
			config: { reclaimBackoffMs: 30_000 },
		});
		const resumed = await second.ensureRun(
			"ws1",
			"/w",
			board({ backlog: ["a", "b"] }, [{ fromTaskId: "b", toTaskId: "a" }]),
		);
		expect(resumed).toBe(true);
		// Boot RECLAIMS the orphaned lease but the reclaim BACKOFF (30s) holds re-dispatch off this tick (anti-thunder).
		expect(redispatched).toEqual([]);
		// Once the backoff elapses, the timer tick re-dispatches the orphaned in-flight card `a`; blocked `b` stays put.
		nowMs = 2_030_001;
		await second.tickAll();
		expect(redispatched).toEqual(["a"]);
	});

	it("scopes resume by workflowId: another workspace's ledger events are ignored", async () => {
		const foreignLedger: AgentSchedulerEvent[] = [];
		// A run in ws-other populates the ledger.
		const other = createDurableRunWiring({
			enabled: true,
			appendEvent: (e) => {
				foreignLedger.push(e);
			},
			startCard: () => {},
			hashWorkspacePath: (p) => `hash:${p}`,
			workflowIdFor: (ws) => `run:${ws}`,
			now: () => 1_000_000,
			mintWorkerId: () => "w",
		});
		await other.ensureRun("ws-other", "/o", board({ backlog: ["x"] }));

		// ws1 reads the SAME ledger blob but its workflowId differs → no foreign entries replayed → x never dispatched.
		const dispatched: string[] = [];
		const mine = createDurableRunWiring({
			enabled: true,
			appendEvent: () => {},
			startCard: (_ws, taskId) => {
				dispatched.push(taskId);
			},
			readLedger: (): AgentLedgerEvent[] => foreignLedger,
			hashWorkspacePath: (p) => `hash:${p}`,
			workflowIdFor: (ws) => `run:${ws}`,
			now: () => 2_000_000,
			mintWorkerId: () => "w2",
		});
		await mine.ensureRun("ws1", "/w", board({ backlog: ["a"] }));
		expect(dispatched).toEqual(["a"]); // only ws1's own card, never the foreign x
	});
});
