/**
 * Suite: Chat execution-posture chip (F2.8b)
 *
 * The session header shows a derived execution-posture chip — one legible label (with a tooltip of
 * capabilities/boundaries) computed from the session's scope + risk-ack + browser controls:
 *  1. A `chat_only` session reads "Isolated · read-only" (the read-only floor).
 *  2. A `project_sandboxed` session reads "Sandboxed · confirms host actions".
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as chat-browser-toggle.spec.ts).
 */

import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-chat-posture-chip-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Posture Chip Test Project",
			taskCounts: { backlog: 0, planning: 0, in_progress: 0, review: 0, completed: 0, trash: 0 },
		},
	],
	workspaceState: {
		repoPath: "/home/user/project",
		statePath: "/home/user/project/.nklein/state.json",
		git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
		board: {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		},
		sessions: {},
		revision: 1,
	},
	workspaceMetadata: null,
	nkleinSessionContextVersion: 0,
};

const NOW = 1_700_000_000_000;

const MOCK_SESSION_BASE = {
	id: "session-posture-chip-test-1",
	title: "Test session",
	role: "planner_architect",
	goal: null,
	riskAcknowledged: false,
	browserEnabled: false,
	createdAt: NOW,
	updatedAt: NOW,
};

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

async function setupMocks(page: Page, options: { scope: string }): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3");
	});

	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		ws.onMessage(() => {});
		ws.onClose(() => {});
		ws.send(JSON.stringify(WS_SNAPSHOT));
	});

	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		(route) => {
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			const stubs = procedures.map((proc) => {
				if (proc === "workspace.getState") {
					return { result: { data: WS_SNAPSHOT.workspaceState } };
				}
				if (proc === "runtime.getSwarmStop") {
					return { result: { data: { ok: true, signal: null } } };
				}
				if (proc === "runtime.getNKleinProviderCatalog") {
					return {
						result: {
							data: {
								providers: [
									{
										id: "lm-studio",
										name: "LM Studio",
										baseUrl: "http://localhost:1234",
										defaultModelId: "test-model",
										capabilities: ["text"],
									},
								],
							},
						},
					};
				}
				if (proc === "runtime.getNKleinProviderModels") {
					return { result: { data: { models: [{ id: "test-model", name: "Test Model", contextLength: 8192 }] } } };
				}
				return { result: { data: null } };
			});
			if (stubs.length === 0) {
				stubs.push({ result: { data: null } });
			}
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);

	await page.route(
		(url) =>
			url.pathname.startsWith("/api/trpc/") &&
			(url.pathname.includes("chat.listSessions") || url.pathname.includes("chat.getTranscript")),
		async (route) => {
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			const stubs = procedures.map((proc) => {
				if (proc === "chat.listSessions") {
					return (trpcOk({ sessions: [{ ...MOCK_SESSION_BASE, scope: options.scope }] }) as unknown[])[0];
				}
				if (proc === "chat.getTranscript") {
					return (trpcOk({ sessionId: MOCK_SESSION_BASE.id, messages: [] }) as unknown[])[0];
				}
				return { result: { data: null } };
			});
			await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);
}

async function openChatSidebar(page: Page): Promise<void> {
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
	const openButton = page.getByTestId("open-chat-button");
	if (await openButton.isVisible()) {
		await openButton.click();
	}
	await expect(page.getByTestId("chat-sidebar")).toBeVisible({ timeout: 5_000 });
}

async function selectFirstSession(page: Page): Promise<void> {
	const row = page.getByTestId("chat-session-item").first();
	await expect(row).toBeVisible({ timeout: 5_000 });
	await row.click();
	await expect(page.getByTestId("chat-session-scope")).toBeVisible({ timeout: 5_000 });
}

test.describe("Chat execution-posture chip", () => {
	test("a chat_only session reads the read-only floor posture", async ({ page }) => {
		await setupMocks(page, { scope: "chat_only" });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-posture-chip")).toContainText("Isolated · read-only");
	});

	test("a project_sandboxed session reads the sandboxed-confirming posture", async ({ page }) => {
		await setupMocks(page, { scope: "project_sandboxed" });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-posture-chip")).toContainText("Sandboxed · confirms host actions");
	});
});
