import { describe, expect, it } from "vitest";
import { createBoardMutationTools, createBoardReadTools } from "../../../src/chat/chat-board-tools";
import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeWorkspaceStateResponse,
} from "../../../src/core/api-contract";
import type {
	RuntimeWorkspaceAtomicMutationResponse,
	RuntimeWorkspaceAtomicMutationResult,
} from "../../../src/state/workspace-state";

function board(
	columns: Array<{ id: RuntimeBoardColumnId; title: string; cards: Array<{ id: string; title?: string }> }>,
): RuntimeBoardData {
	return {
		columns: columns.map((column) => ({
			id: column.id,
			title: column.title,
			cards: column.cards.map((card) => ({
				id: card.id,
				title: card.title ?? "",
				prompt: "",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			})),
		})),
		dependencies: [],
	};
}

function getBoardTool(loadBoard: (projectPath: string) => Promise<RuntimeBoardData>) {
	const { tools } = createBoardReadTools("/proj", { deps: { loadBoard } });
	const tool = tools.find((candidate) => candidate.name === "get_board");
	if (!tool) {
		throw new Error("get_board tool missing");
	}
	return tool;
}

/** Build a minimal RuntimeWorkspaceStateResponse with a given board and optional branch. */
function fakeState(b: RuntimeBoardData, currentBranch: string | null = "main"): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/proj",
		statePath: "/state",
		git: { currentBranch, defaultBranch: "main", branches: ["main"] },
		board: b,
		sessions: {},
		revision: 0,
	};
}

/**
 * Build an in-memory board mutator that satisfies BoardMutationDeps.mutateBoard.
 * It runs the mutation against the provided state and returns a fake response — no disk I/O.
 */
function inMemoryMutator(state: RuntimeWorkspaceStateResponse) {
	return async <T>(
		_projectPath: string,
		mutate: (s: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceAtomicMutationResult<T>,
	): Promise<RuntimeWorkspaceAtomicMutationResponse<T>> => {
		const result = mutate(state);
		return {
			value: result.value,
			state: { ...state, board: result.board },
			saved: result.save !== false,
		};
	};
}

describe("createBoardReadTools — get_board", () => {
	it("is a sandbox_read action (always allowed by the execution-mode gate)", () => {
		const { tools } = createBoardReadTools("/proj");
		expect(tools[0]?.actionKind).toBe("sandbox_read");
	});

	it("summarizes every column with its card ids and titles", async () => {
		const tool = getBoardTool(async () =>
			board([
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{ id: "c1", title: "Add login" },
						{ id: "c2", title: "Fix bug" },
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [{ id: "c3", title: "Build API" }] },
			]),
		);
		const out = await tool.run({});
		expect(out).toContain("Backlog (2): [c1] Add login · [c2] Fix bug");
		expect(out).toContain("Planning (0): —");
		expect(out).toContain("In Progress (1): [c3] Build API");
		expect(out).toContain("3 card(s) across 3 columns");
	});

	it("reports an empty board distinctly", async () => {
		const tool = getBoardTool(async () => board([{ id: "backlog", title: "Backlog", cards: [] }]));
		expect(await tool.run({})).toBe("The board has no cards yet (all columns are empty).");
	});

	it("falls back to (untitled) for a card with a blank title", async () => {
		const tool = getBoardTool(async () =>
			board([{ id: "backlog", title: "Backlog", cards: [{ id: "c1", title: "  " }] }]),
		);
		expect(await tool.run({})).toContain("[c1] (untitled)");
	});

	it("returns a safe message — never a host path — when the board cannot be read", async () => {
		const tool = getBoardTool(async () => {
			throw new Error("/private/var/folders/secret/board.json boom");
		});
		const out = await tool.run({});
		expect(out).toBe("Could not read the project board.");
		expect(out).not.toContain("/private/var");
	});

	it("does not leak the project path into the tool definition shown to the model", () => {
		const { definitions } = createBoardReadTools("/private/var/secret-proj");
		expect(JSON.stringify(definitions)).not.toContain("secret-proj");
		expect(definitions[0]?.name).toBe("get_board");
	});
});

describe("createBoardMutationTools — create_card", () => {
	it("is a control_plane action", () => {
		const { tools } = createBoardMutationTools("/proj");
		const tool = tools.find((t) => t.name === "create_card");
		expect(tool?.actionKind).toBe("control_plane");
	});

	it("adds a card to the backlog and returns its id", async () => {
		const emptyBoard = board([
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
		]);
		const state = fakeState(emptyBoard);
		const { tools } = createBoardMutationTools("/proj", {
			deps: { mutateBoard: inMemoryMutator(state) as never },
		});
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");

		const out = await tool.run({ title: "New feature", prompt: "Build the thing." });
		expect(out).toMatch(/Created card \[.+\] "New feature" in Backlog\./);
	});

	it("the created card lands in backlog with the correct fields", async () => {
		// Use a mutable container to avoid TypeScript CFA narrowing issues with closures.
		const captured: { card: RuntimeBoardCard | null } = { card: null };
		const emptyBoard = board([
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
		]);
		const state = fakeState(emptyBoard, "feat/my-branch");

		const trackingMutator = async <T>(
			_projectPath: string,
			mutate: (s: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceAtomicMutationResult<T>,
		): Promise<RuntimeWorkspaceAtomicMutationResponse<T>> => {
			const result = mutate(state);
			// The backlog column is the first column; grab the first card.
			captured.card = result.board.columns.find((col) => col.id === "backlog")?.cards[0] ?? null;
			return {
				value: result.value,
				state: { ...state, board: result.board },
				saved: true,
			};
		};

		const { tools } = createBoardMutationTools("/proj", { deps: { mutateBoard: trackingMutator as never } });
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");
		await tool.run({ title: "My task", prompt: "Do the work." });

		const card = captured.card;
		expect(card).not.toBeNull();
		expect(card?.title).toBe("My task");
		expect(card?.prompt).toBe("Do the work.");
		expect(card?.startInPlanMode).toBe(false);
		expect(card?.baseRef).toBe("feat/my-branch");
		expect(typeof card?.id).toBe("string");
		expect(card?.id.length ?? 0).toBeGreaterThan(0);
		expect(typeof card?.createdAt).toBe("number");
		expect(typeof card?.updatedAt).toBe("number");
	});

	it("falls back to defaultBranch for baseRef when currentBranch is null", async () => {
		const captured: { card: RuntimeBoardCard | null } = { card: null };
		const emptyBoard = board([{ id: "backlog", title: "Backlog", cards: [] }]);
		const state = fakeState(emptyBoard, null); // no currentBranch

		const trackingMutator = async <T>(
			_projectPath: string,
			mutate: (s: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceAtomicMutationResult<T>,
		): Promise<RuntimeWorkspaceAtomicMutationResponse<T>> => {
			const result = mutate(state);
			captured.card = result.board.columns.find((col) => col.id === "backlog")?.cards[0] ?? null;
			return { value: result.value, state: { ...state, board: result.board }, saved: true };
		};

		const { tools } = createBoardMutationTools("/proj", { deps: { mutateBoard: trackingMutator as never } });
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");
		await tool.run({ title: "T", prompt: "P" });
		expect(captured.card?.baseRef).toBe("main"); // defaultBranch fallback
	});

	it("returns an error string — never a host path — when the mutator throws", async () => {
		const failingMutator = async () => {
			throw new Error("/private/var/folders/secret/board.json boom");
		};
		const { tools } = createBoardMutationTools("/proj", { deps: { mutateBoard: failingMutator as never } });
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");

		const out = await tool.run({ title: "T", prompt: "P" });
		expect(out).toBe("Could not create the card — the board may be temporarily unavailable.");
		expect(out).not.toContain("/private/var");
	});

	it("rejects missing title", async () => {
		const { tools } = createBoardMutationTools("/proj");
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");
		const out = await tool.run({ prompt: "Some prompt" });
		expect(out).toContain("non-empty");
		expect(out).toContain("title");
	});

	it("rejects empty title", async () => {
		const { tools } = createBoardMutationTools("/proj");
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");
		const out = await tool.run({ title: "   ", prompt: "Some prompt" });
		expect(out).toContain("non-empty");
		expect(out).toContain("title");
	});

	it("rejects missing prompt", async () => {
		const { tools } = createBoardMutationTools("/proj");
		const tool = tools.find((t) => t.name === "create_card");
		if (!tool) throw new Error("create_card missing");
		const out = await tool.run({ title: "My task" });
		expect(out).toContain("non-empty");
		expect(out).toContain("prompt");
	});

	it("does not leak the project path into the tool definition shown to the model", () => {
		const { definitions } = createBoardMutationTools("/private/var/secret-proj");
		expect(JSON.stringify(definitions)).not.toContain("secret-proj");
		expect(definitions[0]?.name).toBe("create_card");
	});
});
