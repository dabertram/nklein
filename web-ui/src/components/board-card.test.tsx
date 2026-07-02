import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardCard } from "@/components/board-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { ReviewTaskWorkspaceSnapshot } from "@/types";

let mockWorkspaceSnapshot: ReviewTaskWorkspaceSnapshot | undefined;
let mockMeasureWidths = [240, 240, 240];
let mockMeasureCallCount = 0;

vi.mock("@hello-pangea/dnd", () => ({
	Draggable: ({
		children,
	}: {
		children: (
			provided: {
				innerRef: (element: HTMLDivElement | null) => void;
				draggableProps: object;
				dragHandleProps: object;
			},
			snapshot: { isDragging: boolean },
		) => ReactNode;
	}): React.ReactElement => (
		<>{children({ innerRef: () => {}, draggableProps: {}, dragHandleProps: {} }, { isDragging: false })}</>
	),
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceSnapshotValue: () => mockWorkspaceSnapshot,
}));

vi.mock("@/utils/react-use", () => ({
	useMedia: () => false,
	useMeasure: () => {
		mockMeasureCallCount += 1;
		const width = mockMeasureWidths[(mockMeasureCallCount - 1) % mockMeasureWidths.length] ?? 240;
		return [
			() => {},
			{
				width,
				height: 0,
				top: 0,
				left: 0,
				bottom: 0,
				right: 0,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			},
		];
	},
}));

vi.mock("@/utils/text-measure", () => ({
	DEFAULT_TEXT_MEASURE_FONT: "400 14px sans-serif",
	measureTextWidth: (value: string) => value.length * 8,
	readElementFontShorthand: () => "400 14px sans-serif",
}));

vi.mock("@/utils/task-prompt", async () => {
	const actual = await vi.importActual<typeof import("@/utils/task-prompt")>("@/utils/task-prompt");
	return {
		...actual,
		truncateTaskPromptLabel: (prompt: string) => prompt.split("||")[0]?.trim() ?? "",
		normalizePromptForDisplay: (value: string) => value.split("||")[0]?.trim() ?? value.trim(),
		getTaskPromptDescription: (prompt: string, title: string) => {
			const normalized = prompt.trim();
			if (!normalized.startsWith(title)) {
				return normalized;
			}
			return normalized.slice(title.length).replace(/^\|\|/, "").trim();
		},
	};
});

function createCard(overrides?: Partial<Parameters<typeof BoardCard>[0]["card"]>) {
	return {
		id: "task-1",
		title: "Review API changes",
		prompt: "Review API changes",
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit" as const,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	overrides?: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "nklein",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: 1,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createReview(
	overrides?: Partial<NonNullable<Parameters<typeof BoardCard>[0]["card"]["review"]>>,
): NonNullable<Parameters<typeof BoardCard>[0]["card"]["review"]> {
	return {
		status: "changes_requested",
		round: 1,
		history: [{ round: 1, verdict: "request_changes", feedbackFingerprint: "fb-1", workFingerprint: "work-1" }],
		lastVerdict: "request_changes",
		lastSummary: "Needs fixes",
		lastFeedback: "Fix the failing acceptance check",
		lastInsight: null,
		signOff: null,
		parkedReason: null,
		updatedAt: 1,
		...overrides,
	};
}

function Harness(): React.ReactElement {
	const [card, setCard] = useState(
		createCard({
			autoReviewEnabled: true,
			autoReviewMode: "pr",
		}),
	);

	return (
		<BoardCard
			card={card}
			index={0}
			columnId="backlog"
			onCancelAutomaticAction={() => {
				setCard((currentCard) => ({
					...currentCard,
					autoReviewEnabled: false,
				}));
			}}
		/>
	);
}

describe("BoardCard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		mockWorkspaceSnapshot = undefined;
		mockMeasureWidths = [240, 240, 240];
		mockMeasureCallCount = 0;
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			width: 240,
			height: 32,
			right: 240,
			bottom: 32,
			toJSON: () => ({}),
		}));
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("shows a mode-specific cancel button and hides it after canceling auto review", async () => {
		await act(async () => {
			root.render(<Harness />);
		});

		const cancelButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Cancel Auto-PR",
		);
		expect(cancelButton).toBeDefined();

		await act(async () => {
			cancelButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			cancelButton?.click();
		});

		const nextCancelButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Cancel Auto-"),
		);
		expect(nextCancelButton).toBeUndefined();
	});

	it("shows the architect role on plan-mode cards", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard({ startInPlanMode: true })} index={0} columnId="planning" />);
		});

		expect(container.textContent).toContain("Architect");
		expect(container.textContent).not.toContain("Worker");
	});

	it("shows the worker role for execution cards waiting in Planning", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard({ startInPlanMode: false })} index={0} columnId="planning" />);
		});

		expect(container.textContent).toContain("Worker");
		expect(container.textContent).not.toContain("Architect");
	});

	it("shows when a role is actively working", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({ startInPlanMode: true })}
					index={0}
					columnId="planning"
					sessionSummary={createSummary("running")}
				/>,
			);
		});

		expect(container.textContent).toContain("Architect working");
	});

	it("shows a recovery message for lost NKlein heartbeats", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						reviewReason: "error",
						heartbeatStatus: "lost",
						warningMessage:
							"!Klein session heartbeat was lost. Review the latest transcript, then resume the card or mark it interrupted.",
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Needs attention: the !Klein session heartbeat was lost");
	});

	it("shows durable auto-review notices on review cards", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						autoReviewEnabled: true,
						autoReviewStatus: "failed",
						autoReviewMessage: "Auto-commit did not start. Review the task workspace.",
					})}
					index={0}
					columnId="review"
				/>,
			);
		});

		expect(container.textContent).toContain("Auto-commit did not start. Review the task workspace.");
	});

	it("does not show a finished-card action when replay is disabled", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard()} index={0} columnId="review" />);
		});

		expect(container.querySelector('button[aria-label="Move task to completed"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Replay task"]')).toBeNull();
	});

	it("shows review git actions for sandbox result branches without workspace snapshots", async () => {
		const handleCommit = vi.fn();
		const handleOpenPr = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({ agentId: "nklein" })}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						latestHookActivity: {
							activityText: "Result patch captured: nklein/tasks/task-1",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "abc1234",
							hookEventName: "sandbox_patch_captured",
							notificationType: null,
							source: "nklein",
						},
					})}
					onCommit={handleCommit}
					onOpenPr={handleOpenPr}
				/>,
			);
		});

		const commitButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Commit",
		);
		const openPrButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Open PR",
		);
		expect(commitButton).toBeInstanceOf(HTMLButtonElement);
		expect(openPrButton).toBeInstanceOf(HTMLButtonElement);
	});

	it("shows a replay control for finished cards when replay is enabled", async () => {
		const handleReplayTask = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="completed"
					replayCardsEnabled
					onReplayTask={handleReplayTask}
				/>,
			);
		});

		const replayButton = container.querySelector<HTMLButtonElement>('button[aria-label="Replay task"]');
		expect(replayButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			replayButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			replayButton?.click();
		});

		expect(handleReplayTask).toHaveBeenCalledWith("task-1");
	});

	it("shows a pause control for running task sessions", async () => {
		const handlePauseTask = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running")}
					onPauseTask={handlePauseTask}
				/>,
			);
		});

		const pauseButton = container.querySelector<HTMLButtonElement>('button[aria-label="Pause task"]');
		expect(pauseButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			pauseButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			pauseButton?.click();
		});

		expect(handlePauseTask).toHaveBeenCalledWith("task-1");
		expect(container.querySelector('button[aria-label="Resume task"]')).toBeNull();
	});

	it("shows sandbox capacity queue state without run controls", async () => {
		await act(async () => {
			root.render(
				<BoardCard card={createCard()} index={0} columnId="in_progress" sessionSummary={createSummary("queued")} />,
			);
		});

		expect(container.textContent).toContain("Queued");
		expect(container.textContent).toContain("waiting for sandbox capacity");
		expect(container.querySelector('button[aria-label="Pause task"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Start task"]')).toBeNull();
	});

	it("shows a resume control for paused task sessions", async () => {
		const handleResumeTask = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", { paused: true })}
					onResumeTask={handleResumeTask}
				/>,
			);
		});

		const resumeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Resume task"]');
		expect(resumeButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			resumeButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			resumeButton?.click();
		});

		expect(handleResumeTask).toHaveBeenCalledWith("task-1");
		expect(container.querySelector('button[aria-label="Pause task"]')).toBeNull();
	});

	it("shows inline see more and less controls for long descriptions", async () => {
		const description =
			"Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau final hidden segment";

		await act(async () => {
			root.render(
				<BoardCard card={createCard({ prompt: `Task title||${description}` })} index={0} columnId="backlog" />,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

		const seeMoreButton = findButton("See more");
		expect(seeMoreButton).toBeDefined();
		expect(container.textContent).not.toContain("final hidden segment");

		await act(async () => {
			seeMoreButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			seeMoreButton?.click();
		});

		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeDefined();
		expect(container.textContent).toContain(description);

		const lessButton = findButton("Less");
		await act(async () => {
			lessButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			lessButton?.click();
		});

		expect(findButton("See more")).toBeDefined();
		expect(container.textContent).not.toContain("final hidden segment");
	});

	it("does not reconstruct a host worktree path for default trashed sandbox tasks", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard({ id: "trash-task-1" })}
						index={0}
						columnId="trash"
						workspacePath="/Users/alice/projects/kanban"
					/>
				</TooltipProvider>,
			);
		});

		expect(container.textContent).not.toContain("~/.nklein/worktrees/trash-task-1/kanban");
	});

	it("reconstructs and shows trashed worktree path for legacy host-workspace agents", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard({ id: "trash-task-1", agentId: "codex" })}
						index={0}
						columnId="trash"
						workspacePath="/Users/alice/projects/kanban"
					/>
				</TooltipProvider>,
			);
		});

		expect(container.textContent).toContain("~/.nklein/worktrees/trash-task-1/kanban");
	});

	it("shows formatted agent override details with model name and reasoning effort", async () => {
		mockWorkspaceSnapshot = {
			taskId: "task-1",
			path: "/tmp/worktrees/task-1",
			branch: "feature/override",
			isDetached: false,
			headCommit: "1234567890abcdef",
			changedFiles: 2,
			additions: 5,
			deletions: 1,
		};

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						agentId: "nklein",
						nkleinSettings: {
							modelId: "openai/gpt-5.5",
							reasoningEffort: "low",
						},
					})}
					index={0}
					columnId="review"
				/>,
			);
		});

		expect(container.textContent).toContain("!Klein");
		expect(container.textContent).toContain("GPT-5.5 (Low)");
		expect(container.textContent).not.toContain("openai/gpt-5.5");
	});

	it("shows the task-level indicator for reasoning-only overrides", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						nkleinSettings: {
							reasoningEffort: "low",
						},
					})}
					index={0}
					columnId="backlog"
					defaultNKleinModelId="openai/gpt-5.5"
				/>,
			);
		});

		expect(container.textContent).toContain("GPT-5.5 (Low)");
	});

	it("shows a fallback indicator for reasoning-only overrides without a resolved default model", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						nkleinSettings: {
							reasoningEffort: "low",
						},
					})}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		expect(container.textContent).toContain("Default model (Low)");
	});

	it("shows explicit default reasoning metadata for reasoning-only task overrides", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						agentId: "nklein",
						nkleinSettings: {},
					})}
					index={0}
					columnId="backlog"
					defaultNKleinModelId="openai/gpt-5.5"
				/>,
			);
		});

		expect(container.textContent).toContain("GPT-5.5 (Default)");
		expect(container.textContent).not.toContain("GPT-5.5 (High)");
	});

	it("does not mislabel provider-only overrides as the global default model", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						nkleinSettings: {
							providerId: "groq",
						},
					})}
					index={0}
					columnId="backlog"
					defaultNKleinModelId="openai/gpt-5.5"
				/>,
			);
		});

		expect(container.textContent).toContain("Provider: groq");
		expect(container.textContent).not.toContain("GPT-5.5");
	});

	it("does not show inherited global reasoning for explicit model overrides using default effort", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						agentId: "nklein",
						nkleinSettings: {
							modelId: "openai/gpt-5.5",
						},
					})}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		expect(container.textContent).toContain("GPT-5.5");
		expect(container.textContent).not.toContain("GPT-5.5 (High)");
	});

	it("shows tool input details in the session preview text", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "nklein",
						workspacePath: "/tmp/worktree",
						pid: null,
						startedAt: Date.now(),
						updatedAt: Date.now(),
						lastOutputAt: Date.now(),
						reviewReason: null,
						exitCode: null,
						lastHookAt: Date.now(),
						latestHookActivity: {
							activityText: "Using Read",
							toolName: "Read",
							toolInputSummary: "src/index.ts",
							finalMessage: null,
							hookEventName: "tool_call",
							notificationType: null,
							source: "nklein-sdk",
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Using Read");
	});

	it("shows non-nklein tool activity in the compact tool label format", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "claude",
						latestHookActivity: {
							activityText: "Completed Read: src/index.ts",
							toolName: "Read",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "tool_result",
							notificationType: null,
							source: "claude",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Completed Read");
	});

	it("keeps canonical tool names in the session preview label", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "kiro",
						latestHookActivity: {
							activityText: "Using fs_write: src/index.ts",
							toolName: "fs_write",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "preToolUse",
							notificationType: null,
							source: "kiro",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("fs_write(src/index.ts)");
	});

	it("parses codex tool activity into the compact tool label format", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "codex",
						latestHookActivity: {
							activityText: "Calling Read: src/index.ts",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "raw_response_item",
							notificationType: null,
							source: "codex",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Calling Read");
	});

	it("does not show a stale bare tool name for non-tool review updates", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						agentId: "kiro",
						latestHookActivity: {
							activityText: "Waiting for review",
							toolName: "fs_write",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "stop",
							notificationType: null,
							source: "kiro",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Waiting for review");
		expect(container.textContent).not.toContain("fs_write");
	});

	it("keeps showing the last nklein tool label during assistant streaming", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "nklein",
						workspacePath: "/tmp/worktree",
						pid: null,
						startedAt: Date.now(),
						updatedAt: Date.now(),
						lastOutputAt: Date.now(),
						reviewReason: null,
						exitCode: null,
						lastHookAt: Date.now(),
						latestHookActivity: {
							activityText: "Agent active",
							toolName: "Read",
							toolInputSummary: "src/index.ts",
							finalMessage: "Looking at the file now",
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "nklein-sdk",
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("renders a new card description before the async measure observer reports width", async () => {
		mockMeasureWidths = [0, 0, 0];

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({ prompt: "Task title||Freshly created task description" })}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		expect(container.textContent).toContain("Freshly created task description");
	});

	it("exposes a create evidence action without opening the card", async () => {
		const onCopyEvidence = vi.fn();
		const onClick = vi.fn();

		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard()}
						index={0}
						columnId="review"
						onCopyEvidence={onCopyEvidence}
						onClick={onClick}
					/>
				</TooltipProvider>,
			);
		});

		// Icon-only button (label via aria-label + tooltip) so the card title keeps its width in narrow columns.
		const button = container.querySelector<HTMLButtonElement>('button[aria-label="Create task evidence"]');
		expect(button).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			button?.click();
		});

		expect(onCopyEvidence).toHaveBeenCalledWith("task-1");
		expect(onClick).not.toHaveBeenCalled();
	});

	it("renders session activity as single-line truncated text on trash cards", async () => {
		const preview =
			"Reviewing the archived implementation details and collecting the final notes for the handoff before cleanup hidden tail";

		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard()}
						index={0}
						columnId="trash"
						sessionSummary={createSummary("awaiting_review", {
							latestHookActivity: {
								activityText: null,
								toolName: null,
								toolInputSummary: null,
								finalMessage: preview,
								hookEventName: "assistant_delta",
								notificationType: null,
								source: "nklein-sdk",
							},
						})}
					/>
				</TooltipProvider>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

		// Session activity uses CSS truncation with no See more / Less buttons
		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeUndefined();

		// The full text is in the DOM (CSS handles visual truncation)
		expect(container.textContent).toContain(preview);
	});

	it("renders session activity as single-line truncated text for running tasks", async () => {
		const preview =
			"Reviewing the archived implementation details and collecting the final notes for the handoff before cleanup hidden tail";

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						latestHookActivity: {
							activityText: null,
							toolName: null,
							toolInputSummary: null,
							finalMessage: preview,
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "nklein-sdk",
						},
					})}
				/>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

		// Session activity uses CSS truncation with no See more / Less buttons
		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeUndefined();

		// The full text is in the DOM (CSS handles visual truncation)
		expect(container.textContent).toContain(preview);
	});

	it("shows the latest assistant preview on active task cards", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						latestHookActivity: {
							activityText: "Reviewing the final diff",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "Reviewing the final diff",
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "nklein-sdk",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Reviewing the final diff");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("shows compact running telemetry and context budget on active cards", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						startedAt: Date.now() - 10_000,
						latestUsage: {
							inputTokens: 12_400,
							outputTokens: 120,
						},
						latestTurnCheckpoint: {
							turn: 3,
							ref: "refs/kanban/task-1/turn-3",
							commit: "abc123",
							createdAt: Date.now(),
						},
						contextBudgetBreakdown: {
							systemPromptTokens: 100,
							toolSchemaTokens: 200,
							taskPromptTokens: 300,
							userMessageTokens: 100,
							includedFileContentTokens: 500,
							otherHistoryTokens: 400,
							reservedPromptOverheadTokens: 100,
							reservedOutputTokens: 1_000,
							usedWorkingTokens: 1_600,
							freeWorkingTokens: 2_400,
							effectiveContextWindow: 4_000,
							projectedTokens: 2_000,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("12.4k in/120 out");
		expect(container.textContent).toContain("12 tok/s");
		expect(container.textContent).toContain("Turn 3");
		expect(container.textContent).toContain("Ctx 50%");
		const contextLabel = Array.from(container.querySelectorAll("span")).find(
			(element) => element.textContent === "Ctx 50%",
		);
		expect(contextLabel?.parentElement?.className).toContain("w-full");
	});

	it("shows plain-language recovery text for parked local-only errors", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						reviewReason: "error",
						warningMessage:
							'Cloud models are disabled in this build (local-only mode). The provider "openrouter" is a cloud/paid provider.',
						latestHookActivity: {
							activityText: "Send failed: Cloud models are disabled in this build",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "Cloud models are disabled in this build",
							hookEventName: "agent_error",
							notificationType: null,
							source: "nklein-sdk",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Paused: this card targets a cloud model.");
		expect(container.textContent).toContain("Choose an Ollama or LM Studio model");
		expect(container.textContent).not.toContain("openrouter");
	});

	it("shows normal agent messages without the agent prefix", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "codex",
						latestHookActivity: {
							activityText: "Agent: checking the next file",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "agent_message",
							notificationType: null,
							source: "codex",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("checking the next file");
		expect(container.textContent).not.toContain("Agent:");
	});

	it("renders a manage-dependencies button when onManageDependencies is provided and calls it with the card id", async () => {
		const onManageDependencies = vi.fn();

		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard()}
						index={0}
						columnId="backlog"
						onManageDependencies={onManageDependencies}
					/>
				</TooltipProvider>,
			);
		});

		const button = container.querySelector<HTMLButtonElement>('button[aria-label="Manage dependencies"]');
		expect(button).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			button?.click();
		});

		expect(onManageDependencies).toHaveBeenCalledWith("task-1");
	});

	it("does not render the manage-dependencies button when onManageDependencies is not provided", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard()} index={0} columnId="backlog" />);
		});

		expect(container.querySelector('button[aria-label="Manage dependencies"]')).toBeNull();
	});

	it("shows a compact session model badge with the provider prefix stripped", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", { modelId: "openai/gpt-5.5" })}
				/>,
			);
		});

		const badge = container.querySelector<HTMLSpanElement>("[data-model-badge]");
		expect(badge).toBeInstanceOf(HTMLSpanElement);
		expect(badge?.textContent).toContain("◈");
		expect(badge?.textContent).toContain("gpt-5.5");
		expect(badge?.textContent).not.toContain("openai/gpt-5.5");
		expect(badge?.getAttribute("title")).toContain("openai/gpt-5.5");
	});

	it("middle-truncates long session model ids and keeps the full id in the tooltip", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						modelId: "lmstudio-community/qwen3-coder-30b-a3b-instruct",
					})}
				/>,
			);
		});

		const badge = container.querySelector<HTMLSpanElement>("[data-model-badge]");
		expect(badge?.textContent).toContain("qwen3-c…struct");
		expect(badge?.textContent).not.toContain("qwen3-coder-30b-a3b-instruct");
		expect(badge?.getAttribute("title")).toContain("lmstudio-community/qwen3-coder-30b-a3b-instruct");
	});

	it("does not render the model badge without a session model id", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running")}
				/>,
			);
		});

		expect(container.querySelector("[data-model-badge]")).toBeNull();
	});

	it("shows the bounce rung as current for a bounced review", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard({ review: createReview() })} index={0} columnId="in_progress" />);
		});

		const ladder = container.querySelector<HTMLDivElement>("[data-review-ladder]");
		expect(ladder).toBeInstanceOf(HTMLDivElement);
		expect(ladder?.textContent).toContain("bounce");
		expect(ladder?.textContent).toContain("escalate");
		expect(ladder?.textContent).toContain("park");
		expect(ladder?.querySelector('[data-rung="bounce"]')?.getAttribute("data-rung-state")).toBe("now");
		expect(ladder?.querySelector('[data-rung="escalate"]')?.getAttribute("data-rung-state")).toBe("pending");
		expect(ladder?.querySelector('[data-rung="park"]')?.getAttribute("data-rung-state")).toBe("pending");
	});

	it("shows the escalate rung as current when the persisted history carries a stuck-loop signature", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						review: createReview({
							round: 2,
							// Stall signature: two consecutive rounds reviewed the same unchanged work.
							history: [
								{
									round: 1,
									verdict: "request_changes",
									feedbackFingerprint: "fb-1",
									workFingerprint: "work-1",
								},
								{
									round: 2,
									verdict: "request_changes",
									feedbackFingerprint: "fb-2",
									workFingerprint: "work-1",
								},
							],
						}),
					})}
					index={0}
					columnId="in_progress"
				/>,
			);
		});

		const ladder = container.querySelector<HTMLDivElement>("[data-review-ladder]");
		expect(ladder?.querySelector('[data-rung="bounce"]')?.getAttribute("data-rung-state")).toBe("done");
		expect(ladder?.querySelector('[data-rung="escalate"]')?.getAttribute("data-rung-state")).toBe("now");
		expect(ladder?.querySelector('[data-rung="park"]')?.getAttribute("data-rung-state")).toBe("pending");
	});

	it("shows the park rung in the bad state for parked reviews", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						review: createReview({
							status: "parked",
							round: 3,
							parkedReason: "Review is looping: the same change request on unchanged work. Parking for a human.",
							history: [
								{
									round: 1,
									verdict: "request_changes",
									feedbackFingerprint: "fb-1",
									workFingerprint: "work-1",
								},
								{
									round: 2,
									verdict: "request_changes",
									feedbackFingerprint: "fb-2",
									workFingerprint: "work-1",
								},
								{
									round: 3,
									verdict: "request_changes",
									feedbackFingerprint: "fb-2",
									workFingerprint: "work-1",
								},
							],
						}),
					})}
					index={0}
					columnId="review"
				/>,
			);
		});

		const ladder = container.querySelector<HTMLDivElement>("[data-review-ladder]");
		const parkRung = ladder?.querySelector('[data-rung="park"]');
		expect(parkRung?.getAttribute("data-rung-state")).toBe("now");
		expect(parkRung?.className).toContain("text-status-red");
		expect(ladder?.querySelector('[data-rung="bounce"]')?.getAttribute("data-rung-state")).toBe("done");
		expect(ladder?.getAttribute("title")).toContain("Review is looping");
	});

	it("skips the review ladder for approved reviews and cards without review state", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						review: createReview({
							status: "approved",
							lastVerdict: "approve",
							signOff: "Looks good.",
							history: [{ round: 1, verdict: "approve", feedbackFingerprint: null, workFingerprint: "work-1" }],
						}),
					})}
					index={0}
					columnId="completed"
				/>,
			);
		});

		expect(container.querySelector("[data-review-ladder]")).toBeNull();

		await act(async () => {
			root.render(<BoardCard card={createCard()} index={0} columnId="in_progress" />);
		});

		expect(container.querySelector("[data-review-ladder]")).toBeNull();
	});
});
