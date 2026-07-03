import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SetupWizardDialog } from "@/components/setup-wizard-dialog";
import type { RuntimeSetupPlanStep } from "@/runtime/types";

const STEPS: RuntimeSetupPlanStep[] = [
	{ stepId: "provider", title: "Provider", recommendation: "Use local !Klein", detail: "Detail one." },
	{ stepId: "sandbox", title: "Sandbox", recommendation: "Docker is ready", detail: "Detail two." },
	{ stepId: "review", title: "Review", recommendation: "Enable second opinion", detail: "Detail three." },
];

/** Radix Dialog portals into document.body, so query there and match a button by its trimmed text. */
function findButton(label: string): HTMLButtonElement {
	const button = Array.from(document.body.querySelectorAll("button")).find(
		(node) => node.textContent?.trim() === label,
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Button "${label}" was not rendered.`);
	}
	return button;
}

function hasText(text: string): boolean {
	return document.body.textContent?.includes(text) ?? false;
}

describe("SetupWizardDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	function render(overrides: Partial<React.ComponentProps<typeof SetupWizardDialog>> = {}): {
		onComplete: ReturnType<typeof vi.fn>;
		onSkip: ReturnType<typeof vi.fn>;
	} {
		const onComplete = vi.fn();
		const onSkip = vi.fn();
		act(() => {
			root.render(
				<SetupWizardDialog
					open={true}
					kind="global"
					steps={STEPS}
					onComplete={onComplete}
					onSkip={onSkip}
					{...overrides}
				/>,
			);
		});
		return { onComplete, onSkip };
	}

	function click(button: HTMLButtonElement): void {
		act(() => {
			button.click();
		});
	}

	it("renders the first step with its recommendation, detail, and step count", () => {
		render();
		expect(hasText("Provider")).toBe(true);
		expect(hasText("Use local !Klein")).toBe(true);
		expect(hasText("Detail one.")).toBe(true);
		expect(hasText("Step 1 of 3")).toBe(true);
		// Back is disabled on the first step; the primary action reads "Next" (not "Finish") until the last step.
		expect(findButton("Back").disabled).toBe(true);
		expect(hasText("Next")).toBe(true);
	});

	it("steps forward through Next and back through Back, then Finish calls onComplete", () => {
		const { onComplete } = render();

		click(findButton("Next"));
		expect(hasText("Sandbox")).toBe(true);
		expect(hasText("Step 2 of 3")).toBe(true);
		expect(findButton("Back").disabled).toBe(false);

		click(findButton("Back"));
		expect(hasText("Step 1 of 3")).toBe(true);

		click(findButton("Next"));
		click(findButton("Next"));
		expect(hasText("Review")).toBe(true);
		expect(hasText("Step 3 of 3")).toBe(true);

		// Last step: the primary action is "Finish" and it calls onComplete rather than advancing.
		const finish = findButton("Finish");
		expect(onComplete).not.toHaveBeenCalled();
		click(finish);
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("calls onSkip from the Skip setup affordance", () => {
		const { onSkip } = render();
		click(findButton("Skip setup"));
		expect(onSkip).toHaveBeenCalledTimes(1);
	});

	it("shows the per-kind footer note", () => {
		render({ kind: "global" });
		expect(hasText("You can re-run this anytime from Settings.")).toBe(true);

		act(() => {
			root.render(
				<SetupWizardDialog open={true} kind="project" steps={STEPS} onComplete={vi.fn()} onSkip={vi.fn()} />,
			);
		});
		expect(hasText("Re-run from this project's settings.")).toBe(true);
	});
});
