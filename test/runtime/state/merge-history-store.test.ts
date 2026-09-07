import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectApprovedUnmergedRedelivery } from "../../../src/server/merge-redelivery-decision";
import {
	buildDeliveryGateFailureRecord,
	buildMergeHistoryRecord,
	readMergeHistory,
	recordDeliveryGateFailure,
	recordMergeHistory,
} from "../../../src/state/merge-history-store";
import type { TaskWorktreeAutoMergeResult } from "../../../src/workspace/task-worktree-auto-merge";

function okResult(): TaskWorktreeAutoMergeResult {
	return { ok: true, steps: [], mergedTaskIds: ["a", "b"], skippedTaskIds: ["c"] };
}

function conflictResult(): TaskWorktreeAutoMergeResult {
	return {
		ok: false,
		steps: [],
		mergedTaskIds: [],
		skippedTaskIds: [],
		conflict: {
			type: "conflict",
			taskId: "x",
			headCommit: "deadbeef",
			conflictedPaths: ["src/a.ts"],
			message: "merge conflict",
		},
	};
}

describe("merge-history-store", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-merge-history-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("builds a record from a successful and a conflicting merge result", () => {
		expect(
			buildMergeHistoryRecord({ workspacePath: "/repo", taskId: "t1", result: okResult(), recordedAt: 5 }),
		).toMatchObject({
			ok: true,
			mergedTaskIds: ["a", "b"],
			skippedTaskIds: ["c"],
			conflictedPaths: [],
			reason: null,
		});
		expect(
			buildMergeHistoryRecord({ workspacePath: "/repo", taskId: "t2", result: conflictResult(), recordedAt: 6 }),
		).toMatchObject({ ok: false, conflictedPaths: ["src/a.ts"], reason: "merge conflict" });
	});

	it("appends and reads back merge history newest-first, scoped by workspace", async () => {
		await recordMergeHistory(
			{ workspacePath: "/repo", taskId: "t1", result: okResult(), recordedAt: 10 },
			{ rootDir },
		);
		await recordMergeHistory(
			{ workspacePath: "/repo", taskId: "t2", result: conflictResult(), recordedAt: 20 },
			{ rootDir },
		);
		await recordMergeHistory(
			{ workspacePath: "/other", taskId: "t3", result: okResult(), recordedAt: 30 },
			{ rootDir },
		);

		const repo = await readMergeHistory({ workspacePath: "/repo", rootDir });
		expect(repo.map((record) => record.taskId)).toEqual(["t2", "t1"]);
		expect(repo[0]?.ok).toBe(false);

		const other = await readMergeHistory({ workspacePath: "/other", rootDir });
		expect(other).toHaveLength(1);
		expect(await readMergeHistory({ workspacePath: "/missing", rootDir })).toEqual([]);
	});

	it("records a delivery-gate failure as a failed delivery attempt that the watchdog redelivery picks up (HITL 2026-09-07 s63/s77)", async () => {
		expect(
			buildDeliveryGateFailureRecord({
				workspacePath: "/repo",
				taskId: "s77",
				reason: "  delivery gate: npm run typecheck failed (exit 2)  ",
				recordedAt: 7,
			}),
		).toEqual({
			schemaVersion: 1,
			recordedAt: 7,
			workspacePath: "/repo",
			taskId: "s77",
			ok: false,
			mergedTaskIds: [],
			skippedTaskIds: [],
			conflictedPaths: [],
			reason: "delivery gate: npm run typecheck failed (exit 2)",
		});
		expect(buildDeliveryGateFailureRecord({ workspacePath: null, taskId: "x", reason: " " }).reason).toBe(
			"delivery gate failed on the merged tree",
		);
		const now = 20 * 60_000;
		await recordDeliveryGateFailure(
			{
				workspacePath: "/repo",
				taskId: "s77",
				reason: "delivery gate: typecheck failed",
				recordedAt: now - 11 * 60_000,
			},
			{ rootDir },
		);
		const history = await readMergeHistory({ workspacePath: "/repo", rootDir });
		expect(history).toHaveLength(1);
		// Before this record an approved-but-held card was invisible to the redelivery ("never attempted"): now it
		// qualifies after the gap, so the gate re-runs on the current base without an operator.
		expect(
			selectApprovedUnmergedRedelivery({
				reviewCards: [{ id: "s77", review: { status: "approved", round: 1 } } as never],
				history,
				activeTaskIds: new Set(),
				handledThisTick: new Set(),
				now,
			}),
		).toMatchObject({ taskId: "s77", reason: "delivery gate: typecheck failed" });
	});
});
