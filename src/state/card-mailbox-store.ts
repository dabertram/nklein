import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * §5.AU STEP 6b — the CARD MAILBOX: durable per-card pending GUIDANCE. When a user's main-chat message targets a card
 * that is NOT actively running (queued/blocked/ready), {@link resolveCardMessageEffect} returns `queue_mailbox` — the
 * guidance sticks to the card here and is CONSUMED as opening context when the card later starts WORK. This decouples
 * communication (always allowed) from execution (readiness-gated), so guidance to a blocked card is never lost and never
 * force-starts it.
 *
 * Append-only JSONL event log (crash-safe, replayed on read), same pattern as the chat-session store: `append` adds a
 * note; `consume` marks every still-pending note for a task consumed (as of a timestamp). Pending = a note appended after
 * the task's latest consume.
 */

/** Where a mailbox note originated — the main chat (targeted at a card) or a stream-level fan-out. */
export type CardMailboxSource = "chat" | "stream" | "operator";

export interface CardMailboxNote {
	schemaVersion: 1;
	id: string;
	taskId: string;
	/** The guidance text. */
	text: string;
	source: CardMailboxSource;
	createdAt: number;
}

const cardMailboxNoteSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	taskId: z.string(),
	text: z.string(),
	source: z.enum(["chat", "stream", "operator"]),
	createdAt: z.number(),
});

const cardMailboxEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("append"), at: z.number(), note: cardMailboxNoteSchema }),
	z.object({
		type: z.literal("consume"),
		at: z.number(),
		taskId: z.string(),
		/** The exact ids consumed (bug-hunt 2026-07-05 fix). Absent ⇒ an OLD event predating this field; falls back to
		 * the legacy `createdAt > at` boundary (best-effort for already-persisted logs, still subject to the tie bug). */
		noteIds: z.array(z.string()).optional(),
	}),
]);
type CardMailboxEvent = z.infer<typeof cardMailboxEventSchema>;

export interface CardMailboxStoreOptions {
	rootDir?: string;
	now?: () => number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "card-mailbox");

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "mailbox.jsonl");
}

async function readEvents(rootDir?: string): Promise<CardMailboxEvent[]> {
	let raw: string;
	try {
		raw = await readFile(resolveLogPath(rootDir), "utf8");
	} catch {
		return [];
	}
	return parseValidatedJsonl(raw, cardMailboxEventSchema, "card-mailbox-store");
}

async function appendEvent(event: CardMailboxEvent, rootDir?: string): Promise<void> {
	const root = rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await appendFile(resolveLogPath(rootDir), `${JSON.stringify(event)}\n`, "utf8");
}

/** Replay to the still-PENDING notes for `taskId`, oldest first — those appended after the task's latest `consume`. */
function replayPending(events: readonly CardMailboxEvent[], taskId: string): CardMailboxNote[] {
	// Process events in LOG ORDER: a `consume` only clears the notes SEEN SO FAR (already appended earlier in the log);
	// one appended after the consume event's log position is naturally preserved (it isn't in `notes` yet).
	let notes: CardMailboxNote[] = [];
	for (const event of events) {
		if (event.type === "consume" && event.taskId === taskId) {
			// Bug-hunt fix (2026-07-05): consume by EXACT id when the event carries `noteIds` (the ids actually read),
			// not by a `createdAt > at` timestamp boundary. The boundary form is ambiguous on a tie: a note that
			// arrives during the read-to-consume window can share the SAME millisecond as the newest note that WAS
			// read (real under "fast/concurrent chat delivery"), and `createdAt > at` then wrongly drops it — even
			// though it was never actually read/folded into the prompt this consume is finalizing. An id-set has no
			// such ambiguity: only the notes truly read are ever removed. Legacy events (persisted before this fix)
			// carry no `noteIds` — fall back to the old boundary for those (best-effort on old, unmigrated logs only).
			const consumedIds = event.noteIds;
			notes = consumedIds
				? notes.filter((note) => !consumedIds.includes(note.id))
				: notes.filter((note) => note.createdAt > event.at);
		} else if (event.type === "append" && event.note.taskId === taskId) {
			notes.push(event.note);
		}
	}
	return notes.sort((a, b) => a.createdAt - b.createdAt);
}

/** Queue a guidance note on a card's mailbox. */
export async function appendCardMailboxNote(
	input: { taskId: string; text: string; source?: CardMailboxSource },
	options: CardMailboxStoreOptions = {},
): Promise<CardMailboxNote> {
	const now = (options.now ?? Date.now)();
	const note: CardMailboxNote = {
		schemaVersion: 1,
		id: randomUUID(),
		taskId: input.taskId,
		text: input.text,
		source: input.source ?? "chat",
		createdAt: now,
	};
	await appendEvent({ type: "append", at: now, note }, options.rootDir);
	return note;
}

/** The still-pending guidance notes for a card, oldest first. */
export async function listPendingCardMailbox(
	taskId: string,
	options: CardMailboxStoreOptions = {},
): Promise<CardMailboxNote[]> {
	return replayPending(await readEvents(options.rootDir), taskId);
}

/** How many notes are pending for a card (for the "N pending notes" badge). */
export async function countPendingCardMailbox(taskId: string, options: CardMailboxStoreOptions = {}): Promise<number> {
	return (await listPendingCardMailbox(taskId, options)).length;
}

/**
 * Render consumed mailbox notes as the opening-context addendum appended to the card's start prompt. Pure; empty
 * string for no notes. Notes are quoted verbatim (oldest first) under a header that marks them as operator guidance.
 */
export function composeMailboxPromptAddendum(notes: readonly CardMailboxNote[]): string {
	if (notes.length === 0) {
		return "";
	}
	const lines = notes.map((note) => `- ${note.text}`);
	return `\n\nOperator guidance queued while this card waited (read before starting; it may adjust or scope the task):\n${lines.join("\n")}`;
}

/**
 * Mark a card's mailbox consumed UP TO a specific note timestamp — the crash-safe half of "consume on start".
 * A start reads the pending notes NON-destructively ({@link listPendingCardMailbox}), folds them into the opening
 * prompt, and only calls this AFTER the start actually succeeds — so a start that throws (Docker down, bad baseRef,
 * stale workspace) leaves the guidance pending for the next attempt instead of durably losing it.
 *
 * Pass `consumedNoteIds` (the exact ids of the notes just read/folded in) whenever the caller has them — bug-hunt fix
 * 2026-07-05: a boundary based only on `upToCreatedAt` is ambiguous on a tie (a note arriving during the read-to-
 * consume window can share the SAME millisecond as the newest note that WAS read — real under fast/concurrent chat
 * delivery — and gets wrongly swept up by a plain `createdAt > at` filter even though it was never actually read).
 * An id-set has no such ambiguity. Omit it only for a caller that doesn't have the read notes' ids on hand; that path
 * keeps the older, tie-prone timestamp boundary for back-compat.
 */
export async function markCardMailboxConsumedUpTo(
	taskId: string,
	upToCreatedAt: number,
	options: CardMailboxStoreOptions = {},
	consumedNoteIds?: readonly string[],
): Promise<void> {
	if (!Number.isFinite(upToCreatedAt)) {
		return;
	}
	await appendEvent(
		{ type: "consume", at: upToCreatedAt, taskId, ...(consumedNoteIds ? { noteIds: [...consumedNoteIds] } : {}) },
		options.rootDir,
	);
}

/**
 * Consume the card's pending guidance — call when the card STARTS WORK, to fold the notes into its opening context.
 * Returns the consumed notes (oldest first) and records the consume so they never resurface. NOTE: this consumes
 * BEFORE you can know the start succeeded; prefer `listPendingCardMailbox` + `markCardMailboxConsumedUpTo` (consume
 * only after a successful start) on any path where the start can fail after the read.
 */
export async function consumeCardMailbox(
	taskId: string,
	options: CardMailboxStoreOptions = {},
): Promise<CardMailboxNote[]> {
	const pending = await listPendingCardMailbox(taskId, options);
	if (pending.length > 0) {
		await appendEvent({ type: "consume", at: (options.now ?? Date.now)(), taskId }, options.rootDir);
	}
	return pending;
}
