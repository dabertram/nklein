/**
 * USER-STORY JOURNEY SUITE, batch 1 (David 2026-08-18: "user story driven test cases to stabilize workflow
 * and ux"). Each spec is one user's journey through a real flow, end-to-end at the UI boundary: the runtime
 * mock captures the mutations the journey MUST fire and streams the runtime's answers back over the mocked
 * WS, so every story pins both directions (user → runtime call, runtime → visible state).
 */

import { expect, type Page, test } from "@playwright/test";

import { createBacklogTask, gotoBoard, openCard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	taskSessionSummary,
	taskSessionsUpdatedFrame,
	trpcOk,
	workspaceStateUpdatedFrame,
} from "./harness/runtime-mock";

async function primeZoom(page: Page, zoom: string): Promise<void> {
	await page.addInitScript((level) => {
		window.localStorage.setItem("nklein.ui-zoom-level.v3", level);
	}, zoom);
}

test.describe("user stories — workflow + ux stability", () => {
	test("US-1 my first task: create it on the board and see it land in Backlog", async ({ page }) => {
		await primeZoom(page, "2");
		const mock = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({}) }),
			mutations: {
				// Creation is a client-side board mutation persisted whole via workspace.saveState.
				"workspace.saveState": () => trpcOk({ ok: true, revision: 2 }),
			},
		});
		await gotoBoard(page);
		await createBacklogTask(page, "Ship the invoice exporter");
		// The card appears immediately (locally applied board mutation)…
		await expect(page.locator("[data-task-id]").filter({ hasText: "Ship the invoice exporter" })).toBeVisible();
		// …and the journey persists it: saveState fired carrying the new card's prompt.
		await expect.poll(() => mock.calls["workspace.saveState"]?.length ?? 0).toBeGreaterThan(0);
		expect(JSON.stringify(mock.calls["workspace.saveState"]?.at(-1))).toContain("Ship the invoice exporter");
	});

	test("US-2 the app tells me where I'm needed: pill at Minimalistic jumps to the board", async ({ page }) => {
		await primeZoom(page, "2");
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					review: [buildBoardCard({ id: "r1", title: "Needs my verdict", extra: { blockedKind: null } })],
				}),
				sessions: { r1: taskSessionSummary("r1", { state: "awaiting_review", reviewReason: "attention" }) },
			}),
		});
		await gotoBoard(page);
		await page.getByRole("button", { name: "0 Minimalistic" }).click();
		const pill = page.getByTestId("needs-you-badge");
		await expect(pill).toBeVisible();
		await pill.click();
		// The jump lands on the full board (Advanced) with the review card in sight.
		await expect(page.locator("[data-task-id]").filter({ hasText: "Needs my verdict" })).toBeVisible();
	});

	test("US-3 I follow my running work from the map: cluster → sheet shows live state → full detail", async ({
		page,
	}) => {
		await primeZoom(page, "2");
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					in_progress: [buildBoardCard({ id: "w1", title: "Streaming worker card" })],
				}),
				sessions: { w1: taskSessionSummary("w1", { state: "running", modelId: "qwen3.8-27b-mlx" }) },
			}),
		});
		await gotoBoard(page);
		await page.getByRole("button", { name: "1 Clean" }).click();
		await page.locator("[data-cluster-id]").first().click();
		await page.getByTestId("lean-lane-doing").getByText("Streaming worker card").click();
		const sheet = page.getByTestId("card-sheet");
		await expect(sheet).toBeVisible();
		await expect(page.getByTestId("card-sheet-state")).toContainText("right now");
		await page.getByTestId("card-sheet-full-detail").click();
		await expect(page.getByTestId("card-detail-view")).toBeVisible();
	});

	test("US-4 I watch my card finish live: stream frames move it to Completed without a reload", async ({ page }) => {
		await primeZoom(page, "2");
		const mock = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					in_progress: [buildBoardCard({ id: "w2", title: "Long build card" })],
				}),
				sessions: { w2: taskSessionSummary("w2", { state: "running" }) },
			}),
		});
		await gotoBoard(page);
		await expect(page.locator("[data-task-id]").filter({ hasText: "Long build card" })).toBeVisible();
		mock.pushFrame(taskSessionsUpdatedFrame([taskSessionSummary("w2", { state: "idle" })]));
		mock.pushFrame(
			workspaceStateUpdatedFrame(
				buildBoardColumns({
					completed: [buildBoardCard({ id: "w2", title: "Long build card" })],
				}),
			),
		);
		const completedColumn = page.locator('[data-column-id="completed"]');
		await expect(completedColumn.locator("[data-task-id]").filter({ hasText: "Long build card" })).toBeVisible();
	});

	test("US-5 I start my queued work: Start fires the runtime call for the right card", async ({ page }) => {
		await primeZoom(page, "2");
		const mock = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					backlog: [buildBoardCard({ id: "b7", title: "Waiting card" })],
				}),
			}),
			mutations: {
				"runtime.startTaskSession": () => trpcOk({ ok: true }),
			},
		});
		await gotoBoard(page);
		const card = page.locator("[data-task-id]").filter({ hasText: "Waiting card" }).first();
		await card.hover();
		await card.getByRole("button", { name: /start/i }).first().click();
		await expect.poll(() => mock.calls["runtime.startTaskSession"]?.length ?? 0).toBeGreaterThan(0);
		const body = mock.calls["runtime.startTaskSession"]?.[0] as { taskId?: string } | undefined;
		expect(body?.taskId ?? JSON.stringify(body)).toContain("b7");
	});

	test("US-6 I read the reviewer's verdict: bounced card shows the ladder and its feedback in detail", async ({
		page,
	}) => {
		await primeZoom(page, "2");
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					review: [
						buildBoardCard({
							id: "rv1",
							title: "Bounced parser card",
							extra: {
								review: {
									status: "changes_requested",
									round: 2,
									lastVerdict: "request_changes",
									lastSummary: "Worker missed the boolean negation rules.",
									lastFeedback: "Add --no-flag negation handling and its tests before resubmitting.",
									lastInsight: null,
									signOff: null,
									parkedReason: null,
									history: [
										// Fingerprints match the production writer's shape (string|null, never
										// omitted): omitted fields read as undefined, which the escalation-signature
										// detector's `!== null` checks treat as MATCHING pairs (fixture-bent trap).
										{
											round: 1,
											verdict: "request_changes",
											summary: "Zero files changed.",
											workFingerprint: "wf-round-1",
											feedbackFingerprint: "fb-round-1",
										},
										{
											round: 2,
											verdict: "request_changes",
											summary: "Negation rules missing.",
											workFingerprint: "wf-round-2",
											feedbackFingerprint: "fb-round-2",
										},
									],
									updatedAt: 1_700_001_000_000,
								},
							},
						}),
					],
				}),
			}),
		});
		await gotoBoard(page);
		const card = page.locator("[data-task-id]").filter({ hasText: "Bounced parser card" }).first();
		await expect(card).toBeVisible();
		// The review-ladder strip names where the card sits: bounce is the active rung.
		const ladder = card.locator("[data-review-ladder]");
		await expect(ladder).toBeVisible();
		await expect(ladder.locator('[data-rung="bounce"]')).toHaveAttribute("data-rung-state", "now");
		// Drilling in shows the reviewer's actual feedback — the text the user must act on.
		await openCard(page, "Bounced parser card");
		await expect(page.getByText("Add --no-flag negation handling and its tests before resubmitting.")).toBeVisible();
	});

	test("US-7 my card parked for me: the park rung + reason are visible where I look", async ({ page }) => {
		await primeZoom(page, "2");
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					review: [
						buildBoardCard({
							id: "pk1",
							title: "Parked integration card",
							extra: {
								review: {
									status: "parked",
									round: 3,
									lastVerdict: "request_changes",
									lastSummary: "No-op round: the worker made zero file changes.",
									lastFeedback: null,
									lastInsight: null,
									signOff: null,
									parkedReason:
										"Review stalled: the worker made no changes after the last review. Parking for a human.",
									history: [
										{
											round: 1,
											verdict: "request_changes",
											summary: "Zero files.",
											workFingerprint: "wf-empty",
											feedbackFingerprint: "fb-1",
										},
										{
											round: 2,
											verdict: "request_changes",
											summary: "Still zero.",
											workFingerprint: "wf-empty",
											feedbackFingerprint: "fb-2",
										},
										{
											round: 3,
											verdict: "request_changes",
											summary: "Stalled.",
											workFingerprint: "wf-empty",
											feedbackFingerprint: "fb-3",
										},
									],
									escalated: true,
									updatedAt: 1_700_001_000_000,
								},
							},
						}),
					],
				}),
			}),
		});
		await gotoBoard(page);
		const card = page.locator("[data-task-id]").filter({ hasText: "Parked integration card" }).first();
		await expect(card).toBeVisible();
		// The ladder strip shows the card is PARKED (the red terminal rung), with the reason in its tooltip.
		const ladder = card.locator("[data-review-ladder]");
		await expect(ladder).toBeVisible();
		await expect(ladder.locator('[data-rung="park"]')).toHaveAttribute("data-rung-state", "now");
		await expect(ladder).toHaveAttribute("title", /parked for a human/i);
		// Drilling in shows the park reason verbatim — what the human is being asked to resolve.
		await openCard(page, "Parked integration card");
		await expect(
			page.getByText("Review stalled: the worker made no changes after the last review. Parking for a human."),
		).toBeVisible();
	});
});
