import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "../state/jsonl-store";

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

/** §5.AU — the chat's current addressing focus (a card/stream the user drilled into); drives `resolveMessageTarget`. */
export interface ChatSessionFocus {
	kind: "card" | "stream";
	id: string;
	/** When the focus was set (epoch ms) — for focus-decay policy. */
	at: number;
}

/** §5.AU — an outstanding card ASK the user's next message might answer (recorded by the §5.AT feedback bridge). */
export interface ChatOutstandingAsk {
	/** `${taskId}:${kind}` — the §5.AT dedupe key + the reply referent. */
	signalKey: string;
	taskId: string;
	streamId?: string;
	question?: string;
}

export interface ChatSession {
	schemaVersion: 1;
	id: string;
	title: string;
	scope: ChatSessionScope;
	role: ChatSessionRole;
	/** A Codex-style explicit objective kept in focus across turns (todo §5.M); null when unset. */
	goal: string | null;
	/** §5.M G3b: the user accepted the risk of this session running UNSAFE commands (general-ack). Default false. */
	riskAcknowledged: boolean;
	/** §5.M G6: the user enabled the headless-browser/internet tool for this session (orthogonal). Default false. */
	browserEnabled: boolean;
	/** §5.AU: the ONE workspace this chat owns (v1 is 1 chat ↔ 1 workspace) — routes board→chat feedback here; null when unset. */
	ownedWorkspaceId: string | null;
	/** §5.AU: the current addressing focus (the "talking to X" target), or null (⇒ the goal). */
	focus: ChatSessionFocus | null;
	/** §5.AU: card ASKs currently awaiting the operator's answer (for reply-binding); empty when none. */
	outstandingAsks: readonly ChatOutstandingAsk[];
	/** §5.AE: the skills the user has enabled for this session; their merged apiProfile is folded into the model call. */
	selectedSkillIds: readonly string[];
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

// Schema for a persisted session — uses .optional() / .nullable() on back-compat fields so old records
// written before those fields existed are still accepted (replayChatSessions normalises them to defaults).
const chatSessionPersistedSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	title: z.string(),
	scope: z.enum(["project_sandboxed", "all_projects", "host_access", "chat_only"]),
	role: z.enum(["planner_architect", "reviewer", "debugger", "researcher", "system_operator"]),
	goal: z.string().nullable().optional(),
	riskAcknowledged: z.boolean().optional(),
	browserEnabled: z.boolean().optional(),
	ownedWorkspaceId: z.string().nullable().optional(),
	focus: z
		.object({ kind: z.enum(["card", "stream"]), id: z.string(), at: z.number() })
		.nullable()
		.optional(),
	outstandingAsks: z
		.array(
			z.object({
				signalKey: z.string(),
				taskId: z.string(),
				streamId: z.string().optional(),
				question: z.string().optional(),
			}),
		)
		.optional(),
	selectedSkillIds: z.array(z.string()).optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

// The schema is intentionally looser than ChatSessionEvent: back-compat fields (goal, riskAcknowledged,
// browserEnabled) are optional so old records written before they existed still parse. replayChatSessions
// normalises all absent fields to their defaults, so the cast below is always safe.
const chatSessionEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("upsert"), at: z.number(), session: chatSessionPersistedSchema }),
	z.object({ type: z.literal("delete"), at: z.number(), id: z.string() }),
]);

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
	// Cast is safe: replayChatSessions coerces all optional back-compat fields to their defaults.
	return parseValidatedJsonl(raw, chatSessionEventSchema, "chat-session-store") as ChatSessionEvent[];
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
				// Back-compat for sessions persisted before `riskAcknowledged` existed (default: not acknowledged).
				riskAcknowledged: event.session.riskAcknowledged === true,
				// Back-compat for sessions persisted before `browserEnabled` existed (default: disabled).
				browserEnabled: event.session.browserEnabled === true,
				// §5.AU back-compat: addressing state absent on old records → unset / empty.
				ownedWorkspaceId:
					typeof event.session.ownedWorkspaceId === "string" ? event.session.ownedWorkspaceId : null,
				focus: event.session.focus ?? null,
				outstandingAsks: event.session.outstandingAsks ?? [],
				// §5.AE back-compat: sessions persisted before skill selection existed → no skills enabled.
				selectedSkillIds: event.session.selectedSkillIds ?? [],
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
	input: {
		title: string;
		scope?: ChatSessionScope;
		role?: ChatSessionRole;
		goal?: string | null;
		riskAcknowledged?: boolean;
		browserEnabled?: boolean;
		/** §5.AU: the workspace this chat owns (v1 = 1 chat ↔ 1 workspace). */
		ownedWorkspaceId?: string | null;
		/** §5.AE: skills the user enables for this session. */
		selectedSkillIds?: readonly string[];
	},
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
		riskAcknowledged: input.riskAcknowledged ?? false,
		browserEnabled: input.browserEnabled ?? false,
		ownedWorkspaceId: input.ownedWorkspaceId ?? null,
		focus: null,
		outstandingAsks: [],
		selectedSkillIds: input.selectedSkillIds ?? [],
		createdAt: now,
		updatedAt: now,
	};
	await appendChatSessionEvent({ type: "upsert", at: now, session }, options.rootDir);
	return session;
}

/**
 * §5.AT/§5.AU one-chat-per-project: the chat session that OWNS `workspaceId`, or null. The newest-updated match wins
 * (deterministic if two ever exist), so the board→chat feedback bridge routes to a single, stable session per project.
 */
export async function findChatSessionByOwnedWorkspace(
	workspaceId: string,
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession | null> {
	const owned = (await listChatSessions(options))
		.filter((session) => session.ownedWorkspaceId === workspaceId)
		.sort((a, b) => b.updatedAt - a.updatedAt);
	return owned[0] ?? null;
}

/**
 * §5.AT/§5.AU one-chat-per-project: find the chat owning `workspaceId`, or create one bound to it. Idempotent — the
 * feedback bridge and the client both call this, and a project ends up with exactly one owning chat.
 */
export async function ensureChatSessionForWorkspace(
	input: { workspaceId: string; title: string },
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession> {
	const existing = await findChatSessionByOwnedWorkspace(input.workspaceId, options);
	if (existing) {
		return existing;
	}
	return createChatSession({ title: input.title, ownedWorkspaceId: input.workspaceId }, options);
}

export async function updateChatSession(
	id: string,
	patch: {
		title?: string;
		scope?: ChatSessionScope;
		role?: ChatSessionRole;
		goal?: string | null;
		riskAcknowledged?: boolean;
		browserEnabled?: boolean;
		/** §5.AU: set (or `null` = clear) the session's addressing focus — e.g. after an explicit @card handle. */
		focus?: ChatSessionFocus | null;
		/** §5.AE: replace the session's enabled skills. */
		selectedSkillIds?: readonly string[];
	},
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
		...(patch.riskAcknowledged !== undefined ? { riskAcknowledged: patch.riskAcknowledged } : {}),
		...(patch.browserEnabled !== undefined ? { browserEnabled: patch.browserEnabled } : {}),
		...(patch.focus !== undefined ? { focus: patch.focus } : {}),
		...(patch.selectedSkillIds !== undefined ? { selectedSkillIds: patch.selectedSkillIds } : {}),
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
