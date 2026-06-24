import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

/**
 * Per-session chat transcript store (todo §5.M). The durable message log for a chat session
 * ([chat-session-store.ts](./chat-session-store.ts) owns the session metadata; this owns its messages). Each
 * session is one append-only JSONL file (messages only ever grow), so writes are concurrency-safe and a crash
 * mid-write never corrupts earlier turns. The lean live window + long-term memory (§5.M) read from here.
 */

export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
	schemaVersion: 1;
	id: string;
	role: ChatMessageRole;
	content: string;
	createdAt: number;
}

export interface ChatTranscriptStoreOptions {
	rootDir?: string;
	now?: () => number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-transcripts");

/** One file per session, keyed by a hash of the session id so any id is a safe, fixed-length filename. */
function resolveTranscriptPath(sessionId: string, rootDir?: string): string {
	const fileName = `${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.jsonl`;
	return join(rootDir ?? DEFAULT_ROOT, fileName);
}

export async function appendChatMessage(
	sessionId: string,
	input: { role: ChatMessageRole; content: string; id?: string; createdAt?: number },
	options: ChatTranscriptStoreOptions = {},
): Promise<ChatMessage> {
	const message: ChatMessage = {
		schemaVersion: 1,
		id: input.id ?? randomUUID(),
		role: input.role,
		content: input.content,
		createdAt: input.createdAt ?? (options.now ?? Date.now)(),
	};
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await appendFile(resolveTranscriptPath(sessionId, options.rootDir), `${JSON.stringify(message)}\n`, "utf8");
	return message;
}

export interface ReadChatTranscriptOptions extends ChatTranscriptStoreOptions {
	/** Return only the most recent `limit` messages (chronological order is preserved). */
	limit?: number;
}

export async function readChatTranscript(
	sessionId: string,
	options: ReadChatTranscriptOptions = {},
): Promise<ChatMessage[]> {
	let raw: string;
	try {
		raw = await readFile(resolveTranscriptPath(sessionId, options.rootDir), "utf8");
	} catch {
		return [];
	}
	const messages: ChatMessage[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as ChatMessage;
			if (parsed.role === "user" || parsed.role === "assistant" || parsed.role === "system") {
				messages.push(parsed);
			}
		} catch {
			// Skip a malformed line rather than failing the whole read.
		}
	}
	if (typeof options.limit === "number" && options.limit >= 0 && messages.length > options.limit) {
		return messages.slice(messages.length - options.limit);
	}
	return messages;
}

export async function clearChatTranscript(sessionId: string, options: ChatTranscriptStoreOptions = {}): Promise<void> {
	await rm(resolveTranscriptPath(sessionId, options.rootDir), { force: true });
}
