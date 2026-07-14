/**
 * Suite: Host-action confirm dialog (F2.2b/F2.12b)
 *
 * When a chat turn parks a `confirm`-tier host action, the operator is prompted to approve or deny it:
 *  1. A pending confirmation surfaces the dialog with the action + target.
 *  2. Approving calls resolveHostActionConfirm with approve:true (bound to the pending entry's identity).
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as chat-browser-toggle.spec.ts).
 */

import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-host-action-confirm-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Host Action Confirm Test Project",
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

const PENDING = {
	attemptId: "sess-1:call-9",
	sessionId: "sess-1",
	action: "host_command",
	target: "rm -rf build",
	requestedAt: 1,
	expiresAt: 999_999_999_999,
};

interface Handles {
	getResolveBodies: () => unknown[];
}

async function setupMocks(page: Page): Promise<Handles> {
	const resolveBodies: unknown[] = [];
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
				if (proc === "runtime.getPendingHostActionConfirms") {
					return { result: { data: { pending: [PENDING] } } };
				}
				return { result: { data: null } };
			});
			if (stubs.length === 0) {
				stubs.push({ result: { data: null } });
			}
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);

	// Registered AFTER the catch-all so it wins (Playwright routes are LIFO): capture the resolve mutation.
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.resolveHostActionConfirm"),
		async (route) => {
			try {
				resolveBodies.push(route.request().postDataJSON());
			} catch {
				// empty body
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([{ result: { data: { outcome: "applied" } } }]),
			});
		},
	);

	return { getResolveBodies: () => resolveBodies };
}

test.describe("Host-action confirm dialog", () => {
	test("a pending confirmation surfaces the dialog with the action + target", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await expect(page.getByTestId("host-action-confirm-detail")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("host-action-confirm-detail")).toContainText("host_command");
		await expect(page.getByTestId("host-action-confirm-detail")).toContainText("rm -rf build");
	});

	test("approving calls resolveHostActionConfirm with approve:true bound to the entry", async ({ page }) => {
		const { getResolveBodies } = await setupMocks(page);
		await page.goto("/");
		await expect(page.getByTestId("host-action-confirm-approve")).toBeVisible({ timeout: 15_000 });
		await page.getByTestId("host-action-confirm-approve").click();

		await expect.poll(() => getResolveBodies().length, { timeout: 3_000 }).toBeGreaterThan(0);
		const arg = (getResolveBodies()[0] as Record<string, Record<string, unknown>>)["0"] ?? {};
		expect(arg.attemptId).toBe("sess-1:call-9");
		expect(arg.approve).toBe(true);
		expect(arg.target).toBe("rm -rf build");
	});
});
