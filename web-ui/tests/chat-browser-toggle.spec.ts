/**
 * Suite: Chat browser-enabled toggle (§5.M G6)
 *
 * Verifies the per-session headless-browser opt-in (`browserEnabled`), which gates the `browse_url` tool:
 *  1. The toggle is visible for a can-act scope (project_sandboxed / all_projects / host_access).
 *  2. The toggle is hidden for a `chat_only` scope (browsing is a host action, denied there).
 *  3. Toggling ON calls `updateSession` with `browserEnabled: true` immediately (no confirmation dialog —
 *     unlike the unsafe-commands toggle, browsing read-only pages is lower-risk).
 *  4. Toggling OFF calls `updateSession` with `browserEnabled: false`.
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as chat-risk-ack.spec.ts).
 */

import { expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-chat-browser-toggle-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Browser Toggle Test Project",
			taskCounts: {
				backlog: 0,
				planning: 0,
				in_progress: 0,
				review: 0,
				completed: 0,
				trash: 0,
			},
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
	id: "session-browser-toggle-test-1",
	title: "Test session",
	scope: "project_sandboxed",
	role: "planner_architect",
	goal: null,
	riskAcknowledged: false,
	createdAt: NOW,
	updatedAt: NOW,
};

// ---------------------------------------------------------------------------
// tRPC response helpers
// ---------------------------------------------------------------------------

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface MockHandles {
	getUpdateSessionBodies: () => unknown[];
}

/**
 * Registers all mock routes and returns capture handles.
 * `initialScope` and `initialBrowserEnabled` control the session returned by listSessions.
 */
async function setupMocks(
	page: Page,
	options: { initialScope?: string; initialBrowserEnabled?: boolean } = {},
): Promise<MockHandles> {
	const { initialScope = "project_sandboxed", initialBrowserEnabled = false } = options;
	const updateSessionBodies: unknown[] = [];

	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3"); // Z3 Expert: the kanban board (default Z1 has no columns)
	});

	// WebSocket: board snapshot
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		ws.onClose(() => {
			/* no-op */
		});
		ws.send(JSON.stringify(WS_SNAPSHOT));
	});

	// --- Catch-all (LIFO — lowest priority) ---
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
					return {
						result: {
							data: { models: [{ id: "test-model", name: "Test Model", contextLength: 8192 }] },
						},
					};
				}
				return { result: { data: null } };
			});
			if (stubs.length === 0) {
				stubs.push({ result: { data: null } });
			}
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(stubs),
			});
		},
	);

	// --- chat.listSessions + chat.getTranscript (LIFO) ---
	await page.route(
		(url) =>
			url.pathname.startsWith("/api/trpc/") &&
			(url.pathname.includes("chat.listSessions") || url.pathname.includes("chat.getTranscript")),
		async (route) => {
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			const stubs = procedures.map((proc) => {
				if (proc === "chat.listSessions") {
					return (
						trpcOk({
							sessions: [
								{
									...MOCK_SESSION_BASE,
									scope: initialScope,
									browserEnabled: initialBrowserEnabled,
								},
							],
						}) as unknown[]
					)[0];
				}
				if (proc === "chat.getTranscript") {
					return (trpcOk({ sessionId: MOCK_SESSION_BASE.id, messages: [] }) as unknown[])[0];
				}
				return { result: { data: null } };
			});
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(stubs),
			});
		},
	);

	// --- chat.updateSession (LIFO — highest priority) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("chat.updateSession"),
		async (route) => {
			try {
				updateSessionBodies.push(route.request().postDataJSON());
			} catch {
				// postDataJSON can throw if body is empty
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(trpcOk({ session: MOCK_SESSION_BASE })),
			});
		},
	);

	return {
		getUpdateSessionBodies: () => updateSessionBodies,
	};
}

/** Opens the chat sidebar (the collapsed rail icon) and waits for the session list. */
async function openChatSidebar(page: Page): Promise<void> {
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
	const openButton = page.getByTestId("open-chat-button");
	const isCollapsed = await openButton.isVisible();
	if (isCollapsed) {
		await openButton.click();
	}
	await expect(page.getByTestId("chat-sidebar")).toBeVisible({ timeout: 5_000 });
}

/** Clicks the first session row to select it and waits for the header to appear. */
async function selectFirstSession(page: Page): Promise<void> {
	const row = page.getByTestId("chat-session-item").first();
	await expect(row).toBeVisible({ timeout: 5_000 });
	await row.click();
	await expect(page.getByTestId("chat-session-scope")).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Chat browser-enabled toggle", () => {
	test("toggle is visible for a can-act scope (project_sandboxed)", async ({ page }) => {
		await setupMocks(page, { initialScope: "project_sandboxed", initialBrowserEnabled: false });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-browser-toggle")).toBeVisible();
	});

	test("toggle is hidden for a chat_only scope", async ({ page }) => {
		await setupMocks(page, { initialScope: "chat_only", initialBrowserEnabled: false });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-browser-toggle")).not.toBeVisible();
	});

	test("toggling ON calls updateSession with browserEnabled: true — no dialog", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, {
			initialScope: "project_sandboxed",
			initialBrowserEnabled: false,
		});
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await page.getByTestId("chat-browser-toggle").click();

		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);
		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; browserEnabled?: boolean }>;
		expect(body["0"]?.id).toBe(MOCK_SESSION_BASE.id);
		expect(body["0"]?.browserEnabled).toBe(true);
	});

	test("toggling OFF calls updateSession with browserEnabled: false", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, {
			initialScope: "project_sandboxed",
			initialBrowserEnabled: true,
		});
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await page.getByTestId("chat-browser-toggle").click();

		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);
		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; browserEnabled?: boolean }>;
		expect(body["0"]?.id).toBe(MOCK_SESSION_BASE.id);
		expect(body["0"]?.browserEnabled).toBe(false);
	});

	test("toggle is visible for host_access scope", async ({ page }) => {
		await setupMocks(page, { initialScope: "host_access", initialBrowserEnabled: false });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-browser-toggle")).toBeVisible();
	});
});
