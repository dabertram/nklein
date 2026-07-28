import { describe, expect, it } from "vitest";
import { createNestedModelTurnAdmissionGate, type NestedModelTurnRequest } from "./nested-model-turn-admission";

interface Reservation {
	id: number;
	taskId: string;
}

/**
 * Test double whose `acquire` resolves only when the test admits it, so the child-boundary races the G6.8a v9
 * live wedge exposed (2026-07-28: a 2.5h dead runtime behind one leaked reservation) are reproducible
 * deterministically.
 */
function manualAdmission() {
	let nextId = 1;
	const held = new Set<Reservation>();
	const pending: Array<{ request: NestedModelTurnRequest; admit: () => void }> = [];
	return {
		held,
		pending,
		deps: {
			acquire: (request: NestedModelTurnRequest) =>
				new Promise<Reservation>((resolve) => {
					pending.push({
						request,
						admit: () => {
							const reservation = { id: nextId++, taskId: request.taskId };
							held.add(reservation);
							resolve(reservation);
						},
					});
				}),
			release: (reservation: Reservation) => {
				held.delete(reservation);
			},
		},
		/** Admit the oldest pending acquire and return its request for assertions. */
		admitNext(): NestedModelTurnRequest {
			const entry = pending.shift();
			if (!entry) {
				throw new Error("no pending acquire to admit");
			}
			entry.admit();
			return entry.request;
		},
	};
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitFor(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 200; i += 1) {
		if (condition()) {
			return;
		}
		await tick();
	}
	throw new Error("condition never became true");
}

describe("nested model-turn admission gate", () => {
	it("acquires, runs, and releases a top-level turn", async () => {
		const admission = manualAdmission();
		const gate = createNestedModelTurnAdmissionGate<NestedModelTurnRequest, Reservation>(admission.deps);
		const done = gate({ taskId: "t1" }, async () => "ok");
		await waitFor(() => admission.pending.length === 1);
		admission.admitNext();
		expect(await done).toBe("ok");
		expect(admission.held.size).toBe(0);
	});

	it("stamps parentReacquire on the acquire that restores a yielded parent slot", async () => {
		const admission = manualAdmission();
		const gate = createNestedModelTurnAdmissionGate<NestedModelTurnRequest, Reservation>(admission.deps);
		let releaseChild: () => void = () => {};
		const parentDone = gate({ taskId: "parent" }, async () => {
			await gate(
				{ taskId: "parent::critique", admissionParentTaskId: "parent" },
				() => new Promise<void>((resolve) => (releaseChild = resolve)),
			);
		});
		await waitFor(() => admission.pending.length === 1);
		expect(admission.admitNext().taskId).toBe("parent");
		// Child yields the parent slot, then acquires its own.
		await waitFor(() => admission.pending.length === 1);
		expect(admission.admitNext().taskId).toBe("parent::critique");
		await waitFor(() => releaseChild !== undefined && admission.held.size === 1);
		releaseChild();
		// The reacquire restoring the parent's slot must carry the marker so admission can purge ghosts.
		await waitFor(() => admission.pending.length === 1);
		const reacquire = admission.admitNext();
		expect(reacquire.taskId).toBe("parent");
		expect(reacquire.parentReacquire).toBe(true);
		await parentDone;
		expect(admission.held.size).toBe(0);
	});

	it("releases a reacquired slot instead of assigning it when the parent closed during the pending acquire (G6.8a v9 race B)", async () => {
		const admission = manualAdmission();
		const gate = createNestedModelTurnAdmissionGate<NestedModelTurnRequest, Reservation>(admission.deps);
		let releaseChild: () => void = () => {};
		let abortParent: (error: Error) => void = () => {};
		let childDone: Promise<unknown> = Promise.resolve();
		const parentDone = gate({ taskId: "parent" }, async () => {
			childDone = gate(
				{ taskId: "parent::critique", admissionParentTaskId: "parent" },
				() => new Promise<void>((resolve) => (releaseChild = resolve)),
			);
			// The parent's run aborts WITHOUT awaiting its child (the guard/park path) — the lease closes while
			// the child-side reacquire may still be pending.
			await new Promise<never>((_, reject) => (abortParent = reject));
		}).catch(() => "aborted");
		await waitFor(() => admission.pending.length === 1);
		admission.admitNext(); // parent slot
		await waitFor(() => admission.pending.length === 1);
		admission.admitNext(); // child slot (parent yielded)
		await waitFor(() => admission.held.size === 1);
		// Child settles first: its finally starts the parent reacquire, which pends.
		releaseChild();
		await waitFor(() => admission.pending.length === 1);
		expect(admission.pending[0]?.request.parentReacquire).toBe(true);
		// Parent closes WHILE the reacquire is pending.
		abortParent(new Error("parked"));
		expect(await parentDone).toBe("aborted");
		// Now the pending reacquire resolves against a closed lease.
		admission.admitNext();
		await childDone;
		await tick();
		// Pre-fix this reservation was assigned to the closed lease and leaked forever, same-task-blocking every
		// future turn of the task (the G6.8a v9 2.5h wedge). It must be released by the post-await recheck.
		expect(admission.held.size).toBe(0);
	});

	it("releases a stale reacquired slot when a new child arrived during the pending acquire (G6.8a v9 race A)", async () => {
		const admission = manualAdmission();
		const gate = createNestedModelTurnAdmissionGate<NestedModelTurnRequest, Reservation>(admission.deps);
		let releaseChild1: () => void = () => {};
		let releaseChild2: () => void = () => {};
		let startChild2: () => void = () => {};
		const child2Trigger = new Promise<void>((resolve) => (startChild2 = resolve));
		const childrenDone: Promise<unknown>[] = [];
		const parentDone = gate({ taskId: "parent" }, async () => {
			childrenDone.push(
				gate(
					{ taskId: "parent::c1", admissionParentTaskId: "parent" },
					() => new Promise<void>((resolve) => (releaseChild1 = resolve)),
				),
			);
			await child2Trigger;
			childrenDone.push(
				gate(
					{ taskId: "parent::c2", admissionParentTaskId: "parent" },
					() => new Promise<void>((resolve) => (releaseChild2 = resolve)),
				),
			);
			await Promise.all(childrenDone);
		});
		await waitFor(() => admission.pending.length === 1);
		admission.admitNext(); // parent slot
		await waitFor(() => admission.pending.length === 1);
		admission.admitNext(); // child1 slot (parent yielded)
		await waitFor(() => admission.held.size === 1);
		// child1 settles; its finally starts the parent reacquire, which pends.
		releaseChild1();
		await waitFor(() => admission.pending.length === 1);
		expect(admission.pending[0]?.request.parentReacquire).toBe(true);
		// A SECOND child starts in that window — its yield no-ops on the still-null parent reservation.
		startChild2();
		await waitFor(() => admission.pending.length === 2);
		// The stale child1 reacquire resolves AFTER child2 raised nestedTurnCount: the recheck must release it
		// (pre-fix it was silently assigned while child2 also ran — a double-hold that deadlocked cap-1).
		admission.admitNext();
		await tick();
		admission.admitNext(); // child2's own slot
		await waitFor(() => admission.held.size === 1);
		releaseChild2();
		// child2's completion performs the REAL parent reacquire.
		await waitFor(() => admission.pending.length === 1);
		const finalReacquire = admission.admitNext();
		expect(finalReacquire.parentReacquire).toBe(true);
		await parentDone;
		expect(admission.held.size).toBe(0);
	});
});
