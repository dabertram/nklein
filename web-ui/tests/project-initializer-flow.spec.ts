/**
 * F2.32 — the guided project initializer inside "Add project → New" (David directive 2026-09-02: welcome and setup
 * dialogues "smooth, covered, makes sense, user friendly, not annoying, intuitive").
 *
 * What a first project creation owes the user, pinned on the page-level runtime mock:
 *  1. Readiness is HONEST — in beginner mode every canonical topic must be answered before Create enables, and
 *     the Preview step says so in words ("needs answers" → "Ready to create and seed planning").
 *  2. The beginner stepper works — step buttons jump, Back/Next bound at the ends, typed answers survive the walk.
 *  3. Creating sends the REAL request: `projects.add` with createDirectory + initializeGit and the brief as typed,
 *     then the dialog closes.
 *  4. Cancel is safe and Escape never discards a half-written brief: with a field focused it only blurs (inputs
 *     AND textareas — the textarea half was the annoyance this spec caught); a second Escape closes; nothing is
 *     created either way.
 */
import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import { installRuntimeMock, trpcOk } from "./harness/runtime-mock";

type Page = import("@playwright/test").Page;

async function openNewProjectTab(page: Page) {
	await page.getByRole("button", { name: "Add Project" }).click();
	const dialog = page.getByRole("dialog").filter({ hasText: "Existing" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "New", exact: true }).click();
	await expect(dialog.getByLabel("Project name")).toBeVisible();
	return dialog;
}

const STEPS = ["Vision", "Technical", "Boundaries", "Done", "References", "Preview"] as const;

async function goToStep(dialog: ReturnType<Page["getByRole"]>, step: (typeof STEPS)[number]) {
	await dialog.getByRole("navigation", { name: "Initializer steps" }).getByRole("button", { name: step }).click();
}

/** Every canonical topic the beginner mode requires, in the step that holds it. */
const BRIEF = {
	Vision: [
		["What does done look like?", "A CLI that tracks daily habits and streaks."],
		["Who is it for?", "One person on their own laptop."],
	],
	Technical: [
		["Stack / runtime", "Node 22, TypeScript, vitest."],
		["Domain concepts and rules", "A habit has a name; a streak counts consecutive days marked done."],
	],
	Boundaries: [
		["In scope", "add, mark done, list with streaks"],
		["Out of scope", "sync, accounts, reminders"],
		["Constraints / do not", "no network access"],
	],
	Done: [
		["Commands that must pass", "npm test"],
		["Observable success criteria", "allow a user to mark a habit done for today"],
	],
	References: [["Risks / uncertainty", "none known"]],
} as const;

async function fillWholeBrief(dialog: ReturnType<Page["getByRole"]>) {
	for (const step of ["Vision", "Technical", "Boundaries", "Done", "References"] as const) {
		await goToStep(dialog, step);
		for (const [label, text] of BRIEF[step]) {
			await dialog.getByLabel(label).fill(text);
			await expect(dialog.getByLabel(label)).toHaveValue(text);
		}
	}
}

test.describe("project initializer flow (F2.32)", () => {
	test("readiness is honest: Create stays disabled until every beginner topic is answered", async ({ page }) => {
		await installRuntimeMock(page);
		await gotoBoard(page);
		const dialog = await openNewProjectTab(page);
		await dialog.getByLabel("Project name").fill("Habit Tracker");
		await expect(dialog.getByLabel("Folder name")).toHaveAttribute("placeholder", "habit-tracker");
		const create = dialog.getByRole("button", { name: "Create Project" });
		await expect(create).toBeDisabled();

		// The outcome alone is not enough — Preview names the state in words, and Create stays off.
		await dialog.getByLabel("What does done look like?").fill("A CLI that tracks daily habits and streaks.");
		await goToStep(dialog, "Preview");
		await expect(dialog.getByText("Brief needs answers before creation")).toBeVisible();
		await expect(create).toBeDisabled();

		await fillWholeBrief(dialog);
		await goToStep(dialog, "Preview");
		await expect(dialog.getByText("Ready to create and seed planning")).toBeVisible();
		await expect(create).toBeEnabled();
	});

	test("the beginner stepper: Back off on the first step, Next off on the last, jumps keep typed answers", async ({
		page,
	}) => {
		await installRuntimeMock(page);
		await gotoBoard(page);
		const dialog = await openNewProjectTab(page);
		const brief = dialog.getByRole("region", { name: "Guided project brief" });
		await expect(brief.getByRole("button", { name: "Back" })).toBeDisabled();
		await brief.getByLabel("What does done look like?").fill("Track habits.");
		await brief.getByRole("button", { name: "Next" }).click();
		await expect(brief.getByLabel("Stack / runtime")).toBeVisible();
		await expect(brief.getByRole("button", { name: "Back" })).toBeEnabled();
		await goToStep(dialog, "Preview");
		await expect(brief.getByRole("button", { name: "Next" })).toBeDisabled();
		await expect(brief.getByRole("region", { name: "Initial decomposition preview" })).toBeVisible();
		// Walking away and back does not lose what was typed.
		await goToStep(dialog, "Vision");
		await expect(brief.getByLabel("What does done look like?")).toHaveValue("Track habits.");
	});

	test("creating sends the real request with the brief as typed, then closes", async ({ page }) => {
		const mock = await installRuntimeMock(page, {
			mutations: {
				"projects.add": () =>
					trpcOk({ ok: true, project: { id: "ws-habit", name: "Habit Tracker", path: "/habit-tracker" } }),
			},
		});
		await gotoBoard(page);
		const dialog = await openNewProjectTab(page);
		await dialog.getByLabel("Project name").fill("Habit Tracker");
		await fillWholeBrief(dialog);
		await dialog.getByRole("button", { name: "Create Project" }).click();

		await expect.poll(() => mock.calls["projects.add"]?.length ?? 0).toBe(1);
		const serialized = JSON.stringify(mock.calls["projects.add"]?.[0]);
		expect(serialized).toContain('"createDirectory":true');
		expect(serialized).toContain('"initializeGit":true');
		expect(serialized).toContain('"projectName":"Habit Tracker"');
		expect(serialized).toContain("/habit-tracker");
		expect(serialized).toContain("A CLI that tracks daily habits and streaks.");
		expect(serialized).toContain('"acceptanceCommands":"npm test"');
		expect(serialized).toContain("allow a user to mark a habit done for today");
		await expect(dialog).not.toBeVisible();
	});

	test("Escape never discards a half-written brief; Cancel closes without creating", async ({ page }) => {
		const mock = await installRuntimeMock(page, {
			mutations: { "projects.add": () => trpcOk({ ok: true, project: { id: "x", name: "x", path: "/x" } }) },
		});
		await gotoBoard(page);
		const dialog = await openNewProjectTab(page);
		const name = dialog.getByLabel("Project name");
		await name.fill("Throwaway");
		// Escape with an INPUT focused: blur only, the dialog and the value stay.
		await page.keyboard.press("Escape");
		await expect(dialog).toBeVisible();
		await expect(name).not.toBeFocused();
		await expect(name).toHaveValue("Throwaway");
		// Escape with a TEXTAREA focused: the same protection (the brief is where the long answers live).
		const outcome = dialog.getByLabel("What does done look like?");
		await outcome.fill("A long brief nobody wants to retype.");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeVisible();
		await expect(outcome).not.toBeFocused();
		await expect(outcome).toHaveValue("A long brief nobody wants to retype.");
		// Nothing focused: Escape closes; nothing was created.
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
		expect(mock.calls["projects.add"] ?? []).toEqual([]);

		// Cancel is the explicit safe exit.
		const again = await openNewProjectTab(page);
		await again.getByRole("button", { name: "Cancel" }).click();
		await expect(again).not.toBeVisible();
		expect(mock.calls["projects.add"] ?? []).toEqual([]);
	});
});
