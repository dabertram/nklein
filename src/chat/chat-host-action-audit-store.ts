import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "../state/jsonl-store";
import type { ChatActionDecision, ChatActionKind, ChatExecutionMode } from "./chat-execution-mode";

/**
 * Host-action audit log (todo §5.M "Safety, permissions & audit"). The chat agent may touch the host only under
 * the execution-mode policy ([chat-execution-mode.ts](./chat-execution-mode.ts)); this is the durable, append-only
 * record of **every** such attempt — what action, under which mode, the policy decision, whether the user
 * confirmed, and whether it executed — so host access is always logged (the §5.M safety invariant) and reviewable.
 */

export interface ChatHostActionAuditEntry {
	schemaVersion: 1;
	id: string;
	sessionId: string;
	mode: ChatExecutionMode;
	action: ChatActionKind;
	decision: ChatActionDecision;
	/** Whether the user explicitly confirmed (relevant when the decision was `confirm`). */
	confirmed: boolean;
	/** Whether the action actually executed after the policy + confirmation. */
	executed: boolean;
	/** Short human description of the action (e.g. the command or path); never secrets. */
	detail: string | null;
	recordedAt: number;
}

export const chatHostActionAuditEntrySchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	sessionId: z.string(),
	mode: z.enum(["isolated_readonly", "sandbox_with_host_escape", "host"]),
	action: z.enum([
		"sandbox_read",
		"sandbox_write",
		"control_plane",
		"egress_read",
		"host_read",
		"host_write",
		"host_command",
	]),
	decision: z.enum(["allow", "confirm", "deny"]),
	confirmed: z.boolean(),
	executed: z.boolean(),
	detail: z.string().nullable(),
	recordedAt: z.number(),
}) satisfies z.ZodType<ChatHostActionAuditEntry>;

export interface ChatHostActionAuditStoreOptions {
	rootDir?: string;
	now?: () => number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-audit");

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "host-actions.jsonl");
}

export async function recordChatHostAction(
	input: {
		sessionId: string;
		mode: ChatExecutionMode;
		action: ChatActionKind;
		decision: ChatActionDecision;
		confirmed?: boolean;
		executed?: boolean;
		detail?: string | null;
		id?: string;
	},
	options: ChatHostActionAuditStoreOptions = {},
): Promise<ChatHostActionAuditEntry> {
	const entry: ChatHostActionAuditEntry = {
		schemaVersion: 1,
		id: input.id ?? randomUUID(),
		sessionId: input.sessionId,
		mode: input.mode,
		action: input.action,
		decision: input.decision,
		confirmed: input.confirmed ?? false,
		executed: input.executed ?? false,
		detail: input.detail ?? null,
		recordedAt: (options.now ?? Date.now)(),
	};
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await appendFile(resolveLogPath(options.rootDir), `${JSON.stringify(entry)}\n`, "utf8");
	return entry;
}

export interface ReadChatHostActionAuditOptions extends ChatHostActionAuditStoreOptions {
	/** Restrict to one session. */
	sessionId?: string;
	/** Return only the most recent `limit` entries (newest first). */
	limit?: number;
}

export async function readChatHostActionAudit(
	options: ReadChatHostActionAuditOptions = {},
): Promise<ChatHostActionAuditEntry[]> {
	let raw: string;
	try {
		raw = await readFile(resolveLogPath(options.rootDir), "utf8");
	} catch {
		return [];
	}
	const all = parseValidatedJsonl(raw, chatHostActionAuditEntrySchema, "chat-host-action-audit-store");
	const entries = options.sessionId ? all.filter((e) => e.sessionId === options.sessionId) : all;
	entries.sort((left, right) => right.recordedAt - left.recordedAt);
	return typeof options.limit === "number" ? entries.slice(0, Math.max(0, options.limit)) : entries;
}
