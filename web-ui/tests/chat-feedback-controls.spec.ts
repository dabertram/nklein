/**
 * Suite: Chat board-feedback controls (F2.14 — verbosity + quiet)
 *
 * Verifies the per-session board→chat feedback controls that sit beside the existing mute toggle:
 *  1. The controls (mute + verbosity select + quiet toggle) are visible for a chat that OWNS a workspace.
 *  2. They are hidden for a chat that owns no workspace (board feedback only flows to an owning chat).
 *  3. Changing the verbosity select calls `updateSession` with the chosen `feedbackVerbosity`.
 *  4. Toggling quiet calls `updateSession` with `feedbackQuiet: true`.
 *  5. When board updates are muted, the verbosity select and quiet toggle are disabled (they only matter
 *     while feedback is flowing).
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as chat-browser-toggle.spec.ts).
 */

import { expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-chat-feedback-controls-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Feedback Controls Test Project",
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
	id: "session-feedback-controls-test-1",
	title: "Test session",
	scope: "project_sandboxed",
	role: "planner_architect",
	goal: null,
	riskAcknowledged: false,
	feedbackMuted: false,
	feedbackVerbosity: "normal",
	feedbackQuiet: false,
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
 * Registers all mock routes and returns capture handles. The session-shape options control whether the chat
 * owns a workspace (the gate for the feedback controls) and its initial feedback flags.
 */
async function setupMocks(
	page: Page,
	options: { owned?: boolean; feedbackMuted?: boolean; feedbackVerbosity?: string; feedbackQuiet?: boolean } = {},
): Promise<MockHandles> {
	const { owned = true, feedbackMuted = false, feedbackVerbosity = "normal", feedbackQuiet = false } = options;
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
									ownedWorkspaceId: owned ? WORKSPACE_ID : null,
									feedbackMuted,
									feedbackVerbosity,
									feedbackQuiet,
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

test.describe("Chat board-feedback controls", () => {
	test("controls are visible for a chat that owns a workspace", async ({ page }) => {
		await setupMocks(page, { owned: true });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-feedback-controls")).toBeVisible();
		await expect(page.getByTestId("chat-feedback-verbosity")).toBeVisible();
		await expect(page.getByTestId("chat-feedback-quiet-toggle")).toBeVisible();
	});

	test("controls are hidden for a chat that owns no workspace", async ({ page }) => {
		await setupMocks(page, { owned: false });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-feedback-controls")).not.toBeVisible();
	});

	test("changing verbosity calls updateSession with the chosen feedbackVerbosity", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, { owned: true, feedbackVerbosity: "normal" });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await page.getByTestId("chat-feedback-verbosity").selectOption("verbose");

		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);
		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; feedbackVerbosity?: string }>;
		expect(body["0"]?.id).toBe(MOCK_SESSION_BASE.id);
		expect(body["0"]?.feedbackVerbosity).toBe("verbose");
	});

	test("toggling quiet calls updateSession with feedbackQuiet: true", async ({ page }) => {
		const { getUpdateSessionBodies } = await setupMocks(page, { owned: true, feedbackQuiet: false });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await page.getByTestId("chat-feedback-quiet-toggle").click();

		await expect.poll(() => getUpdateSessionBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);
		const body = getUpdateSessionBodies()[0] as Record<string, { id?: string; feedbackQuiet?: boolean }>;
		expect(body["0"]?.id).toBe(MOCK_SESSION_BASE.id);
		expect(body["0"]?.feedbackQuiet).toBe(true);
	});

	test("verbosity + quiet controls are disabled while board updates are muted", async ({ page }) => {
		await setupMocks(page, { owned: true, feedbackMuted: true });
		await page.goto("/");
		await openChatSidebar(page);
		await selectFirstSession(page);

		await expect(page.getByTestId("chat-feedback-verbosity")).toBeDisabled();
		await expect(page.getByTestId("chat-feedback-quiet-toggle")).toBeDisabled();
	});
});
