/**
 * Suite: Chat capability grants + revoke (F2.2)
 *
 * A can-act chat session's header carries a collapsible "Active permissions" panel over the session's standing
 * capability grants (the least-scope approvals that let a confirmed host action re-run without re-prompting):
 *  1. The panel is present for a can-act scope; expanding it lists the session's active grants.
 *  2. Clicking "Revoke" on a grant calls the revoke mutation and removes it from the list, leaving the others.
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock. The mock is STATEFUL — a revoke actually
 * drops the key from what the next list query returns, so the test proves the round-trip, not just an optimistic edit.
 */

import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-chat-capability-grants-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Capability Grants Test Project",
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
const SESSION_ID = "session-capability-grants-test-1";
const GRANT_A = "host_command:npm test";
const GRANT_B = "host_write:/etc/hosts";

function trpcOk(payload: unknown): { result: { data: unknown } } {
	return { result: { data: payload } };
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

	// Stateful: revoked keys are removed from what the list query returns thereafter — proving the round-trip.
	const revoked = new Set<string>();
	const allGrants = [
		{ key: GRANT_A, grantedAt: NOW, expiresAt: NOW + 15 * 60_000 },
		{ key: GRANT_B, grantedAt: NOW, expiresAt: NOW + 15 * 60_000 },
	];

	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			// Decode the input for a revoke mutation (POST body → keyed by index) to know which key to drop.
			let revokeKey: string | null = null;
			if (procedures.includes("runtime.revokeChatSessionCapabilityGrant")) {
				try {
					const body = route.request().postDataJSON() as Record<string, { key?: string }>;
					revokeKey = Object.values(body ?? {})[0]?.key ?? null;
				} catch {
					revokeKey = null;
				}
			}
			const stubs = procedures.map((proc) => {
				if (proc === "workspace.getState") {
					return trpcOk(WS_SNAPSHOT.workspaceState);
				}
				if (proc === "runtime.getSwarmStop") {
					return trpcOk({ ok: true, signal: null });
				}
				if (proc === "runtime.getChatSessionCapabilityGrants") {
					return trpcOk({ grants: allGrants.filter((grant) => !revoked.has(grant.key)) });
				}
				if (proc === "runtime.revokeChatSessionCapabilityGrant") {
					const removed = revokeKey !== null && !revoked.has(revokeKey);
					if (revokeKey !== null) {
						revoked.add(revokeKey);
					}
					return trpcOk({ revoked: removed });
				}
				if (proc === "chat.listSessions") {
					return trpcOk({
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
					});
				}
				if (proc === "chat.getTranscript") {
					return trpcOk({ sessionId: SESSION_ID, messages: [] });
				}
				return trpcOk(null);
			});
			if (stubs.length === 0) {
				stubs.push(trpcOk(null));
			}
			await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);
}

async function openGrantsPanel(page: Page): Promise<void> {
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
	const openButton = page.getByTestId("open-chat-button");
	if (await openButton.isVisible()) {
		await openButton.click();
	}
	await expect(page.getByTestId("chat-sidebar")).toBeVisible({ timeout: 5_000 });
	const row = page.getByTestId("chat-session-item").first();
	await expect(row).toBeVisible({ timeout: 5_000 });
	await row.click();
	await expect(page.getByTestId("chat-capability-grants-toggle")).toBeVisible({ timeout: 5_000 });
	await page.getByTestId("chat-capability-grants-toggle").click();
}

test.describe("Chat capability grants", () => {
	test("expanding the panel lists the session's active grants", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openGrantsPanel(page);

		const panel = page.getByTestId("chat-capability-grants");
		await expect(panel).toContainText(GRANT_A);
		await expect(panel).toContainText(GRANT_B);
	});

	test("revoking a grant removes it (round-trip), leaving the others standing", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openGrantsPanel(page);
		const panel = page.getByTestId("chat-capability-grants");
		await expect(panel).toContainText(GRANT_A);

		// Revoke the first grant: the row's Revoke button. After the mutation + refetch, GRANT_A is gone, GRANT_B stays.
		await panel.getByTestId("chat-capability-grant-revoke").first().click();
		await expect(panel).not.toContainText(GRANT_A);
		await expect(panel).toContainText(GRANT_B);
	});
});
