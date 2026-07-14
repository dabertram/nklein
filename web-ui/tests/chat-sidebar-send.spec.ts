/**
 * Suite: Chat sidebar send + AutonomousRunBar (§5.M — the "Chat e2e" leaf)
 *
 * Verifies the STANDALONE chat sidebar's send flow end-to-end, model-free (distinct from chat-send.spec.ts, which
 * covers a board TASK's agent chat via `runtime.sendTaskChatMessage`; this covers the §5.M sidebar via `chat.*`):
 *  1. The AutonomousRunBar (goal input + Auto button) renders; the Auto button is DISABLED with an empty goal and
 *     ENABLES once a goal is typed.
 *  2. The composer's Send button is DISABLED with an empty input and ENABLES once text is typed.
 *  3. Sending a message GROWS the transcript — the user's message appears.
 *
 * Backend: fully mocked via Playwright route-intercept + WebSocket mock (same pattern as chat-scope.spec.ts):
 *  - WebSocket /api/runtime/ws → a minimal snapshot so the board renders.
 *  - tRPC chat.listSessions   → one session so the sidebar has a selectable row.
 *  - tRPC chat.getTranscript  → EMPTY until a send happens, then [user, assistant] (so "grows" is observable).
 *  - tRPC chat.streamMessage  → an event-stream response; flips the `sent` flag. The send flow refetches the
 *    transcript unconditionally after the stream settles, so the grown transcript shows regardless of SSE framing;
 *    the optimistic pending-user render covers the still-streaming path too.
 *  - Catch-all /api/*         → the usual stubs.
 */

import { expect, type Page, test } from "@playwright/test";

const WORKSPACE_ID = "ws-chat-send-test";

const WS_SNAPSHOT = {
	type: "snapshot",
	currentProjectId: WORKSPACE_ID,
	projects: [
		{
			id: WORKSPACE_ID,
			path: "/home/user/project",
			name: "Chat Send Test Project",
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
	id: "session-send-test-1",
	title: "Send test session",
	scope: "chat_only",
	role: "planner_architect",
	goal: null,
	createdAt: NOW,
	updatedAt: NOW,
};

const USER_TEXT = "cap the habit score at 100";
const ASSISTANT_TEXT = "Done — added a Math.min(100, ...) clamp.";

function trpcOk(payload: unknown): unknown[] {
	return [{ result: { data: payload } }];
}

async function setupMocks(page: Page): Promise<{ wasSent: () => boolean }> {
	let sent = false;

	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3"); // Z3 Expert: the kanban board
	});

	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		ws.send(JSON.stringify(WS_SNAPSHOT));
	});

	// Catch-all (LIFO — lowest priority).
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
				return { result: { data: null } };
			});
			if (stubs.length === 0) {
				stubs.push({ result: { data: null } });
			}
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);

	// chat.listSessions + chat.getTranscript (transcript GROWS after a send).
	await page.route(
		(url) =>
			url.pathname.startsWith("/api/trpc/") &&
			(url.pathname.includes("chat.listSessions") || url.pathname.includes("chat.getTranscript")),
		async (route) => {
			const pathAfterTrpc = route.request().url().split("/api/trpc/")[1]?.split("?")[0] ?? "";
			const procedures = pathAfterTrpc ? pathAfterTrpc.split(",") : [];
			const messages = sent
				? [
						{ id: "m-user", role: "user", text: USER_TEXT, createdAt: NOW + 1 },
						{ id: "m-assistant", role: "assistant", text: ASSISTANT_TEXT, createdAt: NOW + 2 },
					]
				: [];
			const stubs = procedures.map((proc) => {
				if (proc === "chat.listSessions") {
					return (trpcOk({ sessions: [MOCK_SESSION] }) as unknown[])[0];
				}
				if (proc === "chat.getTranscript") {
					return (trpcOk({ sessionId: MOCK_SESSION.id, messages }) as unknown[])[0];
				}
				return { result: { data: null } };
			});
			await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);

	// chat.streamMessage (SSE) — flip the `sent` flag and end the stream. The send flow refetches the transcript
	// after the stream settles regardless of framing, so we don't depend on tRPC's exact SSE envelope here.
	await page.route(
		(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("chat.streamMessage"),
		async (route) => {
			sent = true;
			await route.fulfill({
				status: 200,
				contentType: "text/event-stream",
				headers: { "cache-control": "no-cache" },
				body: "",
			});
		},
	);

	return { wasSent: () => sent };
}

async function openChatSidebarAndSelect(page: Page): Promise<void> {
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
	const openButton = page.getByTestId("open-chat-button");
	if (await openButton.isVisible()) {
		await openButton.click();
	}
	await expect(page.getByTestId("chat-sidebar")).toBeVisible({ timeout: 5_000 });
	const row = page.getByTestId("chat-session-item").first();
	await expect(row).toBeVisible({ timeout: 5_000 });
	await row.click();
	await expect(page.getByTestId("chat-composer-input")).toBeVisible({ timeout: 5_000 });
}

test.describe("Chat sidebar send + AutonomousRunBar (§5.M)", () => {
	test("AutonomousRunBar renders and its Auto button gates on a non-empty goal", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openChatSidebarAndSelect(page);

		const goalInput = page.getByTestId("chat-autonomous-goal");
		const autoButton = page.getByTestId("chat-autonomous-start");
		await expect(goalInput).toBeVisible();
		await expect(autoButton).toBeVisible();
		await expect(autoButton).toBeDisabled(); // empty goal
		await goalInput.fill("investigate the flaky test");
		await expect(autoButton).toBeEnabled();
	});

	test("the composer Send button gates on non-empty input", async ({ page }) => {
		await setupMocks(page);
		await page.goto("/");
		await openChatSidebarAndSelect(page);

		const sendButton = page.getByTestId("chat-send-button");
		await expect(sendButton).toBeDisabled();
		await page.getByTestId("chat-composer-input").fill(USER_TEXT);
		await expect(sendButton).toBeEnabled();
	});

	test("sending a message grows the transcript with the user's message", async ({ page }) => {
		const handles = await setupMocks(page);
		await page.goto("/");
		await openChatSidebarAndSelect(page);

		// Transcript starts empty.
		await expect(page.getByTestId("chat-message")).toHaveCount(0);

		await page.getByTestId("chat-composer-input").fill(USER_TEXT);
		await page.getByTestId("chat-send-button").click();

		// The stream endpoint was hit, and the user's message is now visible in the transcript (it grew).
		await expect.poll(() => handles.wasSent(), { timeout: 5_000 }).toBe(true);
		await expect(page.getByText(USER_TEXT).first()).toBeVisible({ timeout: 5_000 });
	});

	test("F2.7b: attaching an image shows a chip and sends imageAttachments; removing clears it", async ({ page }) => {
		await setupMocks(page);
		// Capture the streamMessage request (LIFO — registered after setupMocks so it wins) to inspect the payload.
		let streamRequest = "";
		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("chat.streamMessage"),
			async (route) => {
				streamRequest = decodeURIComponent(`${route.request().url()} ${route.request().postData() ?? ""}`);
				await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
			},
		);
		await page.goto("/");
		await openChatSidebarAndSelect(page);

		// A 1x1 PNG (valid base64) staged via the hidden attach input.
		const pngBuffer = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
			"base64",
		);
		await page
			.getByTestId("chat-attach-input")
			.setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: pngBuffer });

		// The pending-attachment chip appears with the filename.
		await expect(page.getByTestId("chat-pending-attachments")).toBeVisible();
		await expect(page.getByTestId("chat-pending-attachments")).toContainText("shot.png");

		// Removing clears the chip.
		await page.getByTestId("chat-attachment-remove").click();
		await expect(page.getByTestId("chat-pending-attachments")).toHaveCount(0);

		// Re-attach, then send — the request carries imageAttachments and the chip clears afterward.
		await page
			.getByTestId("chat-attach-input")
			.setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: pngBuffer });
		await expect(page.getByTestId("chat-pending-attachments")).toBeVisible();
		await page.getByTestId("chat-composer-input").fill(USER_TEXT);
		await page.getByTestId("chat-send-button").click();

		await expect.poll(() => streamRequest, { timeout: 5_000 }).toContain("imageAttachments");
		await expect(page.getByTestId("chat-pending-attachments")).toHaveCount(0);
	});

	test("F2.7b: a transcript message with attachments renders its images from getMessageImages", async ({ page }) => {
		await setupMocks(page);
		const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
		// A transcript with one user message that carries an attachment count (bytes live out-of-band).
		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("chat.getTranscript"),
			async (route) => {
				const message = {
					id: "m-user-img",
					role: "user",
					content: "look at this",
					createdAt: NOW + 1,
					meta: { imageAttachmentCount: 1 },
				};
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([{ result: { data: { sessionId: MOCK_SESSION.id, messages: [message] } } }]),
				});
			},
		);
		// The out-of-band image fetch.
		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes("chat.getMessageImages"),
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([
						{ result: { data: { images: [{ data: PNG, mimeType: "image/png", name: "shot.png" }] } } },
					]),
				});
			},
		);
		await page.goto("/");
		await openChatSidebarAndSelect(page);

		// The persisted image renders inline (the shared TaskImageStrip <img> with the data URL).
		await expect(page.locator('img[src^="data:image/png;base64,"]').first()).toBeVisible({ timeout: 5_000 });
	});
});
