export type NKleinTaskTimeoutKind = "stream" | "tool" | "conversation";

/**
 * Per-task timeout timer handles, extracted from InMemoryNKleinTaskSessionService.
 *
 * Owns the nested `Map<taskId, Map<kind, timer>>` and the fiddly bookkeeping around it: storing a
 * freshly-scheduled timer, clearing a single kind (and dropping the now-empty per-task entry), and
 * clearing every kind for a task. The scheduling POLICY (which timeout to arm, for how long) and
 * the firing action stay in the service — this only manages handle storage and teardown.
 *
 * Behavior-preserving: each method mirrors the exact inline Map ops it replaced, including the
 * "remove the outer entry once its inner map is empty" cleanup in {@link clearKind}.
 */
export class TaskTimeoutHandles {
	private readonly handlesByTaskId = new Map<string, Map<NKleinTaskTimeoutKind, NodeJS.Timeout>>();

	/** Stores (or replaces) the timer for one kind, creating the per-task inner map on first use. */
	set(taskId: string, kind: NKleinTaskTimeoutKind, handle: NodeJS.Timeout): void {
		const handles = this.handlesByTaskId.get(taskId) ?? new Map<NKleinTaskTimeoutKind, NodeJS.Timeout>();
		handles.set(kind, handle);
		this.handlesByTaskId.set(taskId, handles);
	}

	/** Clears the timer for one kind, dropping the per-task entry once no kinds remain. */
	clearKind(taskId: string, kind: NKleinTaskTimeoutKind): void {
		const handles = this.handlesByTaskId.get(taskId);
		const handle = handles?.get(kind);
		if (handle) {
			clearTimeout(handle);
			handles?.delete(kind);
		}
		if (handles?.size === 0) {
			this.handlesByTaskId.delete(taskId);
		}
	}

	/** Clears every kind's timer for the task and forgets it. */
	clearAll(taskId: string): void {
		const handles = this.handlesByTaskId.get(taskId);
		if (handles) {
			for (const handle of handles.values()) {
				clearTimeout(handle);
			}
		}
		this.handlesByTaskId.delete(taskId);
	}

	/** The task ids with live handles — used to sweep every task on disposal. */
	taskIds(): IterableIterator<string> {
		return this.handlesByTaskId.keys();
	}
}
