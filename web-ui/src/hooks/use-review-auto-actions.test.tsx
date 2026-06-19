import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { useReviewAutoActions } from "@/hooks/use-review-auto-actions";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { resetWorkspaceMetadataStore, setTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";
import type { BoardColumnId, BoardData, ReviewTaskWorkspaceSnapshot } from "@/types";

function createBoard(autoReviewEnabled: boolean): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: "task-1",
						title: "Test task",
						prompt: "Test task",
						startInPlanMode: false,
						autoReviewEnabled,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

const workspaceSnapshots: Record<string, ReviewTaskWorkspaceSnapshot> = {
	"task-1": {
		taskId: "task-1",
		path: "/tmp/task-1",
		branch: "task-1",
		isDetached: false,
		headCommit: "abc123",
		changedFiles: 3,
		additions: 10,
		deletions: 2,
	},
};

function HookHarness({
	board,
	sessions = {},
	workspaceSnapshot = workspaceSnapshots["task-1"] ?? null,
	runAutoReviewGitAction,
	requestMoveTaskToCompleted,
	onAutoReviewNoticeChange,
}: {
	board: BoardData;
	sessions?: Record<string, RuntimeTaskSessionSummary>;
	workspaceSnapshot?: ReviewTaskWorkspaceSnapshot | null;
	runAutoReviewGitAction: (taskId: string, action: TaskGitAction) => Promise<boolean>;
	requestMoveTaskToCompleted: (taskId: string, fromColumnId: BoardColumnId) => Promise<void>;
	onAutoReviewNoticeChange?: (
		taskId: string,
		notice: { status: "running" | "failed"; message: string } | null,
	) => void;
}): null {
	setTaskWorkspaceSnapshot(workspaceSnapshot);
	useReviewAutoActions({
		board,
		sessions,
		taskGitActionLoadingByTaskId: {},
		runAutoReviewGitAction,
		requestMoveTaskToCompleted,
		onAutoReviewNoticeChange,
	});
	return null;
}

function createSession(hookEventName: string): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		agentId: "cline",
		workspacePath: "/repo",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: "exit",
		exitCode: 0,
		lastHookAt: 1,
		latestHookActivity: {
			activityText: hookEventName === "sandbox_patch_captured" ? "Result patch captured" : "No changes",
			toolName: null,
			toolInputSummary: null,
			finalMessage: null,
			hookEventName,
			notificationType: null,
			source: "nklein",
		},
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("useReviewAutoActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		resetWorkspaceMetadataStore();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
		vi.useRealTimers();
	});

	it("cancels a scheduled auto review action when autoReviewEnabled is turned off", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToCompleted = vi.fn(async () => {});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(true)}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToCompleted={requestMoveTaskToCompleted}
				/>,
			);
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(false)}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToCompleted={requestMoveTaskToCompleted}
				/>,
			);
		});

		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(runAutoReviewGitAction).not.toHaveBeenCalled();
		expect(requestMoveTaskToCompleted).not.toHaveBeenCalled();
	});

	it("records a durable failure notice when an auto review action is a no-op", async () => {
		const runAutoReviewGitAction = vi.fn(async () => false);
		const requestMoveTaskToCompleted = vi.fn(async () => {});
		const onAutoReviewNoticeChange = vi.fn();

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(true)}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToCompleted={requestMoveTaskToCompleted}
					onAutoReviewNoticeChange={onAutoReviewNoticeChange}
				/>,
			);
		});

		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(runAutoReviewGitAction).toHaveBeenCalledWith("task-1", "commit");
		expect(onAutoReviewNoticeChange).toHaveBeenCalledWith("task-1", {
			status: "running",
			message: "Auto-commit is running. !Klein will move this task to Done once no task changes remain.",
		});
		expect(onAutoReviewNoticeChange).toHaveBeenCalledWith("task-1", {
			status: "failed",
			message:
				"Auto-commit did not start. Review the task result, then run the action manually or cancel automation.",
		});
		expect(requestMoveTaskToCompleted).not.toHaveBeenCalled();
	});

	it("starts auto review from a captured sandbox result branch without a workspace snapshot", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToCompleted = vi.fn(async () => {});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(true)}
					sessions={{ "task-1": createSession("sandbox_patch_captured") }}
					workspaceSnapshot={null}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToCompleted={requestMoveTaskToCompleted}
				/>,
			);
		});

		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(runAutoReviewGitAction).toHaveBeenCalledWith("task-1", "commit");
		expect(requestMoveTaskToCompleted).not.toHaveBeenCalled();
	});

	it("moves auto-reviewed sandbox tasks to done after a clean result capture", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToCompleted = vi.fn(async () => {});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(true)}
					sessions={{ "task-1": createSession("sandbox_patch_captured") }}
					workspaceSnapshot={null}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToCompleted={requestMoveTaskToCompleted}
				/>,
			);
		});

		await act(async () => {
			vi.advanceTimersByTime(1000);
			await Promise.resolve();
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard(true)}
					sessions={{ "task-1": createSession("sandbox_patch_empty") }}
					workspaceSnapshot={null}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToCompleted={requestMoveTaskToCompleted}
				/>,
			);
		});

		await act(async () => {
			vi.advanceTimersByTime(1000);
			await Promise.resolve();
		});

		expect(requestMoveTaskToCompleted).toHaveBeenCalledWith("task-1", "review", {
			skipWorkingChangeWarning: true,
		});
	});
});
