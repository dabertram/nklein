import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendChatMessage, clearChatTranscript, readChatTranscript } from "../../../src/chat/chat-transcript-store";

describe("chat-transcript-store", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-transcripts-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("appends and reads back a session's messages in order, isolated per session", async () => {
		await appendChatMessage("session-a", { role: "user", content: "hi", createdAt: 1 }, { rootDir });
		await appendChatMessage("session-a", { role: "assistant", content: "hello", createdAt: 2 }, { rootDir });
		await appendChatMessage("session-b", { role: "user", content: "other", createdAt: 3 }, { rootDir });

		const a = await readChatTranscript("session-a", { rootDir });
		expect(a.map((message) => [message.role, message.content])).toEqual([
			["user", "hi"],
			["assistant", "hello"],
		]);
		expect(a[0]?.id).toBeTruthy();

		expect(await readChatTranscript("session-b", { rootDir })).toHaveLength(1);
		expect(await readChatTranscript("missing", { rootDir })).toEqual([]);
	});

	it("returns only the most recent messages when limited (preserving order)", async () => {
		for (let i = 0; i < 5; i++) {
			await appendChatMessage("s", { role: "user", content: `m${i}`, createdAt: i }, { rootDir });
		}
		const recent = await readChatTranscript("s", { rootDir, limit: 2 });
		expect(recent.map((message) => message.content)).toEqual(["m3", "m4"]);
		expect(await readChatTranscript("s", { rootDir, limit: 0 })).toEqual([]);
	});

	it("clears a session's transcript", async () => {
		await appendChatMessage("s", { role: "user", content: "x" }, { rootDir });
		await clearChatTranscript("s", { rootDir });
		expect(await readChatTranscript("s", { rootDir })).toEqual([]);
	});
});
