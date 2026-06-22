import { describe, expect, it, vi } from "vitest";
import type { RuntimeBoardData, RuntimeCardReview } from "../../../src/core/api-contract";
import type { ReviewSubmissionInput } from "../../../src/core/review-orchestration";
import {
	applyCardReviewToBoard,
	runSecondOpinionReviewForTask,
} from "../../../src/server/second-opinion-review-runner";

const COLUMN_IDS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;

function boardWithCardInReview(): RuntimeBoardData {
	return {
		columns: COLUMN_IDS.map((id) => ({
			id,
			title: id,
			cards:
				id === "review"
					? [
							{
								id: "task-1",
								title: "Add login",
								prompt: "Implement login.",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 2,
							},
						]
					: [],
		})),
		dependencies: [],
	};
}

function makeDeps(overrides: { enabled?: boolean; submission?: ReviewSubmissionInput | null; diff?: string | null }) {
	const board = boardWithCardInReview();
	const loadRuntimeConfig = vi.fn(async () => ({
		secondOpinionReviewEnabled: overrides.enabled ?? true,
		reviewMaxRounds: 20,
		modelRoles: { reviewer: { providerId: "lmstudio", modelId: "reviewer-model" } },
	})) as unknown as never;
	const loadWorkspaceState = vi.fn(async () => ({ board })) as unknown as never;
	const mutateWorkspaceState = vi.fn(async (_cwd: string, mutate: (state: { board: RuntimeBoardData }) => unknown) => {
		mutate({ board });
		return { saved: true };
	}) as unknown as never;
	const getTaskResultBranchDiff = vi.fn(async () =>
		overrides.diff === undefined ? "diff --git a/login.ts b/login.ts\n+code" : overrides.diff,
	) as unknown as never;
	const runSecondOpinionReviewSession = vi.fn(async () =>
		overrides.submission === undefined
			? ({ verdict: "approve", summary: "LGTM", feedback: null, insight: null } satisfies ReviewSubmissionInput)
			: overrides.submission,
	);
	const sendTaskSessionInput = vi.fn(async (_taskId: string, _prompt: string, _mode?: string) => null);
	return {
		loadRuntimeConfig,
		loadWorkspaceState,
		mutateWorkspaceState,
		getTaskResultBranchDiff,
		runSecondOpinionReviewSession,
		sendTaskSessionInput,
	};
}

describe("applyCardReviewToBoard", () => {
	const review: RuntimeCardReview = {
		status: "changes_requested",
		round: 1,
		history: [],
		lastVerdict: "request_changes",
		lastSummary: "s",
		lastFeedback: "fix",
		lastInsight: null,
		signOff: null,
		parkedReason: null,
		updatedAt: 5,
	};

	it("sets the review in place when no target column is given", () => {
		const next = applyCardReviewToBoard(boardWithCardInReview(), "task-1", review, undefined, () => 99);
		const reviewCol = next.columns.find((c) => c.id === "review");
		expect(reviewCol?.cards[0]?.review).toEqual(review);
		expect(reviewCol?.cards[0]?.updatedAt).toBe(99);
	});

	it("moves the card to the target column", () => {
		const next = applyCardReviewToBoard(boardWithCardInReview(), "task-1", review, "in_progress");
		expect(next.columns.find((c) => c.id === "review")?.cards).toHaveLength(0);
		const moved = next.columns.find((c) => c.id === "in_progress")?.cards[0];
		expect(moved?.id).toBe("task-1");
		expect(moved?.review).toEqual(review);
	});
});

describe("runSecondOpinionReviewForTask", () => {
	const service = (deps: ReturnType<typeof makeDeps>) =>
		({
			runSecondOpinionReviewSession: deps.runSecondOpinionReviewSession,
			sendTaskSessionInput: deps.sendTaskSessionInput,
		}) as unknown as never;

	it("skips and never starts a session when review is disabled", async () => {
		const deps = makeDeps({ enabled: false });
		const outcome = await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
		});
		expect(outcome).toEqual({ type: "skipped", reason: "disabled" });
		expect(deps.runSecondOpinionReviewSession).not.toHaveBeenCalled();
	});

	it("delivers on approve and persists the review (no worker re-drive)", async () => {
		const deps = makeDeps({ submission: { verdict: "approve", summary: "Good", feedback: null, insight: null } });
		const outcome = await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
		});
		expect(outcome.type).toBe("delivered");
		expect(deps.mutateWorkspaceState).toHaveBeenCalledTimes(1);
		expect(deps.sendTaskSessionInput).not.toHaveBeenCalled();
		// the reviewer model from config is passed to the session
		expect(deps.runSecondOpinionReviewSession).toHaveBeenCalledWith(
			expect.objectContaining({ reviewer: { providerId: "lmstudio", modelId: "reviewer-model" } }),
		);
	});

	it("bounces on request_changes: persists, moves to In Progress, re-drives the worker", async () => {
		const deps = makeDeps({
			submission: { verdict: "request_changes", summary: "Almost", feedback: "Add a guard", insight: null },
		});
		const outcome = await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
		});
		expect(outcome).toEqual({ type: "bounced", round: 1 });
		expect(deps.sendTaskSessionInput).toHaveBeenCalledTimes(1);
		const call = deps.sendTaskSessionInput.mock.calls[0];
		expect(call?.[0]).toBe("task-1");
		expect(call?.[1]).toContain("Add a guard");
		expect(call?.[2]).toBe("act");
	});

	it("still reviews a no-change result (a no-op result is reviewed, not silently delivered)", async () => {
		const deps = makeDeps({
			diff: "",
			submission: {
				verdict: "request_changes",
				summary: "Nothing was done",
				feedback: "Implement it",
				insight: null,
			},
		});
		const outcome = await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
		});
		expect(outcome).toEqual({ type: "bounced", round: 1 });
		expect(deps.runSecondOpinionReviewSession).toHaveBeenCalledTimes(1);
	});
});
