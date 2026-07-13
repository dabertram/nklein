import type { BackgroundEvalLease } from "./background-eval-runner.js";

/**
 * F1.35 (§5.AI) — rail CONTROLS + STATUS, the pure core: an enable/pause control reducer that tells the host
 * exactly when to start/stop the F1.31 service, a bounded recent-outcome log, a status-snapshot composer over
 * the service's own status shape, and a change-only publisher so the surface is PUSH-based (the runtime notifies
 * on ticks/control changes and publishes only when the snapshot actually changed — no tight poll loop anywhere).
 * Everything effectful (the service, the websocket hub, config persistence) is the F1.31b wiring's job.
 */

export interface RailControlState {
	/** The operator's on/off switch (persisted intent). */
	enabled: boolean;
	/** A temporary hold that keeps `enabled` intact (resume returns to the enabled state). */
	paused: boolean;
	pauseReason: string | null;
}

export const INITIAL_RAIL_CONTROL_STATE: RailControlState = { enabled: false, paused: false, pauseReason: null };

export type RailControlCommand =
	| { kind: "enable" }
	| { kind: "disable" }
	| { kind: "pause"; reason?: string | null }
	| { kind: "resume" };

/** What the host must do to the F1.31 service after a control transition. */
export type RailServiceAction = "start" | "stop" | "none";

export interface RailControlTransition {
	state: RailControlState;
	action: RailServiceAction;
}

function isRailActive(state: RailControlState): boolean {
	return state.enabled && !state.paused;
}

/**
 * Apply one control command. Pure + idempotent: re-applying a command the state already reflects returns the
 * same state with action `none`, so a double-clicked button or a replayed command never bounces the service.
 */
export function applyRailControlCommand(state: RailControlState, command: RailControlCommand): RailControlTransition {
	let next: RailControlState;
	switch (command.kind) {
		case "enable":
			next = { ...state, enabled: true };
			break;
		case "disable":
			next = { enabled: false, paused: false, pauseReason: null };
			break;
		case "pause":
			next = { ...state, paused: true, pauseReason: command.reason?.trim() || null };
			break;
		case "resume":
			next = { ...state, paused: false, pauseReason: null };
			break;
	}
	const wasActive = isRailActive(state);
	const nowActive = isRailActive(next);
	const action: RailServiceAction = nowActive === wasActive ? "none" : nowActive ? "start" : "stop";
	return { state: next, action };
}

/** One tick's outcome as kept in the recent-outcome log (newest first). */
export interface RailTickOutcomeSummary {
	at: number;
	reason: string;
	/** The project a run was admitted for this tick, or null when nothing started. */
	admittedProject: string | null;
	reapedCount: number;
}

export interface RailOutcomeLog {
	record: (outcome: RailTickOutcomeSummary) => void;
	/** Newest first, at most `capacity` entries. */
	list: () => readonly RailTickOutcomeSummary[];
}

/** Bounded in-memory log of recent tick outcomes — the "latest outcomes" half of the status surface. */
export function createRailOutcomeLog(capacity = 20): RailOutcomeLog {
	const boundedCapacity = Math.max(1, Math.trunc(capacity));
	const outcomes: RailTickOutcomeSummary[] = [];
	return {
		record(outcome) {
			outcomes.unshift({ ...outcome });
			if (outcomes.length > boundedCapacity) {
				outcomes.length = boundedCapacity;
			}
		},
		list() {
			return [...outcomes];
		},
	};
}

export type RailRunState = "disabled" | "paused" | "active" | "idle";

/** The F1.35 status surface: controls + cadence/caps + live leases + latest outcomes + cleanup errors. */
export interface RailStatusSnapshot {
	state: RailRunState;
	pauseReason: string | null;
	/** Tick cadence in ms (the "cadence" control). */
	cadenceMs: number;
	/** Max concurrent background evals (the "background cap" control). */
	maxConcurrentEvals: number;
	/** The long-timeout profile rail runs use, when configured (surfaced verbatim). */
	timeoutProfile: string | null;
	activeLeases: readonly BackgroundEvalLease[];
	lastTick: { at: number; reason: string; reapedCount: number } | null;
	lastTickError: string | null;
	cleanupErrors: readonly string[];
	recentOutcomes: readonly RailTickOutcomeSummary[];
}

export interface ComposeRailStatusInput {
	control: RailControlState;
	cadenceMs: number;
	maxConcurrentEvals: number;
	timeoutProfile?: string | null;
	/** The F1.31 service's status (shape-compatible subset of `BackgroundEvalServiceStatus`). */
	service: {
		activeLeases: readonly BackgroundEvalLease[];
		lastTick: { at: number; reason: string; reapedCount: number } | null;
		lastTickError: string | null;
		cleanupErrors: readonly string[];
	};
	recentOutcomes: readonly RailTickOutcomeSummary[];
}

export function composeRailStatus(input: ComposeRailStatusInput): RailStatusSnapshot {
	const state: RailRunState = !input.control.enabled
		? "disabled"
		: input.control.paused
			? "paused"
			: input.service.activeLeases.length > 0
				? "active"
				: "idle";
	return {
		state,
		pauseReason: input.control.pauseReason,
		cadenceMs: input.cadenceMs,
		maxConcurrentEvals: input.maxConcurrentEvals,
		timeoutProfile: input.timeoutProfile ?? null,
		activeLeases: input.service.activeLeases.map((lease) => ({ ...lease })),
		lastTick: input.service.lastTick ? { ...input.service.lastTick } : null,
		lastTickError: input.service.lastTickError,
		cleanupErrors: [...input.service.cleanupErrors],
		recentOutcomes: input.recentOutcomes.map((outcome) => ({ ...outcome })),
	};
}

export interface RailStatusPublisher {
	/** Recompose and publish IF the snapshot changed since the last publish. Returns whether a publish happened. */
	notify: () => boolean;
}

/**
 * Change-only push publisher: the host calls `notify()` on every tick / control change / cleanup, and the
 * snapshot goes out ONLY when it differs from the last published one — subscribers get events, never a poll loop,
 * and identical ticks (e.g. repeated `yield_to_interactive` with unchanged timestamps) stay silent.
 */
export function createRailStatusPublisher(deps: {
	compose: () => RailStatusSnapshot;
	publish: (snapshot: RailStatusSnapshot) => void;
}): RailStatusPublisher {
	let lastPublished: string | null = null;
	return {
		notify() {
			const snapshot = deps.compose();
			const serialized = JSON.stringify(snapshot);
			if (serialized === lastPublished) {
				return false;
			}
			lastPublished = serialized;
			deps.publish(snapshot);
			return true;
		},
	};
}
