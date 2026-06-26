import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import {
	createNKleinPromotionTool,
	type NKleinCardPromotedEvent,
	promoteCardToImplementation,
} from "../../../src/nklein-agent/nklein-promotion-tool";
import { loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";
import { createGitTestEnv } from "../../utilities/git-env";

let repoPath: string;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;
let tempHome: string;

interface PromotionResult {
	ok: boolean;
	promoted: boolean;
	instruction: string;
}

function uniqueDir(prefix: string): string {
	return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

beforeEach(() => {
	tempHome = uniqueDir("kanban-promotion-home");
	mkdirSync(tempHome, { recursive: true });
	previousHome = process.env.HOME;
	previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	repoPath = uniqueDir("kanban-promotion-repo");
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
		title: "Implement the widget",
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
			{ id: "review", title: "Review", cards: card.columnId === "review" ? [taskCard] : [] },
			{ id: "completed", title: "Completed", cards: card.columnId === "completed" ? [taskCard] : [] },
			{ id: "trash", title: "Trash", cards: card.columnId === "trash" ? [taskCard] : [] },
		],
		dependencies: [],
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

function createTool(onPromoted?: (event: NKleinCardPromotedEvent) => void) {
	return createNKleinPromotionTool({ workspacePath: repoPath, taskId: "task-1", onPromoted });
}

async function runPromotion(
	input: unknown,
	onPromoted?: (event: NKleinCardPromotedEvent) => void,
): Promise<PromotionResult> {
	const tool = createTool(onPromoted);
	return (await tool.execute(input, undefined as never)) as PromotionResult;
}

describe("createNKleinPromotionTool (begin_implementation)", () => {
	it("promotes a refining work card from Planning to In Progress and fires onPromoted", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "planning" }) });
		const events: NKleinCardPromotedEvent[] = [];
		const result = await runPromotion({ refinementNotes: "Spec still holds; nothing merged since." }, (e) =>
			events.push(e),
		);
		expect(result.ok).toBe(true);
		expect(result.promoted).toBe(true);
		expect(await columnOf("task-1")).toBe("in_progress");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			taskId: "task-1",
			fromColumnId: "planning",
			refinementNotes: "Spec still holds; nothing merged since.",
		});
	});

	it("promotes a work card straight from Backlog (defensive, if the lane had not reconciled yet)", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "backlog" }) });
		const result = await runPromotion({});
		expect(result.promoted).toBe(true);
		expect(await columnOf("task-1")).toBe("in_progress");
	});

	it("is an idempotent no-op when the card is already In Progress (does not fire onPromoted)", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "in_progress" }) });
		const events: NKleinCardPromotedEvent[] = [];
		const result = await runPromotion({}, (e) => events.push(e));
		expect(result.ok).toBe(true);
		expect(result.promoted).toBe(false);
		expect(events).toHaveLength(0);
		expect(await columnOf("task-1")).toBe("in_progress");
	});

	it("refuses to promote a planning card (startInPlanMode true) — it must decompose instead", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: true, columnId: "planning" }) });
		const events: NKleinCardPromotedEvent[] = [];
		const result = await runPromotion({}, (e) => events.push(e));
		expect(result.ok).toBe(false);
		expect(result.promoted).toBe(false);
		expect(result.instruction).toMatch(/decompose_project/);
		expect(events).toHaveLength(0);
		expect(await columnOf("task-1")).toBe("planning");
	});

	it("refuses a terminal (completed) card without moving it", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "completed" }) });
		const result = await runPromotion({});
		expect(result.ok).toBe(false);
		expect(result.promoted).toBe(false);
		expect(await columnOf("task-1")).toBe("completed");
	});

	it("refuses when the task is not on the board", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "backlog" }) });
		const tool = createNKleinPromotionTool({
			workspacePath: repoPath,
			taskId: "no-such-task",
			onPromoted: undefined,
		});
		const result = (await tool.execute({}, undefined as never)) as PromotionResult;
		expect(result.ok).toBe(false);
		expect(result.promoted).toBe(false);
		expect(await columnOf("task-1")).toBe("backlog");
	});
});

// The §5.B Increment C auto-promote recovery calls promoteCardToImplementation DIRECTLY (not via the tool) when a
// work card starts mutating the repo without first calling begin_implementation, and branches on the returned
// PromotionOutcome.state. These lock that contract independently of the tool's instruction strings.
describe("promoteCardToImplementation (Increment C recovery core)", () => {
	it("promotes a work card from Planning, returns a promoted outcome, and fires onPromoted once", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "planning" }) });
		const events: NKleinCardPromotedEvent[] = [];
		const outcome = await promoteCardToImplementation({
			workspacePath: repoPath,
			taskId: "task-1",
			onPromoted: (e) => void events.push(e),
			refinementNotes: "started editing files",
		});
		expect(outcome).toMatchObject({ moved: true, fromColumnId: "planning", state: "promoted" });
		expect(await columnOf("task-1")).toBe("in_progress");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ fromColumnId: "planning", refinementNotes: "started editing files" });
	});

	it("is a no-op once the card is already In Progress (already-implementing, no onPromoted)", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "in_progress" }) });
		const events: NKleinCardPromotedEvent[] = [];
		const outcome = await promoteCardToImplementation({
			workspacePath: repoPath,
			taskId: "task-1",
			onPromoted: (e) => void events.push(e),
		});
		expect(outcome).toMatchObject({ moved: false, state: "already-implementing" });
		expect(events).toHaveLength(0);
		expect(await columnOf("task-1")).toBe("in_progress");
	});

	it("refuses a planning card (startInPlanMode true) so a mutating tool cannot force-implement a decompose card", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: true, columnId: "planning" }) });
		const outcome = await promoteCardToImplementation({ workspacePath: repoPath, taskId: "task-1" });
		expect(outcome).toMatchObject({ moved: false, state: "planning-card" });
		expect(await columnOf("task-1")).toBe("planning");
	});

	it("returns a missing outcome without throwing when the task is not on the board", async () => {
		await saveWorkspaceState(repoPath, { board: board({ startInPlanMode: false, columnId: "backlog" }) });
		const outcome = await promoteCardToImplementation({ workspacePath: repoPath, taskId: "ghost" });
		expect(outcome).toEqual({ moved: false, fromColumnId: null, state: "missing" });
		expect(await columnOf("task-1")).toBe("backlog");
	});
});
