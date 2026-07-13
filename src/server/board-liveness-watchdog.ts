export type BoardLivenessWatchdogSnapshot<T> =
	| { status: "ok"; value: T }
	| { status: "scope_mismatch"; reason: string }
	| { status: "skipped"; reason: string };

export type BoardLivenessWatchdogTickStage =
	| "entered"
	| "snapshot_loaded"
	| "snapshot_timeout"
	| "scope_mismatch"
	| "skipped"
	| "completed"
	| "failed";

export interface BoardLivenessWatchdogTickEvent {
	tick: number;
	stage: BoardLivenessWatchdogTickStage;
	elapsedMs: number;
	reason?: string;
}

export interface BoardLivenessWatchdogHandle {
	runNow(): void;
	dispose(): void;
}

export interface StartBoardLivenessWatchdogOptions<T> {
	intervalMs: number;
	snapshotTimeoutMs: number;
	loadSnapshot: () => Promise<BoardLivenessWatchdogSnapshot<T>>;
	handleSnapshot: (snapshot: T) => Promise<void>;
	onTickEvent?: (event: BoardLivenessWatchdogTickEvent) => void;
	now?: () => number;
}

class BoardLivenessWatchdogSnapshotTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Board-liveness watchdog snapshot load exceeded ${timeoutMs}ms.`);
		this.name = "BoardLivenessWatchdogSnapshotTimeoutError";
	}
}

async function withSnapshotTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new BoardLivenessWatchdogSnapshotTimeoutError(timeoutMs)), timeoutMs);
		timeout.unref?.();
	});
	try {
		return await Promise.race([operation, timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

/**
 * Run the board-liveness watchdog on a fixed cadence without allowing one hung snapshot read to consume every future
 * tick. Each tick is independently bounded before the effectful rescue handler starts, and announces entry before its
 * first await so telemetry distinguishes an interval that never fired from a state/index/lock read that did not settle.
 */
export function startBoardLivenessWatchdog<T>(
	options: StartBoardLivenessWatchdogOptions<T>,
): BoardLivenessWatchdogHandle {
	const intervalMs = Math.max(1, Math.trunc(options.intervalMs));
	const snapshotTimeoutMs = Math.max(1, Math.trunc(options.snapshotTimeoutMs));
	const now = options.now ?? Date.now;
	let disposed = false;
	let tick = 0;

	const emit = (event: BoardLivenessWatchdogTickEvent): void => {
		try {
			options.onTickEvent?.(event);
		} catch {
			// Observability must never become a new watchdog failure mode.
		}
	};

	const runNow = (): void => {
		if (disposed) {
			return;
		}
		const currentTick = ++tick;
		const startedAt = now();
		emit({ tick: currentTick, stage: "entered", elapsedMs: 0 });
		void (async () => {
			let snapshot: BoardLivenessWatchdogSnapshot<T>;
			try {
				snapshot = await withSnapshotTimeout(options.loadSnapshot(), snapshotTimeoutMs);
			} catch (error) {
				const elapsedMs = Math.max(0, now() - startedAt);
				if (error instanceof BoardLivenessWatchdogSnapshotTimeoutError) {
					emit({ tick: currentTick, stage: "snapshot_timeout", elapsedMs, reason: error.message });
					return;
				}
				emit({
					tick: currentTick,
					stage: "failed",
					elapsedMs,
					reason: error instanceof Error ? error.message : String(error),
				});
				return;
			}
			if (disposed) {
				return;
			}

			const loadedAt = now();
			emit({ tick: currentTick, stage: "snapshot_loaded", elapsedMs: Math.max(0, loadedAt - startedAt) });
			if (snapshot.status === "scope_mismatch") {
				emit({
					tick: currentTick,
					stage: "scope_mismatch",
					elapsedMs: Math.max(0, now() - startedAt),
					reason: snapshot.reason,
				});
				return;
			}
			if (snapshot.status === "skipped") {
				emit({
					tick: currentTick,
					stage: "skipped",
					elapsedMs: Math.max(0, now() - startedAt),
					reason: snapshot.reason,
				});
				return;
			}

			try {
				if (disposed) {
					return;
				}
				await options.handleSnapshot(snapshot.value);
				if (disposed) {
					return;
				}
				emit({ tick: currentTick, stage: "completed", elapsedMs: Math.max(0, now() - startedAt) });
			} catch (error) {
				emit({
					tick: currentTick,
					stage: "failed",
					elapsedMs: Math.max(0, now() - startedAt),
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	};

	const timer = setInterval(runNow, intervalMs);
	timer.unref?.();
	return {
		runNow,
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			clearInterval(timer);
		},
	};
}
