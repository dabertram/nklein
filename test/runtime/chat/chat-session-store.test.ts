import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createChatSession,
	deleteChatSession,
	ensureChatSessionForWorkspace,
	findChatSessionByOwnedWorkspace,
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

	it("§5.AU: focus defaults null, sets via update (round-trips), and clears with null", async () => {
		const created = await createChatSession({ title: "Focus" }, { rootDir, now });
		expect(created.focus).toBeNull();
		clock = 2000;
		const focused = await updateChatSession(
			created.id,
			{ focus: { kind: "card", id: "card-1", at: 2000 } },
			{ rootDir, now },
		);
		expect(focused?.focus).toEqual({ kind: "card", id: "card-1", at: 2000 });
		expect((await getChatSession(created.id, { rootDir }))?.focus).toEqual({ kind: "card", id: "card-1", at: 2000 });
		const cleared = await updateChatSession(created.id, { focus: null }, { rootDir, now });
		expect(cleared?.focus).toBeNull();
	});

	it("defaults browserEnabled to false, and update toggles + round-trips it (§5.M G6)", async () => {
		const created = await createChatSession({ title: "Browsing" }, { rootDir, now });
		expect(created.browserEnabled).toBe(false);
		clock = 2000;
		const on = await updateChatSession(created.id, { browserEnabled: true }, { rootDir, now });
		expect(on?.browserEnabled).toBe(true);
		// Persisted across a fresh read (replayed from the event log).
		expect((await getChatSession(created.id, { rootDir }))?.browserEnabled).toBe(true);
		// And can be turned back off.
		const off = await updateChatSession(created.id, { browserEnabled: false }, { rootDir, now });
		expect(off?.browserEnabled).toBe(false);
	});

	it("§5.AU: defaults the addressing state (ownedWorkspaceId/focus/outstandingAsks) + round-trips ownership", async () => {
		const created = await createChatSession({ title: "Board chat" }, { rootDir, now });
		expect(created.ownedWorkspaceId).toBeNull();
		expect(created.focus).toBeNull();
		expect(created.outstandingAsks).toEqual([]);

		const owned = await createChatSession({ title: "Owned", ownedWorkspaceId: "ws-1" }, { rootDir, now });
		expect(owned.ownedWorkspaceId).toBe("ws-1");
		// Persisted across a fresh read (replayed from the event log).
		expect((await getChatSession(owned.id, { rootDir }))?.ownedWorkspaceId).toBe("ws-1");
	});

	it("§5.AU: back-compat — a record persisted before the addressing fields existed loads with defaults", async () => {
		// Simulate an OLD event-log line missing ownedWorkspaceId/focus/outstandingAsks.
		const { appendFile, mkdir } = await import("node:fs/promises");
		await mkdir(rootDir, { recursive: true });
		const legacy = {
			type: "upsert",
			at: 1,
			session: {
				schemaVersion: 1,
				id: "legacy",
				title: "Old",
				scope: "chat_only",
				role: "reviewer",
				createdAt: 1,
				updatedAt: 1,
			},
		};
		await appendFile(join(rootDir, "sessions.jsonl"), `${JSON.stringify(legacy)}\n`, "utf8");

		const loaded = await getChatSession("legacy", { rootDir });
		expect(loaded).toMatchObject({ id: "legacy", ownedWorkspaceId: null, focus: null, outstandingAsks: [] });
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

describe("one-chat-per-project (§5.AT/§5.AU ownedWorkspaceId)", () => {
	let rootDir2: string;
	beforeEach(async () => {
		rootDir2 = await mkdtemp(join(tmpdir(), "nklein-chat-owned-"));
	});
	afterEach(async () => {
		await rm(rootDir2, { recursive: true, force: true }).catch(() => undefined);
	});

	it("createChatSession persists ownedWorkspaceId and findChatSessionByOwnedWorkspace locates it", async () => {
		const opts = { rootDir: rootDir2 };
		await createChatSession({ title: "Other", ownedWorkspaceId: "ws-other" }, opts);
		const mine = await createChatSession({ title: "Mine", ownedWorkspaceId: "ws-mine" }, opts);
		expect((await findChatSessionByOwnedWorkspace("ws-mine", opts))?.id).toBe(mine.id);
		expect(await findChatSessionByOwnedWorkspace("ws-nobody", opts)).toBeNull();
	});

	it("ensureChatSessionForWorkspace is idempotent — one owning chat per project", async () => {
		const opts = { rootDir: rootDir2 };
		const first = await ensureChatSessionForWorkspace({ workspaceId: "ws-1", title: "Project 1" }, opts);
		const second = await ensureChatSessionForWorkspace({ workspaceId: "ws-1", title: "Project 1 again" }, opts);
		expect(second.id).toBe(first.id); // reused, not a second chat
		expect(first.ownedWorkspaceId).toBe("ws-1");
		const owningWs1 = (await listChatSessions(opts)).filter((session) => session.ownedWorkspaceId === "ws-1");
		expect(owningWs1).toHaveLength(1);
	});
});
