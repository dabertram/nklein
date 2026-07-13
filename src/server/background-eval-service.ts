import {
	type BackgroundEvalLease,
	type BackgroundEvalRunnerDeps,
	type BackgroundEvalTickOutcome,
	createBackgroundEvalRunner,
} from "../core/background-eval-runner.js";

/**
 * F1.31 (§5.AI) — the PRODUCTION background-eval service: the thin durable driver the runtime hosts around the pure
 * runner core. The core owns admission/reaping/checkpointing per tick; this service owns everything a long-lived
 * process needs on top:
 *   - a timer loop with SERIALIZED ticks (a slow tick is skipped-over, never overlapped or queued into a backlog);
 *   - startup recovery (`recover()` restores the lease checkpoint BEFORE the first tick, so a restart reaps its
 *     predecessor's runs instead of forgetting them);
 *   - throwaway-project cleanup on EVERY exit path: each reaped lease (completed / expired / recovered-dead) and,
 *     on shutdown, every still-held lease is handed to `cleanupProject` — errors are COLLECTED into the status,
 *     never thrown, so one stuck sandbox can't wedge the runtime's shutdown;
 *   - a status snapshot (running, leases, last tick, cleanup errors) for the F1.35 controls/status surface.
 * Every effect stays injected (the runner deps + `cleanupProject`), so the full lifecycle is unit-testable; the
 * runtime supplies real deps and the opt-in flag at its wiring site.
 */

export type BackgroundEvalCleanupCause = "reaped" | "shutdown";

export interface BackgroundEvalServiceDeps {
	runner: BackgroundEvalRunnerDeps;
	tickIntervalMs: number;
	/** Delete the throwaway project/workspace a lease ran in. Called for every reaped lease and on shutdown. */
	cleanupProject: (lease: BackgroundEvalLease, cause: BackgroundEvalCleanupCause) => Promise<void>;
	/** Optional observability hook — called after every completed tick. */
	onTick?: (outcome: BackgroundEvalTickOutcome) => void;
}

export interface BackgroundEvalServiceStatus {
	running: boolean;
	activeLeases: readonly BackgroundEvalLease[];
	lastTick: { at: number; reason: BackgroundEvalTickOutcome["reason"]; reapedCount: number } | null;
	lastTickError: string | null;
	/** Most recent cleanup failures (bounded); empty when every throwaway project was removed cleanly. */
	cleanupErrors: readonly string[];
}

export interface BackgroundEvalService {
	/** Recover the lease checkpoint, then begin interval ticking. Idempotent while running. */
	start: () => Promise<void>;
	/** Halt the timer, drain any in-flight tick, force-stop + clean every held lease, empty the checkpoint. Idempotent. */
	stop: () => Promise<void>;
	/** Run one serialized tick immediately (skipped with null if one is already in flight). */
	tickNow: () => Promise<BackgroundEvalTickOutcome | null>;
	getStatus: () => BackgroundEvalServiceStatus;
}

const MAX_RETAINED_CLEANUP_ERRORS = 20;

export function createBackgroundEvalService(deps: BackgroundEvalServiceDeps): BackgroundEvalService {
	const runner = createBackgroundEvalRunner(deps.runner);
	let timer: ReturnType<typeof setInterval> | null = null;
	let started = false;
	let ticking: Promise<BackgroundEvalTickOutcome | null> | null = null;
	let lastTick: BackgroundEvalServiceStatus["lastTick"] = null;
	let lastTickError: string | null = null;
	const cleanupErrors: string[] = [];

	const recordCleanupError = (lease: BackgroundEvalLease, cause: BackgroundEvalCleanupCause, error: unknown): void => {
		const message = error instanceof Error ? error.message : String(error);
		cleanupErrors.push(`${cause} ${lease.project} (${lease.runId}): ${message}`);
		if (cleanupErrors.length > MAX_RETAINED_CLEANUP_ERRORS) {
			cleanupErrors.splice(0, cleanupErrors.length - MAX_RETAINED_CLEANUP_ERRORS);
		}
	};

	const cleanupLease = async (lease: BackgroundEvalLease, cause: BackgroundEvalCleanupCause): Promise<void> => {
		try {
			await deps.cleanupProject(lease, cause);
		} catch (error) {
			recordCleanupError(lease, cause, error);
		}
	};

	const runTick = async (): Promise<BackgroundEvalTickOutcome | null> => {
		try {
			const outcome = await runner.tick();
			lastTick = { at: deps.runner.now(), reason: outcome.reason, reapedCount: outcome.reaped.length };
			lastTickError = null;
			for (const lease of outcome.reaped) {
				await cleanupLease(lease, "reaped");
			}
			deps.onTick?.(outcome);
			return outcome;
		} catch (error) {
			lastTickError = error instanceof Error ? error.message : String(error);
			return null;
		}
	};

	const tickSerialized = async (): Promise<BackgroundEvalTickOutcome | null> => {
		if (ticking) {
			return null; // a tick is in flight — skip, the next interval catches up
		}
		const inFlight = runTick().finally(() => {
			ticking = null;
		});
		ticking = inFlight;
		return inFlight;
	};

	return {
		async start(): Promise<void> {
			if (started) {
				return;
			}
			started = true;
			await runner.recover();
			timer = setInterval(() => {
				void tickSerialized();
			}, deps.tickIntervalMs);
			timer.unref?.();
		},

		async stop(): Promise<void> {
			if (!started) {
				return;
			}
			started = false;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			if (ticking) {
				await ticking; // drain the in-flight tick before tearing leases down
			}
			for (const lease of runner.getLeases()) {
				try {
					await deps.runner.stopRun(lease);
				} catch (error) {
					recordCleanupError(lease, "shutdown", error);
				}
				await cleanupLease(lease, "shutdown");
			}
			try {
				await deps.runner.saveCheckpoint([]);
				await runner.recover(); // reload the emptied checkpoint so the lease set reads as torn down
			} catch (error) {
				lastTickError = error instanceof Error ? error.message : String(error);
			}
		},

		tickNow(): Promise<BackgroundEvalTickOutcome | null> {
			return tickSerialized();
		},

		getStatus(): BackgroundEvalServiceStatus {
			return {
				running: started,
				activeLeases: runner.getLeases(),
				lastTick,
				lastTickError,
				cleanupErrors: [...cleanupErrors],
			};
		},
	};
}
