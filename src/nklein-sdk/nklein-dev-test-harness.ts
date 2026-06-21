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

function countsKey(counts: DevTestBoardCounts): string {
	return [counts.completed, counts.review, counts.planning, counts.inProgress, counts.backlog, counts.failed].join(
		":",
	);
}

function isComplete(counts: DevTestBoardCounts): boolean {
	return counts.review + counts.planning + counts.inProgress + counts.backlog + counts.failed === 0;
}

function readCounts(state: DevTestStateRead): DevTestBoardCounts {
	const base = state.board
		? countDevTestBoardColumns(state.board)
		: { completed: 0, review: 0, planning: 0, inProgress: 0, backlog: 0, failed: 0, trash: 0 };
	return { ...base, failed: state.failedCardCount ?? base.failed };
}

export async function runDevTestProject(
	options: RunDevTestProjectOptions,
	deps: DevTestHarnessDeps,
): Promise<DevTestProjectRunResult> {
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	const stablePolls = options.stablePollsUntilSettled ?? DEFAULT_STABLE_POLLS;

	const payload = buildDevTestSeedStartPayload(options);
	const start = await deps.startSeedTask(payload);

	const startedAt = deps.now();
	let polls = 0;
	let lastState: DevTestStateRead = { board: null, runtimeReachable: true };
	let lastKey: string | null = null;
	let unchangedPolls = 0;

	while (deps.now() - startedAt <= maxWaitMs) {
		const state = await deps.readState();
		polls += 1;
		lastState = state;
		const counts = readCounts(state);

		if (state.board && isComplete(counts)) {
			break;
		}
		// A vanished runtime ends the monitor immediately; the last persisted read is what we classify.
		if (!state.runtimeReachable) {
			break;
		}
		const key = countsKey(counts);
		if (key === lastKey) {
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

	const finalCounts = readCounts(lastState);
	const acceptancePassed = deps.runAcceptance ? await deps.runAcceptance() : null;
	const classification = classifyDevTestRun({
		counts: finalCounts,
		acceptancePassed,
		runtimeReachable: lastState.runtimeReachable,
	});

	return {
		started: start.ok,
		startMessage: start.message ?? null,
		classification,
		polls,
		runtimeReachable: lastState.runtimeReachable,
		finalCounts,
	};
}
