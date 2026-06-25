import type { RuntimeBoardData } from "../core/api-contract";
import type { LocalLlmToolDefinition } from "../nklein-sdk/nklein-local-llm-client";
import { loadWorkspaceState } from "../state/workspace-state";
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
