import { describe, expect, it, vi } from "vitest";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../../../src/core/api-contract";
import {
	type BoardHealthBoardView,
	summarizeBoardHealth,
	summarizeWorkspaceBoardHealth,
} from "../../../src/core/operator-board-health";

function card(id: string, blockedKind?: RuntimeBoardCard["blockedKind"]): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `prompt ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
		...(blockedKind ? { blockedKind } : {}),
	} as RuntimeBoardCard;
}

function session(over: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary {
	return {
		taskId: "t",
		state: "running",
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 0,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...over,
	};
}

function board(cardsByColumn: Array<{ columnId: string; card: RuntimeBoardCard }>): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({
			id,
			title: id,
			cards: cardsByColumn.filter((entry) => entry.columnId === id).map((entry) => entry.card),
		})),
		dependencies: [],
	};
}

function stateWith(
	board_: RuntimeBoardData,
	sessions: Record<string, RuntimeTaskSessionSummary> = {},
): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/repo",
		statePath: "/repo/.nklein",
		git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
		board: board_,
		sessions,
		revision: 1,
	};
}

describe("summarizeWorkspaceBoardHealth", () => {
	it("is all-zero for an empty board", () => {
		const summary = summarizeWorkspaceBoardHealth(stateWith(board([])));
		expect(summary.total).toBe(0);
		expect(summary.counts).toEqual({ healthy: 0, stuck: 0, risky: 0, done: 0 });
	});

	it("classifies each card from its session + column and EXCLUDES trash", () => {
		const summary = summarizeWorkspaceBoardHealth(
			stateWith(
				board([
					{ columnId: "in_progress", card: card("run") },
					{ columnId: "completed", card: card("done1") }, // no session → idle, but completed → done
					{ columnId: "in_progress", card: card("lost") },
					{ columnId: "trash", card: card("trashed") }, // excluded
				]),
				{
					run: session({ state: "running" }),
					lost: session({ state: "running", heartbeatStatus: "lost" }),
				},
			),
		);
		expect(summary.total).toBe(3); // trash excluded
		expect(summary.counts).toEqual({ healthy: 1, stuck: 1, risky: 0, done: 1 });
		expect(summary.byState.healthy).toEqual(["run"]);
		expect(summary.byState.stuck).toEqual(["lost"]);
		expect(summary.byState.done).toEqual(["done1"]);
	});

	it("reads the card's own blockedKind from board state → sandbox-unavailable is risky, needs-decomposition is stuck", () => {
		const summary = summarizeWorkspaceBoardHealth(
			stateWith(
				board([
					{ columnId: "in_progress", card: card("sandbox", "agent_sandbox_unavailable") },
					{ columnId: "planning", card: card("decomp", "needs_decomposition") },
				]),
			),
		);
		expect(summary.counts.risky).toBe(1);
		expect(summary.counts.stuck).toBe(1);
		expect(summary.byState.risky).toEqual(["sandbox"]);
		// Both are blocked-on-setup in the inbox.
		expect(summary.inbox.blockedOnSetup.sort()).toEqual(["decomp", "sandbox"]);
	});

	it("applies caller-supplied off-summary overrides (e.g. a held delivery → risky + inbox)", () => {
		const summary = summarizeWorkspaceBoardHealth(
			stateWith(board([{ columnId: "in_progress", card: card("gated") }]), { gated: session({ state: "running" }) }),
			(taskId) => (taskId === "gated" ? { deliveryGateHeld: true } : {}),
		);
		expect(summary.counts.risky).toBe(1);
		expect(summary.inbox.heldDeliveries).toEqual(["gated"]);
	});

	it("folds a PARKED or ESCALATED review from board state → risky + the escalatedToOperator inbox (no session needed)", () => {
		const parked = { ...card("parked"), review: { status: "parked" } } as RuntimeBoardCard;
		const escalated = { ...card("escalated"), review: { status: "in_review", escalated: true } } as RuntimeBoardCard;
		const summary = summarizeWorkspaceBoardHealth(
			stateWith(
				board([
					{ columnId: "in_progress", card: parked },
					{ columnId: "in_progress", card: escalated },
				]),
			),
		);
		expect(summary.counts.risky).toBe(2);
		expect(summary.inbox.escalatedToOperator.sort()).toEqual(["escalated", "parked"]);
	});
});

// §5.V — direct coverage of the lower-level summarizeBoardHealth (the higher-level workspace variant above wraps it, so it
// was only transitively covered). Locks its own contract: trash exclusion + the per-card resolveOverrides callback.
describe("summarizeBoardHealth (§5.V coverage)", () => {
	const view = (columns: Array<{ id: string; cards: Array<Record<string, unknown>> }>): BoardHealthBoardView =>
		({ columns }) as unknown as BoardHealthBoardView;

	it("counts non-trash cards and excludes the trash column", () => {
		const summary = summarizeBoardHealth(
			view([
				{ id: "backlog", cards: [{ id: "c1" }, { id: "c2" }] },
				{ id: "trash", cards: [{ id: "gone" }] },
			]),
			{},
		);
		expect(summary.total).toBe(2);
		const allIds = Object.values(summary.byState).flat();
		expect(allIds).toContain("c1");
		expect(allIds).not.toContain("gone");
	});

	it("consults resolveOverrides for each non-trash card id", () => {
		const resolveOverrides = vi.fn(() => ({}));
		summarizeBoardHealth(view([{ id: "backlog", cards: [{ id: "c1" }, { id: "c2" }] }]), {}, resolveOverrides);
		expect(resolveOverrides).toHaveBeenCalledWith("c1");
		expect(resolveOverrides).toHaveBeenCalledWith("c2");
	});
});
