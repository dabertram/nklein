import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-egress-confirm-test";
const PENDING = {
	attemptId: "connect-9",
	host: "api.example.com",
	port: 443,
	role: "worker",
	requestedAt: 1,
	expiresAt: 999_999_999_999,
};

const SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Egress Confirm Test",
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

async function setupMocks(page: Page): Promise<unknown[]> {
	const resolveBodies: unknown[] = [];
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3");
	});
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		ws.onMessage(() => {});
		ws.onClose(() => {});
		ws.send(JSON.stringify(SNAPSHOT));
	});
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		(route) => {
			const procedures = (route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "").split(",");
			const stubs = procedures.filter(Boolean).map((procedure) => {
				if (procedure === "workspace.getState") return { result: { data: SNAPSHOT.workspaceState } };
				if (procedure === "runtime.getSwarmStop") return { result: { data: { ok: true, signal: null } } };
				if (procedure === "runtime.getPendingEgressConfirms") return { result: { data: { pending: [PENDING] } } };
				return { result: { data: null } };
			});
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);
	await page.route(
		(url) => url.pathname.includes("runtime.resolveEgressConfirm"),
		async (route) => {
			resolveBodies.push(route.request().postDataJSON());
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([{ result: { data: { outcome: "applied" } } }]),
			});
		},
	);
	return resolveBodies;
}

test.describe("Sandbox egress confirm dialog", () => {
	test("shows the exact destination and originating role", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await expect(page.getByTestId("egress-confirm-detail")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("egress-confirm-detail")).toContainText("api.example.com:443");
		await expect(page.getByTestId("egress-confirm-detail")).toContainText("worker");
	});

	test("approves only the displayed attempt identity", async ({ page }) => {
		const resolveBodies = await setupMocks(page);
		await page.goto("/");
		await page.getByTestId("egress-confirm-approve").click();
		await expect.poll(() => resolveBodies.length).toBeGreaterThan(0);
		const input = (resolveBodies[0] as Record<string, Record<string, unknown>>)["0"] ?? {};
		expect(input).toMatchObject({
			attemptId: "connect-9",
			host: "api.example.com",
			port: 443,
			role: "worker",
			approve: true,
		});
	});
});
