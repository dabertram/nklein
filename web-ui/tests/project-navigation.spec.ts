/**
 * Suite: Project navigation — switching projects renders the target project's board (§5.AI)
 *
 * Verifies the workspace-aware board switch, model-free: two projects (Alpha, Beta) each with a DISTINCT card, and a
 * WebSocket mock keyed on the `?workspaceId=` in the stream URL (the board comes from `useRuntimeStateStream`, which
 * opens a NEW WebSocket per project — getRuntimeStreamUrl). Clicking the Beta project rail button switches the board
 * to Beta's card and drops Alpha's. This pins the workspace-aware mock the §5.AI project-switch work needs.
 *
 * The rapid-switch case also injects a stale snapshot and late old-workspace chat frame while recording the actual
 * A→B→A→B socket sequence, then proves the target board, task chat, and Settings config converge without a reload.
 */

import { expect, type Page, test } from "@playwright/test";
import { buildMockRuntimeConfig } from "./harness/runtime-mock";

const PROJECT_A = "ws-project-alpha";
const PROJECT_B = "ws-project-beta";

function snapshotFor(projectId: string, cardTitle: string) {
	const card = {
		id: `${projectId}-card`,
		title: cardTitle,
		prompt: cardTitle,
		agentId: "nklein",
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
		workspaceId: projectId,
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

async function setupMocks(
	page: Page,
	options: { injectStaleFirstBetaSnapshot?: boolean; serveProjectConfigs?: boolean } = {},
): Promise<{ configRequestWorkspaceIds: string[]; streamRequestWorkspaceIds: string[] }> {
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3"); // Z3 Expert: the kanban board with columns
	});

	// Workspace-aware WebSocket: pick the snapshot from the `?workspaceId=` in the stream URL (a switch opens a NEW
	// socket with the target workspace id). The initial connection (no workspaceId) defaults to Alpha.
	let betaConnectionCount = 0;
	const streamRequestWorkspaceIds: string[] = [];
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		const workspaceId = new URL(ws.url()).searchParams.get("workspaceId");
		streamRequestWorkspaceIds.push(workspaceId ?? "");
		const snapshot = workspaceId === PROJECT_B ? SNAPSHOT_B : SNAPSHOT_A;
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		if (workspaceId === PROJECT_B) {
			betaConnectionCount += 1;
			if (options.injectStaleFirstBetaSnapshot && betaConnectionCount === 1) {
				// Exercise the defensive mismatch path deterministically: the first B socket receives a genuinely stale
				// A snapshot plus a late A chat frame. The hook must reject it, reconnect, and never leak the A frame.
				ws.send(JSON.stringify(SNAPSHOT_A));
				ws.send(
					JSON.stringify({
						type: "task_chat_message",
						workspaceId: PROJECT_A,
						taskId: `${PROJECT_A}-card`,
						message: {
							id: "stale-alpha-message",
							role: "assistant",
							content: "STALE Alpha chat must never render",
							createdAt: 1_700_002_000_000,
						},
					}),
				);
				return;
			}
		}
		ws.send(JSON.stringify(snapshot));
		if (workspaceId === PROJECT_B && options.injectStaleFirstBetaSnapshot) {
			ws.send(
				JSON.stringify({
					type: "task_chat_message",
					workspaceId: PROJECT_B,
					taskId: `${PROJECT_B}-card`,
					message: {
						id: "beta-message",
						role: "assistant",
						content: "Beta chat settled on the selected project",
						createdAt: 1_700_002_000_001,
					},
				}),
			);
		}
	});

	const configRequestWorkspaceIds: string[] = [];
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
				if (proc === "runtime.getConfig" && options.serveProjectConfigs) {
					configRequestWorkspaceIds.push(headerWorkspaceId ?? "");
					return {
						result: {
							data: buildMockRuntimeConfig({ maxConcurrentTasks: headerWorkspaceId === PROJECT_B ? 7 : 2 }),
						},
					};
				}
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

	return { configRequestWorkspaceIds, streamRequestWorkspaceIds };
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

	test("rapid reversals reject stale stream data and settle board, task chat, and settings on the last project", async ({
		page,
	}) => {
		const { configRequestWorkspaceIds, streamRequestWorkspaceIds } = await setupMocks(page, {
			injectStaleFirstBetaSnapshot: true,
			serveProjectConfigs: true,
		});
		await page.goto("/");

		await expect(page.getByText("Alpha Task").first()).toBeVisible({ timeout: 15_000 });

		// Switch A→B→A→B before the first destination snapshot can settle. The second click used to be dropped
		// because currentProjectId was still A even though the requested navigation target was B.
		await page.getByText("Beta", { exact: true }).first().click();
		await expect.poll(() => streamRequestWorkspaceIds.at(-1)).toBe(PROJECT_B);
		await page.getByText("Alpha", { exact: true }).first().click();
		await expect.poll(() => streamRequestWorkspaceIds.at(-1)).toBe(PROJECT_A);
		await page.getByText("Beta", { exact: true }).first().click();
		await expect.poll(() => streamRequestWorkspaceIds.at(-1)).toBe(PROJECT_B);
		expect(streamRequestWorkspaceIds.slice(-3)).toEqual([PROJECT_B, PROJECT_A, PROJECT_B]);

		await expect(page.getByText("Beta Task").first()).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("Alpha Task")).toHaveCount(0);
		await expect(page.getByText("STALE Alpha chat must never render")).toHaveCount(0);

		// Settings is keyed by navigationCurrentProjectId, so the destination config must win even while old requests
		// and sockets are completing in the background.
		await page.getByTestId("open-settings-button").click();
		await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Agents" }).click();
		await expect(page.locator("#runtime-settings-max-concurrent-tasks")).toHaveValue("7");
		expect(configRequestWorkspaceIds).toContain(PROJECT_B);
		await page.keyboard.press("Escape");

		// The task-chat stream is workspace-filtered too: only B's message reaches B's card detail.
		await page.getByText("Beta Task").first().click();
		await expect(page.getByText("Beta chat settled on the selected project")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("STALE Alpha chat must never render")).toHaveCount(0);
	});
});
