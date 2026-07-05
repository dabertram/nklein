import type { RuntimeBoardCard, RuntimeBoardData, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { buildBoardChatDigest } from "../core/board-chat-digest";
import { type BoardStreamsSummary, renderBoardStreamsSummary } from "../core/board-streams-summary";
import {
	type CardExecutionState,
	type CardMessageIntent,
	classifyCardMessageIntent,
	resolveCardMessageEffect,
} from "../core/card-message-effect";
import { summarizeWorkspaceBoardHealth, summarizeWorkspaceBoardStreams } from "../core/operator-board-health";
import type { OperatorBoardSummary } from "../core/operator-task-state";
import { addTaskToColumn } from "../core/task-board-mutations";
import { listUnmetDependencyTaskIds, resolveCardExecutionState } from "../core/task-board-ready-sweep";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
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
	/**
	 * §5.AG/§5.AT: load the operator board-health rollup (healthy/stuck/risky/done counts) for the project. Defaults to
	 * the on-disk workspace state (board + live sessions). Injected so `get_board_status` is unit-testable without disk.
	 */
	loadBoardHealth?: (projectPath: string) => Promise<OperatorBoardSummary>;
	/**
	 * §5.AU: load the per-stream overview (each stream's health/progress/frontier + loose cards) for the project.
	 * Defaults to the on-disk workspace state. Injected so `get_streams` is unit-testable without disk.
	 */
	loadBoardStreams?: (projectPath: string) => Promise<BoardStreamsSummary>;
}

const DEFAULT_BOARD_DEPS: Required<BoardToolDeps> = {
	loadBoard: async (projectPath) => (await loadWorkspaceState(projectPath)).board,
	loadBoardHealth: async (projectPath) => summarizeWorkspaceBoardHealth(await loadWorkspaceState(projectPath)),
	loadBoardStreams: async (projectPath) =>
		summarizeWorkspaceBoardStreams(await loadWorkspaceState(projectPath), { now: Date.now() }),
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
		{
			name: "get_board_status",
			actionKind: "sandbox_read",
			run: async () => {
				try {
					const loadBoardHealth = deps.loadBoardHealth ?? DEFAULT_BOARD_DEPS.loadBoardHealth;
					const { counts } = await loadBoardHealth(projectPath);
					// items: [] ⇒ the digest renders just the board-health rollup line ("Board: N need you · M stuck · …") —
					// the §5.AT pull path, composing the SAME renderer the push feedback uses. Never empty (renderHealthLine
					// always returns a line), but keep a defensive fallback.
					return buildBoardChatDigest({ items: [], boardHealth: counts }).message || "Board: nothing in progress.";
				} catch {
					return "Could not read the project board status.";
				}
			},
		},
		{
			name: "get_streams",
			actionKind: "sandbox_read",
			run: async () => {
				try {
					const loadBoardStreams = deps.loadBoardStreams ?? DEFAULT_BOARD_DEPS.loadBoardStreams;
					return renderBoardStreamsSummary(await loadBoardStreams(projectPath));
				} catch {
					return "Could not read the project streams.";
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
		{
			name: "get_board_status",
			description:
				"Show a one-line health rollup of the current project's board — how many cards need your attention, are stuck, are on track, or are done. Use this for a quick triage/status check; use get_board to list the actual cards. Takes no arguments.",
			parameters: { type: "object", properties: {} },
		},
		{
			name: "get_streams",
			description:
				"Show the current project's streams (epics/groups of related cards) — each stream's title, health, progress (done/total), and how many of its cards are running now, plus any cards not in a stream. Use this for the 'group altitude' overview before drilling into individual cards. Takes no arguments.",
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

/**
 * §5.AU STEP 6 — the RELAY tool: `send_to_card` delivers a user/chat message TO a card, with the effect decided by
 * the pure `(card state × intent)` core — communication is always possible, execution stays readiness-gated:
 * RUNNING ⇒ delivered live into the agent's turn; READY/BLOCKED guidance ⇒ durably queued in the card's mailbox
 * (consumed as opening context when it starts); a steer on a BLOCKED card ⇒ a gated unblock SUGGESTION (never an
 * auto-start); questions ⇒ answered from board state. INVARIANT (core-tested): a blocked card is never started.
 *
 * `control_plane`: it touches only !Klein-owned state (mailbox, live session input) — never the working tree or a
 * shell. Results name card ids/titles only, never on-disk paths.
 */
export interface CardRelayDeps {
	/** The board + the live-session task ids (running/queued), for execution-state resolution. */
	loadBoard: (projectPath: string) => Promise<RuntimeBoardData>;
	listActiveSessionTaskIds: () => ReadonlySet<string>;
	/** Deliver text into the card's LIVE session turn; false when no live session accepted it. */
	deliverLive: (taskId: string, text: string) => Promise<boolean>;
	/** Queue a note on the card's durable mailbox; returns the pending count after the append. */
	queueMailbox: (taskId: string, text: string) => Promise<number>;
}

/** Parse and validate the `send_to_card` tool arguments. */
function parseSendToCardArgs(
	args: Record<string, unknown>,
): { cardId: string; message: string; intent: CardMessageIntent | null } | { error: string } {
	const rawCardId = args.card_id ?? args.cardId ?? args.id;
	const rawMessage = args.message ?? args.text;
	if (typeof rawCardId !== "string" || !rawCardId.trim()) {
		return { error: "send_to_card requires a non-empty `card_id` string (use get_board to find card ids)." };
	}
	if (typeof rawMessage !== "string" || !rawMessage.trim()) {
		return { error: "send_to_card requires a non-empty `message` string." };
	}
	const rawIntent = typeof args.intent === "string" ? args.intent.trim().toLowerCase() : null;
	const intent =
		rawIntent === "guidance" || rawIntent === "steer" || rawIntent === "question" || rawIntent === "answer"
			? (rawIntent as CardMessageIntent)
			: null;
	return { cardId: rawCardId.trim(), message: rawMessage.trim(), intent };
}

/** A path-free one-line state answer for a card (the cheap local-first `answer_from_state`). */
function describeCardState(
	board: RuntimeBoardData,
	cardId: string,
	state: CardExecutionState,
	activeSessionTaskIds: ReadonlySet<string>,
): string {
	const card = board.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === cardId);
	const title = card?.title?.trim() || cardId;
	if (state === "running") {
		return `Card [${cardId}] "${title}" is RUNNING — an agent is actively working it.`;
	}
	if (state === "done") {
		return `Card [${cardId}] "${title}" is COMPLETED.`;
	}
	if (state === "blocked") {
		const unmet = listUnmetDependencyTaskIds(board, cardId);
		const why = card?.blockedKind
			? `blocked (${card.blockedKind}${card.blockedReason ? `: ${card.blockedReason}` : ""})`
			: unmet.length > 0
				? `waiting on ${unmet.map((id) => `[${id}]`).join(", ")}`
				: "blocked";
		return `Card [${cardId}] "${title}" is BLOCKED — ${why}.`;
	}
	const waitingNote = activeSessionTaskIds.size > 0 ? " (other cards are running)" : "";
	return `Card [${cardId}] "${title}" is READY to start${waitingNote}.`;
}

export function createCardRelayTools(projectPath: string, deps: CardRelayDeps): ChatToolSet {
	const tools: ChatTool[] = [
		{
			name: "send_to_card",
			actionKind: "control_plane",
			run: async (args) => {
				const parsed = parseSendToCardArgs(args);
				if ("error" in parsed) {
					return parsed.error;
				}
				const { cardId, message } = parsed;
				let board: RuntimeBoardData;
				try {
					board = await deps.loadBoard(projectPath);
				} catch {
					return "Could not read the project board.";
				}
				const activeSessionTaskIds = deps.listActiveSessionTaskIds();
				const state = resolveCardExecutionState(board, activeSessionTaskIds, cardId);
				if (state === null) {
					return `No card with id "${cardId}" on the board (use get_board to list cards).`;
				}
				const intent = parsed.intent ?? classifyCardMessageIntent(message);
				const verdict = resolveCardMessageEffect({ cardState: state, intent });
				switch (verdict.effect) {
					case "deliver_live": {
						const delivered = await deps.deliverLive(cardId, message).catch(() => false);
						if (delivered) {
							return `Delivered to the agent working [${cardId}] (live).`;
						}
						// The session ended between the state read and the delivery — fall back to the durable mailbox.
						const pending = await deps.queueMailbox(cardId, message);
						return `The card's session just ended — queued to its mailbox instead (${pending} pending note(s)).`;
					}
					case "queue_mailbox": {
						const pending = await deps.queueMailbox(cardId, message);
						return `Queued on [${cardId}]'s mailbox (${pending} pending note(s)) — it will be read when the card starts. The card was NOT started (${state === "blocked" ? "it is blocked" : "starting stays a separate, gated action"}).`;
					}
					case "request_start": {
						// v1: no start path from chat — the message is preserved and the READY state surfaced; starting
						// remains the user's (or the swarm's) gated action. Never silently drops the guidance.
						const pending = await deps.queueMailbox(cardId, message);
						return `Card [${cardId}] is READY. Your note is queued (${pending} pending) and will open its run — ask the user to start the card (or the swarm will pick it up); chat cannot start cards yet.`;
					}
					case "suggest_unblock": {
						const unmet = listUnmetDependencyTaskIds(board, cardId);
						const pending = await deps.queueMailbox(cardId, message);
						if (unmet.length > 0) {
							const blockers = unmet.map((id) => `[${id}]`).join(", ");
							return `Card [${cardId}] is BLOCKED by ${blockers} — it was NOT started. Your note is queued (${pending} pending). To act now, suggest to the user: reprioritize ${blockers}, or drop the dependency.`;
						}
						// No unmet dependency edge — the card is blocked by an explicit blockedKind
						// (needs_decomposition, local_model_required, agent_sandbox_unavailable, …). Surface the REAL
						// cause instead of pointing at a nonexistent dependency the user cannot reprioritize/drop.
						const card = board.columns
							.flatMap((column) => column.cards)
							.find((candidate) => candidate.id === cardId);
						const cause = card?.blockedKind
							? `${card.blockedKind}${card.blockedReason ? `: ${card.blockedReason}` : ""}`
							: "an unknown blocker";
						return `Card [${cardId}] is BLOCKED (${cause}) — it was NOT started. Your note is queued (${pending} pending). To act now, suggest to the user: resolve the blocker above.`;
					}
					case "append_followup": {
						const pending = await deps.queueMailbox(cardId, message);
						return `Card [${cardId}] is already completed — your note is recorded as a follow-up (${pending} pending note(s)).`;
					}
					default:
						// answer_from_state / consult_response — both answer ABOUT the card from board state (consult's
						// dedicated read-only model turn is a later §5.AU rung; the state answer is the honest v1).
						return describeCardState(board, cardId, state, activeSessionTaskIds);
				}
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "send_to_card",
			description:
				"Send a message TO a specific board card: guidance or a steer for the agent working it (delivered live when it's running, queued to the card's durable mailbox otherwise), or a question about its status. Never starts a card — starting stays a separate, dependency-gated action. Use get_board first to find the card id.",
			parameters: {
				type: "object",
				properties: {
					card_id: { type: "string", description: "The target card's id (from get_board)." },
					message: { type: "string", description: "What to tell (or ask) the card's agent." },
					intent: {
						type: "string",
						description:
							"Optional: how the message is meant — guidance (default), steer (a clear 'go'), question (about the card), or answer (replying to the card's own question).",
					},
				},
				required: ["card_id", "message"],
			},
		},
	];

	return { tools, definitions };
}
