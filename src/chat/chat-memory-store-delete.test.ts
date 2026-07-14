import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendChatMemory, deleteChatMemory, readChatMemories } from "./chat-memory-store";

describe("deleteChatMemory (F2.9b)", () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "chat-mem-del-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("removes one memory by id, keeps the rest, and returns true", async () => {
		const a = await appendChatMemory({ sessionId: "s1", text: "keep me" }, { rootDir: root });
		const b = await appendChatMemory({ sessionId: "s1", text: "delete me" }, { rootDir: root });

		expect(await deleteChatMemory(b.id, { rootDir: root })).toBe(true);
		const remaining = await readChatMemories({ rootDir: root });
		expect(remaining.map((memory) => memory.id)).toEqual([a.id]);
	});

	it("returns false for an absent id and never rewrites away existing rows", async () => {
		const a = await appendChatMemory({ sessionId: "s1", text: "keep" }, { rootDir: root });
		expect(await deleteChatMemory("never-existed", { rootDir: root })).toBe(false);
		expect((await readChatMemories({ rootDir: root })).map((memory) => memory.id)).toEqual([a.id]);
	});
});
