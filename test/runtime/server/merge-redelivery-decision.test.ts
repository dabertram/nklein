import { describe, expect, it } from "vitest";
import {
	buildApprovedUnmergedCapHoldObservation,
	classifyApprovedUnmergedCard,
	classifyApprovedUnmergedCards,
	MERGE_REDELIVERY_MAX_PER_DAY,
	MERGE_REDELIVERY_MIN_GAP_MS,
	MERGE_REDELIVERY_WINDOW_MS,
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

describe("classifyApprovedUnmergedCard (every leg of the redelivery rules is a NAMED outcome — P0.RECONCILE-SKIP)", () => {
	const failedGapAgo = () => record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1, false);
	const base = {
		card: approved("s03"),
		history: [failedGapAgo()],
		activeTaskIds: new Set<string>(),
		handledThisTick: new Set<string>(),
		now,
	};

	it("names the rule that stops a redelivery, in the watchdog's check order", () => {
		expect(
			classifyApprovedUnmergedCard({
				...base,
				card: { id: "s03", review: { status: "changes_requested", round: 1 } } as never,
			}),
		).toEqual({ kind: "not_approved", taskId: "s03" });
		expect(classifyApprovedUnmergedCard({ ...base, handledThisTick: new Set(["s03"]) })).toEqual({
			kind: "handled_this_tick",
			taskId: "s03",
		});
		expect(classifyApprovedUnmergedCard({ ...base, recentAttemptAt: now - 30_000 })).toEqual({
			kind: "gap",
			taskId: "s03",
			basis: "in_process",
			lastAttemptAt: now - 30_000,
			retryAt: now - 30_000 + MERGE_REDELIVERY_MIN_GAP_MS,
			attemptsInWindow: 1,
			reason: "last merge conflicted in 1 file(s)",
		});
		expect(classifyApprovedUnmergedCard({ ...base, activeTaskIds: new Set(["s03::merge"]) })).toEqual({
			kind: "live",
			taskId: "s03",
			sessionKey: "s03::merge",
		});
	});

	it("an in-process re-run with no record yet says so", () => {
		expect(classifyApprovedUnmergedCard({ ...base, history: [], recentAttemptAt: now - 30_000 })).toMatchObject({
			kind: "gap",
			basis: "in_process",
			attemptsInWindow: 0,
			reason: "a re-delivery is in flight and has left no record yet",
		});
	});

	it("never attempted, or last attempt merged, is not a redelivery matter", () => {
		expect(classifyApprovedUnmergedCard({ ...base, history: [] })).toEqual({
			kind: "never_failed",
			taskId: "s03",
			lastAttemptAt: null,
		});
		expect(classifyApprovedUnmergedCard({ ...base, history: [record("s03", now - 5_000, true)] })).toEqual({
			kind: "never_failed",
			taskId: "s03",
			lastAttemptAt: now - 5_000,
		});
	});

	it("a failed record inside the gap names WHEN the gap elapses", () => {
		expect(classifyApprovedUnmergedCard({ ...base, history: [record("s03", now - 60_000, false)] })).toEqual({
			kind: "gap",
			taskId: "s03",
			basis: "record",
			lastAttemptAt: now - 60_000,
			retryAt: now - 60_000 + MERGE_REDELIVERY_MIN_GAP_MS,
			attemptsInWindow: 1,
			reason: "last merge conflicted in 1 file(s)",
		});
	});

	it("a spent daily cap names WHEN the window rolls (the cap-th newest record ages out)", () => {
		const capped = Array.from({ length: MERGE_REDELIVERY_MAX_PER_DAY + 1 }, (_, index) =>
			record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1 - index * 60_000, false),
		);
		const capHolder = capped[MERGE_REDELIVERY_MAX_PER_DAY - 1] as MergeHistoryRecord;
		expect(classifyApprovedUnmergedCard({ ...base, history: capped })).toEqual({
			kind: "cap",
			taskId: "s03",
			lastAttemptAt: now - MERGE_REDELIVERY_MIN_GAP_MS - 1,
			attemptsInWindow: MERGE_REDELIVERY_MAX_PER_DAY + 1,
			windowResetsAt: capHolder.recordedAt + MERGE_REDELIVERY_WINDOW_MS,
			reason: "last merge conflicted in 1 file(s)",
		});
	});

	it("otherwise re-delivers, and the plural form + select agree card by card", () => {
		expect(classifyApprovedUnmergedCard(base)).toEqual({
			kind: "redeliver",
			taskId: "s03",
			decision: {
				taskId: "s03",
				lastAttemptAt: now - MERGE_REDELIVERY_MIN_GAP_MS - 1,
				attemptsInWindow: 1,
				reason: "last merge conflicted in 1 file(s)",
			},
		});
		const input = {
			reviewCards: [approved("done"), approved("s03"), approved("s04")],
			history: [record("done", now - 3_600_000, true), failedGapAgo(), record("s04", now - 1_000, false)],
			activeTaskIds: new Set<string>(),
			handledThisTick: new Set<string>(),
			now,
			recentAttempts: new Map([["s04", now - 1_000]]),
		};
		expect(classifyApprovedUnmergedCards(input).map((entry) => entry.kind)).toEqual([
			"never_failed",
			"redeliver",
			"gap",
		]);
		expect(selectApprovedUnmergedRedelivery(input)).toMatchObject({ taskId: "s03" });
	});
});

describe("buildApprovedUnmergedCapHoldObservation (the watchdog's twin of the boot hold)", () => {
	it("records the spent cap under the registered category with when re-delivery resumes", () => {
		const capped = Array.from({ length: MERGE_REDELIVERY_MAX_PER_DAY }, (_, index) =>
			record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1 - index * 60_000, false),
		);
		const hold = classifyApprovedUnmergedCard({
			card: approved("s03"),
			history: capped,
			activeTaskIds: new Set(),
			handledThisTick: new Set(),
			now,
		});
		if (hold.kind !== "cap") {
			throw new Error(`expected cap, got ${hold.kind}`);
		}
		const observation = buildApprovedUnmergedCapHoldObservation(hold, now);
		expect(observation).toMatchObject({
			signal: "custom",
			severity: "warning",
			taskId: "s03",
			metadata: {
				category: "review_reconcile_hold",
				seam: "watchdog",
				outcome: "redelivery_cap",
				attemptsInWindow: MERGE_REDELIVERY_MAX_PER_DAY,
				retryAt: hold.windowResetsAt,
			},
		});
		expect(observation.message).toContain(`${MERGE_REDELIVERY_MAX_PER_DAY} delivery attempts in 24h`);
		expect(observation.message).toContain("unless an operator merges or re-drives the card first");
	});
});
