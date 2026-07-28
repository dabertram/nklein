export interface NestedModelTurnRequest {
	taskId: string;
	/**
	 * Set only when this turn is an awaited child of an active parent model turn. The gate temporarily yields the
	 * parent's reservation, runs the child under the same caps, then reacquires the parent before its model loop resumes.
	 */
	admissionParentTaskId?: string | null;
	/**
	 * Stamped by THIS gate (never by callers) on the acquire that restores a parent's yielded slot. Admission uses it
	 * to treat a lingering same-task reservation as a leaked ghost to purge rather than an active turn to wait on —
	 * the parent is the only legitimate turn for its task while its children run (G6.8a v9 deadlock, 2026-07-28).
	 */
	parentReacquire?: boolean;
}

interface ActiveAdmissionLease<Request, Reservation> {
	request: Request;
	reservation: Reservation | null;
	nestedTurnCount: number;
	closed: boolean;
}

export interface NestedModelTurnAdmissionDependencies<Request, Reservation> {
	acquire(request: Request): Promise<Reservation>;
	release(reservation: Reservation): void;
	/** Wake unrelated queued work only when a reservation is genuinely free, not during an atomic parent/child handoff. */
	onCapacityFreed?(): void;
}

/**
 * Admission wrapper with cooperative reservation handoff for awaited auxiliary model turns.
 *
 * A parent awaiting a same-host child cannot retain the only host reservation: cap=1 would make each side wait for the
 * other forever. This coordinator yields the parent without raising or bypassing any cap. Parallel children are counted
 * so the parent is reacquired only after the last child settles; unrelated turns continue through normal admission.
 */
export function createNestedModelTurnAdmissionGate<Request extends NestedModelTurnRequest, Reservation>(
	deps: NestedModelTurnAdmissionDependencies<Request, Reservation>,
) {
	const activeByTaskId = new Map<string, ActiveAdmissionLease<Request, Reservation>>();

	const releaseLease = (lease: ActiveAdmissionLease<Request, Reservation>, notify: boolean): void => {
		const reservation = lease.reservation;
		if (reservation === null) {
			return;
		}
		lease.reservation = null;
		deps.release(reservation);
		if (notify) {
			deps.onCapacityFreed?.();
		}
	};

	return async <T>(request: Request, run: () => Promise<T>): Promise<T> => {
		const parentTaskId = request.admissionParentTaskId?.trim() || null;
		const parent = parentTaskId && parentTaskId !== request.taskId ? activeByTaskId.get(parentTaskId) : undefined;
		if (parent && !parent.closed) {
			parent.nestedTurnCount += 1;
			// Do not wake the general queue here: the released slot is being transferred to this awaited child.
			releaseLease(parent, false);
		}

		let lease: ActiveAdmissionLease<Request, Reservation> | null = null;
		try {
			lease = {
				request,
				reservation: await deps.acquire(request),
				nestedTurnCount: 0,
				closed: false,
			};
			activeByTaskId.set(request.taskId, lease);
			return await run();
		} finally {
			if (lease) {
				lease.closed = true;
				if (activeByTaskId.get(request.taskId) === lease) {
					activeByTaskId.delete(request.taskId);
				}
				// A parent handoff immediately reacquires below. A top-level completion genuinely frees capacity.
				releaseLease(lease, !parent);
			}
			if (parent) {
				parent.nestedTurnCount = Math.max(0, parent.nestedTurnCount - 1);
				if (parent.nestedTurnCount === 0 && !parent.closed) {
					const reacquired = await deps.acquire({ ...parent.request, parentReacquire: true });
					// G6.8a v9 deadlock (2026-07-28, 2.5h live wedge): this acquire can pend for a long time, and the
					// world can move on while it does — the parent may CLOSE (its run aborted), or a NEW child may
					// start (its yield was a no-op on the still-null reservation). Assigning unconditionally then
					// leaks a reservation nobody owns, and every later same-task admission blocks on the ghost
					// forever. Re-check the lease after the await; if it is no longer the sole open parent with an
					// empty slot, the reacquired reservation must be returned, not stored.
					if (parent.closed || parent.nestedTurnCount > 0 || parent.reservation !== null) {
						deps.release(reacquired);
						deps.onCapacityFreed?.();
					} else {
						parent.reservation = reacquired;
					}
				} else if (parent.nestedTurnCount > 0) {
					// Another sibling is waiting for the yielded slot; wake it without reacquiring the parent prematurely.
					deps.onCapacityFreed?.();
				}
			}
		}
	};
}
