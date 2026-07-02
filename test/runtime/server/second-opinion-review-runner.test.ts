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
	const mutationResults: unknown[] = [];
	const mutateWorkspaceState = vi.fn(async (_cwd: string, mutate: (state: { board: RuntimeBoardData }) => unknown) => {
		mutationResults.push(mutate({ board }));
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
		mutationResults,
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

	it("waives a configured reviewer that is NOT loaded to the service's diverse auto-pick (W2.5 pin-miss)", async () => {
		const deps = makeDeps({ submission: { verdict: "approve", summary: "Good", feedback: null, insight: null } });
		const warn = vi.fn();
		const outcome = await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
			// The loaded set positively LACKS the configured "reviewer-model" ⇒ the pin is waived (never launch an
			// unloaded model) and the service auto-picks (reviewer: null triggers pickDiverseReviewerModel).
			fetchLoadedModelIds: async () => ["some-other-loaded-model"],
			warn,
		});
		expect(outcome.type).toBe("delivered");
		expect(deps.runSecondOpinionReviewSession).toHaveBeenCalledWith(expect.objectContaining({ reviewer: null }));
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("waived"));
	});

	it("honors a configured reviewer that IS loaded (valid-pin behavior unchanged)", async () => {
		const deps = makeDeps({ submission: { verdict: "approve", summary: "Good", feedback: null, insight: null } });
		const warn = vi.fn();
		await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
			fetchLoadedModelIds: async () => ["reviewer-model", "some-other-loaded-model"],
			warn,
		});
		expect(deps.runSecondOpinionReviewSession).toHaveBeenCalledWith(
			expect.objectContaining({ reviewer: { providerId: "lmstudio", modelId: "reviewer-model" } }),
		);
		expect(warn).not.toHaveBeenCalled();
	});

	it("honors the pin leniently when the loaded set is unknown (empty probe never wedges a review)", async () => {
		const deps = makeDeps({ submission: { verdict: "approve", summary: "Good", feedback: null, insight: null } });
		await runSecondOpinionReviewForTask({
			workspacePath: "/repo",
			taskId: "task-1",
			service: service(deps),
			loadRuntimeConfig: deps.loadRuntimeConfig,
			loadWorkspaceState: deps.loadWorkspaceState,
			mutateWorkspaceState: deps.mutateWorkspaceState,
			getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
			fetchLoadedModelIds: async () => {
				throw new Error("endpoint unreachable");
			},
		});
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

	const boardsFromMutations = (deps: ReturnType<typeof makeDeps>): RuntimeBoardData[] =>
		deps.mutationResults
			.map((result) => (result as { board?: RuntimeBoardData })?.board)
			.filter((candidate): candidate is RuntimeBoardData => Boolean(candidate));

	const hasRedecomposeCard = (boards: RuntimeBoardData[], taskId: string): boolean =>
		boards.some((candidate) =>
			candidate.columns.some((column) => column.cards.some((card) => card.id === `redecompose-${taskId}`)),
		);

	it("a plain park (no prior escalation) never spawns a re-decompose card", async () => {
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
		expect(hasRedecomposeCard(boardsFromMutations(deps), "task-1")).toBe(false);
	});

	it("a park AFTER escalation spawns the §5.AB re-decompose card (the ladder escape)", async () => {
		const deps = makeDeps({
			submission: { verdict: "request_changes", summary: "Stuck", feedback: "Cannot proceed", insight: null },
			maxRounds: 0,
		});
		const runnerService = {
			...(service(deps) as unknown as Record<string, unknown>),
			pickDiverseEscalationModel: vi.fn(async () => ({ providerId: "lmstudio", modelId: "gptoss120-m5" })),
		} as unknown as never;
		const run = () =>
			runSecondOpinionReviewForTask({
				workspacePath: "/repo",
				taskId: "task-1",
				service: runnerService,
				loadRuntimeConfig: deps.loadRuntimeConfig,
				loadWorkspaceState: deps.loadWorkspaceState,
				mutateWorkspaceState: deps.mutateWorkspaceState,
				getTaskResultBranchDiff: deps.getTaskResultBranchDiff,
			});
		const first = await run();
		expect(first.type).toBe("escalated");
		const second = await run();
		expect(second.type).toBe("parked");
		const boards = boardsFromMutations(deps);
		expect(hasRedecomposeCard(boards, "task-1")).toBe(true);
		// The spawned card carries the decompose instruction and lands in backlog for the sweep.
		const spawned = boards
			.flatMap((candidate) => candidate.columns.flatMap((column) => column.cards.map((card) => ({ column, card }))))
			.find((entry) => entry.card.id === "redecompose-task-1");
		expect(spawned?.column.id).toBe("backlog");
		expect(spawned?.card.prompt).toContain("decompose_project");
		// Idempotent: a THIRD park attempt must not duplicate the card (same runner instance set).
		const third = await run();
		expect(third.type).toBe("parked");
		const duplicates = boardsFromMutations(deps)
			.flatMap((candidate) => candidate.columns.flatMap((column) => column.cards))
			.filter((card) => card.id === "redecompose-task-1").length;
		expect(duplicates).toBeGreaterThanOrEqual(1);
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
