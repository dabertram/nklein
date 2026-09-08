/**
 * Decide whether a drive has STOPPED MOVING, from the same facts a watcher already polls.
 *
 * ── WHY ──
 * Live 2026-09-08: the agent filling the model seat of the HITL rig was killed by its own harness mid-drive
 * ("no progress for 600s"). Nothing downstream noticed. The batch driver was inside a 90-minute `--max-wait-ms`
 * window, and a 90-minute window is indistinguishable from a slow model right up until it expires — so a dead
 * endpoint bought ninety minutes of silence and then reported a timeout, with no hint that the model had gone away
 * at minute six. The deadline is the wrong instrument: it bounds the WHOLE drive, and what needs bounding is a
 * SILENCE inside it.
 *
 * The fingerprint is deliberately coarse — the counts and states a watcher already reads. Anything that moves the
 * board, starts or settles a session, or delivers a message changes it; nothing else needs to. A tick that changes
 * nothing at all, repeated past the threshold, is the only thing this reports, and it reports it as a fact about
 * OBSERVED progress, never as a diagnosis of the cause: an endpoint may be dead, wedged, or merely thinking for
 * longer than the threshold allows, and the caller (not this core) decides what a stall is worth.
 *
 * Pure so the threshold is testable without a live drive — the failure it guards against takes an hour to stage.
 */

export interface DriveProgressSample {
	/** Monotonic-ish observation time (ms). The caller's clock; only differences are used. */
	at: number;
	/** Everything observed this tick, in a stable order. Any change means the drive moved. */
	fingerprint: string;
}

export interface DriveStallState {
	/** The last fingerprint seen, and when it FIRST appeared (not when it was last re-seen). */
	readonly lastFingerprint: string | null;
	readonly unchangedSince: number;
}

export interface DriveStallDecision {
	readonly state: DriveStallState;
	/** True once the fingerprint has been unchanged for at least `stallMs`. */
	readonly stalled: boolean;
	/** How long the drive has shown no observable progress, in ms. */
	readonly silentMs: number;
}

export const EMPTY_DRIVE_STALL_STATE: DriveStallState = { lastFingerprint: null, unchangedSince: 0 };

/**
 * Fold one observation into the stall state.
 *
 * A CHANGED fingerprint resets the clock to this sample's time — progress is progress, however small. An unchanged
 * one leaves `unchangedSince` at the moment the current fingerprint first appeared, so the silence is measured from
 * when movement stopped rather than from the previous tick.
 */
export function observeDriveProgress(
	previous: DriveStallState,
	sample: DriveProgressSample,
	stallMs: number,
): DriveStallDecision {
	const changed = previous.lastFingerprint !== sample.fingerprint;
	const state: DriveStallState = changed
		? { lastFingerprint: sample.fingerprint, unchangedSince: sample.at }
		: previous;
	const silentMs = Math.max(0, sample.at - state.unchangedSince);
	// A non-positive threshold disables the watchdog rather than firing on the first identical tick: a caller that
	// passes 0 means "do not bound the silence", and turning that into an instant stall would be the opposite.
	return { state, stalled: stallMs > 0 && silentMs >= stallMs, silentMs };
}

/**
 * Build the fingerprint from a drive's per-lane observations. Sorted by lane label so a reordered poll — the map
 * iteration order of a fresh state object — is not mistaken for progress.
 */
export function fingerprintDriveLanes(
	lanes: readonly {
		label: string;
		cardCount: number;
		messageCount: number;
		sessionStates: Iterable<readonly [string, string]>;
	}[],
): string {
	return lanes
		.map((lane) => {
			const sessions = [...lane.sessionStates]
				.map(([taskId, state]) => `${taskId}=${state}`)
				.sort()
				.join(",");
			return `${lane.label}|cards=${lane.cardCount}|msgs=${lane.messageCount}|${sessions}`;
		})
		.sort()
		.join("\n");
}
