/**
 * N5b — the drained-state COLLECTOR: turn a finished nightly drain into the `DrainedState` N5 judges. PURE core.
 *
 * N5 does the judging and does it carefully. This module does the gathering, and gathering is where that care can
 * be quietly undone.
 *
 * ── THE FAILURE THIS MODULE IS SHAPED TO MAKE IMPOSSIBLE ──
 * N5 reports a signal it was not watching as `indeterminate`, never as a pass. That status only means something if
 * `watchedSignals` is TRUE. The easy, plausible, catastrophic implementation is:
 *
 *     watchedSignals = new Set([...pack.mustFire, ...pack.mustStayQuiet])   // ← NEVER
 *
 * That reads as "we watched everything the pack cares about" and is really "we asserted that we watched." It turns
 * every `indeterminate` into a false pass and **un-builds N5's third status from the outside — without editing a
 * line of N5 or failing any of its 12 tests.**
 *
 * A guard test could catch that. Structure is better: **this module never receives the pack.** `collectDrainedState`
 * has no parameter a pack could be passed through, so the offending line cannot be written here at all. The
 * dependency arrow points one way — the collector reports what happened, the pack decides what that means, and the
 * collector cannot see the answer sheet. Prevention by construction beats detection by test, because a test only
 * catches the version of the mistake it was written for.
 *
 * So `watchedSignals` is derived from ONE source: subscriptions the harness demonstrably registered before the
 * drain. A signal is watched because something was listening for it, never because someone wanted it to have been.
 */

import type { DrainedState } from "./nightly-invariant-pack";

/**
 * A signal the harness registered a listener for BEFORE the drain started. Carrying `registeredAt` is not
 * decoration: a subscription registered after the run cannot have observed it, and counting one would reintroduce
 * the exact lie this module is built to prevent, just later in the timeline.
 */
export interface SignalSubscription {
	readonly signal: string;
	/** Milliseconds since epoch when the listener was registered. */
	readonly registeredAt: number;
}

export interface DrainSignalEvent {
	readonly signal: string;
	readonly emittedAt: number;
}

export interface CardTerminalState {
	readonly cardId: string;
	readonly lane: string;
}

export interface TeardownReport {
	readonly orphanSessions: number;
	readonly orphanWorktrees: number;
	readonly orphanLeases: number;
}

export interface CollectorInput {
	/** When the drain began. Subscriptions registered after this cannot have watched it. */
	readonly drainStartedAt: number;
	readonly subscriptions: readonly SignalSubscription[];
	readonly events: readonly DrainSignalEvent[];
	readonly terminalCards: readonly CardTerminalState[];
	readonly unmatchedAimockRequests: number;
	readonly teardown: TeardownReport;
}

export interface CollectionResult {
	readonly state: DrainedState;
	/**
	 * Signals that FIRED while nothing was watching for them. Not an error — the drain is allowed to emit more than
	 * the harness subscribes to — but worth surfacing, because it names coverage the nightly suite is missing.
	 */
	readonly firedButUnwatched: readonly string[];
	/** Subscriptions registered too late to have observed the drain. Excluded from `watchedSignals`, and named. */
	readonly lateSubscriptions: readonly string[];
	readonly summary: string;
}

/**
 * Collect drained state from what the harness actually observed.
 *
 * Note the signature: there is no pack parameter, and that absence is the design (see the docblock). This function
 * cannot know which signals the assertions care about, so it cannot be tempted to claim it watched them.
 */
export function collectDrainedState(input: CollectorInput): CollectionResult {
	const watched = new Set<string>();
	const lateSubscriptions: string[] = [];

	for (const subscription of input.subscriptions) {
		// A listener registered after the drain started did not watch the whole drain. Counting it would mean
		// reporting "watched" for a window we were absent from — a smaller version of the same lie.
		if (subscription.registeredAt > input.drainStartedAt) {
			lateSubscriptions.push(subscription.signal);
			continue;
		}
		watched.add(subscription.signal);
	}

	const fired = new Set<string>();
	for (const event of input.events) {
		fired.add(event.signal);
	}

	const firedButUnwatched = [...fired].filter((signal) => !watched.has(signal)).sort();

	const terminalLanesByCard = new Map<string, string>();
	for (const card of input.terminalCards) {
		terminalLanesByCard.set(card.cardId, card.lane);
	}

	const state: DrainedState = {
		terminalLanesByCard,
		firedSignals: fired,
		watchedSignals: watched,
		unmatchedAimockRequests: input.unmatchedAimockRequests,
		orphanSessions: input.teardown.orphanSessions,
		orphanWorktrees: input.teardown.orphanWorktrees,
		orphanLeases: input.teardown.orphanLeases,
	};

	const notes: string[] = [
		`${terminalLanesByCard.size} card(s), ${watched.size} signal(s) watched, ${fired.size} fired`,
	];
	if (lateSubscriptions.length > 0) {
		notes.push(
			`${lateSubscriptions.length} subscription(s) registered AFTER the drain started and are not counted as watched: ${lateSubscriptions.sort().join(", ")}`,
		);
	}
	if (firedButUnwatched.length > 0) {
		notes.push(`fired with nothing watching (coverage gap): ${firedButUnwatched.join(", ")}`);
	}

	return {
		state,
		firedButUnwatched,
		lateSubscriptions: lateSubscriptions.sort(),
		summary: notes.join("; "),
	};
}
