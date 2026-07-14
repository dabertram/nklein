import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatImageAttachment } from "../core/chat-multimodal";
import { deleteChatMessageImages, readChatMessageImages, writeChatMessageImages } from "./chat-image-store";

const IMAGE: ChatImageAttachment = { data: "QUJD", mimeType: "image/png", name: "shot.png" };

describe("chat-image-store (F2.7b out-of-band image persistence)", () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "chat-image-store-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("round-trips a message's images by (session, message)", async () => {
		await writeChatMessageImages("sess-1", "msg-1", [IMAGE], { rootDir: root });
		expect(await readChatMessageImages("sess-1", "msg-1", { rootDir: root })).toEqual([IMAGE]);
	});

	it("returns [] for a message with no images (no file) — never throws", async () => {
		expect(await readChatMessageImages("sess-1", "absent", { rootDir: root })).toEqual([]);
	});

	it("an empty list writes no file (stays []), and keys are message-scoped", async () => {
		await writeChatMessageImages("sess-1", "msg-empty", [], { rootDir: root });
		expect(await readChatMessageImages("sess-1", "msg-empty", { rootDir: root })).toEqual([]);
		// A different message id does not read another's images.
		await writeChatMessageImages("sess-1", "msg-a", [IMAGE], { rootDir: root });
		expect(await readChatMessageImages("sess-1", "msg-b", { rootDir: root })).toEqual([]);
	});

	it("delete removes a message's images", async () => {
		await writeChatMessageImages("sess-1", "msg-1", [IMAGE], { rootDir: root });
		await deleteChatMessageImages("sess-1", "msg-1", { rootDir: root });
		expect(await readChatMessageImages("sess-1", "msg-1", { rootDir: root })).toEqual([]);
	});
});
