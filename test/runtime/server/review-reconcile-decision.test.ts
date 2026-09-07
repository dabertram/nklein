import { describe, expect, it } from "vitest";
import {
	MERGE_REDELIVERY_MAX_PER_DAY,
	MERGE_REDELIVERY_MIN_GAP_MS,
	MERGE_REDELIVERY_WINDOW_MS,
} from "../../../src/server/merge-redelivery-decision";
import {
	buildReviewReconcileHoldObservation,
	decideReviewReconcileCandidate,
	RECONCILE_RESULT_BRANCH_PROBE_RETRY_DELAYS_MS,
	type ReviewReconcileCandidate,
	summarizeReviewReconcileDecision,
} from "../../../src/server/review-reconcile-decision";
import type { MergeHistoryRecord } from "../../../src/state/merge-history-store";
import type { TaskResultBranchProbe } from "../../../src/workspace/task-result-branches";

const now = 1_788_640_000_000;
const found: TaskResultBranchProbe = { status: "found", commit: "abc123" };
const missing: TaskResultBranchProbe = { status: "missing", commit: null };
const probeError: TaskResultBranchProbe = { status: "error", commit: null, message: "spawn EBADF" };

const record = (taskId: string, recordedAt: number, ok: boolean, reason = "conflict"): MergeHistoryRecord => ({
	schemaVersion: 1,
	recordedAt,
	workspacePath: "/ws",
	taskId,
	ok,
	mergedTaskIds: ok ? [taskId] : [],
	skippedTaskIds: [],
	conflictedPaths: ok ? [] : ["src/a.ts"],
	reason: ok ? null : reason,
});
const card = (
	id: string,
	review: { status: "in_review" | "changes_requested" | "approved" | "parked" } | null = null,
	startInPlanMode = false,
): ReviewReconcileCandidate => ({ id, review: review ? { ...review, round: 1 } : undefined, startInPlanMode }) as never;
const approved = (id: string) => card(id, { status: "approved" });

const decide = (
	input: Partial<Parameters<typeof decideReviewReconcileCandidate>[0]> & { card: ReviewReconcileCandidate },
) =>
	decideReviewReconcileCandidate({
		probe: found,
		history: [],
		now,
		honourRedeliveryRules: true,
		...input,
	});

describe("decideReviewReconcileCandidate (every boot candidate ends in a NAMED fate — P0.RECONCILE-SKIP)", () => {
	it("skips a plan-mode card with the reason instead of letting the finalizer drop it silently", () => {
		expect(decide({ card: card("d1", { status: "approved" }, true) })).toMatchObject({
			action: "skip",
			taskId: "d1",
			skip: "plan_mode",
		});
	});

	it("holds a card whose result-branch probe ERRORED fail-closed — an error is never 'no result'", () => {
		const decision = decide({ card: approved("s51"), probe: probeError });
		expect(decision).toMatchObject({ action: "skip", skip: "result_branch_probe_error" });
		expect(decision.reason).toContain("spawn EBADF");
	});

	it("finalizes an APPROVED card with no result branch (the settled no-op completes through delivery)", () => {
		expect(decide({ card: approved("s07"), probe: missing })).toEqual({
			action: "finalize",
			taskId: "s07",
			reason: "approved with no result branch — the settled no-op completes through delivery",
			redelivery: null,
		});
	});

	it("skips an unapproved card with no result branch, naming the review status", () => {
		const decision = decide({ card: card("s08", { status: "changes_requested" }), probe: missing });
		expect(decision).toMatchObject({ action: "skip", skip: "no_result_branch" });
		expect(decision.reason).toContain("review changes_requested");
		expect(decide({ card: card("s09"), probe: missing }).reason).toContain("review pending");
	});

	it("finalizes an unapproved card with a result branch — the review is dispatched", () => {
		expect(decide({ card: card("s10", { status: "in_review" }) })).toMatchObject({
			action: "finalize",
			reason: "review in_review — dispatching the review",
			redelivery: null,
		});
	});

	it("finalizes an approved card that was never delivered, or whose last delivery merged", () => {
		expect(decide({ card: approved("s11") })).toMatchObject({
			action: "finalize",
			reason: "approved — delivery not yet attempted",
			redelivery: null,
		});
		expect(decide({ card: approved("s11"), history: [record("s11", now - 60_000, true)] })).toMatchObject({
			action: "finalize",
			reason: "approved — the last delivery merged; completing",
			redelivery: null,
		});
	});

	it("re-delivers an approved card whose last delivery FAILED once the gap has passed, carrying the watchdog's decision", () => {
		const decision = decide({
			card: approved("s03"),
			history: [record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1, false)],
		});
		expect(decision).toEqual({
			action: "finalize",
			taskId: "s03",
			reason: "last merge conflicted in 1 file(s)",
			redelivery: {
				taskId: "s03",
				lastAttemptAt: now - MERGE_REDELIVERY_MIN_GAP_MS - 1,
				attemptsInWindow: 1,
				reason: "last merge conflicted in 1 file(s)",
			},
		});
	});

	it("HOLDS inside the gap and says when the watchdog re-gates the card", () => {
		const lastAttemptAt = now - 3 * 60_000;
		const decision = decide({ card: approved("s03"), history: [record("s03", lastAttemptAt, false)] });
		expect(decision).toMatchObject({
			action: "hold",
			hold: "redelivery_gap",
			lastAttemptAt,
			attemptsInWindow: 1,
			retryAt: lastAttemptAt + MERGE_REDELIVERY_MIN_GAP_MS,
		});
		expect(decision.reason).toContain("failed 3 min ago");
		expect(decision.reason).toContain("re-gates it in ~7 min");
		expect(decision.reason).toContain(`attempt 2 of ${MERGE_REDELIVERY_MAX_PER_DAY} in 24h`);
	});

	it("HOLDS on the daily cap and says when the window rolls", () => {
		const history = Array.from({ length: MERGE_REDELIVERY_MAX_PER_DAY }, (_, index) =>
			record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1 - index * 60_000, false),
		);
		const oldestInCap = history[MERGE_REDELIVERY_MAX_PER_DAY - 1] as MergeHistoryRecord;
		const decision = decide({ card: approved("s03"), history });
		expect(decision).toMatchObject({
			action: "hold",
			hold: "redelivery_cap",
			attemptsInWindow: MERGE_REDELIVERY_MAX_PER_DAY,
			retryAt: oldestInCap.recordedAt + MERGE_REDELIVERY_WINDOW_MS,
		});
		expect(decision.reason).toContain(`${MERGE_REDELIVERY_MAX_PER_DAY} delivery attempts in 24h`);
	});

	it("with the rules disabled (NKLEIN_RECONCILE_REDELIVERY_RULES=0) re-finalizes at once — still recorded as a re-delivery", () => {
		const lastAttemptAt = now - 3 * 60_000;
		const inGap = decide({
			card: approved("s03"),
			history: [record("s03", lastAttemptAt, false)],
			honourRedeliveryRules: false,
		});
		expect(inGap).toMatchObject({
			action: "finalize",
			reason: "last merge conflicted in 1 file(s) (redelivery rules disabled)",
			redelivery: { taskId: "s03", lastAttemptAt, attemptsInWindow: 1 },
		});
		const capped = Array.from({ length: MERGE_REDELIVERY_MAX_PER_DAY }, (_, index) =>
			record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1 - index * 60_000, false),
		);
		expect(decide({ card: approved("s03"), history: capped, honourRedeliveryRules: false })).toMatchObject({
			action: "finalize",
			redelivery: { attemptsInWindow: MERGE_REDELIVERY_MAX_PER_DAY },
		});
	});

	it("uses a delivery-gate failure record exactly like a merge failure (P0.GATEHOLD records flow through)", () => {
		const gate: MergeHistoryRecord = {
			...record("s77", now - 2 * 60_000, false),
			conflictedPaths: [],
			reason: "delivery gate: npm run typecheck failed (exit 2)",
		};
		const decision = decide({ card: approved("s77"), history: [gate] });
		expect(decision).toMatchObject({ action: "hold", hold: "redelivery_gap" });
		expect(decision.reason).toContain("delivery gate: npm run typecheck failed (exit 2)");
	});

	it("retries an erroring probe on a short schedule before giving up (one transient git failure must not drop a card for the process)", () => {
		expect(RECONCILE_RESULT_BRANCH_PROBE_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
		expect(RECONCILE_RESULT_BRANCH_PROBE_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)).toBeLessThan(10_000);
	});
});

describe("buildReviewReconcileHoldObservation", () => {
	it("records the hold with when it lifts, under the registered category", () => {
		const lastAttemptAt = now - 3 * 60_000;
		const decision = decide({ card: approved("s03"), history: [record("s03", lastAttemptAt, false)] });
		if (decision.action === "finalize") {
			throw new Error("expected a hold");
		}
		expect(buildReviewReconcileHoldObservation(decision)).toEqual({
			signal: "custom",
			severity: "info",
			message: `Boot reconcile held s03: ${decision.reason}.`,
			taskId: "s03",
			metadata: {
				category: "review_reconcile_hold",
				seam: "boot_reconcile",
				outcome: "redelivery_gap",
				retryAt: lastAttemptAt + MERGE_REDELIVERY_MIN_GAP_MS,
				attemptsInWindow: 1,
				lastAttemptAt,
			},
		});
	});

	it("escalates a probe error and a spent cap to warning; a routine skip stays info", () => {
		const errored = decide({ card: approved("s51"), probe: probeError });
		const noBranch = decide({ card: card("s08", { status: "in_review" }), probe: missing });
		const capped = decide({
			card: approved("s03"),
			history: Array.from({ length: MERGE_REDELIVERY_MAX_PER_DAY }, (_, index) =>
				record("s03", now - MERGE_REDELIVERY_MIN_GAP_MS - 1 - index * 60_000, false),
			),
		});
		for (const [decision, severity, outcome] of [
			[errored, "warning", "result_branch_probe_error"],
			[noBranch, "info", "no_result_branch"],
			[capped, "warning", "redelivery_cap"],
		] as const) {
			if (decision.action === "finalize") {
				throw new Error("expected a hold/skip");
			}
			const observation = buildReviewReconcileHoldObservation(decision);
			expect(observation.severity).toBe(severity);
			expect(observation.metadata.outcome).toBe(outcome);
			expect(observation.message).toContain(decision.taskId);
		}
	});
});

describe("summarizeReviewReconcileDecision (the per-boot summary line names every candidate's fate)", () => {
	it("labels finalize, re-delivery, holds and skips compactly", () => {
		const lastAttemptAt = now - 3 * 60_000;
		expect(summarizeReviewReconcileDecision(decide({ card: approved("a") }), now)).toBe("finalize");
		expect(
			summarizeReviewReconcileDecision(
				decide({ card: approved("b"), history: [record("b", now - MERGE_REDELIVERY_MIN_GAP_MS - 1, false)] }),
				now,
			),
		).toBe(`re-deliver (attempt 2/${MERGE_REDELIVERY_MAX_PER_DAY} in 24h)`);
		expect(
			summarizeReviewReconcileDecision(
				decide({ card: approved("c"), history: [record("c", lastAttemptAt, false)] }),
				now,
			),
		).toBe("held: redelivery_gap (~7 min)");
		expect(summarizeReviewReconcileDecision(decide({ card: approved("d"), probe: probeError }), now)).toBe(
			"skipped: result_branch_probe_error",
		);
	});
});
