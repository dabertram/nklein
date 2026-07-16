import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { OutwardActionStatus, QueuedOutwardAction } from "../core/outward-action-queue.js";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Phase 7S / S3 — the persisted OUTWARD-ACTION review queue ("queue for later review", David 2026-07-16). When the
 * autonomous path would need human approval for a novel outward action ({@link decideOutwardActionApproval} →
 * `require_approval`), the broker records the intended action here instead of performing or dropping it; the operator
 * reviews it out-of-band (`dev outward-queue`) and approves/rejects. Append-only for new actions; a status change
 * rewrites the log (read-modify-write) since the queue is small and reviewed rarely. Best-effort producer: a recording
 * failure never breaks the agent turn. Schema-invalid lines are skipped, never trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "outward-action-queue");

const OUTWARD_ACTION_STATUSES = ["pending", "approved", "rejected"] as const;

export const queuedOutwardActionSchema: z.ZodType<QueuedOutwardAction> = z.object({
	id: z.string(),
	toolName: z.string(),
	target: z.string(),
	argsSummary: z.string(),
	reason: z.string(),
	status: z.enum(OUTWARD_ACTION_STATUSES),
	at: z.number(),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}
function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "queue.jsonl");
}

/** Append one intended outward action to the queue (best-effort: callers should catch to stay non-fatal). */
export async function enqueueOutwardAction(action: QueuedOutwardAction, options?: { rootDir?: string }): Promise<void> {
	const line = `${JSON.stringify(queuedOutwardActionSchema.parse(action))}\n`;
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), line, "utf8");
}

/** Read every queued outward action (empty when the log is missing/unreadable — never throws). */
export async function readOutwardActionQueue(options?: { rootDir?: string }): Promise<QueuedOutwardAction[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, queuedOutwardActionSchema, "outward-action-queue-store");
}

/**
 * Set the status of a queued action by id (operator review). Rewrites the log with the updated record. Returns true when
 * the id was found and updated, false otherwise. The queue is small and reviewed rarely, so a full rewrite is fine.
 */
export async function setOutwardActionStatus(
	id: string,
	status: OutwardActionStatus,
	options?: { rootDir?: string },
): Promise<boolean> {
	const actions = await readOutwardActionQueue(options);
	let found = false;
	const updated = actions.map((action) => {
		if (action.id === id) {
			found = true;
			return { ...action, status };
		}
		return action;
	});
	if (!found) {
		return false;
	}
	const body = updated.map((action) => JSON.stringify(queuedOutwardActionSchema.parse(action))).join("\n");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await writeFile(resolveLogPath(options?.rootDir), body.length > 0 ? `${body}\n` : "", "utf8");
	return true;
}
