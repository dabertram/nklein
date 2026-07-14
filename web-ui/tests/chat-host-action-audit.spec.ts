/**
 * Suite: Chat host-action audit history (F2.12b)
 *
 * A can-act chat session's header carries a collapsible "Host action history" panel over the read-only audit:
 *  1. The panel is present for a can-act scope; expanding it lists the session's host-action records.
 *  2. The decision filter narrows to one decision; the "executed only" toggle drops not-run entries.
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as chat-browser-toggle.spec.ts).
 */

import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-chat-host-action-audit-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Host Action Audit Test Project",
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
const SESSION_ID = "session-host-audit-test-1";

const AUDIT_ENTRIES = [
	{
		id: "a1",
		sessionId: SESSION_ID,
		mode: "host",
		action: "host_command",
		decision: "allow",
		confirmed: false,
		executed: true,
		detail: "npm test",
		recordedAt: NOW,
	},
	{
		id: "a2",
		sessionId: SESSION_ID,
		mode: "host",
		action: "host_write",
		decision: "deny",
		confirmed: false,
		executed: false,
		detail: "rm -rf /etc",
		recordedAt: NOW - 1000,
	},
];

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

async function setupMocks(page: Page): Promise<void> {
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
				if (proc === "runtime.getChatHostActionAudit") {
					return { result: { data: { entries: AUDIT_ENTRIES } } };
				}
				if (proc === "chat.listSessions") {
					return (
						trpcOk({
							sessions: [
								{
									id: SESSION_ID,
									title: "Host session",
									scope: "host_access",
									role: "planner_architect",
									goal: null,
									riskAcknowledged: false,
									createdAt: NOW,
									updatedAt: NOW,
								},
							],
						}) as unknown[]
					)[0];
				}
				if (proc === "chat.getTranscript") {
					return (trpcOk({ sessionId: SESSION_ID, messages: [] }) as unknown[])[0];
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

async function openAuditPanel(page: Page): Promise<void> {
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
	const openButton = page.getByTestId("open-chat-button");
	if (await openButton.isVisible()) {
		await openButton.click();
	}
	await expect(page.getByTestId("chat-sidebar")).toBeVisible({ timeout: 5_000 });
	const row = page.getByTestId("chat-session-item").first();
	await expect(row).toBeVisible({ timeout: 5_000 });
	await row.click();
	await expect(page.getByTestId("chat-host-action-audit-toggle")).toBeVisible({ timeout: 5_000 });
	await page.getByTestId("chat-host-action-audit-toggle").click();
}

test.describe("Chat host-action audit history", () => {
	test("expanding the panel lists the session's host-action records", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openAuditPanel(page);

		const panel = page.getByTestId("chat-host-action-audit");
		await expect(panel).toContainText("host_command");
		await expect(panel).toContainText("npm test");
		await expect(panel).toContainText("rm -rf /etc");
	});

	test("the decision filter and executed-only toggle narrow the list", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openAuditPanel(page);
		const panel = page.getByTestId("chat-host-action-audit");

		// Filter to denied → only the denied host_write shows, the allowed host_command is gone.
		await page.getByTestId("chat-host-action-audit-decision-filter").selectOption("deny");
		await expect(panel).toContainText("rm -rf /etc");
		await expect(panel).not.toContainText("npm test");

		// Back to any, then executed-only → the not-run denied entry drops, the executed one shows.
		await page.getByTestId("chat-host-action-audit-decision-filter").selectOption("all");
		await page.getByTestId("chat-host-action-audit-executed-only").check();
		await expect(panel).toContainText("npm test");
		await expect(panel).not.toContainText("rm -rf /etc");
	});
});
