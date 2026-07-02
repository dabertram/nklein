import { describe, expect, it, vi } from "vitest";
import type { RuntimeBoardData, RuntimeCardReview } from "../../../src/core/api-contract";
import type { ReviewSubmissionInput } from "../../../src/core/review-orchestration";
import {
	applyCardReviewToBoard,
	buildReviewBoardContext,
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

function makeDeps(overrides: {
	enabled?: boolean;
	submission?: ReviewSubmissionInput | null;
	diff?: string | null;
	maxRounds?: number;
}) {
	const board = boardWithCardInReview();
	const loadRuntimeConfig = vi.fn(async () => ({
		secondOpinionReviewEnabled: overrides.enabled ?? true,
		reviewMaxRounds: overrides.maxRounds ?? 20,
		modelRoles: { reviewer: { providerId: "lmstudio", modelId: "reviewer-model" } },
		effectiveModelRoles: { reviewer: { providerId: "lmstudio", modelId: "reviewer-model" } },
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
	const cancelTaskTurn = vi.fn(async (_taskId: string) => null);
	return {
		loadRuntimeConfig,
		loadWorkspaceState,
		mutateWorkspaceState,
		getTaskResultBranchDiff,
		runSecondOpinionReviewSession,
		sendTaskSessionInput,
		cancelTaskTurn,
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

describe("buildReviewBoardContext", () => {
	it("derives dependencies, dependents, siblings, and the plan objective", () => {
		const card = {
			id: "impl-b",
			title: "Implement B",
			prompt: "Do B.",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
			generatedFromPlan: { artifactKind: "decomposition" as const, planSlug: "plan-x", planTaskId: "plan-1" },
		};
		const board: RuntimeBoardData = {
			columns: [
				{
					id: "planning",
					title: "Planning",
					cards: [{ ...card, id: "plan-1", title: "Plan", prompt: "Build X end to end." }],
				},
				{
					id: "completed",
					title: "Completed",
					cards: [
						{
							...card,
							id: "impl-a",
							title: "Implement A",
							generatedFromPlan: { artifactKind: "decomposition", planSlug: "plan-x", planTaskId: "plan-1" },
						},
					],
				},
				{ id: "review", title: "Review", cards: [card] },
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							...card,
							id: "impl-c",
							title: "Implement C",
							generatedFromPlan: { artifactKind: "decomposition", planSlug: "plan-x", planTaskId: "plan-1" },
						},
					],
				},
			],
			// impl-b depends on impl-a (from→to = depends-on); impl-c depends on impl-b.
			dependencies: [
				{ id: "d1", fromTaskId: "impl-b", toTaskId: "impl-a", createdAt: 1 },
				{ id: "d2", fromTaskId: "impl-c", toTaskId: "impl-b", createdAt: 1 },
			],
		};
		const context = buildReviewBoardContext(board, card);
		expect(context.planObjective).toBe("Build X end to end.");
		expect(context.dependsOn).toEqual([{ title: "Implement A", column: "completed" }]);
		expect(context.dependedOnBy).toEqual([{ title: "Implement C", column: "in_progress" }]);
		expect(context.siblings).toEqual(
			expect.arrayContaining([
				{ title: "Implement A", column: "completed" },
				{ title: "Implement C", column: "in_progress" },
			]),
		);
		expect(context.siblings?.some((s) => s.title === "Implement B")).toBe(false);
	});
});

describe("runSecondOpinionReviewForTask", () => {
	const service = (deps: ReturnType<typeof makeDeps>) =>
		({
			runSecondOpinionReviewSession: deps.runSecondOpinionReviewSession,
			sendTaskSessionInput: deps.sendTaskSessionInput,
			getSummary: () => null,
			cancelTaskTurn: deps.cancelTaskTurn,
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

	it("parking QUIESCES the worker session (run20: a parked card churned turns and starved its endpoint)", async () => {
		// maxRounds 0 forces the loop past its cap on the first request_changes ⇒ park.
		const deps = makeDeps({
			submission: { verdict: "request_changes", summary: "Stuck", feedback: "Cannot proceed", insight: null },
			maxRounds: 0,
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
		expect(outcome.type).toBe("parked");
		expect(deps.cancelTaskTurn).toHaveBeenCalledWith("task-1");
	});

	it("delivered and bounced outcomes never cancel the worker's turn", async () => {
		const approve = makeDeps({ submission: { verdict: "approve", summary: "Good", feedback: null, insight: null } });
		await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(approve),
			loadRuntimeConfig: approve.loadRuntimeConfig,
			loadWorkspaceState: approve.loadWorkspaceState,
			mutateWorkspaceState: approve.mutateWorkspaceState,
			getTaskResultBranchDiff: approve.getTaskResultBranchDiff,
		});
		expect(approve.cancelTaskTurn).not.toHaveBeenCalled();
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
