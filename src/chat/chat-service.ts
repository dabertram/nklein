import { join } from "node:path";
import type {
	RuntimeChatCreateSessionRequest,
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatUpdateSessionRequest,
} from "../core/chat-api-contract";
import type { ChatModelDeps } from "./chat-local-llm-adapter";
import { readChatMemories } from "./chat-memory-store";
import { runChatTurn } from "./chat-runtime";
import type { ChatSession } from "./chat-session-store";
import {
	createChatSession,
	deleteChatSession,
	getChatSession,
	listChatSessions,
	updateChatSession,
} from "./chat-session-store";
import type { ChatMessage } from "./chat-transcript-store";
import { appendChatMessage, readChatTranscript } from "./chat-transcript-store";

/**
 * Board-independent chat service (todo §5.M) — the single aggregation seam over the chat session + transcript
 * stores that the runtime API (and the future Signal bridge) drive. It owns the wire mapping (store `ChatSession` /
 * `ChatMessage` → the contract's `RuntimeChatSession` / `RuntimeChatMessage`, dropping `schemaVersion`) and the
 * store-root layout (each store gets its own subdir under one base root), so the transport layers never touch the
 * stores directly. The root is injectable: production omits it (real runtime home); tests pass a temp dir.
 */

export interface ChatServiceOptions {
	/** Base directory for all chat stores; each store lives in its own subdir. Omit for the real runtime home. */
	rootDir?: string;
	now?: () => number;
	/** Resolves the model completion deps for `sendMessage` (called per turn so discovery/errors surface then).
	 *  Omit for a read-only service (sessions + transcript only); `sendMessage` then throws. */
	resolveModelDeps?: () => Promise<ChatModelDeps>;
	/** Token estimator for the lean-window budget; defaults to ≈4 chars/token. */
	estimateTokens?: (text: string) => number;
}

export interface ChatSendResult {
	userMessage: RuntimeChatMessage;
	assistantMessage: RuntimeChatMessage;
}

function toRuntimeChatSession(session: ChatSession): RuntimeChatSession {
	return {
		id: session.id,
		title: session.title,
		scope: session.scope,
		role: session.role,
		goal: session.goal,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

function toRuntimeChatMessage(message: ChatMessage): RuntimeChatMessage {
	return { id: message.id, role: message.role, content: message.content, createdAt: message.createdAt };
}

export interface ChatService {
	listSessions: () => Promise<RuntimeChatSession[]>;
	getSession: (id: string) => Promise<RuntimeChatSession | null>;
	createSession: (input: RuntimeChatCreateSessionRequest) => Promise<RuntimeChatSession>;
	updateSession: (input: RuntimeChatUpdateSessionRequest) => Promise<RuntimeChatSession | null>;
	deleteSession: (id: string) => Promise<boolean>;
	readTranscript: (sessionId: string, limit?: number) => Promise<RuntimeChatMessage[]>;
	/** Run one chat turn against a session (composes memory + goal, calls the model, persists both messages).
	 *  Returns null when the session doesn't exist; throws when no model is configured. `onToken` (server-side only;
	 *  callbacks can't cross the tRPC wire) streams the assistant reply incrementally when the model supports it. */
	sendMessage: (
		input: {
			sessionId: string;
			message: string;
			tokenBudget?: number;
			memoryLimit?: number;
		},
		onToken?: (delta: string) => void,
	) => Promise<ChatSendResult | null>;
}

const DEFAULT_CHAT_TOKEN_BUDGET = 8000;
const DEFAULT_CHAT_MEMORY_LIMIT = 5;

export function createChatService(options: ChatServiceOptions = {}): ChatService {
	const { rootDir, now } = options;
	// One base root, per-store subdirs (each store joins its own filename onto the dir it's given).
	const sessionOptions = { ...(rootDir ? { rootDir: join(rootDir, "sessions") } : {}), ...(now ? { now } : {}) };
	const transcriptOptions = {
		...(rootDir ? { rootDir: join(rootDir, "transcripts") } : {}),
		...(now ? { now } : {}),
	};
	const memoryOptions = { ...(rootDir ? { rootDir: join(rootDir, "memories") } : {}), ...(now ? { now } : {}) };
	const estimateTokens = options.estimateTokens ?? ((text: string) => Math.ceil(text.length / 4));

	return {
		listSessions: async () => {
			const sessions = await listChatSessions(sessionOptions);
			// Newest-updated first so the UI's most-recent session is at the top.
			return sessions.sort((left, right) => right.updatedAt - left.updatedAt).map(toRuntimeChatSession);
		},
		getSession: async (id) => {
			const session = await getChatSession(id, sessionOptions);
			return session ? toRuntimeChatSession(session) : null;
		},
		createSession: async (input) => {
			const session = await createChatSession(
				{
					title: input.title,
					...(input.scope ? { scope: input.scope } : {}),
					...(input.role ? { role: input.role } : {}),
					...(input.goal !== undefined ? { goal: input.goal } : {}),
				},
				sessionOptions,
			);
			return toRuntimeChatSession(session);
		},
		updateSession: async (input) => {
			const session = await updateChatSession(
				input.id,
				{
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.scope ? { scope: input.scope } : {}),
					...(input.role ? { role: input.role } : {}),
					...(input.goal !== undefined ? { goal: input.goal } : {}),
				},
				sessionOptions,
			);
			return session ? toRuntimeChatSession(session) : null;
		},
		deleteSession: (id) => deleteChatSession(id, sessionOptions),
		readTranscript: async (sessionId, limit) => {
			const messages = await readChatTranscript(sessionId, {
				...transcriptOptions,
				...(typeof limit === "number" ? { limit } : {}),
			});
			return messages.map(toRuntimeChatMessage);
		},
		sendMessage: async (input, onToken) => {
			if (!options.resolveModelDeps) {
				throw new Error("This chat service is read-only: no model is configured for sending messages.");
			}
			const session = await getChatSession(input.sessionId, sessionOptions);
			if (!session) {
				return null;
			}
			const modelDeps = await options.resolveModelDeps();
			const result = await runChatTurn(
				{
					session,
					userMessage: input.message,
					tokenBudget: input.tokenBudget ?? DEFAULT_CHAT_TOKEN_BUDGET,
					memoryLimit: input.memoryLimit ?? DEFAULT_CHAT_MEMORY_LIMIT,
					...(onToken ? { onToken } : {}),
				},
				{
					readTranscript: (sessionId) => readChatTranscript(sessionId, transcriptOptions),
					readMemories: () => readChatMemories(memoryOptions),
					appendMessage: (sessionId, message) => appendChatMessage(sessionId, message, transcriptOptions),
					estimateTokens,
					...modelDeps,
				},
			);
			return {
				userMessage: toRuntimeChatMessage(result.userMessage),
				assistantMessage: toRuntimeChatMessage(result.assistantMessage),
			};
		},
	};
}
