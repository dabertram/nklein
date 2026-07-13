import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { BoardChatVerbosity } from "../core/board-chat-feedback";
import { parseValidatedJsonl } from "../state/jsonl-store";
import { chatSessionGrantStore } from "./chat-session-grants";
import { chatSessionTaintRegistry } from "./chat-session-taint";
import { clearChatTranscript } from "./chat-transcript-store";

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
export type ChatSessionScope = "project_sandboxed" | "all_projects" | "host_access" | "chat_only" | "klein_self";
/** The agent persona a session runs as (mirrors the §5.M preset roles). */
export type ChatSessionRole = "planner_architect" | "reviewer" | "debugger" | "researcher" | "system_operator";

export const CHAT_SESSION_SCOPES: readonly ChatSessionScope[] = [
	"project_sandboxed",
	"all_projects",
	"host_access",
	"chat_only",
	// §6.11-A read-only SELF-awareness scope: the workspace root is the !Klein repo itself (read + get_board only).
	"klein_self",
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
	/** §5.M: workspace-relative directories the user approved for Docker-mounted sandbox writes. Default empty. */
	sandboxWritablePaths: readonly string[];
	/** §5.AT: the user muted board→chat feedback for this (owning) chat — the bridge suppresses every tier. Default false. */
	feedbackMuted: boolean;
	/** F2.14: per-session board→chat push verbosity (silent/concise/normal/verbose). Default "normal". */
	feedbackVerbosity: BoardChatVerbosity;
	/** F2.14: quiet mode — NOTIFY tiers are batched into deferred digests instead of pushed promptly. Default false. */
	feedbackQuiet: boolean;
	/** §5.AU: the ONE workspace this chat owns (v1 is 1 chat ↔ 1 workspace) — routes board→chat feedback here; null when unset. */
	ownedWorkspaceId: string | null;
	/** §5.AU: the current addressing focus (the "talking to X" target), or null (⇒ the goal). */
	focus: ChatSessionFocus | null;
	/** §5.AU: card ASKs currently awaiting the operator's answer (for reply-binding); empty when none. */
	outstandingAsks: readonly ChatOutstandingAsk[];
	/** §5.AE: the skills the user has enabled for this session; their merged apiProfile is folded into the model call. */
	selectedSkillIds: readonly string[];
	/** §5.M: running total of tokens this session's turns have consumed (usage.total_tokens summed across turns). */
	totalTokensUsed: number;
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
	scope: z.enum(["project_sandboxed", "all_projects", "host_access", "chat_only", "klein_self"]),
	role: z.enum(["planner_architect", "reviewer", "debugger", "researcher", "system_operator"]),
	goal: z.string().nullable().optional(),
	riskAcknowledged: z.boolean().optional(),
	browserEnabled: z.boolean().optional(),
	sandboxWritablePaths: z.array(z.string()).optional(),
	feedbackMuted: z.boolean().optional(),
	feedbackVerbosity: z.enum(["silent", "concise", "normal", "verbose"]).optional(),
	feedbackQuiet: z.boolean().optional(),
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
	totalTokensUsed: z.number().optional(),
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

function normalizeSandboxWritablePaths(paths: readonly string[] | undefined): string[] {
	const normalized = new Set<string>();
	for (const path of paths ?? []) {
		const trimmed = path.trim();
		if (trimmed) {
			normalized.add(trimmed);
		}
	}
	return [...normalized];
}

// Serialize check-then-act sequences (read the current session set, decide, then append) per rootDir. The append-only
// log is safe against WRITE corruption on its own, but NOT against a logical race: two concurrent callers can both read
// the SAME pre-write state, decide independently, and both append — a lost update (§5.M totalTokensUsed) or a duplicate
// creation (§5.AT/§5.AU ensureChatSessionForWorkspace "one chat per project"). A promise chain per rootDir gives every
// read-decide-append sequence exclusive access to the store in between its own read and its own append.
const chatSessionWriteChains = new Map<string, Promise<unknown>>();

function serializeChatSessionWrite<T>(rootDir: string | undefined, fn: () => Promise<T>): Promise<T> {
	const key = rootDir ?? DEFAULT_ROOT;
	const prior = chatSessionWriteChains.get(key) ?? Promise.resolve();
	// Run `fn` once the prior write SETTLES (success or failure) so one caller's error never wedges the chain for the
	// next; each caller still gets ITS OWN accurate result/error via the returned `settled` promise.
	const settled = prior.then(fn, fn);
	chatSessionWriteChains.set(
		key,
		settled.catch(() => undefined),
	);
	return settled;
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
				// Back-compat for sessions persisted before approved sandbox write paths existed → no writes.
				sandboxWritablePaths: normalizeSandboxWritablePaths(event.session.sandboxWritablePaths),
				// Back-compat for sessions persisted before `feedbackMuted` existed (default: not muted).
				feedbackMuted: event.session.feedbackMuted === true,
				// F2.14 back-compat: verbosity/quiet absent on old records → the "normal"/not-quiet defaults.
				feedbackVerbosity: normalizeBoardChatVerbosity(event.session.feedbackVerbosity),
				feedbackQuiet: event.session.feedbackQuiet === true,
				// §5.AU back-compat: addressing state absent on old records → unset / empty.
				ownedWorkspaceId:
					typeof event.session.ownedWorkspaceId === "string" ? event.session.ownedWorkspaceId : null,
				focus: event.session.focus ?? null,
				outstandingAsks: event.session.outstandingAsks ?? [],
				// §5.AE back-compat: sessions persisted before skill selection existed → no skills enabled.
				selectedSkillIds: event.session.selectedSkillIds ?? [],
				// §5.M back-compat: sessions persisted before token tracking → 0.
				totalTokensUsed: event.session.totalTokensUsed ?? 0,
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
		sandboxWritablePaths?: readonly string[];
		feedbackMuted?: boolean;
		feedbackVerbosity?: BoardChatVerbosity;
		feedbackQuiet?: boolean;
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
		sandboxWritablePaths: normalizeSandboxWritablePaths(input.sandboxWritablePaths),
		feedbackMuted: input.feedbackMuted ?? false,
		feedbackVerbosity: normalizeBoardChatVerbosity(input.feedbackVerbosity),
		feedbackQuiet: input.feedbackQuiet ?? false,
		ownedWorkspaceId: input.ownedWorkspaceId ?? null,
		focus: null,
		outstandingAsks: [],
		selectedSkillIds: input.selectedSkillIds ?? [],
		totalTokensUsed: 0,
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
	// Serialized (bug-hunt 2026-07-05): this is a check-then-act find-or-create with no lock. Two concurrent callers for
	// the SAME workspace (the feedback bridge + the client, or two racing summary observers) could both miss the cache,
	// both find no owner, and both create a session — splitting ownership of one project across two chats. The write
	// chain gives each caller exclusive access between its own find and its own create.
	return serializeChatSessionWrite(options.rootDir, async () => {
		const existing = await findChatSessionByOwnedWorkspace(input.workspaceId, options);
		if (existing) {
			return existing;
		}
		return createChatSession({ title: input.title, ownedWorkspaceId: input.workspaceId }, options);
	});
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
		sandboxWritablePaths?: readonly string[];
		feedbackMuted?: boolean;
		feedbackVerbosity?: BoardChatVerbosity;
		feedbackQuiet?: boolean;
		/** §5.AU: set (or `null` = clear) the session's addressing focus — e.g. after an explicit @card handle. */
		focus?: ChatSessionFocus | null;
		/** §5.AE: replace the session's enabled skills. */
		selectedSkillIds?: readonly string[];
		/** §5.M: set the running token total to an ABSOLUTE value. Prefer `addTokensUsed` for accumulation — computing
		 * `existing + delta` from a caller-held session snapshot races against a concurrent turn's own update (bug-hunt
		 * 2026-07-05: two turns on one session both read the same stale base, and the later write clobbers the earlier). */
		totalTokensUsed?: number;
		/** §5.M: accumulate the turn's token usage by this DELTA, added to the value freshly read INSIDE this call's
		 * own serialized critical section — concurrency-safe, unlike a caller precomputing `existing.totalTokensUsed +
		 * delta` from a session snapshot that may already be stale by the time this call runs. */
		addTokensUsed?: number;
	},
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession | null> {
	// Serialized (bug-hunt 2026-07-05): a read-then-append with no lock let concurrent updates race — most visibly
	// `addTokensUsed`, where the fresh read below must happen-after any write already queued for this rootDir.
	return serializeChatSessionWrite(options.rootDir, async () => {
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
			...(patch.sandboxWritablePaths !== undefined
				? { sandboxWritablePaths: normalizeSandboxWritablePaths(patch.sandboxWritablePaths) }
				: {}),
			...(patch.feedbackMuted !== undefined ? { feedbackMuted: patch.feedbackMuted } : {}),
			...(patch.feedbackVerbosity !== undefined ? { feedbackVerbosity: patch.feedbackVerbosity } : {}),
			...(patch.feedbackQuiet !== undefined ? { feedbackQuiet: patch.feedbackQuiet } : {}),
			...(patch.focus !== undefined ? { focus: patch.focus } : {}),
			...(patch.selectedSkillIds !== undefined ? { selectedSkillIds: patch.selectedSkillIds } : {}),
			...(patch.totalTokensUsed !== undefined ? { totalTokensUsed: patch.totalTokensUsed } : {}),
			...(patch.addTokensUsed !== undefined
				? { totalTokensUsed: existing.totalTokensUsed + patch.addTokensUsed }
				: {}),
			updatedAt: now,
		};
		await appendChatSessionEvent({ type: "upsert", at: now, session }, options.rootDir);
		return session;
	});
}

/**
 * §5.AT/§5.AU — record an outstanding card ASK on the session (bug-hunt 2026-07-05: this was the missing writer —
 * `updateChatSession`'s patch has no `outstandingAsks` field and nothing else ever set it, so the reply-binding ladder
 * in `resolveMessageTarget` always read an empty array and its rung 2 (bind the next message to the ASK it answers)
 * never fired). Dedupes by `signalKey` (a re-surfaced ASK for the same signal replaces its prior entry, not doubles it).
 * Serialized like `updateChatSession` so a concurrent add/clear on the same session can't race.
 */
export async function addChatOutstandingAsk(
	sessionId: string,
	ask: ChatOutstandingAsk,
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession | null> {
	return serializeChatSessionWrite(options.rootDir, async () => {
		const existing = await getChatSession(sessionId, options);
		if (!existing) {
			return null;
		}
		const now = (options.now ?? Date.now)();
		const session: ChatSession = {
			...existing,
			outstandingAsks: [...existing.outstandingAsks.filter((a) => a.signalKey !== ask.signalKey), ask],
			updatedAt: now,
		};
		await appendChatSessionEvent({ type: "upsert", at: now, session }, options.rootDir);
		return session;
	});
}

/** §5.AT/§5.AU — clear an outstanding ASK (its signal resolved) so it stops being reply-bind eligible. */
export async function clearChatOutstandingAsk(
	sessionId: string,
	signalKey: string,
	options: ChatSessionStoreOptions = {},
): Promise<ChatSession | null> {
	return serializeChatSessionWrite(options.rootDir, async () => {
		const existing = await getChatSession(sessionId, options);
		if (!existing) {
			return null;
		}
		const now = (options.now ?? Date.now)();
		const session: ChatSession = {
			...existing,
			outstandingAsks: existing.outstandingAsks.filter((a) => a.signalKey !== signalKey),
			updatedAt: now,
		};
		await appendChatSessionEvent({ type: "upsert", at: now, session }, options.rootDir);
		return session;
	});
}

export interface DeleteChatSessionOptions extends ChatSessionStoreOptions {
	/** Root dir of the TRANSCRIPT store (separate sibling dir); tests inject a tmp dir. */
	transcriptRootDir?: string;
}

export async function deleteChatSession(id: string, options: DeleteChatSessionOptions = {}): Promise<boolean> {
	const existing = await getChatSession(id, options);
	if (!existing) {
		return false;
	}
	await appendChatSessionEvent({ type: "delete", at: (options.now ?? Date.now)(), id }, options.rootDir);
	// Deleting a session must also drop its transcript — a deleted chat leaving its full transcript on disk was
	// the "cleanup is not consistent in every detail" class of leak (David 2026-07-10).
	await clearChatTranscript(id, { rootDir: options.transcriptRootDir });
	// F2.1: the session's accumulated taint dies with the session (its transcript — the tainted content — is gone).
	chatSessionTaintRegistry.clear(id);
	chatSessionGrantStore.clear(id); // F2.2: grants die with the session too
	return true;
}

/**
 * Delete every chat session OWNED by `workspaceId` (sessions + transcripts). Project removal must sweep the
 * project's chats too — bulk project cleanup previously left them behind (David 2026-07-10: cleanup "should be
 * consistent throughout the full app in every detail"). Returns the deleted session ids.
 */
export async function deleteChatSessionsForWorkspace(
	workspaceId: string,
	options: DeleteChatSessionOptions = {},
): Promise<string[]> {
	const sessions = await listChatSessions(options);
	const owned = sessions.filter((session) => session.ownedWorkspaceId === workspaceId);
	for (const session of owned) {
		await deleteChatSession(session.id, options);
	}
	return owned.map((session) => session.id);
}

/** F2.14: coerce a persisted/patched verbosity value to a valid level (default "normal"). */
function normalizeBoardChatVerbosity(value: unknown): BoardChatVerbosity {
	return value === "silent" || value === "concise" || value === "verbose" ? value : "normal";
}
