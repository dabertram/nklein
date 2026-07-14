import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { ChatImageAttachment } from "../core/chat-multimodal";

/**
 * F2.7b — the chat message IMAGE store. Sent image attachments are persisted OUT OF BAND from the transcript (one
 * small JSON file per message, keyed by a hash of `sessionId:messageId`), NOT inline in the JSONL transcript. This
 * keeps `readChatTranscript` — run on every lean-window pass — lean: it never loads image bytes into memory, and the
 * token estimator never sees base64. The renderer fetches a message's images lazily (once) when it displays them.
 * The bytes are already fail-closed-bounded at the send seam ({@link ../core/chat-multimodal.boundChatImageAttachments}).
 */

const chatImageAttachmentSchema = z.object({
	data: z.string(),
	mimeType: z.string(),
	name: z.string().optional(),
}) satisfies z.ZodType<ChatImageAttachment>;

const chatImageFileSchema = z.object({
	schemaVersion: z.literal(1),
	images: z.array(chatImageAttachmentSchema),
});

export interface ChatImageStoreOptions {
	rootDir?: string;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-images");

/** One file per (session, message): a fixed-length hash keeps any id pair a safe filename. */
function resolveImagePath(sessionId: string, messageId: string, rootDir?: string): string {
	const fileName = `${createHash("sha256").update(`${sessionId}:${messageId}`).digest("hex").slice(0, 20)}.json`;
	return join(rootDir ?? DEFAULT_ROOT, fileName);
}

/** Persist a message's image attachments. No-op for an empty list (no file written). */
export async function writeChatMessageImages(
	sessionId: string,
	messageId: string,
	images: readonly ChatImageAttachment[],
	options: ChatImageStoreOptions = {},
): Promise<void> {
	if (images.length === 0) {
		return;
	}
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	const payload = { schemaVersion: 1 as const, images: images.map((image) => ({ ...image })) };
	await writeFile(resolveImagePath(sessionId, messageId, options.rootDir), JSON.stringify(payload), "utf8");
}

/** Read a message's image attachments; [] when the message has none (no file) or the file is unreadable/invalid. */
export async function readChatMessageImages(
	sessionId: string,
	messageId: string,
	options: ChatImageStoreOptions = {},
): Promise<ChatImageAttachment[]> {
	let raw: string;
	try {
		raw = await readFile(resolveImagePath(sessionId, messageId, options.rootDir), "utf8");
	} catch {
		return [];
	}
	const parsed = chatImageFileSchema.safeParse(JSON.parse(raw));
	return parsed.success ? parsed.data.images : [];
}

/** Best-effort delete of a message's image file (used when a session is deleted). */
export async function deleteChatMessageImages(
	sessionId: string,
	messageId: string,
	options: ChatImageStoreOptions = {},
): Promise<void> {
	await rm(resolveImagePath(sessionId, messageId, options.rootDir), { force: true }).catch(() => {});
}
