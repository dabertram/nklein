import type { RuntimeTaskNKleinSettings } from "../core/api-contract";
import {
	classifyDevTestRun,
	countDevTestBoardColumns,
	type DevTestBoardCounts,
	type DevTestBoardLike,
	type DevTestRunClassification,
} from "../core/dev-test-outcome";
import type { NKleinDevTestProjectScenario } from "./nklein-dev-test-project";

/**
 * Official dev-test harness (follow-up-6 §4.1, §3.4, §3.7).
 *
 * Previously, fresh-run harnesses were ad-hoc scripts that reimplemented UI behavior — and broke because they
 * sent the wrong `runtime.startTaskSession` payload or assumed the board exposed top-level `taskIds` instead of
 * per-column `cards`. This module centralizes (a) the exact UI-equivalent seed-card start payload and (b) the
 * monitor loop, which polls a board reader, tolerates the runtime going away (degrading to whatever the reader
 * can still provide), and ends with a single classified outcome from `dev-test-outcome.ts`.
 *
 * The orchestration takes its side effects as injected dependencies so it is unit-testable without a live
 * runtime, Docker, or a local model; the thin real wiring (tRPC client + persisted-state fallback reader) is
 * supplied by the caller.
 */

export interface DevTestSeedStartPayload {
	taskId: string;
	prompt: string;
	/** The UI sends `taskTitle`, not `title`, to `runtime.startTaskSession`. */
	taskTitle: string;
	startInPlanMode: boolean;
	baseRef: string;
	agentId: string;
	nkleinSettings?: RuntimeTaskNKleinSettings;
}

export interface BuildDevTestSeedStartPayloadOptions {
	scenario: NKleinDevTestProjectScenario;
	seedTaskId: string;
	baseRef: string;
	agentId?: string;
	nkleinSettings?: RuntimeTaskNKleinSettings;
	/** Decomposition seed cards plan first, so the default is plan mode. */
	startInPlanMode?: boolean;
}

export function buildDevTestSeedStartPayload(options: BuildDevTestSeedStartPayloadOptions): DevTestSeedStartPayload {
	return {
		taskId: options.seedTaskId,
		prompt: options.scenario.prompt,
		taskTitle: options.scenario.title,
		startInPlanMode: options.startInPlanMode ?? true,
		baseRef: options.baseRef,
		agentId: options.agentId ?? "nklein",
		...(options.nkleinSettings ? { nkleinSettings: options.nkleinSettings } : {}),
	};
}

/** A single read of project state, abstracting "ask the runtime, else read persisted board state". */
export interface DevTestStateRead {
	board: DevTestBoardLike | null;
	runtimeReachable: boolean;
	/** Optional count of failed sessions the column derivation cannot see. */
	failedCardCount?: number;
	/**
	 * Optional count of sessions doing in-flight LLM work right now (`running` + `queued`). When > 0 the run is NOT
	 * settled even if the board counts are unchanged — a model mid-turn (e.g. a slow decompose under Low Power) keeps the
	 * board static for minutes, which previously tripped the "unchanged ⇒ stagnant" settle and produced a FALSE stall.
	 */
	activeSessionCount?: number;
	/**
	 * Optional count of sessions parked FOR THE OPERATOR (`awaiting_review` + reason `attention` — an autonomy park or
	 * the §12 turn-loop guard's boundary question). Lets the classifier report `needs_attention` ("answer the question")
	 * instead of a generic `stagnant` (live-observed 2026-07-12).
	 */
	attentionCardCount?: number;
}

export interface DevTestHarnessDeps {
	startSeedTask(payload: DevTestSeedStartPayload): Promise<{ ok: boolean; message?: string }>;
	readState(): Promise<DevTestStateRead>;
	/** Optional acceptance-command runner; when omitted, acceptance is treated as "not run" (null). */
	runAcceptance?(): Promise<boolean>;
	sleep(ms: number): Promise<void>;
	now(): number;
}

export interface RunDevTestProjectOptions extends BuildDevTestSeedStartPayloadOptions {
	pollIntervalMs?: number;
	maxWaitMs?: number;
	/** Consecutive unchanged polls after which the run is considered settled (stalled), not just slow. */
	stablePollsUntilSettled?: number;
	/**
	 * Consecutive complete-looking polls (no session in flight) required before the run is accepted as completed.
	 * Guards the decompose-seed race where the parent reaches Completed before its children materialize. Default 2.
	 */
	completeConfirmPolls?: number;
	/**
	 * Consecutive UNREACHABLE polls required before the run ends as `runtime_down`. A saturated single-machine runtime
	 * can make one poll slow/time out without being down, so a single miss must not false-classify. Default 3.
	 */
	maxConsecutiveUnreachablePolls?: number;
}

export interface DevTestProjectRunResult {
	started: boolean;
	startMessage: string | null;
	classification: DevTestRunClassification;
	polls: number;
	runtimeReachable: boolean;
	finalCounts: DevTestBoardCounts;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 30 * 60_000;
const DEFAULT_STABLE_POLLS = 6;
// A board that momentarily LOOKS complete can be a transient window: a decompose seed reaches Completed a beat before
// its spawned child cards materialize on the board, so a single poll sees `completed>0` with nothing else counted yet.
// Breaking on that first poll reports a FALSE GREEN while the children then sit in review/in-progress (observed live,
// 2026-07-11: a smoke seed showed Completed while its lone child was still stuck in Review). Require the complete shape
// to hold for CONSECUTIVE polls with no session in flight before accepting it, so the pending children reset it.
const DEFAULT_COMPLETE_CONFIRM_POLLS = 2;
// Tolerate a short run of slow/timed-out polls (a model-saturated runtime) before declaring runtime_down.
const DEFAULT_MAX_CONSECUTIVE_UNREACHABLE = 3;

function countsKey(counts: DevTestBoardCounts): string {
	return [counts.completed, counts.review, counts.planning, counts.inProgress, counts.backlog, counts.failed].join(
		":",
	);
}

function isComplete(counts: DevTestBoardCounts): boolean {
	// Require at least one card to have actually reached Completed — otherwise an EMPTY board (e.g. before the seed card
	// has materialized at the first poll) trivially satisfies "no incomplete cards" and the monitor would break early and
	// report a false green. With this guard the monitor keeps polling until real work completes (or the run settles/times out).
	return (
		counts.completed > 0 &&
		counts.review + counts.planning + counts.ready + counts.inProgress + counts.backlog + counts.failed === 0
	);
}

function readCounts(state: DevTestStateRead): DevTestBoardCounts {
	const base = state.board
		? countDevTestBoardColumns(state.board)
		: { completed: 0, review: 0, planning: 0, ready: 0, inProgress: 0, backlog: 0, failed: 0, trash: 0 };
	return { ...base, failed: state.failedCardCount ?? base.failed };
}

export async function runDevTestProject(
	options: RunDevTestProjectOptions,
	deps: DevTestHarnessDeps,
): Promise<DevTestProjectRunResult> {
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	const stablePolls = options.stablePollsUntilSettled ?? DEFAULT_STABLE_POLLS;
	const completeConfirmPolls = Math.max(1, options.completeConfirmPolls ?? DEFAULT_COMPLETE_CONFIRM_POLLS);

	const payload = buildDevTestSeedStartPayload(options);
	const start = await deps.startSeedTask(payload);

	const startedAt = deps.now();
	let polls = 0;
	let lastState: DevTestStateRead = { board: null, runtimeReachable: true };
	// The last read that actually REACHED the runtime — classification (counts + reachability) uses this, so a transient
	// slow/failed poll under saturation doesn't blank the board or false-classify runtime_down.
	let lastReachableState: DevTestStateRead = lastState;
	let lastKey: string | null = null;
	let unchangedPolls = 0;
	let completeConfirmations = 0;
	// A busy (single-machine, model-saturated) runtime can make ONE poll slow/time out without being down — require a few
	// CONSECUTIVE misses before ending the run as unreachable (live-found 2026-07-14: a fresh dev-test against a
	// still-draining single-machine board saw a slow poll → false runtime_down while the runtime was demonstrably up).
	let consecutiveUnreachable = 0;
	const maxConsecutiveUnreachable = options.maxConsecutiveUnreachablePolls ?? DEFAULT_MAX_CONSECUTIVE_UNREACHABLE;

	while (deps.now() - startedAt <= maxWaitMs) {
		const state = await deps.readState();
		polls += 1;
		lastState = state;
		const counts = readCounts(state);

		// A session actively working (running/queued) means progress is in-flight even when the board count is static —
		// so do NOT accumulate toward "settled" while one is processing (the fix for the false-stagnant-on-a-slow-turn),
		// and do NOT accept a complete-looking board while a session could still be spawning children.
		const sessionActive = (state.activeSessionCount ?? 0) > 0;

		// Confirm completion over consecutive polls with no session in flight. A decompose seed reaches Completed a beat
		// before its spawned children appear, so a single complete-looking poll is a false green; requiring the shape to
		// persist lets the pending children (which then sit in review/in-progress) reset the count.
		if (state.board && isComplete(counts) && !sessionActive) {
			completeConfirmations += 1;
			if (completeConfirmations >= completeConfirmPolls) {
				break;
			}
		} else {
			completeConfirmations = 0;
		}
		// Tolerate transient unreachability under load: only a RUN of consecutive misses ends the monitor as down. A
		// reachable read resets the streak and becomes the state we classify from (so one slow poll can't blank the board).
		if (!state.runtimeReachable) {
			consecutiveUnreachable += 1;
			if (consecutiveUnreachable >= maxConsecutiveUnreachable) {
				break;
			}
			await deps.sleep(pollIntervalMs);
			continue;
		}
		consecutiveUnreachable = 0;
		lastReachableState = state;
		const key = countsKey(counts);
		if (key === lastKey && !sessionActive) {
			unchangedPolls += 1;
			if (unchangedPolls >= stablePolls) {
				break;
			}
		} else {
			unchangedPolls = 0;
			lastKey = key;
		}
		await deps.sleep(pollIntervalMs);
	}

	// Classify from the last read that REACHED the runtime, and treat it as down ONLY if we saw a genuine run of
	// consecutive misses — a transient slow poll under saturation is not runtime_down.
	const runtimeConfirmedReachable = consecutiveUnreachable < maxConsecutiveUnreachable;
	const finalCounts = readCounts(lastReachableState);
	const acceptancePassed = deps.runAcceptance ? await deps.runAcceptance() : null;
	const classification = classifyDevTestRun({
		counts: finalCounts,
		acceptancePassed,
		runtimeReachable: runtimeConfirmedReachable,
		...(typeof lastReachableState.attentionCardCount === "number"
			? { attentionCardCount: lastReachableState.attentionCardCount }
			: {}),
	});

	return {
		started: start.ok,
		startMessage: start.message ?? null,
		classification,
		polls,
		runtimeReachable: runtimeConfirmedReachable,
		finalCounts,
	};
}
