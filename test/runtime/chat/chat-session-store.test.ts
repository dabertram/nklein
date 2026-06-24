import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createChatSession,
	deleteChatSession,
	getChatSession,
	listChatSessions,
	updateChatSession,
} from "../../../src/chat/chat-session-store";

describe("chat-session-store", () => {
	let rootDir: string;
	let clock: number;
	const now = () => clock;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-sessions-"));
		clock = 1000;
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("creates, lists, and gets a session with defaults applied", async () => {
		const created = await createChatSession({ title: "  Debug the merge  " }, { rootDir, now });
		expect(created).toMatchObject({
			title: "Debug the merge",
			scope: "project_sandboxed",
			role: "planner_architect",
			createdAt: 1000,
			updatedAt: 1000,
		});
		expect(created.id).toBeTruthy();

		expect(await getChatSession(created.id, { rootDir })).toMatchObject({ id: created.id, title: "Debug the merge" });
		expect(await listChatSessions({ rootDir })).toHaveLength(1);
		expect(await getChatSession("missing", { rootDir })).toBeNull();
	});

	it("honors an explicit scope + role", async () => {
		const created = await createChatSession(
			{ title: "Ops", scope: "host_access", role: "system_operator" },
			{ rootDir, now },
		);
		expect(created).toMatchObject({ scope: "host_access", role: "system_operator" });
	});

	it("updates fields, bumps updatedAt, and persists across reads", async () => {
		const created = await createChatSession({ title: "First" }, { rootDir, now });
		clock = 2000;
		const updated = await updateChatSession(created.id, { title: "Renamed", role: "reviewer" }, { rootDir, now });
		expect(updated).toMatchObject({ title: "Renamed", role: "reviewer", createdAt: 1000, updatedAt: 2000 });

		const reloaded = await getChatSession(created.id, { rootDir });
		expect(reloaded).toMatchObject({ title: "Renamed", role: "reviewer", updatedAt: 2000 });
		expect(await updateChatSession("missing", { title: "x" }, { rootDir })).toBeNull();
	});

	it("deletes a session and reports whether it existed", async () => {
		const created = await createChatSession({ title: "Throwaway" }, { rootDir, now });
		expect(await deleteChatSession(created.id, { rootDir, now })).toBe(true);
		expect(await getChatSession(created.id, { rootDir })).toBeNull();
		expect(await listChatSessions({ rootDir })).toHaveLength(0);
		expect(await deleteChatSession(created.id, { rootDir })).toBe(false);
	});

	it("replays the event log newest-updated first", async () => {
		const a = await createChatSession({ title: "A" }, { rootDir, now });
		clock = 1100;
		const b = await createChatSession({ title: "B" }, { rootDir, now });
		clock = 1200;
		await updateChatSession(a.id, { title: "A2" }, { rootDir, now });

		const sessions = await listChatSessions({ rootDir });
		expect(sessions.map((session) => session.title)).toEqual(["A2", "B"]);
		expect(sessions[0]?.id).toBe(a.id);
		expect(sessions[1]?.id).toBe(b.id);
	});
});
