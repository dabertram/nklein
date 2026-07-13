import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimePlanQuestion } from "@/runtime/types";

const queryMocks = vi.hoisted(() => ({
	listNKleinPlanQuestions: vi.fn(),
	answerNKleinPlanQuestion: vi.fn(),
}));
vi.mock("@/runtime/queries/plan-artifacts", () => queryMocks);
const toastMocks = vi.hoisted(() => ({
	showAppToast: vi.fn(),
	notifyError: vi.fn(),
}));
vi.mock("@/components/app-toaster", () => toastMocks);

import { PlanQuestionsPanel } from "@/components/detail-panels/plan-questions-panel";

const question = (over: Partial<RuntimePlanQuestion> = {}): RuntimePlanQuestion => ({
	id: "q-1",
	question: "Which storage backend should the habit log use?",
	status: "open",
	options: [
		{ id: "sqlite", label: "SQLite", description: "Local file DB", recommended: true },
		{ id: "json", label: "Flat JSON", description: null, recommended: false },
	],
	answer: null,
	assumption: null,
	blockedTaskId: null,
	...over,
});

describe("PlanQuestionsPanel (F1.4 clarification dialog)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		queryMocks.listNKleinPlanQuestions.mockReset();
		queryMocks.answerNKleinPlanQuestion.mockReset();
		toastMocks.showAppToast.mockReset();
		toastMocks.notifyError.mockReset();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	async function render(): Promise<void> {
		await act(async () => {
			root.render(<PlanQuestionsPanel workspaceId="ws-1" planSlug="my-plan" />);
		});
	}

	it("renders at least four explained choices (padding with synthesised fall-backs) plus free text", async () => {
		queryMocks.listNKleinPlanQuestions.mockResolvedValue({ ok: true, questions: [question()] });
		await render();

		const radios = container.querySelectorAll('input[type="radio"]');
		expect(radios.length).toBeGreaterThanOrEqual(4); // 2 supplied + ≥2 synthesised to reach the §5.S floor
		expect(container.textContent).toContain("SQLite");
		expect(container.textContent).toContain("Local file DB"); // explained choice
		expect(container.textContent).toContain("(recommended)");
		expect(container.textContent).toContain("Use your best judgement"); // synthesised fall-back
		expect(container.querySelector("textarea")).not.toBeNull(); // free text
		// Accessibility: a radiogroup with label-associated inputs.
		expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
		const firstRadio = radios[0] as HTMLInputElement;
		expect(container.querySelector(`label[for="${firstRadio.id}"]`)).not.toBeNull();
	});

	it("submits a selected option + free text and reloads; a resumed card is surfaced", async () => {
		queryMocks.listNKleinPlanQuestions.mockResolvedValue({ ok: true, questions: [question()] });
		queryMocks.answerNKleinPlanQuestion.mockResolvedValue({
			ok: true,
			questionStatus: "answered",
			resumedTaskId: "task-42",
		});
		await render();

		const sqliteRadio = container.querySelector('input[id$="-sqlite"]') as HTMLInputElement;
		await act(async () => {
			sqliteRadio.click();
		});
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			setter?.call(textarea, "WAL mode please");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const submit = container.querySelector('[data-testid="plan-question-submit"]') as HTMLButtonElement;
		await act(async () => {
			submit.click();
		});

		expect(queryMocks.answerNKleinPlanQuestion).toHaveBeenCalledWith("ws-1", {
			planSlug: "my-plan",
			questionId: "q-1",
			selectedOptionIds: ["sqlite"],
			freeText: "WAL mode please",
		});
		expect(toastMocks.showAppToast).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("task-42") }),
		);
		expect(queryMocks.listNKleinPlanQuestions.mock.calls.length).toBeGreaterThanOrEqual(2); // reloaded
	});

	it("shows durable answer review (resolved questions behind a toggle) and hides itself with no questions", async () => {
		queryMocks.listNKleinPlanQuestions.mockResolvedValue({
			ok: true,
			questions: [
				question({ id: "q-done", status: "answered", answer: "SQLite; WAL mode please" }),
				question({ id: "q-assumed", status: "assumed-default", assumption: "Assume defaults." }),
			],
		});
		await render();
		const toggle = container.querySelector('[data-testid="plan-questions-resolved-toggle"]') as HTMLButtonElement;
		expect(toggle.textContent).toContain("2 answered questions");
		await act(async () => {
			toggle.click();
		});
		const resolved = container.querySelector('[data-testid="plan-questions-resolved"]');
		expect(resolved?.textContent).toContain("SQLite; WAL mode please");
		expect(resolved?.textContent).toContain("Assume defaults.");

		queryMocks.listNKleinPlanQuestions.mockResolvedValue({ ok: true, questions: [] });
		await act(async () => {
			root.render(<PlanQuestionsPanel workspaceId="ws-1" planSlug="empty-plan" />);
		});
		expect(container.querySelector('[aria-label="Plan clarification questions"]')).toBeNull();
	});

	it("blocks an empty submission with an error and never calls the mutation", async () => {
		queryMocks.listNKleinPlanQuestions.mockResolvedValue({ ok: true, questions: [question()] });
		await render();
		const submit = container.querySelector('[data-testid="plan-question-submit"]') as HTMLButtonElement;
		await act(async () => {
			submit.click();
		});
		expect(toastMocks.notifyError).toHaveBeenCalledWith("Pick an option or type an answer first.");
		expect(queryMocks.answerNKleinPlanQuestion).not.toHaveBeenCalled();
	});
});
