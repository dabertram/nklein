import { describe, expect, it } from "vitest";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../../../src/core/api-contract";
import { summarizeWorkspaceBoardHealth } from "../../../src/core/operator-board-health";

function card(id: string): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `prompt ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
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

	it("applies caller-supplied off-summary overrides (e.g. a held delivery → risky + inbox)", () => {
		const summary = summarizeWorkspaceBoardHealth(
			stateWith(board([{ columnId: "in_progress", card: card("gated") }]), { gated: session({ state: "running" }) }),
			(taskId) => (taskId === "gated" ? { deliveryGateHeld: true } : {}),
		);
		expect(summary.counts.risky).toBe(1);
		expect(summary.inbox.heldDeliveries).toEqual(["gated"]);
	});
});
