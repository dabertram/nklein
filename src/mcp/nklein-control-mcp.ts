/**
 * F2.30 (c) — nklein-mcp (David directive 2026-09-02: "maybe sth like an nklein mcp might be interesting").
 *
 * Exposes the SAME control-action registry that backs the `nklein_control` chat tool as an MCP server, so any
 * MCP client (Claude Code, another agent) can drive !Klein: one MCP tool per registry action, schemas derived
 * from the registry — the chat tool, this server, and the docs can never drift apart.
 *
 * The server itself is transport-agnostic glue: `buildNKleinControlMcpServer` takes the injected executor deps
 * (unit-testable with fakes), and `createHttpNKleinControlDeps` implements them over a RUNNING !Klein server's
 * HTTP API (the same tRPC surface the web UI uses) — local-only by construction: the base URL must be loopback.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	buildNKleinControlRegistry,
	type NKleinControlDeps,
	type NKleinControlSessionSummary,
} from "../chat/chat-control-interface";
import type { RuntimeBoardData } from "../core/api-contract";
import type { OperatorColumnId } from "../core/operator-task-state";
import { moveTaskToColumn } from "../core/task-board-mutations";

export const NKLEIN_MCP_SERVER_NAME = "nklein-control";
export const NKLEIN_MCP_SERVER_VERSION = "1.0.0";

/** Build the MCP server over injected executors — one tool per registry action. */
export function buildNKleinControlMcpServer(deps: NKleinControlDeps): McpServer {
	const server = new McpServer({ name: NKLEIN_MCP_SERVER_NAME, version: NKLEIN_MCP_SERVER_VERSION });
	for (const action of buildNKleinControlRegistry()) {
		server.registerTool(
			action.name,
			{
				description: action.description,
				// The registry's JSON-schema properties translate directly; MCP clients validate client-side and
				// the action's own execute() re-validates (it never trusts arguments).
				inputSchema: undefined,
			},
			async (args: Record<string, unknown>) => {
				const text = await action.execute(deps, args ?? {});
				return { content: [{ type: "text" as const, text }] };
			},
		);
	}
	return server;
}

function assertLoopback(baseUrl: string): void {
	const parsed = new URL(baseUrl);
	if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "::1") {
		throw new Error(`nklein-mcp only talks to a LOCAL !Klein server; refusing non-loopback base URL ${baseUrl}`);
	}
}

/** Implement the control deps over a running !Klein server's HTTP API (loopback only). */
export function createHttpNKleinControlDeps(options: {
	baseUrl: string;
	workspaceId: string;
	fetchImpl?: typeof fetch;
}): NKleinControlDeps {
	assertLoopback(options.baseUrl);
	const fetchImpl = options.fetchImpl ?? fetch;
	const base = options.baseUrl.replace(/\/$/u, "");
	const ws = encodeURIComponent(options.workspaceId);

	const getState = async (): Promise<{
		board: RuntimeBoardData;
		sessions: Record<string, { state?: string; modelId?: string | null }>;
	}> => {
		const response = await fetchImpl(
			`${base}/api/trpc/workspace.getState?workspaceId=${ws}&batch=1&input=%7B%220%22%3A%7B%7D%7D`,
		);
		if (!response.ok) {
			throw new Error(`workspace.getState failed: HTTP ${response.status}`);
		}
		const parsed = (await response.json()) as Array<{
			result: { data: { board: RuntimeBoardData; sessions?: never } };
		}>;
		return parsed[0]?.result.data as never;
	};

	const post = async (procedure: string, body: unknown): Promise<Record<string, unknown>> => {
		const response = await fetchImpl(`${base}/api/trpc/${procedure}?workspaceId=${ws}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-nklein-workspace-id": options.workspaceId },
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`${procedure} failed: HTTP ${response.status}`);
		}
		const parsed = (await response.json()) as { result?: { data?: Record<string, unknown> } };
		return parsed.result?.data ?? {};
	};

	return {
		loadBoard: async () => (await getState()).board,
		listSessions: async (): Promise<readonly NKleinControlSessionSummary[]> => {
			const state = await getState();
			return Object.entries(state.sessions ?? {}).map(([taskId, session]) => ({
				taskId,
				state: String(session?.state ?? "idle"),
				modelId: (session?.modelId as string | null) ?? null,
			}));
		},
		startCard: async (taskId, opts) => {
			const state = await getState();
			const card = state.board.columns.flatMap((column) => column.cards).find((entry) => entry.id === taskId);
			if (!card) {
				return { ok: false, error: `card ${taskId} not found on the board` };
			}
			const data = await post("runtime.startTaskSession", {
				taskId,
				prompt: card.prompt,
				taskTitle: card.title,
				startInPlanMode: opts.planMode ?? false,
				baseRef: card.baseRef ?? "main",
				agentId: card.agentId ?? "nklein",
			});
			return { ok: data.ok === true, error: data.ok === true ? null : String(data.error ?? "start refused") };
		},
		stopCard: async (taskId) => (await post("runtime.stopTaskSession", { taskId })).ok === true,
		pauseCard: async (taskId) => (await post("runtime.pauseTask", { taskId })).ok === true,
		resumeCard: async (taskId) => (await post("runtime.resumeTask", { taskId })).ok === true,
		moveCard: async (taskId, column: OperatorColumnId) => {
			const state = await getState();
			const moved = moveTaskToColumn(state.board, taskId, column as never);
			if (!moved.moved || !moved.task) {
				return null;
			}
			await post("workspace.saveState", { board: moved.board });
			return { title: moved.task.title };
		},
		setMaxConcurrentTasks: async (value) => {
			await post("runtime.saveConfig", { maxConcurrentTasks: value });
			return true;
		},
		requestRedecompose: async (input) => {
			const data = await post("runtime.requestRedecompose", input);
			return {
				filed: Array.isArray(data.filed)
					? (data.filed as { taskId: string; redecomposeTaskId: string; title: string; started: boolean }[])
					: [],
				skipped: Array.isArray(data.skipped) ? (data.skipped as { taskId: string; reason: string }[]) : [],
			};
		},
	};
}
