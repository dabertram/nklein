/**
 * Suite: Chat surface WS reconnection (F2.11 residue)
 *
 * Kills the mocked runtime state-stream WebSocket mid-session and asserts the chat surface RECOVERS — it re-opens the
 * socket and the transcript (a poll, independent of the socket) is not lost. Fully mocked (route-intercept + WS mock),
 * same pattern as chat-sidebar-send.spec.ts.
 */

import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-chat-reconnect-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Reconnect Test Project",
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
const MOCK_SESSION = {
	id: "session-reconnect-1",
	title: "Reconnect test session",
	scope: "chat_only",
	role: "planner_architect",
	goal: null,
	createdAt: NOW,
	updatedAt: NOW,
};
const USER_TEXT = "remember this across the reconnect";

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

async function setup(page: Page): Promise<{ connectionCount: () => number }> {
	let connections = 0;
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3");
	});

	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		connections += 1;
		ws.onMessage(() => {});
		ws.send(JSON.stringify(WS_SNAPSHOT));
		// Kill the FIRST connection shortly after the snapshot lands to force a client reconnect.
		if (connections === 1) {
			setTimeout(() => ws.close(), 900);
		}
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
				if (proc === "chat.listSessions") {
					return (trpcOk({ sessions: [MOCK_SESSION] }) as unknown[])[0];
				}
				if (proc === "chat.getTranscript") {
					// The transcript persists across the socket bounce (it is a poll, not the socket).
					return (
						trpcOk({
							sessionId: MOCK_SESSION.id,
							messages: [{ id: "m-user", role: "user", content: USER_TEXT, createdAt: NOW + 1 }],
						}) as unknown[]
					)[0];
				}
				return { result: { data: null } };
			});
			if (stubs.length === 0) {
				stubs.push({ result: { data: null } });
			}
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);

	return { connectionCount: () => connections };
}

test.describe("Chat WS reconnection (F2.11)", () => {
	test("the chat surface recovers after the state-stream socket drops, keeping the transcript", async ({ page }) => {
		const handles = await setup(page);
		await page.goto("/");

		// Open the chat sidebar + select the session.
		await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
		const openButton = page.getByTestId("open-chat-button");
		if (await openButton.isVisible()) {
			await openButton.click();
		}
		await expect(page.getByTestId("chat-sidebar")).toBeVisible({ timeout: 5_000 });
		await page.getByTestId("chat-session-item").first().click();
		await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout: 5_000 });

		// The transcript is present before the drop.
		await expect(page.getByText(USER_TEXT).first()).toBeVisible({ timeout: 5_000 });

		// The socket drops and the client reconnects (a second connection is established).
		await expect.poll(() => handles.connectionCount(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

		// After recovery the board still renders. The chat surface is functional again: if the state resync
		// deselected the session, re-open it — the transcript (poll-backed, never on the socket) is intact, so nothing
		// was lost across the bounce.
		await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("chat-sidebar")).toBeVisible();
		const composer = page.getByTestId("chat-composer-input");
		if (!(await composer.isVisible().catch(() => false))) {
			await page.getByTestId("chat-session-item").first().click();
		}
		await expect(page.getByText(USER_TEXT).first()).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("chat-composer-input")).toBeEnabled({ timeout: 15_000 });
	});
});
