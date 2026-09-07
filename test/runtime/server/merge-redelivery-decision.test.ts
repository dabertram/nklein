import { describe, expect, it } from "vitest";
import {
	MERGE_REDELIVERY_MAX_PER_DAY,
	MERGE_REDELIVERY_MIN_GAP_MS,
	selectApprovedUnmergedRedelivery,
} from "../../../src/server/merge-redelivery-decision";
import type { MergeHistoryRecord } from "../../../src/state/merge-history-store";

const now = 1_788_640_000_000;
const record = (taskId: string, recordedAt: number, ok: boolean, conflicted = ["src/a.ts"]): MergeHistoryRecord => ({
	schemaVersion: 1,
	recordedAt,
	workspacePath: "/ws",
	taskId,
	ok,
	mergedTaskIds: ok ? [taskId] : [],
	skippedTaskIds: [],
	conflictedPaths: ok ? [] : conflicted,
	reason: ok ? null : "conflict",
});
const approved = (id: string) => ({ id, review: { status: "approved" as const, round: 1 } }) as never;

describe("selectApprovedUnmergedRedelivery (watchdog re-runs a failed delivery merge without a restart)", () => {
	it("picks an approved card whose newest merge attempt failed at least the gap ago and nothing of it is live", () => {
		const decision = selectApprovedUnmergedRedelivery({
			reviewCards: [approved("s03")],
			history: [record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1, false)],
			activeTaskIds: new Set(),
			handledThisTick: new Set(),
			now,
		});
		expect(decision).toMatchObject({
			taskId: "s03",
			attemptsInWindow: 1,
			reason: "last merge conflicted in 1 file(s)",
		});
	});

	it("waits while a merge session is live, the gap has not passed, the card was handled, or the review is not approved", () => {
		const history = [record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1, false)];
		const base = { reviewCards: [approved("s03")], history, handledThisTick: new Set<string>(), now };
		expect(selectApprovedUnmergedRedelivery({ ...base, activeTaskIds: new Set(["s03::merge"]) })).toBeNull();
		expect(
			selectApprovedUnmergedRedelivery({ ...base, activeTaskIds: new Set(), handledThisTick: new Set(["s03"]) }),
		).toBeNull();
		expect(
			selectApprovedUnmergedRedelivery({
				...base,
				activeTaskIds: new Set(),
				history: [record("s03", now - 1_000, false)],
			}),
		).toBeNull();
		expect(
			selectApprovedUnmergedRedelivery({
				...base,
				activeTaskIds: new Set(),
				reviewCards: [{ id: "s03", review: { status: "changes_requested", round: 1 } } as never],
			}),
		).toBeNull();
	});

	it("honours the gap for a re-run the watchdog already started even when it left no record (replay 2026-09-07)", () => {
		const history = [record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1, false)];
		const base = {
			reviewCards: [approved("s03")],
			history,
			activeTaskIds: new Set<string>(),
			handledThisTick: new Set<string>(),
			now,
		};
		expect(
			selectApprovedUnmergedRedelivery({ ...base, recentAttempts: new Map([["s03", now - 30_000]]) }),
		).toBeNull();
		expect(
			selectApprovedUnmergedRedelivery({
				...base,
				recentAttempts: new Map([["s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1]]),
			}),
		).toMatchObject({ taskId: "s03" });
	});

	it("leaves cards whose last merge succeeded or that were never attempted, and caps attempts per day", () => {
		expect(
			selectApprovedUnmergedRedelivery({
				reviewCards: [approved("done"), approved("fresh")],
				history: [record("done", now - 3_600_000, true)],
				activeTaskIds: new Set(),
				handledThisTick: new Set(),
				now,
			}),
		).toBeNull();
		const capped = Array.from({ length: MERGE_REDELIVERY_MAX_PER_DAY }, (_, index) =>
			record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1 - index * 60_000, false),
		);
		expect(
			selectApprovedUnmergedRedelivery({
				reviewCards: [approved("s03")],
				history: capped,
				activeTaskIds: new Set(),
				handledThisTick: new Set(),
				now,
			}),
		).toBeNull();
	});
});
