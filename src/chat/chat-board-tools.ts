import type { RuntimeBoardCard, RuntimeBoardData, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { addTaskToColumn } from "../core/task-board-mutations";
import type { LocalLlmToolDefinition } from "../nklein-sdk/nklein-local-llm-client";
import {
	loadWorkspaceState,
	mutateWorkspaceState,
	type RuntimeWorkspaceAtomicMutationResponse,
	type RuntimeWorkspaceAtomicMutationResult,
} from "../state/workspace-state";
import type { ChatTool } from "./chat-tool-executor";

/**
 * Read-only kanban board tools for the chat agent (todo §5.M — "use the project/card/task structure: work an existing
 * project or create a new one"). `get_board` lets the agent SEE the current project's board (columns + cards) so it can
 * reason about existing work before acting — the read half of board awareness; mutating board tools (create/start a
 * card) layer on the execution-mode gate separately.
 *
 * It's a `sandbox_read` action (always allowed by the gate, like the file read tools): reading the !Klein-owned board
 * is a safe control-plane query that never touches the host or a shell. Host-isolation invariant: the summary names
 * only columns + card ids/titles — never the project's on-disk path — so no host detail enters the agent's view.
 * The board loader is injected so the tools are unit-testable without a real workspace.
 */

export interface BoardToolDeps {
	/** Load the board for the given project root. Defaults to the on-disk workspace state. */
	loadBoard: (projectPath: string) => Promise<RuntimeBoardData>;
}

const DEFAULT_BOARD_DEPS: BoardToolDeps = {
	loadBoard: async (projectPath) => (await loadWorkspaceState(projectPath)).board,
};

export interface ChatToolSet {
	/** Runnable, gate-aware tools for the executor. */
	tools: ChatTool[];
	/** OpenAI-style tool schemas to offer the model. */
	definitions: LocalLlmToolDefinition[];
}

/** Render the board as a compact, path-free text summary the agent can read in one tool result. */
function summarizeBoard(board: RuntimeBoardData): string {
	let total = 0;
	const lines = board.columns.map((column) => {
		total += column.cards.length;
		if (column.cards.length === 0) {
			return `${column.title} (0): —`;
		}
		const items = column.cards.map((card) => `[${card.id}] ${card.title?.trim() || "(untitled)"}`).join(" · ");
		return `${column.title} (${column.cards.length}): ${items}`;
	});
	if (total === 0) {
		return "The board has no cards yet (all columns are empty).";
	}
	return `Board — ${total} card(s) across ${board.columns.length} columns:\n${lines.join("\n")}`;
}

/**
 * Build the read-only board tool set for `projectPath` (the project root whose board the agent should see). The
 * returned `tools` plug into `createGatedChatToolExecutor`; the `definitions` are offered to the model via
 * `createChatAgentModel`.
 */
export function createBoardReadTools(projectPath: string, options: { deps?: BoardToolDeps } = {}): ChatToolSet {
	const deps = options.deps ?? DEFAULT_BOARD_DEPS;

	const tools: ChatTool[] = [
		{
			name: "get_board",
			actionKind: "sandbox_read",
			run: async () => {
				try {
					const board = await deps.loadBoard(projectPath);
					return summarizeBoard(board);
				} catch {
					return "Could not read the project board.";
				}
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "get_board",
			description:
				"Show the current project's kanban board — every column and the cards in it (each card's id and title). Use this to see the existing tasks before you discuss, create, or work on cards. Takes no arguments.",
			parameters: { type: "object", properties: {} },
		},
	];

	return { tools, definitions };
}

/**
 * Mutation tools (todo §5.M G5) — board write tools for the chat agent.
 *
 * These are `control_plane` actions: they touch only the !Klein-owned board via `mutateWorkspaceState`, never the
 * user's working tree or a shell. Host-isolation invariant: tool results contain only the new card id — never the
 * project's on-disk path. The board mutator is injected so the tools are unit-testable without real disk.
 */

type BoardMutatorFn = <T>(
	projectPath: string,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceAtomicMutationResult<T>,
) => Promise<RuntimeWorkspaceAtomicMutationResponse<T>>;

export interface BoardMutationDeps {
	/** Atomically mutate the board for the given project root. Defaults to the on-disk workspace state. */
	mutateBoard: BoardMutatorFn;
}

const DEFAULT_MUTATION_DEPS: BoardMutationDeps = {
	mutateBoard: mutateWorkspaceState as BoardMutatorFn,
};

/** Parse and validate the `create_card` tool arguments from the model's raw call. */
function parseCreateCardArgs(args: Record<string, unknown>): { title: string; prompt: string } | { error: string } {
	const rawTitle = args.title;
	const rawPrompt = args.prompt;
	if (typeof rawTitle !== "string" || !rawTitle.trim()) {
		return { error: "create_card requires a non-empty `title` string." };
	}
	if (typeof rawPrompt !== "string" || !rawPrompt.trim()) {
		return { error: "create_card requires a non-empty `prompt` string." };
	}
	return { title: rawTitle.trim(), prompt: rawPrompt.trim() };
}

/**
 * Build the board-mutation tool set for `projectPath`. The returned `tools` plug into
 * `createGatedChatToolExecutor`; the `definitions` are offered to the model.
 */
export function createBoardMutationTools(projectPath: string, options: { deps?: BoardMutationDeps } = {}): ChatToolSet {
	const deps = options.deps ?? DEFAULT_MUTATION_DEPS;

	const tools: ChatTool[] = [
		{
			name: "create_card",
			actionKind: "control_plane",
			run: async (args) => {
				const parsed = parseCreateCardArgs(args);
				if ("error" in parsed) {
					return parsed.error;
				}
				const { title, prompt } = parsed;
				try {
					const result = await deps.mutateBoard<RuntimeBoardCard>(projectPath, (state) => {
						const baseRef = state.git.currentBranch ?? state.git.defaultBranch ?? "main";
						const { board, task } = addTaskToColumn(
							state.board,
							"backlog",
							{ title, prompt, startInPlanMode: false, baseRef },
							crypto.randomUUID.bind(crypto),
						);
						return { board, save: true, value: task };
					});
					return `Created card [${result.value.id}] "${result.value.title}" in Backlog.`;
				} catch {
					return "Could not create the card — the board may be temporarily unavailable.";
				}
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "create_card",
			description:
				"Add a new work card to the project's Backlog column. Use this to capture a new task or feature before discussing it, estimating it, or starting it. The card will sit in Backlog until a user or agent starts it.",
			parameters: {
				type: "object",
				properties: {
					title: {
						type: "string",
						description: "Short title for the card (a few words, the task headline).",
					},
					prompt: {
						type: "string",
						description:
							"Full task description — what to do and why. This is what the agent will see when it starts the card.",
					},
				},
				required: ["title", "prompt"],
			},
		},
	];

	return { tools, definitions };
}
