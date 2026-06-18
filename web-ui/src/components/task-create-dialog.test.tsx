import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCreateDialog } from "@/components/task-create-dialog";

const mockImportTaskContext = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			importTaskContext: {
				mutate: mockImportTaskContext,
			},
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

function flushPromises() {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("TaskCreateDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let promptSpy: ReturnType<typeof vi.fn<(value: string) => void>>;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		promptSpy = vi.fn<(value: string) => void>();
		mockImportTaskContext.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.restoreAllMocks();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	function renderDialog(overrides: Partial<Parameters<typeof TaskCreateDialog>[0]> = {}) {
		act(() => {
			root.render(
				<TaskCreateDialog
					open
					onOpenChange={() => {}}
					prompt="Fix the bug."
					onPromptChange={promptSpy}
					images={[]}
					onImagesChange={() => {}}
					onCreate={() => "task-1"}
					onCreateAndStart={() => "task-1"}
					onCreateMultiple={() => []}
					onCreateAndStartMultiple={() => []}
					startInPlanMode={false}
					onStartInPlanModeChange={() => {}}
					autoReviewEnabled={false}
					onAutoReviewEnabledChange={() => {}}
					autoReviewMode="commit"
					onAutoReviewModeChange={() => {}}
					workspaceId="workspace-1"
					branchRef="main"
					branchOptions={[{ value: "main", label: "main" }]}
					onBranchRefChange={() => {}}
					{...overrides}
				/>,
			);
		});
	}

	function clickButton(label: string) {
		const button = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.textContent === label,
		);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error(`Expected button ${label}.`);
		}
		act(() => {
			button.click();
		});
	}

	it("imports GitHub issue context into the task prompt", async () => {
		vi.spyOn(window, "prompt").mockReturnValue("owner/repo#12");
		mockImportTaskContext.mockResolvedValue({
			ok: true,
			sourceLabel: "GitHub issue owner/repo#12",
			title: "Bug",
			content: "Issue body",
		});

		renderDialog();
		clickButton("Issue");
		await flushPromises();

		expect(mockImportTaskContext).toHaveBeenCalledWith({
			source: "github_issue",
			target: "owner/repo#12",
		});
		expect(promptSpy).toHaveBeenCalledWith(
			["Fix the bug.", "", "Context from GitHub issue owner/repo#12:", "~~~text", "Issue body", "~~~"].join("\n"),
		);
	});

	it("keeps GitHub import disabled without a workspace", () => {
		renderDialog({ workspaceId: null });

		const issueButton = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.textContent === "Issue",
		);
		expect(issueButton).toBeInstanceOf(HTMLButtonElement);
		expect((issueButton as HTMLButtonElement).disabled).toBe(true);
	});
});
