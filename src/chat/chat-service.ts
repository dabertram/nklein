import { join } from "node:path";
import type {
	RuntimeChatCreateSessionRequest,
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatUpdateSessionRequest,
} from "../core/chat-api-contract";
import type { ChatSession } from "./chat-session-store";
import {
	createChatSession,
	deleteChatSession,
	getChatSession,
	listChatSessions,
	updateChatSession,
} from "./chat-session-store";
import type { ChatMessage } from "./chat-transcript-store";
import { readChatTranscript } from "./chat-transcript-store";

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
}

export function createChatService(options: ChatServiceOptions = {}): ChatService {
	const { rootDir, now } = options;
	// One base root, per-store subdirs (each store joins its own filename onto the dir it's given).
	const sessionOptions = { ...(rootDir ? { rootDir: join(rootDir, "sessions") } : {}), ...(now ? { now } : {}) };
	const transcriptOptions = {
		...(rootDir ? { rootDir: join(rootDir, "transcripts") } : {}),
		...(now ? { now } : {}),
	};

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
	};
}
