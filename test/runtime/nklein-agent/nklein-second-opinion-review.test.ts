import { describe, expect, it, vi } from "vitest";
import type { RuntimeCardReview } from "../../../src/core/api-contract";
import { fingerprintReviewArtifact, type ReviewSubmissionInput } from "../../../src/core/review-orchestration";
import {
	type RunNKleinSecondOpinionReviewInput,
	runNKleinSecondOpinionReview,
	type SecondOpinionReviewCard,
} from "../../../src/nklein-agent/nklein-second-opinion-review";

/** Typed first-call-first-arg accessor that throws (rather than a non-null assertion) when the mock was never called. */
function firstArg<T>(fn: { mock: { calls: unknown[][] } }): T {
	const call = fn.mock.calls[0];
	if (!call) {
		throw new Error("expected the mock to have been called at least once");
	}
	return call[0] as T;
}

function makeDeps(overrides: {
	card?: SecondOpinionReviewCard | null;
	diff?: string | null;
	submission?: ReviewSubmissionInput | null;
	speculativeDiff?: string | null;
}): RunNKleinSecondOpinionReviewInput["deps"] & {
	onDeliver: ReturnType<typeof vi.fn>;
	onBounce: ReturnType<typeof vi.fn>;
	onPark: ReturnType<typeof vi.fn>;
	runReviewSession: ReturnType<typeof vi.fn>;
} {
	const card =
		overrides.card === undefined
			? ({ id: "task-1", title: "Add login", prompt: "Implement login." } satisfies SecondOpinionReviewCard)
			: overrides.card;
	return {
		getCard: vi.fn(async () => card),
		getTaskDiff: vi.fn(async () => (overrides.diff === undefined ? "diff --git a/x b/x\n+code" : overrides.diff)),
		...(overrides.speculativeDiff !== undefined
			? { getSpeculativeDiff: vi.fn(async () => overrides.speculativeDiff ?? null) }
			: {}),
		runReviewSession: vi.fn(async () =>
			overrides.submission === undefined
				? ({ verdict: "approve", summary: "LGTM", feedback: null, insight: null } satisfies ReviewSubmissionInput)
				: overrides.submission,
		),
		onDeliver: vi.fn(async () => {}),
		onBounce: vi.fn(async () => {}),
		onPark: vi.fn(async () => {}),
	};
}

const base = {
	taskId: "task-1",
	columnId: "review",
	enabled: true,
	maxRounds: 20,
	now: () => 1000,
} satisfies Omit<RunNKleinSecondOpinionReviewInput, "deps">;

describe("runNKleinSecondOpinionReview", () => {
	it("skips when disabled", async () => {
		const deps = makeDeps({});
		const outcome = await runNKleinSecondOpinionReview({ ...base, enabled: false, deps });
		expect(outcome).toEqual({ type: "skipped", reason: "disabled" });
		expect(deps.runReviewSession).not.toHaveBeenCalled();
	});

	it("skips a non-review column, a reviewer card, and a planning card", async () => {
		expect(await runNKleinSecondOpinionReview({ ...base, columnId: "in_progress", deps: makeDeps({}) })).toEqual({
			type: "skipped",
			reason: "not_reviewable",
		});
		expect(await runNKleinSecondOpinionReview({ ...base, isReviewerCard: true, deps: makeDeps({}) })).toEqual({
			type: "skipped",
			reason: "not_reviewable",
		});
		expect(await runNKleinSecondOpinionReview({ ...base, isPlanningCard: true, deps: makeDeps({}) })).toEqual({
			type: "skipped",
			reason: "not_reviewable",
		});
	});

	it("still reviews a no-change result (a no-op is a red flag, not a silent pass)", async () => {
		const deps = makeDeps({
			diff: "",
			submission: { verdict: "approve", summary: "ok", feedback: null, insight: null },
		});
		const outcome = await runNKleinSecondOpinionReview({ ...base, deps });
		expect(outcome.type).toBe("delivered");
		expect(deps.runReviewSession).toHaveBeenCalledTimes(1);
		const seed = firstArg<{ seedPrompt: string }>(deps.runReviewSession).seedPrompt;
		expect(seed).toContain("No file changes");
	});

	it("skips when the card is gone", async () => {
		expect(await runNKleinSecondOpinionReview({ ...base, deps: makeDeps({ card: null }) })).toEqual({
			type: "skipped",
			reason: "card_not_found",
		});
	});

	it("skips when the reviewer session returns no verdict", async () => {
		const deps = makeDeps({ submission: null });
		expect(await runNKleinSecondOpinionReview({ ...base, deps })).toEqual({ type: "skipped", reason: "no_verdict" });
	});

	it("§5.AW: persists the reviewer's A/B pick on the delivered review (durable across restart)", async () => {
		const choseSpec = makeDeps({
			submission: {
				verdict: "approve",
				summary: "B is cleaner",
				feedback: null,
				insight: null,
				preferred: "speculative",
			},
			speculativeDiff: "diff --git a/alt b/alt\n+alt",
		});
		const specOutcome = await runNKleinSecondOpinionReview({ ...base, deps: choseSpec });
		expect(specOutcome).toMatchObject({ type: "delivered", preferred: "speculative" });
		expect(firstArg<{ review: RuntimeCardReview }>(choseSpec.onDeliver).review.preferredCandidate).toBe(
			"speculative",
		);

		// An approving reviewer that names no candidate (but a spec existed) delivers PRIMARY, persisted.
		const silent = makeDeps({
			submission: { verdict: "approve", summary: "fine", feedback: null, insight: null },
			speculativeDiff: "diff --git a/alt b/alt\n+alt",
		});
		await runNKleinSecondOpinionReview({ ...base, deps: silent });
		expect(firstArg<{ review: RuntimeCardReview }>(silent.onDeliver).review.preferredCandidate).toBe("primary");

		// No speculative candidate ⇒ no arbitration ⇒ the field is absent.
		const noSpec = makeDeps({
			submission: { verdict: "approve", summary: "fine", feedback: null, insight: null },
		});
		await runNKleinSecondOpinionReview({ ...base, deps: noSpec });
		expect(firstArg<{ review: RuntimeCardReview }>(noSpec.onDeliver).review.preferredCandidate).toBeUndefined();
	});

	it("delivers on approve, persisting an approved review with sign-off", async () => {
		const deps = makeDeps({
			submission: { verdict: "approve", summary: "Solid", feedback: null, insight: "Clean tests" },
		});
		const outcome = await runNKleinSecondOpinionReview({ ...base, deps });
		expect(outcome.type).toBe("delivered");
		expect(deps.onDeliver).toHaveBeenCalledTimes(1);
		const { review } = firstArg<{ review: RuntimeCardReview }>(deps.onDeliver);
		expect(review.status).toBe("approved");
		expect(review.round).toBe(1);
		expect(review.history).toHaveLength(1);
		expect(review.signOff).toContain("Solid");
		expect(review.signOff).toContain("Clean tests");
		expect(deps.onBounce).not.toHaveBeenCalled();
	});

	it("reuses a durable approval for the unchanged work artifact without launching another reviewer", async () => {
		const diff = "diff --git a/x b/x\n+code";
		const card: SecondOpinionReviewCard = {
			id: "task-1",
			title: "Add login",
			prompt: "Implement login.",
			review: {
				status: "approved",
				round: 1,
				history: [
					{
						round: 1,
						verdict: "approve",
						feedbackFingerprint: null,
						workFingerprint: fingerprintReviewArtifact(diff),
					},
				],
				lastVerdict: "approve",
				lastSummary: "Looks good",
				lastFeedback: null,
				lastInsight: null,
				signOff: "Approved unchanged login work.",
				parkedReason: null,
				preferredCandidate: "primary",
				updatedAt: 1,
			},
		};
		const deps = makeDeps({ card, diff, submission: null });

		await expect(runNKleinSecondOpinionReview({ ...base, deps })).resolves.toEqual({
			type: "delivered",
			round: 1,
			signOff: "Approved unchanged login work.",
			preferred: "primary",
			reusedApproval: true,
		});
		expect(deps.runReviewSession).not.toHaveBeenCalled();
		expect(deps.onDeliver).not.toHaveBeenCalled();
		expect(deps.onBounce).not.toHaveBeenCalled();
		expect(deps.onPark).not.toHaveBeenCalled();
	});

	it("reviews again when the work changed after a durable approval", async () => {
		const reviewedDiff = "diff --git a/x b/x\n+old";
		const changedDiff = "diff --git a/x b/x\n+new";
		const card: SecondOpinionReviewCard = {
			id: "task-1",
			title: "Add login",
			prompt: "Implement login.",
			review: {
				status: "approved",
				round: 1,
				history: [
					{
						round: 1,
						verdict: "approve",
						feedbackFingerprint: null,
						workFingerprint: fingerprintReviewArtifact(reviewedDiff),
					},
				],
				lastVerdict: "approve",
				lastSummary: "Looks good",
				lastFeedback: null,
				lastInsight: null,
				signOff: "Approved old login work.",
				parkedReason: null,
				updatedAt: 1,
			},
		};
		const deps = makeDeps({
			card,
			diff: changedDiff,
			submission: { verdict: "approve", summary: "New work is sound", feedback: null, insight: null },
		});

		await expect(runNKleinSecondOpinionReview({ ...base, deps })).resolves.toMatchObject({
			type: "delivered",
			round: 2,
		});
		expect(deps.runReviewSession).toHaveBeenCalledTimes(1);
		expect(firstArg<{ review: RuntimeCardReview }>(deps.onDeliver).review.history).toHaveLength(2);
	});

	it("lets an explicit pre-review verdict supersede an unchanged durable approval", async () => {
		const diff = "diff --git a/x b/x\n+code";
		const card: SecondOpinionReviewCard = {
			id: "task-1",
			title: "Add login",
			prompt: "Implement login.",
			review: {
				status: "approved",
				round: 1,
				history: [
					{
						round: 1,
						verdict: "approve",
						feedbackFingerprint: null,
						workFingerprint: fingerprintReviewArtifact(diff),
					},
				],
				lastVerdict: "approve",
				lastSummary: "Looks good",
				lastFeedback: null,
				lastInsight: null,
				signOff: "Approved old login work.",
				parkedReason: null,
				updatedAt: 1,
			},
		};
		const deps = makeDeps({ card, diff, submission: null });

		await expect(
			runNKleinSecondOpinionReview({
				...base,
				deps,
				preReviewVerdict: {
					verdict: "request_changes",
					summary: "Tests required",
					feedback: "Add a regression test",
					insight: null,
				},
			}),
		).resolves.toMatchObject({ type: "parked", round: 2 });
		expect(deps.runReviewSession).not.toHaveBeenCalled();
		expect(deps.onDeliver).not.toHaveBeenCalled();
		expect(deps.onPark).toHaveBeenCalledTimes(1);
	});

	it("bounces on request_changes, passing the worker prompt and changes_requested status", async () => {
		const deps = makeDeps({
			submission: { verdict: "request_changes", summary: "Almost", feedback: "Validate input", insight: null },
		});
		const outcome = await runNKleinSecondOpinionReview({ ...base, deps });
		expect(outcome).toEqual({ type: "bounced", round: 1 });
		expect(deps.onBounce).toHaveBeenCalledTimes(1);
		const call = firstArg<{ review: RuntimeCardReview; workerPrompt: string }>(deps.onBounce);
		expect(call.workerPrompt).toContain("Validate input");
		expect(call.review.status).toBe("changes_requested");
		expect(call.review.lastFeedback).toBe("Validate input");
	});

	it("parks at the round limit and records the reason", async () => {
		const card: SecondOpinionReviewCard = {
			id: "task-1",
			title: "T",
			prompt: "p",
			review: {
				status: "changes_requested",
				round: 1,
				history: [{ round: 1, verdict: "request_changes", feedbackFingerprint: "a", workFingerprint: "w1" }],
				lastVerdict: "request_changes",
				lastSummary: "s",
				lastFeedback: "old",
				lastInsight: null,
				signOff: null,
				parkedReason: null,
				updatedAt: 1,
			},
		};
		const deps = makeDeps({
			card,
			submission: { verdict: "request_changes", summary: "Still", feedback: "Keep going", insight: null },
		});
		const outcome = await runNKleinSecondOpinionReview({ ...base, maxRounds: 2, deps });
		expect(outcome.type).toBe("parked");
		expect(deps.onPark).toHaveBeenCalledTimes(1);
		const { review } = firstArg<{ review: RuntimeCardReview }>(deps.onPark);
		expect(review.status).toBe("parked");
		expect(review.round).toBe(2);
		expect(review.parkedReason).toBeTruthy();
	});

	it("threads prior feedback into the reviewer seed prompt on a re-review", async () => {
		const card: SecondOpinionReviewCard = {
			id: "task-1",
			title: "T",
			prompt: "p",
			review: {
				status: "changes_requested",
				round: 1,
				history: [{ round: 1, verdict: "request_changes", feedbackFingerprint: "a", workFingerprint: "w1" }],
				lastVerdict: "request_changes",
				lastSummary: "s",
				lastFeedback: "Add the missing guard",
				lastInsight: null,
				signOff: null,
				parkedReason: null,
				updatedAt: 1,
			},
		};
		const deps = makeDeps({ card });
		await runNKleinSecondOpinionReview({ ...base, deps });
		const sessionArg = firstArg<{ seedPrompt: string; round: number }>(deps.runReviewSession);
		expect(sessionArg.round).toBe(2);
		expect(sessionArg.seedPrompt).toContain("Add the missing guard");
	});

	it("§5.V preReviewVerdict: a deterministic pre-review request_changes bounces WITHOUT calling the reviewer model", async () => {
		const deps = makeDeps({});
		const outcome = await runNKleinSecondOpinionReview({
			...base,
			deps,
			preReviewVerdict: {
				verdict: "request_changes",
				summary: "Test-driven delivery gate",
				feedback: "Add or update a test that covers the change.",
				insight: null,
			},
		});
		expect(outcome.type).toBe("bounced");
		expect(deps.runReviewSession).not.toHaveBeenCalled();
		expect(deps.onBounce).toHaveBeenCalledTimes(1);
		const bounce = deps.onBounce.mock.calls[0]?.[0] as { workerPrompt: string; review: { lastFeedback: string } };
		expect(bounce.review.lastFeedback).toContain("Add or update a test");
	});
});
