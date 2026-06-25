/**
 * Suite 7 — Playwright: plan-artifact review panel (§5.V)
 *
 * Tests the PendingPlanArtifactsPanel (pending-plan-artifacts-panel.tsx) which renders
 * pending decomposition artifacts for a task and lets the user apply or reject each.
 *
 * Backend approach: MOCKED via Playwright route-intercept + WebSocket mock.
 *
 * The live app proxies /api/* to the real runtime backend (vite.config.ts), so these
 * tests never need a real runtime process running. Instead:
 *   - page.routeWebSocket intercepts /api/runtime/ws and injects a synthetic snapshot
 *     message that loads a project + in-progress card into the board.
 *   - page.route intercepts /api/trpc/* batch requests for listNKleinPlanArtifacts,
 *     applyNKleinPlanArtifact, and rejectNKleinPlanArtifact with canned responses.
 *   - All other /api/trpc/* calls (config, workspace-state saves, etc.) are absorbed
 *     with empty-but-valid stubs so the UI doesn't hang.
 *
 * tRPC httpBatchLink format (confirmed from @trpc/client source):
 *   Query:    GET  /api/trpc/<router>.<procedure>?batch=1&input=<urlencoded-json>
 *   Mutation: POST /api/trpc/<router>.<procedure>?batch=1   body: <json>
 *   Response: JSON array — one element per batched call — [{ result: { data: <payload> } }]
 */

import { expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-plan-artifact-test";
const TASK_ID = "task-plan-artifact-001";
const ARTIFACT_ID = "artifact-decomp-abc";

/** Minimal board card in in_progress so clicking it opens the detail panel. */
const BOARD_CARD = {
	id: TASK_ID,
	title: "Decompose auth module",
	prompt: "Decompose auth module",
	startInPlanMode: false,
	baseRef: "main",
	createdAt: 1_700_000_000_000,
	updatedAt: 1_700_000_000_000,
};

/** Minimal workspace state snapshot pushed over WebSocket. */
const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Test Project",
			taskCounts: {
				backlog: 0,
				planning: 0,
				in_progress: 1,
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
				{ id: "in_progress", title: "In Progress", cards: [BOARD_CARD] },
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

/** One pending plan artifact returned by listNKleinPlanArtifacts. */
const MOCK_ARTIFACT = {
	artifactId: ARTIFACT_ID,
	artifactKind: "decomposition",
	planSlug: "auth-decompose-v1",
	title: "Auth Module Decomposition Plan",
	sourceTaskId: TASK_ID,
	createdAt: 1_700_100_000_000,
	updatedAt: 1_700_100_000_000,
	validationStatus: "valid",
	applicationStatus: "pending",
	taskCount: 5,
	dependencyCount: 3,
	specPath: ".nklein/plans/auth-decompose-v1/spec.md",
	planPath: ".nklein/plans/auth-decompose-v1/plan.json",
	summaryPath: ".nklein/plans/auth-decompose-v1/summary.md",
	taskGraphPath: ".nklein/plans/auth-decompose-v1/task-graph.json",
};

/** Minimal workspace state for apply response (just enough for the schema). */
const MOCK_WORKSPACE_STATE_AFTER_APPLY = {
	repoPath: "/home/user/project",
	statePath: "/home/user/project/.nklein/state.json",
	git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
	board: {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [BOARD_CARD] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	},
	sessions: {},
	revision: 2,
};

// ---------------------------------------------------------------------------
// tRPC response helpers
// ---------------------------------------------------------------------------

/** Wraps a payload in the tRPC httpBatchLink response envelope. */
function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

/** Wraps an error in the tRPC httpBatchLink error envelope (available for future error-path tests). */
function _trpcError(message: string): unknown[] {
	return [{ error: { message, code: -32_603, data: { code: "INTERNAL_SERVER_ERROR" } } }];
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Registers all mock routes on the page:
 *  - WebSocket /api/runtime/ws  → sends the snapshot fixture
 *  - tRPC listNKleinPlanArtifacts → returns MOCK_ARTIFACT
 *  - tRPC applyNKleinPlanArtifact / rejectNKleinPlanArtifact → success
 *  - Catch-all /api/trpc/* → empty stubs so other calls don't 500
 */
async function setupMocks(
	page: Page,
	options: {
		listResponse?: unknown;
		applyResponse?: unknown;
		rejectResponse?: unknown;
	} = {},
): Promise<void> {
	const {
		listResponse = trpcOk({ artifacts: [MOCK_ARTIFACT] }),
		applyResponse = trpcOk({
			ok: true,
			artifact: { ...MOCK_ARTIFACT, applicationStatus: "applied" },
			createdTaskCount: 5,
			createdDependencyCount: 3,
			message: "Applied 5 tasks from Auth Module Decomposition Plan",
			workspaceState: MOCK_WORKSPACE_STATE_AFTER_APPLY,
		}),
		rejectResponse = trpcOk({
			ok: true,
			artifact: { ...MOCK_ARTIFACT, applicationStatus: "rejected" },
			message: "Rejected Auth Module Decomposition Plan",
		}),
	} = options;

	// Pre-seed localStorage BEFORE any page load so the onboarding dialog (which checks
	// nklein.onboarding.dialog.shown) is suppressed and doesn't block the board.
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
	});

	// --- WebSocket: inject snapshot so the board loads without a real backend ---
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		// Absorb messages from the page (keep-alives, ping, etc.)
		ws.onMessage(() => {
			/* no-op: we are the mock server */
		});
		// Close gracefully when the page disconnects
		ws.onClose(() => {
			/* no-op */
		});
		// Send snapshot immediately after the WS is opened (simulate server push)
		ws.send(JSON.stringify(WS_SNAPSHOT));
	});

	// --- Catch-all: absorb remaining /api/* calls with minimal stubs ---
	//
	// IMPORTANT: In Playwright, routes run in LIFO order (last registered = highest priority).
	// The catch-all is registered FIRST so that the specific routes below can override it.
	//
	// tRPC httpBatchLink sends comma-joined procedures in one request:
	//   GET /api/trpc/runtime.getConfig,runtime.getNKleinKanbanAccess?batch=1&input=...
	// The response MUST be an array with exactly one element per procedure.
	//
	// CRITICAL: workspace.getState is frequently batched with runtime procedures
	// (e.g. runtime.getNKleinCodeIntelligenceStatus,runtime.getConfig,...,workspace.getState).
	// If workspace.getState gets a null stub it calls applyWorkspaceState(null) which
	// clears appliedWorkspaceProjectId → isWorkspaceMetadataPending = true → board hidden.
	// We inspect the procedure list and substitute the real workspace state for any
	// workspace.getState element, null for everything else.
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
				if (proc === "runtime.collectTaskEvidence") {
					// Return a minimal valid evidence response to prevent promptBlock crash
					return {
						result: {
							data: {
								ok: true,
								promptBlock: "",
								bundlePath: "/tmp/evidence",
								summaryText: "",
								diffPatchText: null,
								files: {
									summary: null,
									diffPatch: null,
									telemetry: null,
									configSnapshot: null,
									evalResult: null,
									transcripts: [],
								},
							},
						},
					};
				}
				if (proc === "runtime.listNKleinPlanArtifacts") {
					// Default: empty list (specific per-test override uses include-match route below)
					return { result: { data: { artifacts: [] } } };
				}
				if (proc === "runtime.applyNKleinPlanArtifact") {
					return { result: { data: null } };
				}
				if (proc === "runtime.rejectNKleinPlanArtifact") {
					return { result: { data: null } };
				}
				return { result: { data: null } };
			});
			// Non-tRPC paths get a single null stub
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

	// --- tRPC: listNKleinPlanArtifacts (query → GET) ---
	// Registered AFTER the catch-all so it takes priority (LIFO).
	// listNKleinPlanArtifacts can appear alone or batched with other procedures.
	// Use includes() so both "/api/trpc/runtime.listNKleinPlanArtifacts" and
	// "/api/trpc/runtime.listNKleinPlanArtifacts,runtime.getTaskDiagnostics" are matched.
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.listNKleinPlanArtifacts"),
		async (route) => {
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			const stubs = procedures.map((proc) => {
				if (proc === "runtime.listNKleinPlanArtifacts") {
					// Unwrap the outer array from listResponse (which is already trpcOk-wrapped)
					return (listResponse as unknown[])[0];
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

	// --- tRPC: applyNKleinPlanArtifact (mutation → POST) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.applyNKleinPlanArtifact"),
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(applyResponse),
			}),
	);

	// --- tRPC: rejectNKleinPlanArtifact (mutation → POST) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.rejectNKleinPlanArtifact"),
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(rejectResponse),
			}),
	);
}

// ---------------------------------------------------------------------------
// Board navigation helpers
// ---------------------------------------------------------------------------

/**
 * Waits for the kanban board to be in a stable, fully-rendered state and then
 * opens the detail panel for the target card.
 *
 * The board goes through a brief loading state right after the WS snapshot lands
 * (isWorkspaceMetadataPending while appliedWorkspaceProjectId catches up to
 * currentProjectId). We wait for both the "In Progress" column header AND the
 * card inside it to be simultaneously visible, then click.
 */
async function openCard(page: Page, cardTitle: string): Promise<void> {
	// The board briefly hides behind a loading spinner while appliedWorkspaceProjectId
	// catches up to currentProjectId.  Once the WS snapshot is applied the board appears
	// with the card, but a follow-up workspace.getState refresh (batched with runtime
	// procedures) re-runs applyWorkspaceState, causing a short re-render cycle.
	// We wait for the card itself — Playwright retries the locator automatically and will
	// catch the card as soon as it becomes visible in that stable window.
	const card = page.locator("[data-column-id='in_progress'] [data-task-id]").filter({ hasText: cardTitle }).first();
	await expect(card).toBeVisible({ timeout: 15_000 });

	// Click the card's title <p> specifically rather than the card shell's geometric center.
	// The card shell includes an "Create task evidence" button on the right edge; clicking the
	// center of a tall card can land on that button instead, which triggers collectTaskEvidence
	// rather than opening the detail panel.
	const titleEl = card.locator("p").filter({ hasText: cardTitle }).first();
	await titleEl.click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("PendingPlanArtifactsPanel", () => {
	test("renders a pending artifact with title, task count, and dependency count", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Decompose auth module");

		// Panel header
		await expect(page.getByText("Pending plan artifacts")).toBeVisible();
		// Artifact title
		await expect(page.getByText("Auth Module Decomposition Plan")).toBeVisible();
		// Task/dependency summary line rendered by the panel
		await expect(page.getByText(/5 tasks, 3 dependencies/)).toBeVisible();
		// Both action buttons must be present and enabled
		await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
		await expect(page.getByRole("button", { name: "Reject" })).toBeEnabled();
	});

	test("Apply calls applyNKleinPlanArtifact and removes the artifact from the panel", async ({ page }) => {
		let applyRequestBody: unknown = null;

		await setupMocks(page);

		// Intercept after setupMocks so we can capture the request body.
		// Routes registered later take precedence for the same path (LIFO).
		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.applyNKleinPlanArtifact"),
			async (route) => {
				applyRequestBody = route.request().postDataJSON();
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(
						trpcOk({
							ok: true,
							artifact: { ...MOCK_ARTIFACT, applicationStatus: "applied" },
							createdTaskCount: 5,
							createdDependencyCount: 3,
							message: "Applied 5 tasks from Auth Module Decomposition Plan",
							workspaceState: MOCK_WORKSPACE_STATE_AFTER_APPLY,
						}),
					),
				});
			},
		);

		await page.goto("/");
		await openCard(page, "Decompose auth module");
		await expect(page.getByText("Auth Module Decomposition Plan")).toBeVisible();

		await page.getByRole("button", { name: "Apply" }).click();

		// The panel renders null once all artifacts are removed, so the header disappears.
		// Scope to the panel itself to avoid matching any success toast that mentions the title.
		await expect(page.getByText("Pending plan artifacts")).not.toBeVisible({ timeout: 5_000 });

		// Verify the mutation was called with the correct artifactId.
		// tRPC httpBatchLink POST body: arrayToDict(inputs) → { "0": { artifactId: "..." } }
		expect(applyRequestBody).not.toBeNull();
		const body = applyRequestBody as Record<string, { artifactId: string }>;
		expect(body["0"]?.artifactId).toBe(ARTIFACT_ID);
	});

	test("Reject calls rejectNKleinPlanArtifact and removes the artifact from the panel", async ({ page }) => {
		let rejectRequestBody: unknown = null;

		await setupMocks(page);

		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.rejectNKleinPlanArtifact"),
			async (route) => {
				rejectRequestBody = route.request().postDataJSON();
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(
						trpcOk({
							ok: true,
							artifact: { ...MOCK_ARTIFACT, applicationStatus: "rejected" },
							message: "Rejected Auth Module Decomposition Plan",
						}),
					),
				});
			},
		);

		await page.goto("/");
		await openCard(page, "Decompose auth module");
		await expect(page.getByText("Auth Module Decomposition Plan")).toBeVisible();

		await page.getByRole("button", { name: "Reject" }).click();

		// The panel renders null once all artifacts are removed, so the header disappears.
		await expect(page.getByText("Pending plan artifacts")).not.toBeVisible({ timeout: 5_000 });

		// Verify the mutation was called with the correct artifactId.
		// tRPC httpBatchLink POST body: arrayToDict(inputs) → { "0": { artifactId: "..." } }
		expect(rejectRequestBody).not.toBeNull();
		const body = rejectRequestBody as Record<string, { artifactId: string }>;
		expect(body["0"]?.artifactId).toBe(ARTIFACT_ID);
	});

	test("panel is not visible when listNKleinPlanArtifacts returns an empty artifact list", async ({ page }) => {
		await setupMocks(page, { listResponse: trpcOk({ artifacts: [] }) });
		await page.goto("/");
		await openCard(page, "Decompose auth module");

		// With no artifacts the panel renders null — no "Pending plan artifacts" header
		await expect(page.getByText("Pending plan artifacts")).not.toBeVisible();
	});

	test("Apply button is disabled while a request is in-flight", async ({ page }) => {
		let resolveMutation: ((value: unknown) => void) | null = null;
		const mutationHeld = new Promise<void>((resolve) => {
			resolveMutation = () => resolve();
		});

		await setupMocks(page);

		// Install a slow apply handler that we control
		await page.route(
			(url) => url.pathname === "/api/trpc/runtime.applyNKleinPlanArtifact",
			async (route) => {
				resolveMutation?.();
				// Hold the response so we can observe the disabled state
				await new Promise<void>((r) => setTimeout(r, 800));
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(
						trpcOk({
							ok: true,
							artifact: { ...MOCK_ARTIFACT, applicationStatus: "applied" },
							createdTaskCount: 5,
							createdDependencyCount: 3,
							message: "Applied",
							workspaceState: MOCK_WORKSPACE_STATE_AFTER_APPLY,
						}),
					),
				});
			},
		);

		await page.goto("/");
		await openCard(page, "Decompose auth module");

		await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();

		// Kick off Apply (don't await — it's deliberately slow)
		void page.getByRole("button", { name: "Apply" }).click();

		// Wait until the request has actually landed on the handler
		await mutationHeld;

		// While the request is in-flight, both buttons must be disabled
		await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Reject" })).toBeDisabled();
	});
});
