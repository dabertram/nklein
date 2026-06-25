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

	it("defaults riskAcknowledged to false, and update toggles + round-trips it (§5.M G3b)", async () => {
		const created = await createChatSession({ title: "Risky" }, { rootDir, now });
		expect(created.riskAcknowledged).toBe(false);
		clock = 2000;
		const acked = await updateChatSession(created.id, { riskAcknowledged: true }, { rootDir, now });
		expect(acked?.riskAcknowledged).toBe(true);
		// Persisted across a fresh read (replayed from the event log).
		expect((await getChatSession(created.id, { rootDir }))?.riskAcknowledged).toBe(true);
		// And can be turned back off.
		const off = await updateChatSession(created.id, { riskAcknowledged: false }, { rootDir, now });
		expect(off?.riskAcknowledged).toBe(false);
	});

	it("honors an explicit scope + role", async () => {
		const created = await createChatSession(
			{ title: "Ops", scope: "host_access", role: "system_operator" },
			{ rootDir, now },
		);
		expect(created).toMatchObject({ scope: "host_access", role: "system_operator" });
	});

	it("defaults goal to null, sets it on create, and clears vs preserves it on update", async () => {
		const created = await createChatSession({ title: "Plain" }, { rootDir, now });
		expect(created.goal).toBeNull();

		const withGoal = await createChatSession({ title: "Goaled", goal: "  Ship the merge UI  " }, { rootDir, now });
		expect(withGoal.goal).toBe("Ship the merge UI");

		// Absent goal in the patch leaves it unchanged; explicit null clears it.
		const renamed = await updateChatSession(withGoal.id, { title: "Renamed" }, { rootDir, now });
		expect(renamed?.goal).toBe("Ship the merge UI");
		const cleared = await updateChatSession(withGoal.id, { goal: null }, { rootDir, now });
		expect(cleared?.goal).toBeNull();
		expect((await getChatSession(withGoal.id, { rootDir }))?.goal).toBeNull();
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
