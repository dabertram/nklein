/**
 * Suite 15 — board/card lifecycle mutations (todo §5.V)
 *
 * Exercises board/card mutations via the real HTTP/tRPC seam and asserts
 * BOTH the response shape AND the resulting on-disk board state (read back
 * via workspace.getState after each mutation).
 *
 * The single mutation endpoint for all board changes is workspace.saveState —
 * it accepts a full board payload and atomically replaces the board.  The
 * seam-level oracle is:
 *   HTTP POST /api/trpc/workspace.saveState  →  response + revision increment
 *   HTTP GET  /api/trpc/workspace.getState   →  on-disk board state read-back
 *
 * On-disk file asserted: the board.json the server writes — exposed via the
 * `statePath` field in the getState response (the path prefix ends in the
 * workspace dir; board.json lives there).  We also confirm the state file
 * changes by reading the `statePath` directory directly in selected tests.
 *
 * Covered procedures (previously uncovered at the HTTP seam):
 *   workspace.saveState  — all board/card lifecycle mutations (create, move,
 *     reorder, edit fields, trash, completed, dependency add/remove, all-6-column
 *     shape) + invalid inputs (bad column id, missing board, stale revision)
 *   workspace.getState   — read-back after each mutation to confirm on-disk
 *     persistence (this procedure is used in Suite 1 for the shape test only;
 *     its on-disk-after-mutation role is new here)
 *
 * Deferred to the e2e layer (need a live agent / model / Docker):
 *   runtime.startTaskSession   — starts a live agent session
 *   runtime.stopTaskSession    — stops a running session
 *   runtime.pauseTask          — pauses a running agent task
 *   runtime.resumeTask         — resumes a paused task
 *   runtime.sendTaskSessionInput — interactive session input
 *   runtime.reloadTaskChatSession — session reload after a model change
 *   Lane-reconcile transitions (backlog→planning, review→in_progress) — driven
 *     by the task-session start path, which requires a live agent loop.
 *
 * Port-resilient: imports nothing from src/ except the board-data factory used
 * to seed the workspace (the fixture helper already has this dependency and is
 * shared across all suites).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** A full 6-column board factory (no cards by default). */
function makeBoard(options?: {
	backlogCards?: Array<{
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		agentId?: string;
		autoReviewEnabled?: boolean;
		createdAt?: number;
		updatedAt?: number;
	}>;
	planningCards?: Array<{
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		createdAt?: number;
		updatedAt?: number;
	}>;
	inProgressCards?: Array<{
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		createdAt?: number;
		updatedAt?: number;
	}>;
	reviewCards?: Array<{
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		createdAt?: number;
		updatedAt?: number;
	}>;
	completedCards?: Array<{
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		createdAt?: number;
		updatedAt?: number;
	}>;
	trashCards?: Array<{
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		createdAt?: number;
		updatedAt?: number;
	}>;
	dependencies?: Array<{ id: string; fromTaskId: string; toTaskId: string; createdAt: number }>;
}) {
	const now = Date.now();
	const toCard = (c: {
		id: string;
		title: string;
		prompt: string;
		startInPlanMode?: boolean;
		baseRef?: string;
		agentId?: string;
		autoReviewEnabled?: boolean;
		createdAt?: number;
		updatedAt?: number;
	}) => ({
		id: c.id,
		title: c.title,
		prompt: c.prompt,
		startInPlanMode: c.startInPlanMode ?? false,
		baseRef: c.baseRef ?? "main",
		...(c.agentId !== undefined ? { agentId: c.agentId } : {}),
		...(c.autoReviewEnabled !== undefined ? { autoReviewEnabled: c.autoReviewEnabled } : {}),
		createdAt: c.createdAt ?? now,
		updatedAt: c.updatedAt ?? now,
	});

	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: (options?.backlogCards ?? []).map(toCard) },
			{ id: "planning", title: "Planning", cards: (options?.planningCards ?? []).map(toCard) },
			{ id: "in_progress", title: "In Progress", cards: (options?.inProgressCards ?? []).map(toCard) },
			{ id: "review", title: "Review", cards: (options?.reviewCards ?? []).map(toCard) },
			{ id: "completed", title: "Completed", cards: (options?.completedCards ?? []).map(toCard) },
			{ id: "trash", title: "Trash", cards: (options?.trashCards ?? []).map(toCard) },
		],
		dependencies: options?.dependencies ?? [],
	};
}

/** Register the server's own cwd as a project and return workspaceId. */
async function addSelfProject(baseUrl: string, cwdPath: string): Promise<string> {
	const res = await requestJson<{ ok: boolean; project: { id: string } | null }>({
		baseUrl,
		procedure: "projects.add",
		type: "mutation",
		payload: { path: cwdPath, confirmSelfProject: true },
	});
	if (!res.payload.ok || !res.payload.project) {
		throw new Error(`Failed to register project: ${JSON.stringify(res.payload)}`);
	}
	return res.payload.project.id;
}

/** Read the current board state and return the full response. */
async function getState(
	baseUrl: string,
	workspaceId: string,
): Promise<{
	board: {
		columns: Array<{ id: string; cards: Array<Record<string, unknown>> }>;
		dependencies: Array<{ id: string; fromTaskId: string; toTaskId: string }>;
	};
	statePath: string;
	revision: number;
	sessions: Record<string, unknown>;
}> {
	const res = await requestJson<{
		board: {
			columns: Array<{ id: string; cards: Array<Record<string, unknown>> }>;
			dependencies: Array<{ id: string; fromTaskId: string; toTaskId: string }>;
		};
		statePath: string;
		revision: number;
		sessions: Record<string, unknown>;
	}>({
		baseUrl,
		procedure: "workspace.getState",
		type: "query",
		workspaceId,
	});
	if (res.status !== 200) {
		throw new Error(`workspace.getState returned ${res.status}`);
	}
	return res.payload;
}

/** Call workspace.saveState and return the response. */
async function saveState(
	baseUrl: string,
	workspaceId: string,
	board: unknown,
	expectedRevision?: number,
): Promise<{
	status: number;
	payload: {
		board: { columns: Array<{ id: string; cards: Array<Record<string, unknown>> }>; dependencies: Array<unknown> };
		revision: number;
	};
}> {
	const payload: Record<string, unknown> = { board };
	if (expectedRevision !== undefined) {
		payload.expectedRevision = expectedRevision;
	}
	return requestJson({
		baseUrl,
		procedure: "workspace.saveState",
		type: "mutation",
		workspaceId,
		payload,
	});
}

// ---------------------------------------------------------------------------
// Suite: create card → appears in the correct column
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — create card persists in the right column", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-create-cwd-");
		homeDir = makeTempDir("kanban-bl-create-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.saveState — new card in backlog appears in backlog on read-back", async () => {
		const board = makeBoard({
			backlogCards: [{ id: "card-new-1", title: "Brand New Task", prompt: "Do something" }],
		});

		const initial = await getState(server.baseUrl, workspaceId);
		const saveRes = await saveState(server.baseUrl, workspaceId, board, initial.revision);

		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.revision).toBe(initial.revision + 1);

		// Read back from server — asserts on-disk persistence
		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog).toBeDefined();
		expect(backlog?.cards).toHaveLength(1);
		expect(backlog?.cards[0]?.id).toBe("card-new-1");
		expect(backlog?.cards[0]?.title).toBe("Brand New Task");
		expect(backlog?.cards[0]?.prompt).toBe("Do something");
	});

	it("workspace.saveState — new card in planning appears in planning on read-back", async () => {
		const initial = await getState(server.baseUrl, workspaceId);
		const board = makeBoard({
			planningCards: [{ id: "card-plan-1", title: "Plan This", prompt: "Refine it" }],
		});

		const saveRes = await saveState(server.baseUrl, workspaceId, board, initial.revision);
		expect(saveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const planning = state.board.columns.find((c) => c.id === "planning");
		expect(planning?.cards).toHaveLength(1);
		expect(planning?.cards[0]?.id).toBe("card-plan-1");

		// Backlog is now empty (we overwrote the board)
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards).toHaveLength(0);
	});

	it("workspace.saveState — on-disk board.json reflects the saved card", async () => {
		const initial = await getState(server.baseUrl, workspaceId);
		const board = makeBoard({
			backlogCards: [{ id: "card-disk-check", title: "Disk Card", prompt: "Check disk" }],
		});

		await saveState(server.baseUrl, workspaceId, board, initial.revision);

		// statePath points to the workspace state directory; board.json lives there
		const updatedState = await getState(server.baseUrl, workspaceId);
		const boardJsonPath = join(updatedState.statePath, "board.json");
		const raw = JSON.parse(readFileSync(boardJsonPath, "utf8")) as {
			columns: Array<{ id: string; cards: Array<{ id: string }> }>;
		};
		const backlogOnDisk = raw.columns.find((c) => c.id === "backlog");
		expect(backlogOnDisk?.cards[0]?.id).toBe("card-disk-check");
	});
});

// ---------------------------------------------------------------------------
// Suite: move card between columns
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — move card between columns", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-move-cwd-");
		homeDir = makeTempDir("kanban-bl-move-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("backlog → in_progress: card appears in in_progress and backlog is empty", async () => {
		// Step 1: put card in backlog
		const card = { id: "card-move-1", title: "Move Me", prompt: "Start me" };
		let { revision } = await getState(server.baseUrl, workspaceId);
		await saveState(server.baseUrl, workspaceId, makeBoard({ backlogCards: [card] }), revision);

		// Step 2: move to in_progress
		({ revision } = await getState(server.baseUrl, workspaceId));
		const moveRes = await saveState(server.baseUrl, workspaceId, makeBoard({ inProgressCards: [card] }), revision);
		expect(moveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		const inProgress = state.board.columns.find((c) => c.id === "in_progress");

		expect(backlog?.cards).toHaveLength(0);
		expect(inProgress?.cards).toHaveLength(1);
		expect(inProgress?.cards[0]?.id).toBe("card-move-1");
	});

	it("in_progress → review: card moves to review column", async () => {
		const card = { id: "card-move-2", title: "Review Me", prompt: "Need review" };
		let { revision } = await getState(server.baseUrl, workspaceId);
		// Start in in_progress
		await saveState(server.baseUrl, workspaceId, makeBoard({ inProgressCards: [card] }), revision);

		// Move to review
		({ revision } = await getState(server.baseUrl, workspaceId));
		const moveRes = await saveState(server.baseUrl, workspaceId, makeBoard({ reviewCards: [card] }), revision);
		expect(moveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const review = state.board.columns.find((c) => c.id === "review");
		expect(review?.cards).toHaveLength(1);
		expect(review?.cards[0]?.id).toBe("card-move-2");
	});

	it("review → completed: card lands in completed column", async () => {
		const card = { id: "card-move-3", title: "Complete Me", prompt: "Finish this" };
		let { revision } = await getState(server.baseUrl, workspaceId);
		await saveState(server.baseUrl, workspaceId, makeBoard({ reviewCards: [card] }), revision);

		({ revision } = await getState(server.baseUrl, workspaceId));
		const moveRes = await saveState(server.baseUrl, workspaceId, makeBoard({ completedCards: [card] }), revision);
		expect(moveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const completed = state.board.columns.find((c) => c.id === "completed");
		expect(completed?.cards).toHaveLength(1);
		expect(completed?.cards[0]?.id).toBe("card-move-3");
	});

	it("backlog → trash: card moves to the trash column", async () => {
		const card = { id: "card-trash-1", title: "Trash Me", prompt: "Not needed" };
		let { revision } = await getState(server.baseUrl, workspaceId);
		await saveState(server.baseUrl, workspaceId, makeBoard({ backlogCards: [card] }), revision);

		({ revision } = await getState(server.baseUrl, workspaceId));
		const trashRes = await saveState(server.baseUrl, workspaceId, makeBoard({ trashCards: [card] }), revision);
		expect(trashRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const trash = state.board.columns.find((c) => c.id === "trash");
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(trash?.cards).toHaveLength(1);
		expect(trash?.cards[0]?.id).toBe("card-trash-1");
		expect(backlog?.cards).toHaveLength(0);
	});

	it("restore from trash: card moves back to backlog", async () => {
		const card = { id: "card-restore-1", title: "Restore Me", prompt: "Bring back" };
		let { revision } = await getState(server.baseUrl, workspaceId);
		// Put in trash first
		await saveState(server.baseUrl, workspaceId, makeBoard({ trashCards: [card] }), revision);

		// Restore to backlog
		({ revision } = await getState(server.baseUrl, workspaceId));
		const restoreRes = await saveState(server.baseUrl, workspaceId, makeBoard({ backlogCards: [card] }), revision);
		expect(restoreRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		const trash = state.board.columns.find((c) => c.id === "trash");
		expect(backlog?.cards).toHaveLength(1);
		expect(backlog?.cards[0]?.id).toBe("card-restore-1");
		expect(trash?.cards).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: card reordering within a column
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — card reordering within a column", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-order-cwd-");
		homeDir = makeTempDir("kanban-bl-order-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("saving two cards in a column preserves their order on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		const board = makeBoard({
			backlogCards: [
				{ id: "card-ord-1", title: "First", prompt: "First task" },
				{ id: "card-ord-2", title: "Second", prompt: "Second task" },
			],
		});

		const saveRes = await saveState(server.baseUrl, workspaceId, board, revision);
		expect(saveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards).toHaveLength(2);
		expect(backlog?.cards[0]?.id).toBe("card-ord-1");
		expect(backlog?.cards[1]?.id).toBe("card-ord-2");
	});

	it("reordering cards (swap position) persists the new order", async () => {
		// Read current state and swap the two existing cards
		const { revision, board: currentBoard } = await getState(server.baseUrl, workspaceId);
		const backlogCards = currentBoard.columns.find((c) => c.id === "backlog")?.cards ?? [];
		expect(backlogCards).toHaveLength(2);

		// Swap the order — create a reversed list
		const reversedBoard = makeBoard({
			backlogCards: [
				{
					id: String(backlogCards[1]?.id),
					title: String(backlogCards[1]?.title ?? ""),
					prompt: String(backlogCards[1]?.prompt ?? ""),
				},
				{
					id: String(backlogCards[0]?.id),
					title: String(backlogCards[0]?.title ?? ""),
					prompt: String(backlogCards[0]?.prompt ?? ""),
				},
			],
		});

		const swapRes = await saveState(server.baseUrl, workspaceId, reversedBoard, revision);
		expect(swapRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards[0]?.id).toBe("card-ord-2"); // swapped
		expect(backlog?.cards[1]?.id).toBe("card-ord-1");
	});
});

// ---------------------------------------------------------------------------
// Suite: card field edits
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — card field edits persist", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-edit-cwd-");
		homeDir = makeTempDir("kanban-bl-edit-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("editing a card's title persists the new title on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		// Save with original title
		await saveState(
			server.baseUrl,
			workspaceId,
			makeBoard({ backlogCards: [{ id: "card-edit-1", title: "Original Title", prompt: "original prompt" }] }),
			revision,
		);

		// Edit the title
		const { revision: rev2 } = await getState(server.baseUrl, workspaceId);
		const editRes = await saveState(
			server.baseUrl,
			workspaceId,
			makeBoard({ backlogCards: [{ id: "card-edit-1", title: "Updated Title", prompt: "original prompt" }] }),
			rev2,
		);
		expect(editRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards[0]?.title).toBe("Updated Title");
		expect(backlog?.cards[0]?.prompt).toBe("original prompt");
	});

	it("editing a card's prompt persists the new prompt on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		await saveState(
			server.baseUrl,
			workspaceId,
			makeBoard({ backlogCards: [{ id: "card-edit-2", title: "Prompt Test", prompt: "old prompt" }] }),
			revision,
		);

		const { revision: rev2 } = await getState(server.baseUrl, workspaceId);
		await saveState(
			server.baseUrl,
			workspaceId,
			makeBoard({ backlogCards: [{ id: "card-edit-2", title: "Prompt Test", prompt: "new updated prompt" }] }),
			rev2,
		);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards[0]?.prompt).toBe("new updated prompt");
	});

	it("setting agentId on a card persists on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		const res = await saveState(
			server.baseUrl,
			workspaceId,
			makeBoard({
				backlogCards: [{ id: "card-agent-1", title: "Agent Card", prompt: "use nklein", agentId: "nklein" }],
			}),
			revision,
		);
		expect(res.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards[0]?.agentId).toBe("nklein");
	});

	it("setting autoReviewEnabled=true on a card persists on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		const res = await saveState(
			server.baseUrl,
			workspaceId,
			makeBoard({
				backlogCards: [
					{
						id: "card-review-flag-1",
						title: "Auto Review Card",
						prompt: "review me",
						autoReviewEnabled: true,
					},
				],
			}),
			revision,
		);
		expect(res.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards[0]?.autoReviewEnabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite: dependency edge add and remove
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — dependency edge lifecycle", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-deps-cwd-");
		homeDir = makeTempDir("kanban-bl-deps-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	const cardA = { id: "card-dep-a", title: "Card A", prompt: "task a" };
	const cardB = { id: "card-dep-b", title: "Card B", prompt: "task b (waits on a)" };

	it("adding a dependency edge persists the edge on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		const board = makeBoard({
			backlogCards: [cardA, cardB],
			dependencies: [
				{
					id: "dep-ab",
					fromTaskId: cardA.id,
					toTaskId: cardB.id,
					createdAt: Date.now(),
				},
			],
		});

		const saveRes = await saveState(server.baseUrl, workspaceId, board, revision);
		expect(saveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		expect(state.board.dependencies).toHaveLength(1);
		expect(state.board.dependencies[0]?.id).toBe("dep-ab");
		expect(state.board.dependencies[0]?.fromTaskId).toBe(cardA.id);
		expect(state.board.dependencies[0]?.toTaskId).toBe(cardB.id);
	});

	it("dependency shape includes required fields (id, fromTaskId, toTaskId)", async () => {
		const state = await getState(server.baseUrl, workspaceId);
		const dep = state.board.dependencies[0];
		expect(dep).toBeDefined();
		expect(typeof dep?.id).toBe("string");
		expect(dep?.id.length).toBeGreaterThan(0);
		expect(typeof dep?.fromTaskId).toBe("string");
		expect(typeof dep?.toTaskId).toBe("string");
		expect(dep?.fromTaskId).not.toBe(dep?.toTaskId);
	});

	it("multiple dependency edges persist in order", async () => {
		const cardC = { id: "card-dep-c", title: "Card C", prompt: "task c" };
		const { revision } = await getState(server.baseUrl, workspaceId);
		const now = Date.now();
		const board = makeBoard({
			backlogCards: [cardA, cardB, cardC],
			dependencies: [
				{ id: "dep-ab", fromTaskId: cardA.id, toTaskId: cardB.id, createdAt: now },
				{ id: "dep-bc", fromTaskId: cardB.id, toTaskId: cardC.id, createdAt: now },
			],
		});

		const saveRes = await saveState(server.baseUrl, workspaceId, board, revision);
		expect(saveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		expect(state.board.dependencies).toHaveLength(2);
		const ids = state.board.dependencies.map((d) => d.id);
		expect(ids).toContain("dep-ab");
		expect(ids).toContain("dep-bc");
	});

	it("removing a dependency edge (saving without it) removes it on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		// Save with no dependencies
		const boardNoDeps = makeBoard({ backlogCards: [cardA, cardB] });
		const saveRes = await saveState(server.baseUrl, workspaceId, boardNoDeps, revision);
		expect(saveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		expect(state.board.dependencies).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: 6-column shape preservation
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — 6-column board shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-shape-cwd-");
		homeDir = makeTempDir("kanban-bl-shape-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("getState always returns the 6 canonical columns", async () => {
		const state = await getState(server.baseUrl, workspaceId);
		const ids = state.board.columns.map((c) => c.id);
		expect(ids).toContain("backlog");
		expect(ids).toContain("planning");
		expect(ids).toContain("in_progress");
		expect(ids).toContain("review");
		expect(ids).toContain("completed");
		expect(ids).toContain("trash");
		expect(ids).toHaveLength(6);
	});

	it("saving a board with cards in all 6 columns preserves all cards on read-back", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		const now = Date.now();
		const makeCard = (suffix: string) => ({
			id: `card-all-${suffix}`,
			title: `Card ${suffix}`,
			prompt: `prompt ${suffix}`,
			startInPlanMode: false,
			baseRef: "main",
			createdAt: now,
			updatedAt: now,
		});
		const board = makeBoard({
			backlogCards: [makeCard("backlog")],
			planningCards: [makeCard("planning")],
			inProgressCards: [makeCard("inprog")],
			reviewCards: [makeCard("review")],
			completedCards: [makeCard("completed")],
			trashCards: [makeCard("trash")],
		});

		const saveRes = await saveState(server.baseUrl, workspaceId, board, revision);
		expect(saveRes.status).toBe(200);

		const state = await getState(server.baseUrl, workspaceId);
		const cardCount = state.board.columns.reduce((sum, col) => sum + col.cards.length, 0);
		expect(cardCount).toBe(6);

		for (const col of state.board.columns) {
			expect(col.cards).toHaveLength(1);
			expect(col.cards[0]?.id).toBe(`card-all-${col.id === "in_progress" ? "inprog" : col.id}`);
		}
	});
});

// ---------------------------------------------------------------------------
// Suite: invalid input rejection
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — invalid input rejection at the HTTP seam", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-invalid-cwd-");
		homeDir = makeTempDir("kanban-bl-invalid-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.saveState with an unrecognized column id is rejected", async () => {
		const res = await requestJson<{ message?: string }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {
				board: {
					columns: [{ id: "nonexistent_column_xyz", title: "Bad Column", cards: [] }],
					dependencies: [],
				},
			},
		});
		// tRPC should reject an invalid enum value — BAD_REQUEST (400)
		expect(res.status).toBe(400);
	});

	it("workspace.saveState with missing board field is rejected", async () => {
		const res = await requestJson<{ message?: string }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {}, // board is required
		});
		expect(res.status).toBe(400);
	});

	it("workspace.saveState with a card missing required `prompt` field is rejected", async () => {
		const res = await requestJson<{ message?: string }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {
				board: {
					columns: [
						{
							id: "backlog",
							title: "Backlog",
							cards: [
								{
									id: "bad-card-no-prompt",
									title: "No Prompt Card",
									// prompt is required but absent
									startInPlanMode: false,
									baseRef: "main",
									createdAt: Date.now(),
									updatedAt: Date.now(),
								},
							],
						},
						{ id: "planning", title: "Planning", cards: [] },
						{ id: "in_progress", title: "In Progress", cards: [] },
						{ id: "review", title: "Review", cards: [] },
						{ id: "completed", title: "Completed", cards: [] },
						{ id: "trash", title: "Trash", cards: [] },
					],
					dependencies: [],
				},
			},
		});
		expect(res.status).toBe(400);
	});

	it("workspace.saveState without a workspace ID header returns an error", async () => {
		const board = makeBoard({
			backlogCards: [{ id: "card-no-ws", title: "No Workspace", prompt: "no scope" }],
		});
		// Omit workspaceId to trigger the missing-scope guard
		const res = await requestJson<{ message?: string }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			// no workspaceId
			payload: { board },
		});
		// BAD_REQUEST (400) when workspace header is absent
		expect(res.status).toBe(400);
	});

	it("workspace.saveState with an unknown workspaceId returns 404", async () => {
		const board = makeBoard({
			backlogCards: [{ id: "card-unknown-ws", title: "Unknown Workspace", prompt: "no such workspace" }],
		});
		const res = await requestJson<{ message?: string }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId: "completely-unknown-workspace-id-xyz",
			payload: { board },
		});
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Suite: revision conflict and idempotency
// ---------------------------------------------------------------------------

describe.sequential("Suite 15 — revision conflict detection", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-bl-conflict-cwd-");
		homeDir = makeTempDir("kanban-bl-conflict-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("second saveState with the already-consumed revision returns 409", async () => {
		const { revision } = await getState(server.baseUrl, workspaceId);
		const board = makeBoard({ backlogCards: [{ id: "card-conflict-1", title: "First", prompt: "First" }] });

		// First save consumes the revision
		const firstRes = await saveState(server.baseUrl, workspaceId, board, revision);
		expect(firstRes.status).toBe(200);

		// Second save with the SAME (now stale) revision → conflict
		const conflictBoard = makeBoard({
			backlogCards: [{ id: "card-conflict-2", title: "Second", prompt: "Second" }],
		});
		const conflictRes = await saveState(server.baseUrl, workspaceId, conflictBoard, revision);
		expect(conflictRes.status).toBe(409);
	});

	it("save with no expectedRevision always succeeds regardless of server revision", async () => {
		// Omitting expectedRevision should bypass the optimistic-lock check
		const board = makeBoard({
			backlogCards: [{ id: "card-no-rev", title: "No Rev", prompt: "no expected revision" }],
		});
		const res = await saveState(server.baseUrl, workspaceId, board);
		expect(res.status).toBe(200);
	});

	it("after a 409, the board on disk is unchanged from the first successful save", async () => {
		const { revision: rev0 } = await getState(server.baseUrl, workspaceId);
		const board1 = makeBoard({
			backlogCards: [{ id: "card-stable-1", title: "Stable", prompt: "unchanged" }],
		});
		const saveRes = await saveState(server.baseUrl, workspaceId, board1, rev0);
		expect(saveRes.status).toBe(200);

		// Try to overwrite with a conflicting board using the same revision
		const board2 = makeBoard({
			backlogCards: [{ id: "card-conflict-overwrite", title: "Overwrite", prompt: "should not land" }],
		});
		const conflictRes = await saveState(server.baseUrl, workspaceId, board2, rev0);
		expect(conflictRes.status).toBe(409);

		// Board should still reflect the successful first save
		const state = await getState(server.baseUrl, workspaceId);
		const backlog = state.board.columns.find((c) => c.id === "backlog");
		// "card-stable-1" should still be there; "card-conflict-overwrite" must not
		const ids = backlog?.cards.map((c) => String(c.id)) ?? [];
		expect(ids).toContain("card-stable-1");
		expect(ids).not.toContain("card-conflict-overwrite");
	});
});
