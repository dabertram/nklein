/**
 * Suite: Project navigation — switching projects renders the target project's board (§5.AI)
 *
 * Verifies the workspace-aware board switch, model-free: two projects (Alpha, Beta) each with a DISTINCT card, and a
 * WebSocket mock keyed on the `?workspaceId=` in the stream URL (the board comes from `useRuntimeStateStream`, which
 * opens a NEW WebSocket per project — getRuntimeStreamUrl). Clicking the Beta project rail button switches the board
 * to Beta's card and drops Alpha's. This pins the workspace-aware mock the §5.AI project-switch work needs.
 *
 * (The harder half — reproducing the mid-stream switch STALL — is a fragile bug-repro left as a follow-on; this
 * pins the deterministic "switch renders the target board" invariant.)
 */

import { expect, type Page, test } from "@playwright/test";

const PROJECT_A = "ws-project-alpha";
const PROJECT_B = "ws-project-beta";

function snapshotFor(projectId: string, cardTitle: string) {
	const card = {
		id: `${projectId}-card`,
		title: cardTitle,
		prompt: cardTitle,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_001_000_000,
	};
	const columns = [
		{ id: "backlog", title: "Backlog", cards: [] },
		{ id: "planning", title: "Planning", cards: [] },
		{ id: "in_progress", title: "In Progress", cards: [card] },
		{ id: "review", title: "Review", cards: [] },
		{ id: "completed", title: "Completed", cards: [] },
		{ id: "trash", title: "Trash", cards: [] },
	];
	const projectMeta = (id: string, name: string) => ({
		id,
		path: `/home/user/${id}`,
		name,
		taskCounts: { backlog: 0, planning: 0, in_progress: 1, review: 0, completed: 0, trash: 0 },
	});
	return {
		type: "snapshot",
		currentProjectId: projectId,
		projects: [projectMeta(PROJECT_A, "Alpha"), projectMeta(PROJECT_B, "Beta")],
		workspaceState: {
			repoPath: `/home/user/${projectId}`,
			statePath: `/home/user/${projectId}/.nklein/state.json`,
			git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
			board: { columns, dependencies: [] },
			sessions: {},
			revision: 1,
		},
		workspaceMetadata: null,
		nkleinSessionContextVersion: 0,
	};
}

const SNAPSHOT_A = snapshotFor(PROJECT_A, "Alpha Task");
const SNAPSHOT_B = snapshotFor(PROJECT_B, "Beta Task");

async function setupMocks(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3"); // Z3 Expert: the kanban board with columns
	});

	// Workspace-aware WebSocket: pick the snapshot from the `?workspaceId=` in the stream URL (a switch opens a NEW
	// socket with the target workspace id). The initial connection (no workspaceId) defaults to Alpha.
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		const workspaceId = new URL(ws.url()).searchParams.get("workspaceId");
		const snapshot = workspaceId === PROJECT_B ? SNAPSHOT_B : SNAPSHOT_A;
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		ws.send(JSON.stringify(snapshot));
	});

	// Catch-all tRPC — workspace.getState is keyed by the x-nklein-workspace-id header so a getState refetch during a
	// switch returns the target project's board too.
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		(route) => {
			const headerWorkspaceId = route.request().headers()["x-nklein-workspace-id"];
			const state = headerWorkspaceId === PROJECT_B ? SNAPSHOT_B.workspaceState : SNAPSHOT_A.workspaceState;
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			const stubs = procedures.map((proc) => {
				if (proc === "workspace.getState") {
					return { result: { data: state } };
				}
				if (proc === "runtime.getSwarmStop") {
					return { result: { data: { ok: true, signal: null } } };
				}
				return { result: { data: null } };
			});
			if (stubs.length === 0) {
				stubs.push({ result: { data: null } });
			}
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);
}

test.describe("Project navigation (§5.AI workspace-aware switch)", () => {
	test("switching to another project renders that project's board", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");

		// Alpha (the default) is shown first.
		await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("Alpha Task").first()).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("Beta Task")).toHaveCount(0);

		// Switch to Beta by clicking its project row (the name text; the row's onClick fires onSelect).
		await page.getByText("Beta", { exact: true }).first().click();

		// Beta's board renders; Alpha's card is gone.
		await expect(page.getByText("Beta Task").first()).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("Alpha Task")).toHaveCount(0);
	});
});
