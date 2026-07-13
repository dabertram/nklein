import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addChatOutstandingAsk,
	clearChatOutstandingAsk,
	createChatSession,
	deleteChatSession,
	deleteChatSessionsForWorkspace,
	ensureChatSessionForWorkspace,
	findChatSessionByOwnedWorkspace,
	getChatSession,
	listChatSessions,
	updateChatSession,
} from "../../../src/chat/chat-session-store";
import { appendChatMessage, readChatTranscript } from "../../../src/chat/chat-transcript-store";

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

	it("§5.AT: feedbackMuted defaults false, and update toggles + round-trips it (board→chat mute)", async () => {
		const created = await createChatSession({ title: "Muted?" }, { rootDir, now });
		expect(created.feedbackMuted).toBe(false);
		clock = 2000;
		const muted = await updateChatSession(created.id, { feedbackMuted: true }, { rootDir, now });
		expect(muted?.feedbackMuted).toBe(true);
		// Persisted across a fresh read (replayed from the event log).
		expect((await getChatSession(created.id, { rootDir }))?.feedbackMuted).toBe(true);
		// And can be un-muted.
		const off = await updateChatSession(created.id, { feedbackMuted: false }, { rootDir, now });
		expect(off?.feedbackMuted).toBe(false);
	});

	it("F2.14: feedbackVerbosity/feedbackQuiet default normal/false and round-trip through update", async () => {
		const created = await createChatSession({ title: "Verbosity" }, { rootDir, now });
		expect(created.feedbackVerbosity).toBe("normal");
		expect(created.feedbackQuiet).toBe(false);
		clock = 2000;
		const updated = await updateChatSession(
			created.id,
			{ feedbackVerbosity: "concise", feedbackQuiet: true },
			{ rootDir, now },
		);
		expect(updated?.feedbackVerbosity).toBe("concise");
		expect(updated?.feedbackQuiet).toBe(true);
		// Persisted across a fresh replay.
		const reread = await getChatSession(created.id, { rootDir });
		expect(reread?.feedbackVerbosity).toBe("concise");
		expect(reread?.feedbackQuiet).toBe(true);
		// A create can request a non-default verbosity directly.
		const silent = await createChatSession({ title: "Silent", feedbackVerbosity: "silent" }, { rootDir, now });
		expect(silent.feedbackVerbosity).toBe("silent");
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

	it("defaults sandboxWritablePaths to empty and normalizes updates", async () => {
		const created = await createChatSession(
			{ title: "Writable", sandboxWritablePaths: [" src ", "src", ""] },
			{ rootDir, now },
		);
		expect(created.sandboxWritablePaths).toEqual(["src"]);

		const updated = await updateChatSession(
			created.id,
			{ sandboxWritablePaths: ["docs", " docs ", "src/generated"] },
			{ rootDir, now },
		);
		expect(updated?.sandboxWritablePaths).toEqual(["docs", "src/generated"]);
		expect((await getChatSession(created.id, { rootDir }))?.sandboxWritablePaths).toEqual(["docs", "src/generated"]);
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
		expect(loaded).toMatchObject({
			id: "legacy",
			sandboxWritablePaths: [],
			ownedWorkspaceId: null,
			focus: null,
			outstandingAsks: [],
		});
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

	it("bug-hunt #7 (2026-07-05): CONCURRENT ensureChatSessionForWorkspace calls still yield exactly one owning chat", async () => {
		const opts = { rootDir: rootDir2 };
		// Two callers race for the SAME workspace with no cache populated yet (the feedback bridge + the client, or two
		// racing summary observers). Without serialization both would find-no-owner and both create — splitting
		// ownership. Fire them together (not sequentially) to exercise the actual race window.
		const [a, b] = await Promise.all([
			ensureChatSessionForWorkspace({ workspaceId: "ws-race", title: "Race" }, opts),
			ensureChatSessionForWorkspace({ workspaceId: "ws-race", title: "Race" }, opts),
		]);
		expect(a.id).toBe(b.id);
		const owning = (await listChatSessions(opts)).filter((session) => session.ownedWorkspaceId === "ws-race");
		expect(owning).toHaveLength(1);
	});
});

describe("bug-hunt #9/#10 (2026-07-05): totalTokensUsed accumulates via addTokensUsed, concurrency-safe", () => {
	let rootDir3: string;
	beforeEach(async () => {
		rootDir3 = await mkdtemp(join(tmpdir(), "nklein-chat-tokens-"));
	});
	afterEach(async () => {
		await rm(rootDir3, { recursive: true, force: true }).catch(() => undefined);
	});

	it("addTokensUsed accumulates onto the prior total (not an absolute overwrite)", async () => {
		const opts = { rootDir: rootDir3 };
		const created = await createChatSession({ title: "T" }, opts);
		await updateChatSession(created.id, { addTokensUsed: 30 }, opts);
		const after = await updateChatSession(created.id, { addTokensUsed: 50 }, opts);
		expect(after?.totalTokensUsed).toBe(80);
	});

	it("CONCURRENT addTokensUsed calls on one session both land (no lost update)", async () => {
		const opts = { rootDir: rootDir3 };
		const created = await createChatSession({ title: "T" }, opts);
		// Two turns finishing around the same time — fired together, not sequentially, to exercise the actual race.
		await Promise.all([
			updateChatSession(created.id, { addTokensUsed: 30 }, opts),
			updateChatSession(created.id, { addTokensUsed: 50 }, opts),
		]);
		const final = await getChatSession(created.id, opts);
		expect(final?.totalTokensUsed).toBe(80); // both deltas landed, in EITHER order — not last-writer-wins
	});
});

describe("bug-hunt #4 (2026-07-05): outstandingAsks has a writer (addChatOutstandingAsk/clearChatOutstandingAsk)", () => {
	let rootDir4: string;
	beforeEach(async () => {
		rootDir4 = await mkdtemp(join(tmpdir(), "nklein-chat-asks-"));
	});
	afterEach(async () => {
		await rm(rootDir4, { recursive: true, force: true }).catch(() => undefined);
	});

	it("addChatOutstandingAsk persists an ask onto the session (previously always stayed [])", async () => {
		const opts = { rootDir: rootDir4 };
		const created = await createChatSession({ title: "T" }, opts);
		expect(created.outstandingAsks).toEqual([]);
		const updated = await addChatOutstandingAsk(
			created.id,
			{ signalKey: "task-1:awaiting_review", taskId: "task-1", question: "Ready to merge?" },
			opts,
		);
		expect(updated?.outstandingAsks).toEqual([
			{ signalKey: "task-1:awaiting_review", taskId: "task-1", question: "Ready to merge?" },
		]);
		// Persisted, not just returned — a fresh read sees it too.
		const reread = await getChatSession(created.id, opts);
		expect(reread?.outstandingAsks).toHaveLength(1);
	});

	it("dedupes by signalKey — a re-surfaced ASK replaces its prior entry, not doubles it", async () => {
		const opts = { rootDir: rootDir4 };
		const created = await createChatSession({ title: "T" }, opts);
		await addChatOutstandingAsk(created.id, { signalKey: "k1", taskId: "t1", question: "first?" }, opts);
		const second = await addChatOutstandingAsk(
			created.id,
			{ signalKey: "k1", taskId: "t1", question: "second?" },
			opts,
		);
		expect(second?.outstandingAsks).toEqual([{ signalKey: "k1", taskId: "t1", question: "second?" }]);
	});

	it("clearChatOutstandingAsk removes exactly the matching signalKey", async () => {
		const opts = { rootDir: rootDir4 };
		const created = await createChatSession({ title: "T" }, opts);
		await addChatOutstandingAsk(created.id, { signalKey: "k1", taskId: "t1", question: "a?" }, opts);
		await addChatOutstandingAsk(created.id, { signalKey: "k2", taskId: "t2", question: "b?" }, opts);
		const cleared = await clearChatOutstandingAsk(created.id, "k1", opts);
		expect(cleared?.outstandingAsks).toEqual([{ signalKey: "k2", taskId: "t2", question: "b?" }]);
	});

	it("deleteChatSessionsForWorkspace removes exactly the workspace's chats AND their transcripts", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-sessions-"));
		const transcriptRootDir = await mkdtemp(join(tmpdir(), "nklein-chat-transcripts-"));
		const now = () => 1_700_000_000_000;
		try {
			const opts = { rootDir, now };
			const owned = await createChatSession({ title: "proj chat", ownedWorkspaceId: "ws-gone" }, opts);
			const owned2 = await createChatSession({ title: "proj chat 2", ownedWorkspaceId: "ws-gone" }, opts);
			const other = await createChatSession({ title: "other project", ownedWorkspaceId: "ws-keep" }, opts);
			const global = await createChatSession({ title: "global chat" }, opts);
			await appendChatMessage(owned.id, { role: "user", content: "hi" }, { rootDir: transcriptRootDir });

			const deleted = await deleteChatSessionsForWorkspace("ws-gone", { rootDir, now, transcriptRootDir });
			expect(deleted.sort()).toEqual([owned.id, owned2.id].sort());

			const remaining = (await listChatSessions({ rootDir })).map((s) => s.id).sort();
			expect(remaining).toEqual([other.id, global.id].sort());
			// The deleted session's transcript is gone too (cleanup consistent in every detail).
			expect(await readChatTranscript(owned.id, { rootDir: transcriptRootDir })).toEqual([]);
		} finally {
			await rm(rootDir, { force: true, recursive: true });
			await rm(transcriptRootDir, { force: true, recursive: true });
		}
	});

	it("deleteChatSession drops the transcript alongside the session", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-sessions-"));
		const transcriptRootDir = await mkdtemp(join(tmpdir(), "nklein-chat-transcripts-"));
		const now = () => 1_700_000_000_000;
		try {
			const created = await createChatSession({ title: "t" }, { rootDir, now });
			await appendChatMessage(created.id, { role: "user", content: "hello" }, { rootDir: transcriptRootDir });
			expect(await deleteChatSession(created.id, { rootDir, now, transcriptRootDir })).toBe(true);
			expect(await getChatSession(created.id, { rootDir })).toBeNull();
			expect(await readChatTranscript(created.id, { rootDir: transcriptRootDir })).toEqual([]);
		} finally {
			await rm(rootDir, { force: true, recursive: true });
			await rm(transcriptRootDir, { force: true, recursive: true });
		}
	});
});
