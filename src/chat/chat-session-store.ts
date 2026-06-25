import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

/**
 * Board-independent chat session store (todo §5.M — the unified agentic chat). Chat sessions are NOT kanban
 * cards: they are standalone, persisted conversations (one per messenger thread / chat tab), each configured by
 * a use-case preset (scope × role). This module owns their durable metadata; transcripts + memory are separate
 * stores layered on top. It is an append-only event log (concurrency-safe like the other JSONL stores), replayed
 * to the current session set on read — so a crash mid-write never corrupts the index.
 */

/** Where a chat session may reach — most-isolated by default (invariant #2: host access is opt-in + typed).
 *  `chat_only` is the read-only floor (todo §5.M G3a): the agent may read (read_file/list_dir/get_board) but use no
 *  mutating tool. Must stay aligned with `runtimeChatSessionScopeSchema` in core/chat-api-contract.ts. */
export type ChatSessionScope = "project_sandboxed" | "all_projects" | "host_access" | "chat_only";
/** The agent persona a session runs as (mirrors the §5.M preset roles). */
export type ChatSessionRole = "planner_architect" | "reviewer" | "debugger" | "researcher" | "system_operator";

export const CHAT_SESSION_SCOPES: readonly ChatSessionScope[] = [
	"project_sandboxed",
	"all_projects",
	"host_access",
	"chat_only",
];
export const CHAT_SESSION_ROLES: readonly ChatSessionRole[] = [
	"planner_architect",
	"reviewer",
	"debugger",
	"researcher",
	"system_operator",
];

export const DEFAULT_CHAT_SESSION_SCOPE: ChatSessionScope = "project_sandboxed";
export const DEFAULT_CHAT_SESSION_ROLE: ChatSessionRole = "planner_architect";

export interface ChatSession {
	schemaVersion: 1;
	id: string;
	title: string;
	scope: ChatSessionScope;
	role: ChatSessionRole;
	/** A Codex-style explicit objective kept in focus across turns (todo §5.M); null when unset. */
	goal: string | null;
	createdAt: number;
	updatedAt: number;
}

interface ChatSessionUpsertEvent {
	type: "upsert";
	at: number;
	session: ChatSession;
}
interface ChatSessionDeleteEvent {
	type: "delete";
	at: number;
	id: string;
}
type ChatSessionEvent = ChatSessionUpsertEvent | ChatSessionDeleteEvent;

export interface ChatSessionStoreOptions {
	rootDir?: string;
	now?: () => number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-sessions");

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "sessions.jsonl");
}

function normalizeScope(value: unknown): ChatSessionScope {
	return CHAT_SESSION_SCOPES.includes(value as ChatSessionScope)
		? (value as ChatSessionScope)
		: DEFAULT_CHAT_SESSION_SCOPE;
}
function normalizeRole(value: unknown): ChatSessionRole {
	return CHAT_SESSION_ROLES.includes(value as ChatSessionRole)
		? (value as ChatSessionRole)
		: DEFAULT_CHAT_SESSION_ROLE;
}

async function readChatSessionEvents(rootDir?: string): Promise<ChatSessionEvent[]> {
	let raw: string;
	try {
		raw = await readFile(resolveLogPath(rootDir), "utf8");
	} catch {
		return [];
	}
	const events: ChatSessionEvent[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as ChatSessionEvent;
			if (parsed.type === "upsert" || parsed.type === "delete") {
				events.push(parsed);
			}
		} catch {
			// Skip a malformed line rather than failing the whole read.
		}
	}
	return events;
}

async function appendChatSessionEvent(event: ChatSessionEvent, rootDir?: string): Promise<void> {
	const root = rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await appendFile(resolveLogPath(rootDir), `${JSON.stringify(event)}\n`, "utf8");
}

/** Replay the event log into the current session set, newest-updated first. */
function replayChatSessions(events: readonly ChatSessionEvent[]): ChatSession[] {
	const byId = new Map<string, ChatSession>();
	for (const event of events) {
		if (event.type === "delete") {
			byId.delete(event.id);
		} else {
			byId.set(event.session.id, {
				...event.session,
				scope: normalizeScope(event.session.scope),
				role: normalizeRole(event.session.role),
				// Back-compat for sessions persisted before `goal` existed.
				goal: typeof event.session.goal === "string" ? event.session.goal : null,
			});
		}
	}
	return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function listChatSessions(options: ChatSessionStoreOptions = {}): Promise<ChatSession[]> {
	return replayChatSessions(await readChatSessionEvents(options.rootDir));
}

export async function getChatSession(id: string, options: ChatSessionStoreOptions = {}): Promise<ChatSession | null> {
	return (await listChatSessions(options)).find((session) => session.id === id) ?? null;
}

export async function createChatSession(
	input: { title: string; scope?: ChatSessionScope; role?: ChatSessionRole; goal?: string | null },
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession> {
	const now = (options.now ?? Date.now)();
	const session: ChatSession = {
		schemaVersion: 1,
		id: randomUUID(),
		title: input.title.trim() || "Untitled session",
		scope: input.scope ?? DEFAULT_CHAT_SESSION_SCOPE,
		role: input.role ?? DEFAULT_CHAT_SESSION_ROLE,
		goal: input.goal?.trim() || null,
		createdAt: now,
		updatedAt: now,
	};
	await appendChatSessionEvent({ type: "upsert", at: now, session }, options.rootDir);
	return session;
}

export async function updateChatSession(
	id: string,
	patch: { title?: string; scope?: ChatSessionScope; role?: ChatSessionRole; goal?: string | null },
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession | null> {
	const existing = await getChatSession(id, options);
	if (!existing) {
		return null;
	}
	const now = (options.now ?? Date.now)();
	const session: ChatSession = {
		...existing,
		...(patch.title !== undefined ? { title: patch.title.trim() || existing.title } : {}),
		...(patch.scope !== undefined ? { scope: patch.scope } : {}),
		...(patch.role !== undefined ? { role: patch.role } : {}),
		// `goal: null` clears it; `goal: undefined` (absent) leaves it unchanged.
		...(patch.goal !== undefined ? { goal: patch.goal?.trim() || null } : {}),
		updatedAt: now,
	};
	await appendChatSessionEvent({ type: "upsert", at: now, session }, options.rootDir);
	return session;
}

export async function deleteChatSession(id: string, options: ChatSessionStoreOptions = {}): Promise<boolean> {
	const existing = await getChatSession(id, options);
	if (!existing) {
		return false;
	}
	await appendChatSessionEvent({ type: "delete", at: (options.now ?? Date.now)(), id }, options.rootDir);
	return true;
}
