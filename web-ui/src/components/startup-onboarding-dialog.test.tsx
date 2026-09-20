import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";

vi.mock("@/components/task-start-agent-onboarding-carousel", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/task-start-agent-onboarding-carousel")>()),
	TaskStartAgentOnboardingCarousel: () => <div data-testid="carousel-stub" />,
}));

describe("StartupOnboardingDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("renders exactly one close control in the header (the labelled skip button)", () => {
		act(() => {
			root.render(
				<StartupOnboardingDialog
					open
					onClose={() => {}}
					workspaceId={null}
					runtimeConfig={null}
					selectedAgentId={null}
					agents={[]}
					nkleinProviderSettings={null}
				/>,
			);
		});
		// The dialog renders in a portal, so query the document.
		const closeControls = Array.from(document.querySelectorAll("[role='dialog'] button")).filter((button) =>
			/skip the tour|close/i.test(button.getAttribute("aria-label") ?? ""),
		);
		expect(closeControls).toHaveLength(1);
		expect(document.querySelector("[data-testid='onboarding-skip']")).not.toBeNull();
	});
});
