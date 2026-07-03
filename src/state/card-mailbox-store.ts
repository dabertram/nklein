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
export type CardMailboxSource = "chat" | "stream";

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
	source: z.enum(["chat", "stream"]),
	createdAt: z.number(),
});

const cardMailboxEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("append"), at: z.number(), note: cardMailboxNoteSchema }),
	z.object({ type: z.literal("consume"), at: z.number(), taskId: z.string() }),
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
	let lastConsumeAt = Number.NEGATIVE_INFINITY;
	const notes: CardMailboxNote[] = [];
	for (const event of events) {
		if (event.type === "consume" && event.taskId === taskId) {
			lastConsumeAt = Math.max(lastConsumeAt, event.at);
		} else if (event.type === "append" && event.note.taskId === taskId) {
			notes.push(event.note);
		}
	}
	return notes.filter((note) => note.createdAt > lastConsumeAt).sort((a, b) => a.createdAt - b.createdAt);
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
 * stale workspace) leaves the guidance pending for the next attempt instead of durably losing it. Consuming "up to"
 * the newest read note (not `now`) also means a note that arrived DURING the start window stays pending rather than
 * being marked consumed without ever reaching a prompt.
 */
export async function markCardMailboxConsumedUpTo(
	taskId: string,
	upToCreatedAt: number,
	options: CardMailboxStoreOptions = {},
): Promise<void> {
	if (!Number.isFinite(upToCreatedAt)) {
		return;
	}
	await appendEvent({ type: "consume", at: upToCreatedAt, taskId }, options.rootDir);
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
