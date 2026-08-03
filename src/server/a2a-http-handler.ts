/**
 * A2A v1.0 receive-side HTTP handler — P17.8's wire, framework-free and deps-injected (the trigger-intake
 * handler's proven pattern: the route block in runtime-server stays thin, everything here is unit-testable).
 *
 * WHAT AN A2A CLIENT CAN DO, EXACTLY: `SendMessage` (text-only) seeds a board card — the same capability a
 * human or an external trigger has, nothing more — and `GetTask` reads the card's lane projected onto the A2A
 * TaskState enum. Everything else that the spec names is answered honestly: known-but-unimplemented methods
 * return `UnsupportedOperationError` (-32004), unknown methods -32601. `CancelTask` is DELIBERATELY -32004 in
 * the pilot: !Klein's cancel semantics (interrupt vs trash vs park) deserve their own decision, and a wrong
 * guess here would destroy work on a peer's malformed retry.
 *
 * SECURITY POSTURE (pilot): loopback-only — the route block enforces `isLoopbackAddress` exactly like the
 * external-trigger intake, and the whole surface exists only behind NKLEIN_A2A_SERVER (default-OFF) outside
 * remote mode. Inbound text is UNTRUSTED and becomes a card prompt — entering the same S2-fence path every
 * prompt does; the title is length-capped at the mapping core. Unattended cards seed with
 * `autoReviewEnabled: true` (the N10/N20 lesson: a headless card without it strands verdict-less in Review).
 */

import { buildA2aAgentCard } from "../core/a2a-agent-card";
import { buildA2aTaskView, buildSeedCardRequestFromA2a } from "../core/a2a-task-mapping";
import {
	A2A_ERROR_CODES,
	A2A_METHODS,
	A2A_WELL_KNOWN_AGENT_CARD_PATH,
	a2aGetTaskParamsSchema,
	a2aSendMessageParamsSchema,
	readTextFromParts,
} from "../core/a2a-wire-shapes";

export const A2A_RPC_PATH = "/a2a/v1";

export interface A2aWorkspaceEntry {
	workspaceId: string;
	repoPath: string;
}

export interface A2aHttpDeps {
	listWorkspaces: () => Promise<A2aWorkspaceEntry[]>;
	/** Board lookup for one card: its lane + title, or null when absent. */
	readBoardRecord: (entry: A2aWorkspaceEntry, taskId: string) => Promise<{ columnId: string; title: string } | null>;
	/** Seed the card (idempotent on taskId). Lane/flags are the handler's policy, applied by the wire. */
	seedCard: (
		entry: A2aWorkspaceEntry,
		seed: { taskId: string; title: string; prompt: string },
	) => Promise<"created" | "existing">;
	/** Ledger + observation audit for one accepted ingress (mirrors the trigger-intake audit). */
	audit: (input: {
		entry: A2aWorkspaceEntry;
		taskId: string;
		sourceMessageId: string;
		promptBytes: number;
	}) => Promise<void>;
	/**
	 * Newest ACTIONABLE status note for the card (auto-start failures, manual holds, …) — surfaces as
	 * TaskStatus.message so a delegating client can see WHY a card is not progressing (N23: "no provider
	 * configured" was logged six times server-side while A2A reported bare SUBMITTED forever). Optional so
	 * tests and minimal wires stay small; absent ⇒ no status message.
	 */
	readStatusNote?: (entry: A2aWorkspaceEntry, taskId: string) => Promise<string | null>;
	nowIso: () => string;
	randomUuid: () => string;
	productVersion: string;
	/** The externally reachable RPC URL for the agent card (scheme://host:port + A2A_RPC_PATH). */
	rpcUrl: string;
}

export interface A2aHttpResult {
	status: number;
	body: unknown;
}

interface JsonRpcEnvelope {
	jsonrpc: "2.0";
	id: string | number | null;
	method: string;
	params?: unknown;
}

function rpcError(id: string | number | null, code: number, message: string): A2aHttpResult {
	// JSON-RPC errors ride HTTP 200 — transport success, protocol-level error (spec.md §9.5 table maps A2A
	// errors to codes; the HTTP-status column applies to the REST binding, not JSON-RPC).
	return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

function rpcResult(id: string | number | null, result: unknown): A2aHttpResult {
	return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

/** Methods the spec defines but this pilot deliberately does not serve — answered -32004, never -32601. */
const KNOWN_UNIMPLEMENTED_METHODS: ReadonlySet<string> = new Set([
	A2A_METHODS.sendStreamingMessage,
	A2A_METHODS.listTasks,
	A2A_METHODS.cancelTask,
	A2A_METHODS.subscribeToTask,
	A2A_METHODS.getExtendedAgentCard,
	"CreateTaskPushNotificationConfig",
	"GetTaskPushNotificationConfig",
	"ListTaskPushNotificationConfigs",
	"DeleteTaskPushNotificationConfig",
]);

/**
 * Handle one request against the A2A surface. Returns null when the path is not A2A's (the caller falls
 * through to its other routes). `workspaceIdParam` selects the board (like the trigger intake's
 * `?workspaceId=`); absent ⇒ the first registered workspace.
 */
export async function handleA2aHttpRequest(
	input: {
		method: string;
		pathname: string;
		bodyText: string;
		workspaceIdParam: string | null;
	},
	deps: A2aHttpDeps,
): Promise<A2aHttpResult | null> {
	if (input.pathname === A2A_WELL_KNOWN_AGENT_CARD_PATH && input.method === "GET") {
		return {
			status: 200,
			body: buildA2aAgentCard({ rpcUrl: deps.rpcUrl, productVersion: deps.productVersion }),
		};
	}
	if (input.pathname !== A2A_RPC_PATH) {
		return null;
	}
	if (input.method !== "POST") {
		return { status: 405, body: { error: "A2A JSON-RPC endpoint accepts POST only." } };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(input.bodyText);
	} catch {
		return rpcError(null, A2A_ERROR_CODES.parseError, "Request body is not valid JSON.");
	}
	const envelope = parsed as Partial<JsonRpcEnvelope>;
	const id = typeof envelope?.id === "string" || typeof envelope?.id === "number" ? envelope.id : null;
	if (envelope?.jsonrpc !== "2.0" || typeof envelope.method !== "string") {
		return rpcError(id, A2A_ERROR_CODES.invalidRequest, 'Expected a JSON-RPC 2.0 envelope with a string "method".');
	}

	const workspaces = await deps.listWorkspaces();
	const workspace = input.workspaceIdParam
		? workspaces.find((entry) => entry.workspaceId === input.workspaceIdParam)
		: workspaces[0];
	if (!workspace) {
		return rpcError(
			id,
			A2A_ERROR_CODES.invalidParams,
			input.workspaceIdParam
				? `Unknown workspaceId "${input.workspaceIdParam}".`
				: "No workspace is registered on this runtime.",
		);
	}

	if (envelope.method === A2A_METHODS.sendMessage) {
		const params = a2aSendMessageParamsSchema.safeParse(envelope.params);
		if (!params.success) {
			return rpcError(id, A2A_ERROR_CODES.invalidParams, `Invalid SendMessageRequest: ${params.error.message}`);
		}
		const text = readTextFromParts(params.data.message.parts);
		if (!text.ok) {
			return rpcError(
				id,
				A2A_ERROR_CODES.contentTypeNotSupported,
				`Text-only intake: ${text.unsupported} is not accepted by this agent (defaultInputModes: text/plain).`,
			);
		}
		// A client retrying with the same message may set taskId to continue — the pilot treats an inbound
		// taskId as idempotency only (seed once), never as "append to a running session".
		const seed = buildSeedCardRequestFromA2a({ text: text.text, messageId: params.data.message.messageId });
		const taskId = params.data.message.taskId?.trim() || `a2a-${deps.randomUuid()}`;
		const outcome = await deps.seedCard(workspace, { taskId, title: seed.title, prompt: seed.prompt });
		if (outcome === "created") {
			await deps.audit({
				entry: workspace,
				taskId,
				sourceMessageId: seed.sourceMessageId,
				promptBytes: Buffer.byteLength(seed.prompt, "utf8"),
			});
		}
		const record = await deps.readBoardRecord(workspace, taskId);
		return rpcResult(id, {
			task: buildA2aTaskView({
				cardId: taskId,
				columnId: record?.columnId ?? "backlog",
				timestamp: deps.nowIso(),
			}),
		});
	}

	if (envelope.method === A2A_METHODS.getTask) {
		const params = a2aGetTaskParamsSchema.safeParse(envelope.params);
		if (!params.success) {
			return rpcError(id, A2A_ERROR_CODES.invalidParams, `Invalid GetTask params: ${params.error.message}`);
		}
		const record = await deps.readBoardRecord(workspace, params.data.id);
		if (!record) {
			return rpcError(
				id,
				A2A_ERROR_CODES.taskNotFound,
				`No task ${params.data.id} on workspace ${workspace.workspaceId}.`,
			);
		}
		const statusText = (await deps.readStatusNote?.(workspace, params.data.id).catch(() => null)) ?? null;
		return rpcResult(
			id,
			buildA2aTaskView({
				cardId: params.data.id,
				columnId: record.columnId,
				timestamp: deps.nowIso(),
				...(statusText ? { statusText } : {}),
			}),
		);
	}

	if (KNOWN_UNIMPLEMENTED_METHODS.has(envelope.method)) {
		return rpcError(
			id,
			A2A_ERROR_CODES.unsupportedOperation,
			`${envelope.method} is not supported by this agent (pilot serves SendMessage + GetTask; CancelTask awaits a deliberate cancel-semantics decision).`,
		);
	}
	return rpcError(id, A2A_ERROR_CODES.methodNotFound, `Unknown method "${envelope.method}".`);
}
