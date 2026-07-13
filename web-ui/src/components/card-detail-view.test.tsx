import { act, forwardRef, type ReactNode, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDetailView } from "@/components/card-detail-view";
import { getTerminalThemeColors, readStoredThemeId } from "@/hooks/use-theme";
import type {
	RuntimeNKleinPlanArtifactsResponse,
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskDiagnosticsResponse,
	RuntimeTaskWorktreeMergeResponse,
} from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { BoardCard, BoardColumn, CardSelection } from "@/types";

const mockUseRuntimeWorkspaceChanges = vi.fn();
const {
	mockAgentTerminalPanel,
	mockNKleinAgentChatPanel,
	mockDiffViewerPanel,
	mockNKleinAppendToDraft,
	mockNKleinSendText,
	mockFetchTaskDiagnostics,
	mockFetchNKleinPlanArtifacts,
	mockApplyNKleinPlanArtifact,
	mockRejectNKleinPlanArtifact,
	mockVerifyTaskAcceptance,
	mockMergeTaskWorktrees,
	mockCollectTaskEvidence,
} = vi.hoisted(() => ({
	mockAgentTerminalPanel: vi.fn((_props: { panelBackgroundColor?: string; terminalBackgroundColor?: string }) => null),
	mockNKleinAgentChatPanel: vi.fn((..._args: unknown[]) => null),
	mockDiffViewerPanel: vi.fn((..._args: unknown[]) => null),
	mockNKleinAppendToDraft: vi.fn(),
	mockNKleinSendText: vi.fn(async () => {}),
	mockFetchTaskDiagnostics: vi.fn(async (): Promise<RuntimeTaskDiagnosticsResponse> => ({ ok: true, events: [] })),
	mockFetchNKleinPlanArtifacts: vi.fn(async (): Promise<RuntimeNKleinPlanArtifactsResponse> => ({ artifacts: [] })),
	mockApplyNKleinPlanArtifact: vi.fn(),
	mockRejectNKleinPlanArtifact: vi.fn(),
	mockVerifyTaskAcceptance: vi.fn(),
	mockMergeTaskWorktrees: vi.fn(),
	mockCollectTaskEvidence: vi.fn(),
}));

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: () => {},
}));

vi.mock("@/hooks/use-is-mobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: mockAgentTerminalPanel,
}));

vi.mock("@/components/detail-panels/nklein-agent-chat-panel", () => ({
	NKleinAgentChatPanel: forwardRef((props: unknown, ref) => {
		mockNKleinAgentChatPanel(props);
		useImperativeHandle(ref, () => ({
			appendToDraft: mockNKleinAppendToDraft,
			sendText: mockNKleinSendText,
		}));
		return <div data-testid="nklein-agent-chat-panel" />;
	}),
}));

vi.mock("@/components/detail-panels/column-context-panel", () => ({
	ColumnContextPanel: () => <div data-testid="column-context-panel" />,
}));

vi.mock("@/components/detail-panels/diff-viewer-panel", () => ({
	DiffViewerPanel: (props: unknown) => {
		mockDiffViewerPanel(props);
		return <div data-testid="diff-viewer-panel" />;
	},
}));

vi.mock("@/components/detail-panels/file-tree-panel", () => ({
	FileTreePanel: () => <div data-testid="file-tree-panel" />,
}));

vi.mock("@/resize/resizable-bottom-pane", () => ({
	ResizableBottomPane: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/runtime/use-runtime-workspace-changes", () => ({
	useRuntimeWorkspaceChanges: (...args: unknown[]) => mockUseRuntimeWorkspaceChanges(...args),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	applyNKleinPlanArtifact: mockApplyNKleinPlanArtifact,
	collectTaskEvidence: mockCollectTaskEvidence,
	fetchNKleinPlanArtifacts: mockFetchNKleinPlanArtifacts,
	fetchTaskDiagnostics: mockFetchTaskDiagnostics,
	mergeTaskWorktrees: mockMergeTaskWorktrees,
	rejectNKleinPlanArtifact: mockRejectNKleinPlanArtifact,
	verifyTaskAcceptance: mockVerifyTaskAcceptance,
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceStateVersionValue: () => 0,
}));

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutResetEffect: () => {},
}));

function createCard(id: string, overrides: Partial<BoardCard> = {}): BoardCard {
	return {
		id,
		title: `Task ${id}`,
		prompt: `Task ${id}`,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function createSelection(
	options: { columnId?: BoardColumn["id"]; card?: BoardCard; extraCards?: BoardCard[] } = {},
): CardSelection {
	const card = options.card ?? createCard("task-1");
	const columns: BoardColumn[] = [
		{
			id: "backlog",
			title: "Backlog",
			cards: options.columnId === undefined || options.columnId === "backlog" ? [card] : [],
		},
		{
			id: "planning",
			title: "Planning",
			cards: options.columnId === "planning" ? [card, ...(options.extraCards ?? [])] : (options.extraCards ?? []),
		},
		{
			id: "in_progress",
			title: "In Progress",
			cards: options.columnId === "in_progress" ? [card] : [],
		},
		{
			id: "review",
			title: "Review",
			cards: options.columnId === "review" ? [card] : [],
		},
		{
			id: "trash",
			title: "Done",
			cards: options.columnId === "trash" ? [card] : [],
		},
	];
	const column = columns.find((candidate) => candidate.cards.some((candidateCard) => candidateCard.id === card.id));
	return {
		card,
		column: column ?? columns[0]!,
		allColumns: columns,
	};
}

type MockedDiffViewerProps = {
	onAddToTerminal?: (formatted: string) => void;
	onSendToTerminal?: (formatted: string) => void;
};

function getLastMockFirstArg<T>(mockFn: { mock: { calls: unknown[][] } }): T {
	const lastCall = mockFn.mock.calls.at(-1);
	expect(lastCall).toBeDefined();
	return lastCall?.[0] as T;
}

function requireResizeSeparator(container: HTMLElement): HTMLElement {
	const separator = container.querySelector('[aria-label="Resize agent and diff panels"]');
	if (!(separator instanceof HTMLElement)) {
		throw new Error("Expected a resize separator.");
	}
	return separator;
}

function requireAgentPanel(container: HTMLElement): HTMLElement {
	const separator = requireResizeSeparator(container);
	const panel = separator.previousElementSibling;
	if (!(panel instanceof HTMLElement)) {
		throw new Error("Expected an agent panel element.");
	}
	return panel;
}

function requireDetailDiffSeparator(container: HTMLElement): HTMLElement {
	const separator = container.querySelector('[aria-label="Resize detail diff panels"]');
	if (!(separator instanceof HTMLElement)) {
		throw new Error("Expected a detail diff resize separator.");
	}
	return separator;
}

function requireDetailDiffFileTreePanel(container: HTMLElement): HTMLElement {
	const separator = requireDetailDiffSeparator(container);
	const panel = separator.nextElementSibling;
	if (!(panel instanceof HTMLElement)) {
		throw new Error("Expected a detail diff file tree panel element.");
	}
	return panel;
}

describe("CardDetailView", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockAgentTerminalPanel.mockClear();
		mockNKleinAgentChatPanel.mockClear();
		mockDiffViewerPanel.mockClear();
		mockNKleinAppendToDraft.mockClear();
		mockNKleinSendText.mockClear();
		mockFetchTaskDiagnostics.mockReset();
		mockFetchTaskDiagnostics.mockResolvedValue({ ok: true, events: [] });
		mockFetchNKleinPlanArtifacts.mockReset();
		mockFetchNKleinPlanArtifacts.mockResolvedValue({ artifacts: [] });
		mockApplyNKleinPlanArtifact.mockReset();
		mockRejectNKleinPlanArtifact.mockReset();
		mockVerifyTaskAcceptance.mockReset();
		mockCollectTaskEvidence.mockReset();
		mockCollectTaskEvidence.mockResolvedValue({
			bundlePath: "/tmp/evidence/task-1",
			summaryPath: "/tmp/evidence/task-1/summary.md",
			capture: {
				status: "result_branch",
				action: "inspect_result",
				message: "A task result branch was captured.",
				resultCommit: "abc123",
				resultBranchTaskId: "task-1",
			},
			files: {
				summary: "/tmp/evidence/task-1/summary.md",
				telemetry: "/tmp/evidence/task-1/telemetry.jsonl",
				configSnapshot: "/tmp/evidence/task-1/config-snapshot.json",
				evalResult: "/tmp/evidence/task-1/eval.json",
				diffPatch: "/tmp/evidence/task-1/diff.patch",
				transcripts: ["/tmp/evidence/task-1/transcript/01-task-1.json"],
			},
			summaryText: "Task: Fix the issue (task-1)\n\nPrompt:\nFix the issue",
			diffPatchText: "File: src/example.ts\nStatus: modified\n--- new\n+++ old",
			promptBlock: "Here is evidence from a !Klein task.",
		});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn(async () => {}),
			},
		});
		mockVerifyTaskAcceptance.mockResolvedValue({
			ok: true,
			taskId: "task-1",
			taskWorkspacePath: "/tmp/worktree",
			acceptance: {
				present: true,
				command: "npm test",
				passed: true,
				exitCode: 0,
				output: "ok",
				durationMs: 10,
				failureCategory: null,
				failureHint: null,
			},
			message: "Acceptance check passed: npm test.",
		} satisfies RuntimeTaskAcceptanceVerifyResponse);
		mockMergeTaskWorktrees.mockReset();
		mockMergeTaskWorktrees.mockResolvedValue({
			ok: true,
			column: "review",
			mergedTaskIds: ["task-1"],
			skippedTaskIds: [],
			steps: [
				{
					type: "merged",
					taskId: "task-1",
					headCommit: "abc123",
					reason: "task result HEAD merged into the base workspace.",
				},
			],
			conflict: null,
			blocked: null,
			message: "Merged 1 task results; skipped 0.",
		} satisfies RuntimeTaskWorktreeMergeResponse);
		mockUseRuntimeWorkspaceChanges.mockReturnValue({
			changes: {
				files: [
					{
						path: "src/example.ts",
						status: "modified",
						additions: 1,
						deletions: 0,
						oldText: "before\n",
						newText: "after\n",
					},
				],
			},
			isRuntimeAvailable: true,
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		mockUseRuntimeWorkspaceChanges.mockReset();
		mockAgentTerminalPanel.mockClear();
		mockNKleinAgentChatPanel.mockClear();
		mockDiffViewerPanel.mockClear();
		mockNKleinAppendToDraft.mockClear();
		mockNKleinSendText.mockClear();
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("collapses the expanded diff on Escape without closing the detail view", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const expandButton = container.querySelector('button[aria-label="Expand split diff view"]');
		expect(expandButton).toBeInstanceOf(HTMLButtonElement);
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Expected an expand diff button.");
		}

		await act(async () => {
			expandButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			expandButton.click();
		});

		const toolbarButtons = Array.from(container.querySelectorAll("button"));
		expect(toolbarButtons[0]?.getAttribute("aria-label")).toBe("Collapse expanded diff view");
		expect(toolbarButtons[1]?.textContent?.trim()).toBe("All Changes");
		expect(toolbarButtons[2]?.textContent?.trim()).toBe("Last Turn");
		expect(container.querySelector('button[aria-label="Expand split diff view"]')).toBeNull();

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		});

		expect(container.querySelector('button[aria-label="Collapse expanded diff view"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Expand split diff view"]')).toBeInstanceOf(HTMLButtonElement);
	});

	it("loads local diagnostics for the selected card", async () => {
		mockFetchTaskDiagnostics.mockResolvedValue({
			ok: true,
			events: [
				{
					schemaVersion: 1,
					signal: "plan_gap",
					severity: "warning",
					message: "Missing integration step",
					taskId: "task-1",
					runId: null,
					providerId: "ollama",
					modelId: "qwen",
					workspacePath: null,
					createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
				},
			],
		});

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const diagnosticsButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Diagnostics"),
		);
		expect(diagnosticsButton).toBeInstanceOf(HTMLButtonElement);
		if (!(diagnosticsButton instanceof HTMLButtonElement)) {
			throw new Error("Expected diagnostics button.");
		}

		await act(async () => {
			diagnosticsButton.click();
		});

		expect(mockFetchTaskDiagnostics).toHaveBeenCalledWith("workspace-1", "task-1", 20);
		expect(container.textContent).toContain("plan_gap");
		expect(container.textContent).toContain("Missing integration step");
	});

	it("clears stale diff content when switching from all changes to last turn", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const lastTurnButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Last Turn",
		);
		expect(lastTurnButton).toBeInstanceOf(HTMLButtonElement);
		if (!(lastTurnButton instanceof HTMLButtonElement)) {
			throw new Error("Expected a Last Turn button.");
		}

		await act(async () => {
			lastTurnButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			lastTurnButton.click();
		});

		const lastCall = mockUseRuntimeWorkspaceChanges.mock.calls.at(-1);
		expect(lastCall?.[3]).toBe("last_turn");
		expect(lastCall?.[7]).toBe(true);
	});

	it("keeps the active diff mode visually highlighted", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const getDiffModeButton = (label: string): HTMLButtonElement => {
			const button = Array.from(container.querySelectorAll("button")).find(
				(candidate) => candidate.textContent?.trim() === label,
			);
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error(`Expected a ${label} button.`);
			}
			return button;
		};

		const allChangesButton = getDiffModeButton("All Changes");
		const lastTurnButton = getDiffModeButton("Last Turn");

		expect(allChangesButton.getAttribute("aria-pressed")).toBe("true");
		expect(allChangesButton.getAttribute("style")).toContain(
			"background-color: color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))",
		);
		expect(lastTurnButton.getAttribute("aria-pressed")).toBe("false");
		expect(lastTurnButton.style.backgroundColor).toBe("");

		await act(async () => {
			lastTurnButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			lastTurnButton.click();
		});

		expect(getDiffModeButton("All Changes").getAttribute("aria-pressed")).toBe("false");
		expect(getDiffModeButton("All Changes").style.backgroundColor).toBe("");
		expect(getDiffModeButton("Last Turn").getAttribute("aria-pressed")).toBe("true");
		expect(getDiffModeButton("Last Turn").getAttribute("style")).toContain(
			"background-color: color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))",
		);
	});

	it("closes git history before handling other Escape behavior", async () => {
		const onCloseGitHistory = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					gitHistoryPanel={<div data-testid="git-history-panel">Git history</div>}
					onCloseGitHistory={onCloseGitHistory}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const input = document.createElement("input");
		container.appendChild(input);
		input.focus();

		await act(async () => {
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		});

		expect(onCloseGitHistory).toHaveBeenCalledTimes(1);
	});

	it("renders native chat panel for nklein agent", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="nklein-agent-chat-panel"]')).toBeInstanceOf(HTMLDivElement);
		expect(container.querySelector('[data-testid="agent-terminal-panel"]')).toBeNull();
	});

	it("does not render native chat panel when the task explicitly uses a non-nklein agent", async () => {
		const selection = createSelection();
		selection.card.agentId = "codex";

		await act(async () => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="nklein-agent-chat-panel"]')).toBeNull();
	});

	it("shows nklein chat panel when task session agentId is nklein even if global agent is claude", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="claude"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "nklein",
						workspacePath: null,
						pid: null,
						startedAt: null,
						updatedAt: Date.now(),
						lastOutputAt: null,
						reviewReason: null,
						exitCode: null,
						lastHookAt: null,
						latestHookActivity: null,
						warningMessage: null,
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="nklein-agent-chat-panel"]')).toBeInstanceOf(HTMLDivElement);
	});

	it("renders the live task activity surface from the session summary", async () => {
		mockFetchTaskDiagnostics.mockResolvedValue({
			ok: true,
			events: [
				{
					schemaVersion: 1,
					signal: "custom",
					severity: "info",
					message: "Task result merged: task-1",
					taskId: "task-1",
					runId: null,
					providerId: null,
					modelId: null,
					workspacePath: null,
					metadata: { category: "task_worktree_merge", type: "merged" },
					createdAt: Date.UTC(2026, 0, 2, 3, 5, 0),
				},
				{
					schemaVersion: 1,
					signal: "verification_failed",
					severity: "error",
					message: "Acceptance gate failed: npm test",
					taskId: "task-1",
					runId: null,
					providerId: null,
					modelId: null,
					workspacePath: null,
					metadata: { command: "npm test" },
					createdAt: Date.UTC(2026, 0, 2, 3, 4, 0),
				},
			],
		});
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "nklein",
						workspacePath: null,
						pid: null,
						startedAt: null,
						updatedAt: Date.now(),
						lastOutputAt: null,
						reviewReason: null,
						exitCode: null,
						lastHookAt: null,
						latestHookActivity: {
							activityText: "Using read_file: src/example.ts",
							toolName: "read_file",
							toolInputSummary: "src/example.ts",
							finalMessage: null,
							hookEventName: "tool_start",
							notificationType: null,
							source: "nklein-sdk",
						},
						warningMessage: null,
						providerId: "lmstudio",
						modelId: "qwen3",
						endpoint: null,
						sharedEndpointId: "lmstudio:default",
						contextBudgetBreakdown: {
							systemPromptTokens: 100,
							toolSchemaTokens: 100,
							taskPromptTokens: 100,
							userMessageTokens: 100,
							includedFileContentTokens: 100,
							otherHistoryTokens: 100,
							reservedPromptOverheadTokens: 100,
							reservedOutputTokens: 100,
							usedWorkingTokens: 800,
							freeWorkingTokens: 39_200,
							effectiveContextWindow: 40_000,
							projectedTokens: 12_000,
						},
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});
		await act(async () => {});

		expect(container.textContent).toContain("Activity");
		expect(container.textContent).toContain("Routing");
		expect(container.textContent).toContain("runtime-selected: lmstudio / qwen3 on lmstudio:default");
		expect(container.textContent).toContain("Context");
		expect(container.textContent).toContain("12k / 40k tokens");
		expect(container.textContent).toContain("Retrieval");
		expect(container.textContent).toContain("src/example.ts");
		expect(container.textContent).toContain("read_file");
		expect(container.textContent).toContain("Acceptance");
		expect(container.textContent).toContain("Acceptance gate failed: npm test");
		expect(container.textContent).toContain("Merge");
		expect(container.textContent).toContain("Task result merged: task-1");
	});

	it("shows a planning DAG review panel for linked Planning cards", async () => {
		const selected = createCard("plan-ui", {
			title: "Build UI",
			prompt:
				"Implement UI.\n\nComplexity: 45/100\n\nModel fit: validated by !Klein routing guard (lmstudio / qwen3, role worker, context 64,000, capability 70)",
			startInPlanMode: true,
			filesLikelyTouched: ["web-ui/src/App.tsx"],
			agentId: "nklein",
			nkleinSettings: {
				providerId: "lmstudio",
				modelId: "qwen3",
			},
		});
		const prerequisite = createCard("plan-api", {
			title: "Build API",
			prompt: "Implement API.\n\nComplexity: 35/100",
			filesLikelyTouched: ["src/api.ts"],
		});
		const dependent = createCard("plan-polish", {
			title: "Polish flow",
			prompt: "Polish the flow.\n\nComplexity: 80/100",
			filesLikelyTouched: [
				"web-ui/src/flow.tsx",
				"web-ui/src/copy.ts",
				"web-ui/src/styles.css",
				"web-ui/src/test.ts",
			],
		});
		const indirect = createCard("plan-docs", {
			title: "Document flow",
			prompt: "Document the flow.\n\nComplexity: 20/100",
		});
		const revised = createCard("plan-decision", {
			title: "Resolve plan decision gap from plan-ui",
			prompt: "Resolve the decision.\n\nComplexity: 15/100",
		});
		const handleApprovePlanningCard = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection({
						columnId: "planning",
						card: selected,
						extraCards: [prerequisite, dependent, indirect, revised],
					})}
					dependencies={[
						{ id: "dep-1", fromTaskId: "plan-ui", toTaskId: "plan-api", createdAt: 1 },
						{ id: "dep-2", fromTaskId: "plan-polish", toTaskId: "plan-ui", createdAt: 2 },
						{ id: "dep-3", fromTaskId: "plan-docs", toTaskId: "plan-polish", createdAt: 3 },
						{ id: "dep-4", fromTaskId: "plan-decision", toTaskId: "plan-ui", createdAt: 4 },
					]}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onApprovePlanningCard={handleApprovePlanningCard}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("Plan DAG");
		expect(container.textContent).toContain("4 linked cards");
		expect(container.textContent).toContain("Build UI");
		expect(container.textContent).toContain("Blocked by prerequisite");
		expect(container.textContent).toContain("Build API");
		expect(container.textContent).toContain("Unblocks dependent");
		expect(container.textContent).toContain("Polish flow");
		expect(container.textContent).toContain("Linked plan card");
		expect(container.textContent).toContain("Document flow");
		expect(container.textContent).toContain("Resolve plan decision gap from plan-ui");
		expect(container.textContent).toContain("Revised plan");
		expect(container.textContent).toContain("Complexity 80/100");
		expect(container.textContent).toContain("Fit needs review");
		expect(container.textContent).toContain("Backend fit validated");
		expect(container.textContent).toContain("Backend fit pending");
		expect(container.textContent).toContain("web-ui/src/flow.tsx, web-ui/src/copy.ts, web-ui/src/styles.css +1");
		const approveButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Approve for execution",
		);
		expect(approveButton).toBeDefined();
		await act(async () => {
			approveButton?.click();
		});
		expect(handleApprovePlanningCard).toHaveBeenCalledWith("plan-ui");
	});

	it("exposes verify and merge actions for review cards with acceptance checks", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection({
						columnId: "review",
						card: createCard("task-1", {
							prompt: "Ship the change.\n\nAcceptance check: npm test",
						}),
					})}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const verifyButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Verify",
		);
		const mergeButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Merge",
		);
		expect(verifyButton).toBeInstanceOf(HTMLButtonElement);
		expect(mergeButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			verifyButton?.click();
			await Promise.resolve();
		});
		expect(mockVerifyTaskAcceptance).toHaveBeenCalledWith("workspace-1", "task-1");
		expect(container.textContent).toContain("Acceptance check passed");

		await act(async () => {
			mergeButton?.click();
			await Promise.resolve();
		});
		expect(mockMergeTaskWorktrees).toHaveBeenCalledWith("workspace-1", "task-1");
		expect(container.textContent).toContain("Merged 1 task results");
	});

	it("collects and copies evidence for the selected card", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection({ columnId: "review" })}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const evidenceButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Create evidence",
		);
		expect(evidenceButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			evidenceButton?.click();
			await Promise.resolve();
		});

		expect(mockCollectTaskEvidence).toHaveBeenCalledWith("workspace-1", "task-1");
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Here is evidence from a !Klein task.");
		expect(container.textContent).toContain("Evidence created and copied. /tmp/evidence/task-1");
		expect(container.textContent).toContain("Evidence and diff");
		expect(container.textContent).toContain("/tmp/evidence/task-1/diff.patch");
		expect(container.textContent).toContain("/tmp/evidence/task-1/transcript/01-task-1.json");
		expect(container.textContent).toContain("Task: Fix the issue (task-1)");
		expect(container.textContent).toContain("Task artifact: result branch");
		expect(container.textContent).toContain("Recommended action: inspect result");

		const diffTab = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Diff",
		);
		expect(diffTab).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			diffTab?.click();
		});

		expect(container.textContent).toContain("File: src/example.ts");
	});

	it("exposes a mark interrupted action for lost NKlein sessions", async () => {
		const onMarkTaskInterrupted = vi.fn(async () => ({ ok: true }));

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection({ columnId: "review" })}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={{
						taskId: "task-1",
						state: "awaiting_review",
						agentId: "nklein",
						workspacePath: null,
						pid: null,
						startedAt: null,
						updatedAt: Date.now(),
						lastOutputAt: null,
						reviewReason: "error",
						exitCode: null,
						lastHookAt: null,
						latestHookActivity: null,
						warningMessage:
							"!Klein session heartbeat was lost. Review the latest transcript, then resume the card or mark it interrupted.",
						heartbeatStatus: "lost",
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onMarkTaskInterrupted={onMarkTaskInterrupted}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const markInterruptedButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Mark interrupted",
		);
		expect(markInterruptedButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			markInterruptedButton?.click();
			await Promise.resolve();
		});

		expect(onMarkTaskInterrupted).toHaveBeenCalledWith("task-1");
		expect(container.textContent).toContain("Marked the lost task session interrupted.");
	});

	it("shows terminal panel when task session agentId is claude even if global agent is nklein", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "claude",
						workspacePath: null,
						pid: null,
						startedAt: null,
						updatedAt: Date.now(),
						lastOutputAt: null,
						reviewReason: null,
						exitCode: null,
						lastHookAt: null,
						latestHookActivity: null,
						warningMessage: null,
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="nklein-agent-chat-panel"]')).toBeNull();
		expect(mockAgentTerminalPanel).toHaveBeenCalled();
	});

	it("uses surface-primary colors for the detail terminal panel", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="claude"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const lastCall = mockAgentTerminalPanel.mock.calls.at(-1);
		expect(lastCall?.[0]).toMatchObject({
			panelBackgroundColor: "var(--color-surface-0)",
			// §5.AX: default look is now the klein theme — assert against the ACTIVE theme's surface-primary
			// (resolves via readStoredThemeId) so this survives future default changes, not the static legacy color.
			terminalBackgroundColor: getTerminalThemeColors(readStoredThemeId()).surfacePrimary,
		});
	});

	it("queues Add diff comments into the nklein composer without sending them", async () => {
		const onAddReviewComments = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onAddReviewComments={onAddReviewComments}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const diffProps = getLastMockFirstArg<MockedDiffViewerProps>(mockDiffViewerPanel);
		expect(diffProps.onAddToTerminal).toBeTypeOf("function");

		await act(async () => {
			diffProps.onAddToTerminal?.("src/example.ts:4 | value\n> Add tests");
		});

		expect(onAddReviewComments).not.toHaveBeenCalled();
		expect(mockNKleinAppendToDraft).toHaveBeenCalledWith("src/example.ts:4 | value\n> Add tests");
	});

	it("routes Send diff comments through the mounted nklein panel", async () => {
		const onSendReviewComments = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="nklein"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onSendReviewComments={onSendReviewComments}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const diffProps = getLastMockFirstArg<MockedDiffViewerProps>(mockDiffViewerPanel);
		expect(diffProps.onSendToTerminal).toBeTypeOf("function");

		await act(async () => {
			diffProps.onSendToTerminal?.("src/example.ts:8 | done\n> Ship this");
			await Promise.resolve();
		});

		expect(onSendReviewComments).not.toHaveBeenCalled();
		expect(mockNKleinSendText).toHaveBeenCalledWith("src/example.ts:8 | done\n> Ship this");
	});

	it("loads the saved agent-to-diff panel ratio from local storage", async () => {
		window.localStorage.setItem(LocalStorageKey.DetailAgentPanelRatio, "0.62");

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(requireAgentPanel(container).style.width).toBe("62%");
	});

	it("persists the resized agent-to-diff panel ratio globally", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const separator = requireResizeSeparator(container);
		const dragHandle = separator.firstElementChild;
		expect(dragHandle).toBeInstanceOf(HTMLDivElement);
		if (!(dragHandle instanceof HTMLDivElement)) {
			throw new Error("Expected a draggable resize handle.");
		}

		await act(async () => {
			dragHandle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 160 }));
		});
		await act(async () => {
			window.dispatchEvent(new MouseEvent("mousemove", { clientX: 320 }));
			window.dispatchEvent(new MouseEvent("mouseup", { clientX: 320 }));
		});

		const savedRatioRaw = window.localStorage.getItem(LocalStorageKey.DetailAgentPanelRatio);
		expect(savedRatioRaw).not.toBeNull();
		const savedRatio = Number(savedRatioRaw);
		expect(savedRatio).toBeGreaterThan(0.4);
		expect(savedRatio).toBeLessThanOrEqual(0.75);
		expect(requireAgentPanel(container).style.width).not.toBe("40%");
	});

	it("keeps the saved divider position after leaving and reopening task detail", async () => {
		const renderDetail = async (): Promise<void> => {
			await act(async () => {
				root.render(
					<CardDetailView
						selection={createSelection()}
						currentProjectId="workspace-1"
						sessionSummary={null}
						taskSessions={{}}
						onSessionSummary={() => {}}
						onCardSelect={() => {}}
						onTaskDragEnd={() => {}}
						onMoveToTrash={() => {}}
						bottomTerminalOpen={false}
						bottomTerminalTaskId={null}
						bottomTerminalSummary={null}
						onBottomTerminalClose={() => {}}
					/>,
				);
			});
		};

		await renderDetail();

		const separator = requireResizeSeparator(container);
		const dragHandle = separator.firstElementChild;
		expect(dragHandle).toBeInstanceOf(HTMLDivElement);
		if (!(dragHandle instanceof HTMLDivElement)) {
			throw new Error("Expected a draggable resize handle.");
		}

		await act(async () => {
			dragHandle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200 }));
			window.dispatchEvent(new MouseEvent("mouseup", { clientX: 420 }));
		});

		const expectedRatio = window.localStorage.getItem(LocalStorageKey.DetailAgentPanelRatio);
		expect(expectedRatio).not.toBeNull();

		await act(async () => {
			root.unmount();
			root = createRoot(container);
		});

		await renderDetail();

		const restoredWidth = requireAgentPanel(container).style.width;
		const restoredRatio = Number.parseFloat(restoredWidth) / 100;
		expect(restoredRatio).toBeCloseTo(Number(expectedRatio), 2);
	});

	it("uses separate file-tree ratios for collapsed and expanded diff layouts", async () => {
		window.localStorage.setItem(LocalStorageKey.DetailDiffFileTreePanelRatio, "0.42");
		window.localStorage.setItem(LocalStorageKey.DetailExpandedDiffFileTreePanelRatio, "0.18");

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(requireDetailDiffFileTreePanel(container).style.flex).toBe("0 0 42%");

		const expandButton = container.querySelector('button[aria-label="Expand split diff view"]');
		expect(expandButton).toBeInstanceOf(HTMLButtonElement);
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Expected an expand diff button.");
		}

		await act(async () => {
			expandButton.click();
		});

		expect(requireDetailDiffFileTreePanel(container).style.flex).toBe("0 0 18%");
	});
});
