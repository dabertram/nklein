import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { reconcileStartedTaskBoardLane } from "../../../src/core/task-board-lane-reconcile";
import { loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";
import { createGitTestEnv } from "../../utilities/git-env";

let repoPath: string;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;
let tempHome: string;

function uniqueDir(prefix: string): string {
	return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

beforeEach(() => {
	tempHome = uniqueDir("kanban-lane-reconcile-home");
	mkdirSync(tempHome, { recursive: true });
	previousHome = process.env.HOME;
	previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	repoPath = uniqueDir("kanban-lane-reconcile-repo");
	mkdirSync(repoPath, { recursive: true });
	const init = spawnSync("git", ["init"], { cwd: repoPath, stdio: "ignore", env: createGitTestEnv() });
	if (init.status !== 0) {
		throw new Error(`Failed to init git repo at ${repoPath}`);
	}
});

afterEach(() => {
	if (previousHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = previousHome;
	}
	if (previousUserProfile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = previousUserProfile;
	}
	rmSync(repoPath, { recursive: true, force: true });
	rmSync(tempHome, { recursive: true, force: true });
});

function board(card: { startInPlanMode: boolean; columnId: string }): RuntimeBoardData {
	const taskCard = {
		id: "task-1",
		title: "Decompose the project",
		prompt: "Do the work.",
		startInPlanMode: card.startInPlanMode,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: card.columnId === "backlog" ? [taskCard] : [] },
			{ id: "planning", title: "Planning", cards: card.columnId === "planning" ? [taskCard] : [] },
			{ id: "in_progress", title: "In Progress", cards: card.columnId === "in_progress" ? [taskCard] : [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: card.columnId === "completed" ? [taskCard] : [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function summary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "nklein",
		workspacePath: repoPath,
		pid: 1,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

async function columnOf(taskId: string): Promise<string | null> {
	const state = await loadWorkspaceState(repoPath);
	for (const column of state.board.columns) {
		if (column.cards.some((c) => c.id === taskId)) {
			return column.id;
		}
	}
	return null;
}

describe("reconcileStartedTaskBoardLane", () => {
	it("moves a running plan-mode card from Backlog to Planning", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: true, columnId: "backlog" }) });
		const changed = await reconcileStartedTaskBoardLane({ workspacePath: repoPath, summary: summary() });
		expect(changed).toBe(true);
		expect(await columnOf("task-1")).toBe("planning");
	});

	it("moves a running work card (non-plan-mode) from Backlog to Planning — every started card refines first (§5.B)", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "backlog" }) });
		const changed = await reconcileStartedTaskBoardLane({ workspacePath: repoPath, summary: summary() });
		expect(changed).toBe(true);
		expect(await columnOf("task-1")).toBe("planning");
	});

	it("never pulls a resumed card backward from In Progress to Planning", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "in_progress" }) });
		const changed = await reconcileStartedTaskBoardLane({ workspacePath: repoPath, summary: summary() });
		expect(changed).toBe(false);
		expect(await columnOf("task-1")).toBe("in_progress");
	});

	it("leaves a work card already refining in Planning untouched (e.g. a decompose child)", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "planning" }) });
		const changed = await reconcileStartedTaskBoardLane({ workspacePath: repoPath, summary: summary() });
		expect(changed).toBe(false);
		expect(await columnOf("task-1")).toBe("planning");
	});

	it("does NOT move a card while the task is not yet running (queued/starting)", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: true, columnId: "backlog" }) });
		const changed = await reconcileStartedTaskBoardLane({
			workspacePath: repoPath,
			summary: summary({ state: "queued" }),
		});
		expect(changed).toBe(false);
		expect(await columnOf("task-1")).toBe("backlog");
	});

	it("is a no-op when the card is already in its target lane", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: true, columnId: "planning" }) });
		const changed = await reconcileStartedTaskBoardLane({ workspacePath: repoPath, summary: summary() });
		expect(changed).toBe(false);
		expect(await columnOf("task-1")).toBe("planning");
	});

	it("never disturbs a terminal (completed) card", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: true, columnId: "completed" }) });
		const changed = await reconcileStartedTaskBoardLane({ workspacePath: repoPath, summary: summary() });
		expect(changed).toBe(false);
		expect(await columnOf("task-1")).toBe("completed");
	});
});
