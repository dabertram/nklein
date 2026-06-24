import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatService } from "../../../src/chat/chat-service";
import { appendChatMessage } from "../../../src/chat/chat-transcript-store";

describe("createChatService", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-service-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("creates, lists (newest-updated first), gets, updates, and deletes sessions", async () => {
		let clock = 1_000;
		const service = createChatService({ rootDir, now: () => (clock += 1_000) });

		const first = await service.createSession({ title: "First", goal: "ship it" });
		const second = await service.createSession({ title: "Second", scope: "all_projects", role: "reviewer" });

		expect(first.goal).toBe("ship it");
		expect(second.scope).toBe("all_projects");
		expect(second.role).toBe("reviewer");
		// The wire shape carries no schemaVersion.
		expect(first).not.toHaveProperty("schemaVersion");

		const listed = await service.listSessions();
		expect(listed.map((s) => s.title)).toEqual(["Second", "First"]);

		const updated = await service.updateSession({ id: first.id, title: "First (edited)", goal: null });
		expect(updated?.title).toBe("First (edited)");
		expect(updated?.goal).toBeNull();
		expect(updated?.updatedAt).toBeGreaterThan(first.updatedAt);

		// First is now the most-recently-updated → sorts to the top.
		const relisted = await service.listSessions();
		expect(relisted.map((s) => s.title)).toEqual(["First (edited)", "Second"]);

		expect(await service.getSession(second.id)).toMatchObject({ id: second.id, title: "Second" });
		expect(await service.deleteSession(second.id)).toBe(true);
		expect(await service.getSession(second.id)).toBeNull();
		expect(await service.deleteSession("missing")).toBe(false);
	});

	it("reads a session's transcript (mapped to the wire shape, newest-N when limited)", async () => {
		const service = createChatService({ rootDir });
		const session = await service.createSession({ title: "Chat" });
		const transcriptRoot = { rootDir: join(rootDir, "transcripts") };

		await appendChatMessage(session.id, { role: "user", content: "hello" }, transcriptRoot);
		await appendChatMessage(session.id, { role: "assistant", content: "hi there" }, transcriptRoot);

		const all = await service.readTranscript(session.id);
		expect(all.map((m) => ({ role: m.role, content: m.content }))).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]);
		expect(all[0]).not.toHaveProperty("schemaVersion");

		const lastOnly = await service.readTranscript(session.id, 1);
		expect(lastOnly).toHaveLength(1);
		expect(lastOnly[0]?.content).toBe("hi there");
	});

	it("returns an empty transcript for a session with no messages", async () => {
		const service = createChatService({ rootDir });
		const session = await service.createSession({ title: "Quiet" });
		expect(await service.readTranscript(session.id)).toEqual([]);
	});
});
