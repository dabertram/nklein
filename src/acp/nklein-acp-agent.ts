/**
 * P17.2 — !Klein as an ACP AGENT (Agent Client Protocol, agentclientprotocol.com — the Zed/JetBrains one; see
 * the §4A naming-hazard note for the two unrelated "ACP"s). Minimum conformant surface: `initialize`,
 * `session/new`, `session/prompt` (streaming `session/update` notifications), `session/cancel` — JSON-RPC 2.0
 * over stdio, `protocolVersion` 1.
 *
 * DESIGN DECISION (recorded in the item, honored here): ACP lets the CLIENT own `fs/*` and `terminal/*` so
 * editors can render diffs and gate writes. !Klein's execution stays DOCKER-ISOLATED — this agent never
 * requests client fs/terminal capabilities and never proxies execution to the editor. Conformant (those
 * capabilities are optional); the cost is no live terminal mirror inside the editor, which is the right trade
 * for a local-only product whose whole isolation story is the sandbox.
 *
 * The runtime seams arrive as PORTS so the protocol mapping is testable with an in-process duplex and no
 * runtime: `ensureWorkspace` binds the editor's cwd to a workspace id; `runPrompt` drives one turn and
 * streams updates through `emitUpdate` until it resolves with a stop reason.
 */

import type {
	Agent,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	InitializeRequest,
	InitializeResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	ProtocolVersion,
	SessionNotification,
	SessionUpdate,
	StopReason,
} from "@agentclientprotocol/sdk";

export interface NKleinAcpPorts {
	/** Bind the editor-provided cwd to a workspace (registering it if new); returns the workspace id. */
	readonly ensureWorkspace: (cwd: string) => Promise<string>;
	/**
	 * Drive ONE prompt turn. Implementations stream progress via `emitUpdate` and resolve with the stop
	 * reason; they must settle promptly with "cancelled" when `signal` aborts.
	 */
	readonly runPrompt: (input: {
		readonly workspaceId: string;
		readonly sessionId: string;
		readonly promptText: string;
		readonly emitUpdate: (update: SessionUpdate) => Promise<void>;
		readonly signal: AbortSignal;
	}) => Promise<StopReason>;
	readonly randomUuid: () => string;
}

interface AcpSessionState {
	readonly workspaceId: string;
	readonly cwd: string;
	activeTurnAbort: AbortController | null;
}

/** Flatten an ACP prompt (string or content blocks) into the text !Klein's chat pipeline consumes. */
export function acpPromptText(prompt: PromptRequest["prompt"]): string {
	return prompt
		.map((block: PromptRequest["prompt"][number]) => {
			if (block.type === "text") {
				return block.text;
			}
			if (block.type === "resource_link") {
				return `[resource: ${block.uri}]`;
			}
			if (block.type === "resource") {
				return "text" in block.resource ? block.resource.text : `[resource: ${block.resource.uri}]`;
			}
			return `[${block.type}]`;
		})
		.join("\n")
		.trim();
}

export class NKleinAcpAgent implements Agent {
	private readonly sessions = new Map<string, AcpSessionState>();

	constructor(
		private readonly ports: NKleinAcpPorts,
		private readonly connection: { sessionUpdate(params: SessionNotification): Promise<void> },
		private readonly agentVersion: string,
	) {}

	initialize(params: InitializeRequest): InitializeResponse {
		return {
			// v1 is what we implement; a v0 client gets 1 back and disconnects per spec ("client should
			// disconnect if it doesn't support this version"). Capabilities OMITTED are unsupported by spec —
			// exactly the posture we want for client fs/terminal.
			protocolVersion: Math.min(1, params.protocolVersion) as ProtocolVersion,
			agentCapabilities: { loadSession: false },
			agentInfo: { name: "nklein", version: this.agentVersion },
		};
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		const workspaceId = await this.ports.ensureWorkspace(params.cwd);
		const sessionId = `acp-${this.ports.randomUuid()}`;
		this.sessions.set(sessionId, { workspaceId, cwd: params.cwd, activeTurnAbort: null });
		return { sessionId };
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Unknown ACP session ${params.sessionId}.`);
		}
		if (session.activeTurnAbort) {
			// One turn at a time per spec's prompt-turn lifecycle — a second prompt mid-turn is a client bug.
			throw new Error(`Session ${params.sessionId} already has a prompt turn in flight.`);
		}
		const abort = new AbortController();
		session.activeTurnAbort = abort;
		try {
			const stopReason = await this.ports.runPrompt({
				workspaceId: session.workspaceId,
				sessionId: params.sessionId,
				promptText: acpPromptText(params.prompt),
				emitUpdate: (update) => this.connection.sessionUpdate({ sessionId: params.sessionId, update }),
				signal: abort.signal,
			});
			return { stopReason: abort.signal.aborted ? "cancelled" : stopReason };
		} finally {
			session.activeTurnAbort = null;
		}
	}

	authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
		// initialize declares NO authMethods, so a conformant client never calls this; refuse rather than fake.
		return Promise.reject(new Error("nklein declares no ACP auth methods."));
	}

	cancel(params: CancelNotification): void {
		// Per spec: abort the session's in-flight turn; the pending `prompt` must still RESOLVE (with
		// stopReason "cancelled"), which the abort signal accomplishes — never leave the request hanging.
		this.sessions.get(params.sessionId)?.activeTurnAbort?.abort();
	}
}
