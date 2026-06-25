/**
 * Suite: Chat scope selector (§5.M G3/Wave-2b)
 *
 * Verifies:
 *  1. The scope selector renders inside the SessionHeader with the four expected options
 *     (chat-only · current · all · host).
 *  2. Changing the scope calls `chat.updateSession` with the correct `scope` value.
 *  3. The selector reflects the scope returned by `chat.listSessions`.
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as
 * Suite 8 / settings.spec.ts):
 *  - WebSocket /api/runtime/ws → sends a minimal snapshot so the board renders.
 *  - tRPC chat.listSessions      → one session with scope "project_sandboxed".
 *  - tRPC chat.createSession     → returns a new session.
 *  - tRPC chat.updateSession     → spy-captured + returns success.
 *  - Catch-all /api/*            → empty stubs.
 *
 * The chat sidebar is opened by clicking the chat icon on the right rail. Session selection is
 * done by clicking the session row.
 */

import { expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-chat-scope-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Scope Test Project",
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

const MOCK_SESSION = {
	id: "session-scope-test-1",
	title: "Test session",
	scope: "project_sandboxed",
	role: "planner_architect",
	goal: null,
	createdAt: NOW,
	updatedAt: NOW,
};

// ---------------------------------------------------------------------------
// tRPC response helpers (mirrors settings.spec.ts)
// ---------------------------------------------------------------------------

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface MockHandles {
	getUpdateSessionBodies: () => unknown[];
	getCreateSessionBodies: () => unknown[];
}

/**
 * Registers all mock routes and returns capture handles.
 *
 * Route priority uses Playwright's LIFO order (last-registered wins):
 *   1. chat.updateSession (highest)
 *   2. chat.createSession
 *   3. chat.listSessions / chat.getTranscript (session data)
 *   4. Catch-all /api/* (lowest)
 */
async function setupMocks(page: Page, initialScope = "project_sandboxed"): Promise<MockHandles> {
	const updateSessionBodies: unknown[] = [];
	const createSessionBodies: unknown[] = [];

	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
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
					return (trpcOk({ sessions: [{ ...MOCK_SESSION, scope: initialScope }] }) as unknown[])[0];
				}
				if (proc === "chat.getTranscript") {
					return (trpcOk({ sessionId: MOCK_SESSION.id, messages: [] }) as unknown[])[0];
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

	// --- chat.createSession (LIFO) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("chat.createSession"),
		async (route) => {
			try {
				createSessionBodies.push(route.request().postDataJSON());
			} catch {
				// postDataJSON can throw if body is empty
			}
			const newSession = {
				...MOCK_SESSION,
				id: "session-scope-test-new",
				title: "New chat",
				scope: "chat_only",
			};
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(trpcOk({ session: newSession })),
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
				body: JSON.stringify(trpcOk({ session: MOCK_SESSION })),
			});
		},
	);

	return {
		getUpdateSessionBodies: () => updateSessionBodies,
		getCreateSessionBodies: () => createSessionBodies,
	};
}

/** Opens the chat sidebar (the collapsed rail icon) and waits for the session list. */
async function openChatSidebar(page: Page): Promise<void> {
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
	const openButton = page.getByTestId("open-chat-button");
	// Sidebar might already be open (if layout persists) — only click if visible.
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

test.describe("Chat scope selector", () => {
	test("scope selector renders all four options", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		const scopeSelect = page.getByTestId("chat-session-scope");
		await expect(scopeSelect).toBeVisible();

		// Check that all four scope options are present.
		const options = scopeSelect.locator("option");
		await expect(options).toHaveCount(4);
		await expect(options.nth(0)).toHaveText("Chat only");
		await expect(options.nth(1)).toHaveText("Current");
		await expect(options.nth(2)).toHaveText("All");
		// Host option has a warning prefix
		await expect(options.nth(3)).toContainText("Host");
	});

	test("scope selector shows the session's current scope", async ({ page }) => {
		await setupMocks(page, "project_sandboxed");
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		const scopeSelect = page.getByTestId("chat-session-scope");
		await expect(scopeSelect).toHaveValue("project_sandboxed");
	});

	test("changing scope to chat_only calls updateSession with scope=chat_only", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, "project_sandboxed");
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		const scopeSelect = page.getByTestId("chat-session-scope");
		await expect(scopeSelect).toBeVisible();
		await scopeSelect.selectOption("chat_only");

		// updateSession should have been called
		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);

		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; scope?: string }>;
		expect(body["0"]?.id).toBe(MOCK_SESSION.id);
		expect(body["0"]?.scope).toBe("chat_only");
	});

	test("changing scope to all_projects calls updateSession with scope=all_projects", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, "project_sandboxed");
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		const scopeSelect = page.getByTestId("chat-session-scope");
		await scopeSelect.selectOption("all_projects");

		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);

		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; scope?: string }>;
		expect(body["0"]?.scope).toBe("all_projects");
	});

	test("changing scope to host_access calls updateSession with scope=host_access", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, "project_sandboxed");
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		const scopeSelect = page.getByTestId("chat-session-scope");
		await scopeSelect.selectOption("host_access");

		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);

		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; scope?: string }>;
		expect(body["0"]?.scope).toBe("host_access");
	});
});
