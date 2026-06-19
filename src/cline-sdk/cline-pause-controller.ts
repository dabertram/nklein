export class ClinePauseController {
	private boardPaused = false;
	private readonly cardPausedTaskIds = new Set<string>();
	private readonly controllerPausedTaskIds = new Set<string>();
	private readonly waiters = new Set<{
		taskId: string;
		resolve: () => void;
		reject: (error: Error) => void;
		signal: AbortSignal | null;
		abortListener: (() => void) | null;
	}>();

	isPaused(taskId: string): boolean {
		return this.boardPaused || this.cardPausedTaskIds.has(taskId);
	}

	setBoardPaused(paused: boolean): void {
		this.boardPaused = paused;
		this.notifyWaiters();
	}

	setCardPaused(taskId: string, paused: boolean): void {
		if (paused) {
			this.cardPausedTaskIds.add(taskId);
		} else {
			this.cardPausedTaskIds.delete(taskId);
		}
		this.notifyWaiters();
	}

	markTaskParked(taskId: string): void {
		this.controllerPausedTaskIds.add(taskId);
	}

	clearTaskParked(taskId: string): void {
		this.controllerPausedTaskIds.delete(taskId);
	}

	listControllerPausedTaskIds(): string[] {
		return [...this.controllerPausedTaskIds];
	}

	waitUntilResumed(taskId: string, signal?: AbortSignal | null): Promise<void> {
		if (!this.isPaused(taskId)) {
			return Promise.resolve();
		}
		if (signal?.aborted) {
			return Promise.reject(new Error("Task pause wait was aborted."));
		}
		return new Promise((resolve, reject) => {
			const waiter = {
				taskId,
				resolve,
				reject,
				signal: signal ?? null,
				abortListener: null as (() => void) | null,
			};
			waiter.abortListener = () => {
				this.waiters.delete(waiter);
				reject(new Error("Task pause wait was aborted."));
			};
			signal?.addEventListener("abort", waiter.abortListener, { once: true });
			this.waiters.add(waiter);
		});
	}

	private notifyWaiters(): void {
		for (const waiter of [...this.waiters]) {
			if (this.isPaused(waiter.taskId)) {
				continue;
			}
			this.waiters.delete(waiter);
			if (waiter.abortListener) {
				waiter.signal?.removeEventListener("abort", waiter.abortListener);
			}
			waiter.resolve();
		}
	}
}
