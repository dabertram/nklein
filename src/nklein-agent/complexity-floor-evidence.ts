/**
 * F3.41 (c) — the impure half of the calibration loop: read the three streams a measured complexity floor rests on
 * and hand the pure core their join. Called only on a fleet-aware DECOMPOSE start (rare), so the reads are cheap
 * relative to what follows.
 *
 *   review_capacity_evidence  → the card's judgment (delivered / bounced / parked), keyed by task id
 *   plan_sizing_verdict       → the card's declared complexity at plan apply, keyed by task id
 *   the workspace attempt ledger → which WORKER model attempted the card (newest attempt wins)
 */
import {
	type CalibratedComplexityFloor,
	type CardOutcomeRecord,
	calibrateComplexityFloors,
	joinComplexityOutcomeRows,
	type WorkerAttemptRecord,
} from "../core/complexity-floor-calibration";
import { readAgentLedger } from "../state/agent-attempt-ledger-store";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";
import { hashWorkspacePathForLedger } from "./nklein-ledger-attempt";

export interface ReadCalibratedComplexityFloorsInput {
	readonly workspacePath: string;
	/** Served model id → fleet class key (registry key). Unmapped ids key by themselves. */
	readonly classKeyByModelId: ReadonlyMap<string, string>;
}

export interface CalibratedComplexityFloorsResult {
	readonly floors: ReadonlyMap<string, CalibratedComplexityFloor>;
	/** Judged cards that joined all three streams — the evidence base, reported beside every verdict. */
	readonly joinedRows: number;
}

function recordedAtMs(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	const parsed = Date.parse(String(value ?? ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

export async function readCalibratedComplexityFloors(
	input: ReadCalibratedComplexityFloorsInput,
): Promise<CalibratedComplexityFloorsResult> {
	const [capacityRecords, verdictRecords, ledger] = await Promise.all([
		readSelfObservationEvents({ category: "review_capacity_evidence", limit: 2_000 }).catch(() => []),
		readSelfObservationEvents({ category: "plan_sizing_verdict", limit: 2_000 }).catch(() => []),
		readAgentLedger({ workspacePathHash: hashWorkspacePathForLedger(input.workspacePath) }).catch(() => []),
	]);
	const outcomes: CardOutcomeRecord[] = capacityRecords.flatMap((record) => {
		const taskId = typeof record.taskId === "string" ? record.taskId : null;
		const outcome = (record.metadata as { outcome?: unknown } | undefined)?.outcome;
		return taskId && typeof outcome === "string" ? [{ taskId, outcome }] : [];
	});
	const complexityByTaskId = new Map<string, number>();
	for (const record of verdictRecords) {
		const taskId = typeof record.taskId === "string" ? record.taskId : null;
		const complexity = Number((record.metadata as { plannedComplexity?: unknown } | undefined)?.plannedComplexity);
		if (taskId && !complexityByTaskId.has(taskId) && Number.isFinite(complexity)) {
			complexityByTaskId.set(taskId, complexity); // newest first: the first row seen is the latest apply
		}
	}
	const attempts: WorkerAttemptRecord[] = ledger.flatMap((event) =>
		event.kind === "attempt" && typeof event.taskId === "string" && typeof event.modelId === "string"
			? [{ taskId: event.taskId, modelId: event.modelId, recordedAt: recordedAtMs(event.recordedAt) }]
			: [],
	);
	const rows = joinComplexityOutcomeRows({
		outcomes,
		attempts,
		complexityByTaskId,
		classKeyByModelId: input.classKeyByModelId,
	});
	return { floors: calibrateComplexityFloors({ rows }), joinedRows: rows.length };
}
