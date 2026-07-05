import { describe, expect, it } from "vitest";
import {
	type CardRelayDeps,
	createBoardMutationTools,
	createBoardReadTools,
	createCardRelayTools,
} from "../../../src/chat/chat-board-tools";
import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeWorkspaceStateResponse,
} from "../../../src/core/api-contract";
import type { BoardStreamsSummary } from "../../../src/core/board-streams-summary";
import { buildOperatorBoardSummary, type OperatorBoardSummary } from "../../../src/core/operator-task-state";
import type {
	RuntimeWorkspaceAtomicMutationResponse,
	RuntimeWorkspaceAtomicMutationResult,
} from "../../../src/state/workspace-state";

/** A valid OperatorBoardSummary with the given counts (empty byState/inbox — the digest reads only `counts`). */
function boardHealth(counts: OperatorBoardSummary["counts"]): OperatorBoardSummary {
	return { ...buildOperatorBoardSummary([]), counts };
}

function getBoardStatusTool(loadBoardHealth: (projectPath: string) => Promise<OperatorBoardSummary>) {
	const { tools } = createBoardReadTools("/proj", { deps: { loadBoard: async () => board([]), loadBoardHealth } });
	const tool = tools.find((candidate) => candidate.name === "get_board_status");
	if (!tool) {
		throw new Error("get_board_status tool missing");
	}
	return tool;
}

function getStreamsTool(loadBoardStreams: (projectPath: string) => Promise<BoardStreamsSummary>) {
	const { tools } = createBoardReadTools("/proj", { deps: { loadBoard: async () => board([]), loadBoardStreams } });
	const tool = tools.find((candidate) => candidate.name === "get_streams");
	if (!tool) {
		throw new Error("get_streams tool missing");
	}
	return tool;
}

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

describe("createBoardReadTools — get_board_status", () => {
	it("is a sandbox_read action (a safe control-plane query, like get_board)", () => {
		const { tools } = createBoardReadTools("/proj");
		const tool = tools.find((t) => t.name === "get_board_status");
		expect(tool?.actionKind).toBe("sandbox_read");
	});

	it("renders the board-health rollup line from the operator counts", async () => {
		const tool = getBoardStatusTool(async () => boardHealth({ healthy: 3, stuck: 1, risky: 2, done: 5 }));
		// renderHealthLine order: risky ("need you") → stuck → healthy ("on track") → done.
		expect(await tool.run({})).toBe("Board: 2 need you · 1 stuck · 3 on track · 5 done.");
	});

	it("says nothing is in progress when every bucket is empty", async () => {
		const tool = getBoardStatusTool(async () => boardHealth({ healthy: 0, stuck: 0, risky: 0, done: 0 }));
		expect(await tool.run({})).toBe("Board: nothing in progress.");
	});

	it("singularizes a single card needing attention", async () => {
		const tool = getBoardStatusTool(async () => boardHealth({ healthy: 0, stuck: 0, risky: 1, done: 0 }));
		expect(await tool.run({})).toBe("Board: 1 needs you.");
	});

	it("degrades to a safe message when the health load throws (no path leak)", async () => {
		const tool = getBoardStatusTool(async () => {
			throw new Error("/private/var/secret-proj boom");
		});
		const out = await tool.run({});
		expect(out).toBe("Could not read the project board status.");
		expect(out).not.toContain("/private/var");
	});
});

describe("createBoardReadTools — get_streams", () => {
	it("is a sandbox_read action", () => {
		const { tools } = createBoardReadTools("/proj");
		expect(tools.find((t) => t.name === "get_streams")?.actionKind).toBe("sandbox_read");
	});

	it("renders the per-stream overview from the loaded summary", async () => {
		const tool = getStreamsTool(async () => ({
			streams: [
				{
					stream: { id: "s1", title: "Auth", source: "decomposition", createdAt: 1, updatedAt: 1 },
					memberTaskIds: ["a", "b"],
					rollup: {
						counts: { healthy: 1, stuck: 0, risky: 0, done: 1 },
						progress: { done: 1, total: 2, method: "card_count" },
						health: "on_track",
						lifecycle: "active",
						frontierTaskIds: ["b"],
						stale: false,
					},
				},
			],
			ungroupedCardIds: [],
		}));
		expect(await tool.run({})).toBe('Streams (1):\n"Auth" — on track · 1/2 done · running: 1');
	});

	it("degrades to a safe message when the streams load throws (no path leak)", async () => {
		const tool = getStreamsTool(async () => {
			throw new Error("/private/var/secret-proj boom");
		});
		const out = await tool.run({});
		expect(out).toBe("Could not read the project streams.");
		expect(out).not.toContain("/private/var");
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

describe("createCardRelayTools — send_to_card (§5.AU step 6)", () => {
	const RELAY_BOARD: RuntimeBoardData = {
		...board([
			{ id: "backlog", title: "Backlog", cards: [{ id: "ready-1", title: "Ready card" }] },
			{ id: "planning", title: "Planning", cards: [{ id: "blocked-1", title: "Blocked card" }] },
			{ id: "in_progress", title: "Doing", cards: [{ id: "running-1", title: "Running card" }] },
			{ id: "completed", title: "Done", cards: [{ id: "done-1", title: "Done card" }] },
		]),
		dependencies: [{ id: "dep-1", fromTaskId: "blocked-1", toTaskId: "ready-1", createdAt: 1 }],
	};

	function relayTool(overrides: Partial<CardRelayDeps> = {}) {
		const delivered: Array<{ taskId: string; text: string }> = [];
		const queued: Array<{ taskId: string; text: string }> = [];
		const deps: CardRelayDeps = {
			loadBoard: async () => RELAY_BOARD,
			listActiveSessionTaskIds: () => new Set(["running-1"]),
			deliverLive: async (taskId, text) => {
				delivered.push({ taskId, text });
				return true;
			},
			queueMailbox: async (taskId, text) => {
				queued.push({ taskId, text });
				return queued.filter((note) => note.taskId === taskId).length;
			},
			...overrides,
		};
		const { tools } = createCardRelayTools("/proj", deps);
		const tool = tools.find((candidate) => candidate.name === "send_to_card");
		if (!tool) {
			throw new Error("send_to_card tool missing");
		}
		return { tool, delivered, queued };
	}

	it("delivers guidance LIVE to a running card, and falls back to the mailbox when delivery fails", async () => {
		const live = relayTool();
		const result = await live.tool.run({ card_id: "running-1", message: "prefer the streaming parser" });
		expect(result).toContain("Delivered to the agent");
		expect(live.delivered).toEqual([{ taskId: "running-1", text: "prefer the streaming parser" }]);
		expect(live.queued).toEqual([]);

		const dead = relayTool({ deliverLive: async () => false });
		const fallback = await dead.tool.run({ card_id: "running-1", message: "prefer the streaming parser" });
		expect(fallback).toContain("queued to its mailbox instead");
		expect(dead.queued).toHaveLength(1);
	});

	it("queues guidance on ready/blocked cards WITHOUT starting them (the §5.AU invariant)", async () => {
		const relay = relayTool();
		const ready = await relay.tool.run({ card_id: "ready-1", message: "use zod for the config schema" });
		expect(ready).toContain("Queued on [ready-1]'s mailbox");
		expect(ready).toContain("NOT started");
		const blocked = await relay.tool.run({ card_id: "blocked-1", message: "keep the API backwards compatible" });
		expect(blocked).toContain("Queued on [blocked-1]'s mailbox");
		expect(relay.delivered).toEqual([]);
	});

	it("a steer on a BLOCKED card surfaces the gated unblock suggestion, never a start", async () => {
		const relay = relayTool();
		const result = await relay.tool.run({ card_id: "blocked-1", message: "go ahead", intent: "steer" });
		expect(result).toContain("BLOCKED by [ready-1]");
		expect(result).toContain("NOT started");
		expect(relay.queued).toHaveLength(1);
	});

	it("a steer on a blockedKind-only card surfaces the REAL cause, not a phantom dependency", async () => {
		// Card blocked by an explicit blockedKind with NO dependency edge: the old suggest_unblock branch
		// told the user to "reprioritize its blocker, or drop the dependency" — advice for a dependency that
		// does not exist — and hid the actual cause. It must surface the blockedKind/blockedReason instead.
		const kindBoard: RuntimeBoardData = {
			columns: [
				{
					id: "planning",
					title: "Planning",
					cards: [
						{
							id: "k1",
							title: "Big task",
							prompt: "",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
							blockedKind: "needs_decomposition",
							blockedReason: "plan too large",
						},
					],
				},
			],
			dependencies: [],
		};
		const relay = relayTool({ loadBoard: async () => kindBoard });
		const result = await relay.tool.run({ card_id: "k1", message: "go ahead", intent: "steer" });
		expect(result).toContain("BLOCKED (needs_decomposition: plan too large)");
		expect(result).not.toContain("drop the dependency");
		expect(relay.queued).toHaveLength(1);
	});

	it("answers questions from board state and records follow-ups on done cards", async () => {
		const relay = relayTool();
		const question = await relay.tool.run({ card_id: "blocked-1", message: "what is the status?" });
		expect(question).toContain("BLOCKED — waiting on [ready-1]");
		const followup = await relay.tool.run({ card_id: "done-1", message: "also document the flag" });
		expect(followup).toContain("recorded as a follow-up");
		const unknown = await relay.tool.run({ card_id: "nope", message: "hello" });
		expect(unknown).toContain('No card with id "nope"');
	});
});

describe("createCardRelayTools — send_to_stream (§5.AU)", () => {
	const streamCard = (id: string, streamId: string): RuntimeBoardCard => ({
		id,
		title: id,
		prompt: "",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		streamId,
	});
	const STREAM_BOARD: RuntimeBoardData = {
		columns: [
			{ id: "in_progress", title: "Doing", cards: [streamCard("run-1", "s1")] },
			{
				id: "backlog",
				title: "Backlog",
				cards: [streamCard("wait-1", "s1"), streamCard("wait-2", "s1"), streamCard("other", "s2")],
			},
		],
		dependencies: [],
		streams: [{ id: "s1", title: "Auth", source: "decomposition", createdAt: 1, updatedAt: 1 }],
	};

	function streamRelayTool(overrides: Partial<CardRelayDeps> = {}) {
		const delivered: Array<{ taskId: string; text: string }> = [];
		const queued: Array<{ taskId: string; text: string }> = [];
		const deps: CardRelayDeps = {
			loadBoard: async () => STREAM_BOARD,
			listActiveSessionTaskIds: () => new Set(["run-1"]),
			deliverLive: async (taskId, text) => {
				delivered.push({ taskId, text });
				return true;
			},
			queueMailbox: async (taskId, text) => {
				queued.push({ taskId, text });
				return queued.filter((note) => note.taskId === taskId).length;
			},
			...overrides,
		};
		const tool = createCardRelayTools("/proj", deps).tools.find((candidate) => candidate.name === "send_to_stream");
		if (!tool) {
			throw new Error("send_to_stream tool missing");
		}
		return { tool, delivered, queued };
	}

	it("broadcasts to a stream: delivers live to running members, queues the rest (starts nothing)", async () => {
		const r = streamRelayTool();
		const result = await r.tool.run({ stream_id: "s1", message: "use bcrypt" });
		expect(result).toContain('Sent to stream "Auth" (3 card(s))');
		expect(result).toContain("1 delivered live");
		expect(result).toContain("2 queued to mailbox(es)");
		expect(result).toContain("No cards were started");
		// Only the running member (run-1) was delivered live; the two waiting members were queued; s2's card untouched.
		expect(r.delivered).toEqual([{ taskId: "run-1", text: "use bcrypt" }]);
		expect(r.queued.map((q) => q.taskId).sort()).toEqual(["wait-1", "wait-2"]);
	});

	it("errors on an unknown stream id and requires stream_id + message", async () => {
		expect(await streamRelayTool().tool.run({ stream_id: "nope", message: "x" })).toContain(
			'No stream with id "nope"',
		);
		expect(await streamRelayTool().tool.run({ message: "x" })).toContain("requires a non-empty `stream_id`");
		expect(await streamRelayTool().tool.run({ stream_id: "s1" })).toContain("requires a non-empty `message`");
	});
});
