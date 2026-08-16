// §5.BB S3: the minimal card sheet — Minimalistic/Clean's "easy first" card detail. The sheet shows the
// card's essence and exactly one progressive-disclosure affordance; these tests pin that contract.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardSheet } from "@/components/card-sheet";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { CardSelection } from "@/types";

function makeSelection(overrides: Partial<CardSelection["card"]> = {}): CardSelection {
	const card = {
		id: "task-1",
		title: "Wire the frobnicator",
		prompt: "Wire the frobnicator into the delivery seam.\nKeep the audit trail intact.",
		startInPlanMode: false,
		...overrides,
	} as CardSelection["card"];
	const column = { id: "in_progress", title: "In Progress", cards: [card] } as unknown as CardSelection["column"];
	return { card, column, allColumns: [column] };
}

function makeSession(state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return { taskId: "task-1", state } as RuntimeTaskSessionSummary;
}

describe("CardSheet", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	function render(ui: React.ReactElement): void {
		act(() => root.render(ui));
	}

	it("shows title, column, state line, and the reasoning snippet", () => {
		render(
			<CardSheet
				selection={makeSelection()}
				session={makeSession("running")}
				reasoningSnippet="Currently tracing the delivery seam…"
				onOpenFullDetail={() => {}}
				onBack={() => {}}
			/>,
		);
		expect(container.querySelector('[data-testid="card-sheet-title"]')?.textContent).toBe("Wire the frobnicator");
		expect(container.querySelector('[data-testid="card-sheet-column"]')?.textContent).toBe("In Progress");
		expect(container.querySelector('[data-testid="card-sheet-state"]')?.textContent).toContain("right now");
		expect(container.querySelector('[data-testid="card-sheet-snippet"]')?.textContent).toContain(
			"tracing the delivery seam",
		);
	});

	it("falls back to the prompt's first line when the card has no title", () => {
		render(
			<CardSheet
				selection={makeSelection({ title: undefined })}
				session={makeSession("idle")}
				onOpenFullDetail={() => {}}
				onBack={() => {}}
			/>,
		);
		expect(container.querySelector('[data-testid="card-sheet-title"]')?.textContent).toBe(
			"Wire the frobnicator into the delivery seam.",
		);
		// idle has no beginner-facing state line
		expect(container.querySelector('[data-testid="card-sheet-state"]')).toBeNull();
	});

	it("wires progressive disclosure and back", () => {
		const onOpenFullDetail = vi.fn();
		const onBack = vi.fn();
		render(
			<CardSheet
				selection={makeSelection()}
				session={makeSession("awaiting_review")}
				onOpenFullDetail={onOpenFullDetail}
				onBack={onBack}
			/>,
		);
		act(() => {
			container
				.querySelector<HTMLButtonElement>('[data-testid="card-sheet-full-detail"]')
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onOpenFullDetail).toHaveBeenCalledTimes(1);
		const backButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Back"));
		act(() => {
			backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onBack).toHaveBeenCalledTimes(1);
	});
});
