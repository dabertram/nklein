import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "../state/jsonl-store";
import type { ChatActionDecision, ChatExecutionMode } from "./chat-execution-mode";

/**
 * Dedicated egress-attempt audit log (todo §5.L). The generic host-action audit records the tool-policy decision for
 * every chat tool call; this store is the network-specific trail: which egress tool tried to reach what target, whether
 * the per-action gate confirmed it, whether it executed, and the normalized host when the target is a URL.
 */

export type ChatEgressAttemptTargetKind = "url" | "search_query" | "unknown";

export interface ChatEgressAttemptAuditRecord {
	sessionId: string;
	mode: ChatExecutionMode;
	toolName: string;
	action: "egress_read";
	decision: ChatActionDecision;
	confirmed: boolean;
	executed: boolean;
	targetKind: ChatEgressAttemptTargetKind;
	target: string | null;
	host?: string | null;
	detail: string | null;
}

export interface ChatEgressAttemptAuditEntry extends ChatEgressAttemptAuditRecord {
	schemaVersion: 1;
	id: string;
	host: string | null;
	recordedAt: number;
}

export const chatEgressAttemptAuditEntrySchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	sessionId: z.string(),
	mode: z.enum(["isolated_readonly", "sandbox_with_host_escape", "host"]),
	toolName: z.string(),
	action: z.literal("egress_read"),
	decision: z.enum(["allow", "confirm", "deny"]),
	confirmed: z.boolean(),
	executed: z.boolean(),
	targetKind: z.enum(["url", "search_query", "unknown"]),
	target: z.string().nullable(),
	host: z.string().nullable(),
	detail: z.string().nullable(),
	recordedAt: z.number(),
}) satisfies z.ZodType<ChatEgressAttemptAuditEntry>;

export interface ChatEgressAttemptAuditStoreOptions {
	rootDir?: string;
	now?: () => number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-audit");

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "egress-attempts.jsonl");
}

function hostFromUrlTarget(targetKind: ChatEgressAttemptTargetKind, target: string | null): string | null {
	if (targetKind !== "url" || !target) {
		return null;
	}
	try {
		const url = new URL(target);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		return url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
	} catch {
		return null;
	}
}

export async function recordChatEgressAttempt(
	input: ChatEgressAttemptAuditRecord & { id?: string },
	options: ChatEgressAttemptAuditStoreOptions = {},
): Promise<ChatEgressAttemptAuditEntry> {
	const entry: ChatEgressAttemptAuditEntry = {
		schemaVersion: 1,
		id: input.id ?? randomUUID(),
		sessionId: input.sessionId,
		mode: input.mode,
		toolName: input.toolName,
		action: "egress_read",
		decision: input.decision,
		confirmed: input.confirmed,
		executed: input.executed,
		targetKind: input.targetKind,
		target: input.target,
		host: input.host ?? hostFromUrlTarget(input.targetKind, input.target),
		detail: input.detail,
		recordedAt: (options.now ?? Date.now)(),
	};
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await appendFile(resolveLogPath(options.rootDir), `${JSON.stringify(entry)}\n`, "utf8");
	return entry;
}

export interface ReadChatEgressAttemptAuditOptions extends ChatEgressAttemptAuditStoreOptions {
	/** Restrict to one session. */
	sessionId?: string;
	/** Return only the most recent `limit` entries (newest first). */
	limit?: number;
}

export async function readChatEgressAttemptAudit(
	options: ReadChatEgressAttemptAuditOptions = {},
): Promise<ChatEgressAttemptAuditEntry[]> {
	let raw: string;
	try {
		raw = await readFile(resolveLogPath(options.rootDir), "utf8");
	} catch {
		return [];
	}
	const all = parseValidatedJsonl(raw, chatEgressAttemptAuditEntrySchema, "chat-egress-attempt-audit-store");
	const entries = options.sessionId ? all.filter((e) => e.sessionId === options.sessionId) : all;
	entries.sort((left, right) => right.recordedAt - left.recordedAt);
	return typeof options.limit === "number" ? entries.slice(0, Math.max(0, options.limit)) : entries;
}
