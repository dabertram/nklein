/**
 * Suite 9 — Playwright: second-opinion review panel + task recovery actions (§5.V)
 *
 * Tests:
 *   - SecondOpinionReviewPanel (second-opinion-review-panel.tsx):
 *     Renders when a board card carries a `review` object. Verifies the verdict
 *     status label and summary text are surfaced.
 *   - TaskRecoveryActionsPanel (task-recovery-actions-panel.tsx):
 *     Renders "Review actions" for a card in the `review` column; verifies the
 *     "Create evidence" button fires runtime.collectTaskEvidence and the
 *     "Merge" button fires runtime.mergeTaskWorktrees.
 *
 * Backend approach: MOCKED — identical pattern to Suite 7/8.
 *
 * Key implementation notes:
 *  - SecondOpinionReviewPanel reads selection.card.review — the card must carry
 *    a `review` field in the WS snapshot board state.
 *  - TaskRecoveryActionsPanel's canMerge = column.id === "review"; canVerify
 *    requires column "planning"|"review" + an Acceptance check line in the prompt.
 *  - canCollectEvidence = Boolean(workspaceId), always true for our WS snapshot.
 *  - tRPC mutation names:
 *    • runtime.collectTaskEvidence  (POST, body: { "0": { taskId } })
 *    • runtime.mergeTaskWorktrees   (POST, body: { "0": { taskId, column } })
 *    • runtime.verifyTaskAcceptance (POST, body: { "0": { taskId, ensureWorktree } })
 */

import { expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-review-recovery-test";
const TASK_ID = "task-review-recovery-001";

/** A card with a `review` field so SecondOpinionReviewPanel renders. */
const REVIEW_BOARD_CARD = {
	id: TASK_ID,
	title: "Refactor payment gateway",
	prompt: "Refactor payment gateway\nAcceptance check: npm test",
	startInPlanMode: false,
	baseRef: "main",
	createdAt: 1_700_000_000_000,
	updatedAt: 1_700_001_000_000,
	review: {
		status: "changes_requested",
		round: 2,
		history: [],
		lastVerdict: "changes_requested",
		lastSummary: "Overall the refactor looks good but there are test coverage gaps.",
		lastFeedback: "Add unit tests for the retry logic and error handling paths.",
		lastInsight: "Consider extracting the retry policy into a separate module.",
		signOff: null,
		parkedReason: null,
		updatedAt: 1_700_001_000_000,
	},
};

/** Minimal workspace snapshot with the card in the `review` column. */
const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Review Recovery Test",
			taskCounts: {
				backlog: 0,
				planning: 0,
				in_progress: 0,
				review: 1,
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
				{ id: "review", title: "Review", cards: [REVIEW_BOARD_CARD] },
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

// ---------------------------------------------------------------------------
// tRPC response helpers (mirrors Suite 7/8)
// ---------------------------------------------------------------------------

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

// ---------------------------------------------------------------------------
// Mock evidence response
// ---------------------------------------------------------------------------

const MOCK_EVIDENCE_RESPONSE = {
	ok: true,
	promptBlock: "Evidence prompt block content here",
	bundlePath: "/tmp/evidence/task-review-001",
	summaryText: "Summary of evidence",
	diffPatchText: null,
	files: {
		summary: null,
		diffPatch: null,
		telemetry: null,
		configSnapshot: null,
		evalResult: null,
		transcripts: [],
	},
};

const MOCK_MERGE_RESPONSE = {
	ok: true,
	message: "Merge completed successfully.",
	conflict: null,
};

const MOCK_VERIFY_RESPONSE = {
	ok: true,
	message: "Acceptance check passed.",
	acceptance: {
		passed: true,
		command: "npm test",
		output: "All tests pass",
		failureCategory: null,
		failureHint: null,
	},
};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Registers all mock routes.
 * Returns spy capture for collectTaskEvidence and mergeTaskWorktrees bodies.
 */
async function setupMocks(
	page: Page,
	options: {
		evidenceResponse?: unknown;
		mergeResponse?: unknown;
		verifyResponse?: unknown;
	} = {},
): Promise<{
	getEvidenceBodies: () => unknown[];
	getMergeBodies: () => unknown[];
	getVerifyBodies: () => unknown[];
}> {
	const {
		evidenceResponse = trpcOk(MOCK_EVIDENCE_RESPONSE),
		mergeResponse = trpcOk(MOCK_MERGE_RESPONSE),
		verifyResponse = trpcOk(MOCK_VERIFY_RESPONSE),
	} = options;

	const evidenceBodies: unknown[] = [];
	const mergeBodies: unknown[] = [];
	const verifyBodies: unknown[] = [];

	// Pre-seed localStorage so the onboarding dialog is suppressed.
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
	});

	// --- WebSocket: inject snapshot ---
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		ws.onClose(() => {
			/* no-op */
		});
		ws.send(JSON.stringify(WS_SNAPSHOT));
	});

	// --- Catch-all (LIFO — registered first, lowest priority) ---
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
				if (proc === "runtime.listNKleinPlanArtifacts") {
					return { result: { data: { artifacts: [] } } };
				}
				if (proc === "runtime.getTaskDiagnostics") {
					return { result: { data: { diagnostics: [], taskId: TASK_ID } } };
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

	// --- runtime.collectTaskEvidence (mutation → POST) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.collectTaskEvidence"),
		async (route) => {
			try {
				evidenceBodies.push(route.request().postDataJSON());
			} catch {
				// ignore
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(evidenceResponse),
			});
		},
	);

	// --- runtime.mergeTaskWorktrees (mutation → POST) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.mergeTaskWorktrees"),
		async (route) => {
			try {
				mergeBodies.push(route.request().postDataJSON());
			} catch {
				// ignore
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(mergeResponse),
			});
		},
	);

	// --- runtime.verifyTaskAcceptance (mutation → POST) ---
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.verifyTaskAcceptance"),
		async (route) => {
			try {
				verifyBodies.push(route.request().postDataJSON());
			} catch {
				// ignore
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(verifyResponse),
			});
		},
	);

	return {
		getEvidenceBodies: () => evidenceBodies,
		getMergeBodies: () => mergeBodies,
		getVerifyBodies: () => verifyBodies,
	};
}

/**
 * Waits for the board and opens the detail panel for the target card.
 * Mirrors openCard() from Suite 7, but targets the `review` column.
 */
async function openCard(page: Page, cardTitle: string): Promise<void> {
	const card = page.locator("[data-column-id='review'] [data-task-id]").filter({ hasText: cardTitle }).first();
	await expect(card).toBeVisible({ timeout: 15_000 });

	// Click the card's title <p> to avoid hitting edge buttons.
	const titleEl = card.locator("p").filter({ hasText: cardTitle }).first();
	await titleEl.click();
}

// ---------------------------------------------------------------------------
// Tests — SecondOpinionReviewPanel
// ---------------------------------------------------------------------------

test.describe("SecondOpinionReviewPanel", () => {
	test("renders the verdict status label and round for a changes_requested review", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		// Panel header
		await expect(page.getByText("Second-opinion review")).toBeVisible({ timeout: 10_000 });
		// Status label
		await expect(page.getByText("Changes requested")).toBeVisible();
		// Round number
		await expect(page.getByText(/round 2/)).toBeVisible();
	});

	test("renders the last summary text", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Second-opinion review")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("Overall the refactor looks good but there are test coverage gaps.")).toBeVisible();
	});

	test("renders Requested changes feedback when status is changes_requested", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Second-opinion review")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("Requested changes")).toBeVisible();
		await expect(page.getByText("Add unit tests for the retry logic and error handling paths.")).toBeVisible();
	});

	test("renders insight text when lastInsight is present", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Second-opinion review")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText(/Consider extracting the retry policy into a separate module/)).toBeVisible();
	});

	test("panel is not visible when the card has no review data", async ({ page }) => {
		// Override the WS snapshot with a card that has no review field.
		await page.addInitScript(() => {
			window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		});

		const snapshotWithoutReview = {
			...WS_SNAPSHOT,
			workspaceState: {
				...WS_SNAPSHOT.workspaceState,
				board: {
					...WS_SNAPSHOT.workspaceState.board,
					columns: WS_SNAPSHOT.workspaceState.board.columns.map((col) => {
						if (col.id === "review") {
							return {
								...col,
								cards: [{ ...REVIEW_BOARD_CARD, review: undefined }],
							};
						}
						return col;
					}),
				},
			},
		};

		await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
			ws.onMessage(() => {
				/* no-op */
			});
			ws.onClose(() => {
				/* no-op */
			});
			ws.send(JSON.stringify(snapshotWithoutReview));
		});

		await page.route(
			(url) => url.pathname.startsWith("/api/"),
			(route) => {
				const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
				const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
				const stubs = procedures.map((proc) => {
					if (proc === "workspace.getState") {
						return { result: { data: snapshotWithoutReview.workspaceState } };
					}
					if (proc === "runtime.getSwarmStop") {
						return { result: { data: { ok: true, signal: null } } };
					}
					return { result: { data: null } };
				});
				if (stubs.length === 0) stubs.push({ result: { data: null } });
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(stubs),
				});
			},
		);

		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		// Panel must not be present without review data.
		await expect(page.getByText("Second-opinion review")).not.toBeVisible({ timeout: 3_000 });
	});
});

// ---------------------------------------------------------------------------
// Tests — TaskRecoveryActionsPanel
// ---------------------------------------------------------------------------

test.describe("TaskRecoveryActionsPanel", () => {
	test("Review actions panel is visible for a card in the review column", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		// The panel header text is always rendered when workspaceId is non-null.
		await expect(page.getByText("Review actions")).toBeVisible({ timeout: 10_000 });
	});

	test("Create evidence button fires runtime.collectTaskEvidence with the correct taskId", async ({ page }) => {
		// Grant clipboard-write permission so navigator.clipboard.writeText does not throw
		// (the component writes the promptBlock to the clipboard after the API call).
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

		const { getEvidenceBodies } = await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Review actions")).toBeVisible({ timeout: 10_000 });

		// The "Create evidence" button is always rendered (canCollectEvidence = true)
		const evidenceButton = page.getByRole("button", { name: "Create evidence" });
		await expect(evidenceButton).toBeEnabled();
		await evidenceButton.click();

		// Wait for the result text to appear (evidence call completed).
		// The component renders: "Evidence created and copied. <bundlePath>".
		// Use .first() because a toast with the same text may also be present.
		await expect(page.getByText(/Evidence created/).first()).toBeVisible({ timeout: 8_000 });

		// Verify the mutation was called with the correct taskId.
		expect(getEvidenceBodies().length).toBeGreaterThan(0);
		const body = getEvidenceBodies()[0] as Record<string, { taskId: string }>;
		expect(body["0"]?.taskId).toBe(TASK_ID);
	});

	test("Merge button fires runtime.mergeTaskWorktrees with the correct taskId", async ({ page }) => {
		const { getMergeBodies } = await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Review actions")).toBeVisible({ timeout: 10_000 });

		// Merge is shown when canMerge = column.id === "review"
		const mergeButton = page.getByRole("button", { name: "Merge" });
		await expect(mergeButton).toBeVisible();
		await expect(mergeButton).toBeEnabled();
		await mergeButton.click();

		// Wait for the merge result text. Use .first() — a toast may also carry the message.
		await expect(page.getByText("Merge completed successfully.").first()).toBeVisible({ timeout: 8_000 });

		// Verify the mutation was called with the correct taskId.
		expect(getMergeBodies().length).toBeGreaterThan(0);
		const body = getMergeBodies()[0] as Record<string, { taskId: string; column: string }>;
		expect(body["0"]?.taskId).toBe(TASK_ID);
		expect(body["0"]?.column).toBe("review");
	});

	test("Verify button fires runtime.verifyTaskAcceptance for a card with an Acceptance check", async ({ page }) => {
		const { getVerifyBodies } = await setupMocks(page);
		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Review actions")).toBeVisible({ timeout: 10_000 });

		// canVerify = column "review" + prompt has "Acceptance check:" line — both are true.
		const verifyButton = page.getByRole("button", { name: "Verify" });
		await expect(verifyButton).toBeVisible();
		await expect(verifyButton).toBeEnabled();
		await verifyButton.click();

		// Wait for verify result text. Use .first() — the toast also carries the message.
		await expect(page.getByText("Acceptance check passed.").first()).toBeVisible({ timeout: 8_000 });

		expect(getVerifyBodies().length).toBeGreaterThan(0);
		const body = getVerifyBodies()[0] as Record<string, { taskId: string }>;
		expect(body["0"]?.taskId).toBe(TASK_ID);
	});

	test("buttons are disabled while a request is in-flight", async ({ page }) => {
		let resolveEvidence: (() => void) | null = null;
		const evidenceHeld = new Promise<void>((resolve) => {
			resolveEvidence = resolve;
		});

		await setupMocks(page);

		// Override collectTaskEvidence with a slow handler
		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("runtime.collectTaskEvidence"),
			async (route) => {
				resolveEvidence?.();
				// Hold the response long enough to observe the disabled state
				await new Promise<void>((r) => setTimeout(r, 800));
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(trpcOk(MOCK_EVIDENCE_RESPONSE)),
				});
			},
		);

		await page.goto("/");
		await openCard(page, "Refactor payment gateway");

		await expect(page.getByText("Review actions")).toBeVisible({ timeout: 10_000 });

		const evidenceButton = page.getByRole("button", { name: "Create evidence" });
		await expect(evidenceButton).toBeEnabled();

		// Kick off the request without awaiting
		void evidenceButton.click();

		// Wait until the request has actually landed on the handler
		await evidenceHeld;

		// While in-flight, all buttons should be disabled
		await expect(evidenceButton).toBeDisabled();
		await expect(page.getByRole("button", { name: "Merge" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Verify" })).toBeDisabled();
	});
});
