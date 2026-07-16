/**
 * Outward-action review queue — pure helpers (Phase 7S / S3, "queue for later review" model, David 2026-07-16).
 *
 * The S3 decision core ([outward-action-approval.ts](./outward-action-approval.ts)) yields `require_approval` for a
 * novel outward action (post a comment/PR) on the AUTONOMOUS path where there is no human mid-run. David's chosen model:
 * don't silently drop it and don't perform it — RECORD the intended action to a review queue the operator approves or
 * rejects afterward. This module is the pure side: the queue record shape, a secret-safe argument SUMMARY (so the queued
 * record never persists a raw credential the tool args might carry), and a status roll-up for the review surface. The
 * effectful append/read/status-update lives in the store; the effectful stamping of `id`/`at` happens at the broker edge.
 *
 * Pure + deterministic: no I/O, no clock.
 */

export type OutwardActionStatus = "pending" | "approved" | "rejected";

/** One intended outward action recorded for later operator review. */
export interface QueuedOutwardAction {
	/** Stable id (stamped at the effectful edge — e.g. a hash of toolName+summary+at). */
	readonly id: string;
	/** The tool the agent intended to call (e.g. `issues__post_comment`). */
	readonly toolName: string;
	/** Best-effort target the action would hit (an issue/PR ref, a host, or the tool name when unknown). */
	readonly target: string;
	/** A secret-safe, length-bounded summary of the intended call arguments (never the raw args). */
	readonly argsSummary: string;
	/** Why it was queued — the S3 approval-decision reason. */
	readonly reason: string;
	readonly status: OutwardActionStatus;
	/** Epoch-ms the action was queued (stamped at the effectful edge). */
	readonly at: number;
}

const MAX_SUMMARY_CHARS = 300;
// Redact credential-shaped runs so a queued record never persists a token/key the tool args carried.
const SECRET_SHAPED = /\b(?:[A-Za-z0-9_-]{24,}|(?:sk|pk|ghp|gho|xox[baprs])-[A-Za-z0-9_-]{8,})\b/g;

/**
 * Build a secret-safe, length-bounded summary string from arbitrary tool-call args. Objects are shown as their key
 * names with short scalar values; long/credential-shaped values are redacted. Never throws — a non-serializable input
 * degrades to a placeholder. This is what gets PERSISTED, so it must never carry a raw secret.
 */
export function redactArgsSummary(args: unknown): string {
	let raw: string;
	if (args === null || args === undefined) {
		raw = "(no args)";
	} else if (typeof args === "string") {
		raw = args;
	} else if (typeof args === "object") {
		try {
			raw = Object.entries(args as Record<string, unknown>)
				.map(([key, value]) => `${key}=${scalarPreview(value)}`)
				.join(", ");
		} catch {
			raw = "(unsummarizable args)";
		}
	} else {
		raw = String(args);
	}
	const redacted = raw.replace(SECRET_SHAPED, "[redacted]");
	return redacted.length > MAX_SUMMARY_CHARS ? `${redacted.slice(0, MAX_SUMMARY_CHARS)}…` : redacted;
}

/** A short preview of a single scalar/nested value for the args summary (nested objects are elided). */
function scalarPreview(value: unknown): string {
	if (value === null || value === undefined) {
		return "∅";
	}
	if (typeof value === "string") {
		return value.length > 60 ? `"${value.slice(0, 60)}…"` : `"${value}"`;
	}
	if (typeof value === "object") {
		return Array.isArray(value) ? `[${value.length} items]` : "{…}";
	}
	return String(value);
}

export interface OutwardQueueSummary {
	readonly total: number;
	readonly pending: number;
	readonly approved: number;
	readonly rejected: number;
	/** Distinct tools with a PENDING action awaiting review, worst-first (most pending). */
	readonly pendingByTool: ReadonlyArray<{ toolName: string; pending: number }>;
}

/** Roll up the queue for the review surface: status counts + which tools have pending actions. */
export function summarizeOutwardActionQueue(actions: readonly QueuedOutwardAction[]): OutwardQueueSummary {
	let pending = 0;
	let approved = 0;
	let rejected = 0;
	const pendingCounts = new Map<string, number>();
	for (const action of actions) {
		if (action.status === "pending") {
			pending += 1;
			pendingCounts.set(action.toolName, (pendingCounts.get(action.toolName) ?? 0) + 1);
		} else if (action.status === "approved") {
			approved += 1;
		} else {
			rejected += 1;
		}
	}
	const pendingByTool = [...pendingCounts]
		.map(([toolName, count]) => ({ toolName, pending: count }))
		.sort((a, b) => b.pending - a.pending || a.toolName.localeCompare(b.toolName));
	return { total: actions.length, pending, approved, rejected, pendingByTool };
}
