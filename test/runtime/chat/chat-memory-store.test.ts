import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	accessibleChatMemories,
	appendChatMemory,
	type ChatMemory,
	cosineSimilarity,
	lexicalSimilarity,
	readChatMemories,
	recallChatMemories,
} from "../../../src/chat/chat-memory-store";

function memory(overrides: Partial<ChatMemory> = {}): ChatMemory {
	return {
		schemaVersion: 1,
		id: overrides.id ?? "m",
		sessionId: "s1",
		shared: false,
		text: "",
		embedding: null,
		createdAt: 0,
		...overrides,
	};
}

describe("chat-memory-store", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-memories-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("appends and reads back memories", async () => {
		await appendChatMemory({ sessionId: "s1", text: "uses zustand", embedding: [1, 0] }, { rootDir, now: () => 1 });
		await appendChatMemory({ sessionId: "s1", text: "prefers tabs", shared: true }, { rootDir, now: () => 2 });
		const all = await readChatMemories({ rootDir });
		expect(all).toHaveLength(2);
		expect(all[0]).toMatchObject({ text: "uses zustand", embedding: [1, 0], shared: false });
		expect(all[1]).toMatchObject({ text: "prefers tabs", shared: true });
	});

	it("scopes recall to the session's own memories plus shared ones", () => {
		const memories = [
			memory({ id: "own", sessionId: "s1" }),
			memory({ id: "shared", sessionId: "s2", shared: true }),
			memory({ id: "other", sessionId: "s2", shared: false }),
		];
		expect(accessibleChatMemories(memories, "s1").map((m) => m.id)).toEqual(["own", "shared"]);
	});

	it("computes cosine + lexical similarity", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
		expect(lexicalSimilarity("the merge conflict", "merge conflict here")).toBeGreaterThan(0);
		expect(lexicalSimilarity("apples", "oranges")).toBe(0);
	});

	it("recalls by embedding similarity when an embedder is available", async () => {
		const memories = [
			memory({ id: "near", embedding: [1, 0, 0], text: "near" }),
			memory({ id: "far", embedding: [0, 0, 1], text: "far" }),
		];
		const recalled = await recallChatMemories(
			{ query: "q", sessionId: "s1", memories, limit: 1 },
			{ embed: async () => [1, 0, 0] },
		);
		expect(recalled).toHaveLength(1);
		expect(recalled[0]?.id).toBe("near");
		expect(recalled[0]?.score).toBeCloseTo(1);
	});

	it("degrades to lexical overlap when there is no embedder, dropping unrelated memories", async () => {
		const memories = [
			memory({ id: "hit", text: "fix the merge conflict in board state" }),
			memory({ id: "miss", text: "unrelated weather notes" }),
		];
		const recalled = await recallChatMemories({ query: "merge conflict", sessionId: "s1", memories }, {});
		expect(recalled.map((m) => m.id)).toEqual(["hit"]);
	});
});
