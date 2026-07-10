import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LeanBoardView } from "@/components/lean-board-view";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumn } from "@/types";

function card(id: string, title: string, extra: Partial<BoardCard> = {}): BoardCard {
	return {
		id,
		title,
		prompt: title,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		images: [],
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...extra,
	} as BoardCard;
}

function column(id: BoardColumn["id"], cards: BoardCard[]): BoardColumn {
	return { id, title: id, cards } as BoardColumn;
}

describe("LeanBoardView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	const columns: BoardColumn[] = [
		column("backlog", [card("b1", "Backlog idea")]),
		column("planning", [
			card("p1", "Planned step", {
				generatedFromPlan: { artifactKind: "decomposition", planSlug: "s1", planTaskId: "t1" },
			}),
			card("p2", "Blocked step", { blockedKind: "needs_decomposition" }),
		]),
		column("in_progress", [card("d1", "Doing work")]),
		column("review", [card("r1", "In review")]),
		column("completed", [card("c1", "Shipped")]),
		column("trash", [card("x1", "Trashed")]),
	];

	it("renders the FULL minimal lifecycle: Queued (backlog+planning) / Doing / Review / Done — trash excluded", async () => {
		await act(async () => {
			root.render(
				<LeanBoardView
					columns={columns}
					sessions={{}}
					streamFilter={null}
					onSelectCard={() => {}}
					onBackToOverview={() => {}}
				/>,
			);
		});
		const laneText = (key: string) => container.querySelector(`[data-testid="lean-lane-${key}"]`)?.textContent ?? "";
		expect(laneText("queued")).toContain("Backlog idea");
		expect(laneText("queued")).toContain("Planned step");
		expect(laneText("queued")).toContain("3"); // count
		expect(laneText("doing")).toContain("Doing work");
		expect(laneText("review")).toContain("In review");
		expect(laneText("done")).toContain("Shipped");
		expect(container.textContent).not.toContain("Trashed");
	});

	it("marks a blocked queued card", async () => {
		await act(async () => {
			root.render(
				<LeanBoardView
					columns={columns}
					sessions={{}}
					streamFilter={null}
					onSelectCard={() => {}}
					onBackToOverview={() => {}}
				/>,
			);
		});
		expect(container.querySelector('[data-testid="lean-lane-queued"]')?.textContent).toContain("blocked");
	});

	it("filters to one stream (plan slug) when streamFilter is set", async () => {
		await act(async () => {
			root.render(
				<LeanBoardView
					columns={columns}
					sessions={{}}
					streamFilter="s1"
					onSelectCard={() => {}}
					onBackToOverview={() => {}}
				/>,
			);
		});
		const queued = container.querySelector('[data-testid="lean-lane-queued"]')?.textContent ?? "";
		expect(queued).toContain("Planned step");
		expect(queued).not.toContain("Backlog idea");
	});

	it("shows a SHORT model name + tool on a live card", async () => {
		const sessions: Record<string, RuntimeTaskSessionSummary> = {
			d1: {
				taskId: "d1",
				state: "running",
				modelId: "mistralai/devstral-small-2-2512",
				latestHookActivity: { toolName: "read_files", activityText: "reading" },
			} as unknown as RuntimeTaskSessionSummary,
		};
		await act(async () => {
			root.render(
				<LeanBoardView
					columns={columns}
					sessions={sessions}
					streamFilter={null}
					onSelectCard={() => {}}
					onBackToOverview={() => {}}
				/>,
			);
		});
		const doing = container.querySelector('[data-testid="lean-lane-doing"]')?.textContent ?? "";
		expect(doing).toContain("devstral-small-2");
		expect(doing).not.toContain("mistralai/");
		expect(doing).toContain("read_files");
	});
});

describe("queued readiness ordering", () => {
	it("floats dependency-ready cards above blocked ones and labels the wait", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const columns: BoardColumn[] = [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "planning",
				title: "Planning",
				cards: [card("late", "Repository README"), card("root", "Core domain model")],
			},
			{ id: "in_progress", title: "In progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [card("done", "Scaffold")] },
		];
		await act(async () => {
			root.render(
				<LeanBoardView
					columns={columns}
					sessions={{}}
					dependencies={[
						{ fromTaskId: "late", toTaskId: "root" },
						{ fromTaskId: "root", toTaskId: "done" },
					]}
					streamFilter={null}
					onSelectCard={() => {}}
					onBackToOverview={() => {}}
				/>,
			);
		});
		const lane = container.querySelector('[data-testid="lean-lane-queued"]') as HTMLElement;
		const rows = [...lane.querySelectorAll("button")].map((button) => button.textContent ?? "");
		// "root" is ready (its blocker completed) and must come first; "late" waits on root.
		expect(rows[0]).toContain("Core domain model");
		expect(rows[1]).toContain("Repository README");
		expect(rows[1]).toContain("waiting on 1 card(s)");
		act(() => root.unmount());
		container.remove();
	});
});
