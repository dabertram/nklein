import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendCardMailboxNote,
	composeMailboxPromptAddendum,
	consumeCardMailbox,
	countPendingCardMailbox,
	listPendingCardMailbox,
	markCardMailboxConsumedUpTo,
} from "../../../src/state/card-mailbox-store";

describe("card-mailbox-store", () => {
	let rootDir: string;
	let clock: number;
	const now = () => clock;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-card-mailbox-"));
		clock = 1000;
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("queues guidance notes per card, oldest first, isolated by taskId", async () => {
		await appendCardMailboxNote({ taskId: "a", text: "use postgres" }, { rootDir, now });
		clock = 1001;
		await appendCardMailboxNote({ taskId: "a", text: "and add an index", source: "stream" }, { rootDir, now });
		clock = 1002;
		await appendCardMailboxNote({ taskId: "b", text: "unrelated" }, { rootDir, now });

		const a = await listPendingCardMailbox("a", { rootDir });
		expect(a.map((n) => n.text)).toEqual(["use postgres", "and add an index"]);
		expect(a[1]?.source).toBe("stream");
		expect(await countPendingCardMailbox("a", { rootDir })).toBe(2);
		expect(await countPendingCardMailbox("b", { rootDir })).toBe(1);
		expect(await countPendingCardMailbox("missing", { rootDir })).toBe(0);
	});

	it("consume returns the pending notes and clears them (they don't resurface)", async () => {
		await appendCardMailboxNote({ taskId: "a", text: "note 1" }, { rootDir, now });
		clock = 1001;
		await appendCardMailboxNote({ taskId: "a", text: "note 2" }, { rootDir, now });

		clock = 2000;
		const consumed = await consumeCardMailbox("a", { rootDir, now });
		expect(consumed.map((n) => n.text)).toEqual(["note 1", "note 2"]);
		// Cleared across a fresh read.
		expect(await listPendingCardMailbox("a", { rootDir })).toEqual([]);
		expect(await countPendingCardMailbox("a", { rootDir })).toBe(0);
	});

	it("a note queued AFTER a consume is still pending (guidance keeps flowing)", async () => {
		await appendCardMailboxNote({ taskId: "a", text: "before" }, { rootDir, now });
		clock = 2000;
		await consumeCardMailbox("a", { rootDir, now });
		clock = 3000;
		await appendCardMailboxNote({ taskId: "a", text: "after" }, { rootDir, now });

		expect((await listPendingCardMailbox("a", { rootDir })).map((n) => n.text)).toEqual(["after"]);
	});

	it("consume on an empty mailbox is a no-op (returns nothing, writes no consume marker)", async () => {
		expect(await consumeCardMailbox("nobody", { rootDir, now })).toEqual([]);
		// A later note is unaffected.
		clock = 5000;
		await appendCardMailboxNote({ taskId: "nobody", text: "hi" }, { rootDir, now });
		expect(await countPendingCardMailbox("nobody", { rootDir })).toBe(1);
	});
});

describe("composeMailboxPromptAddendum", () => {
	it("renders queued notes as an operator-guidance addendum, empty for none", () => {
		expect(composeMailboxPromptAddendum([])).toBe("");
		const addendum = composeMailboxPromptAddendum([
			{ schemaVersion: 1, id: "n1", taskId: "t", text: "prefer zod", source: "chat", createdAt: 1 },
			{ schemaVersion: 1, id: "n2", taskId: "t", text: "keep the API stable", source: "chat", createdAt: 2 },
		]);
		expect(addendum).toContain("Operator guidance queued while this card waited");
		expect(addendum).toContain("- prefer zod");
		expect(addendum).toContain("- keep the API stable");
	});
});

describe("markCardMailboxConsumedUpTo (§5.BF fix — consume only after a successful start)", () => {
	let rootDir2: string;
	beforeEach(async () => {
		rootDir2 = await mkdtemp(join(tmpdir(), "nklein-card-mailbox-uptoc-"));
	});
	afterEach(async () => {
		await rm(rootDir2, { recursive: true, force: true }).catch(() => undefined);
	});

	it("consumes notes AT OR BEFORE the timestamp and LEAVES newer ones pending (the start-window race)", async () => {
		const opts = { rootDir: rootDir2 };
		const n1 = await appendCardMailboxNote({ taskId: "t", text: "one" }, { ...opts, now: () => 1000 });
		const n2 = await appendCardMailboxNote({ taskId: "t", text: "two" }, { ...opts, now: () => 2000 });
		// A third note arrives DURING the (simulated) start window, after we read [n1, n2].
		await appendCardMailboxNote({ taskId: "t", text: "three" }, { ...opts, now: () => 3000 });
		// Consume up to the newest note we actually READ (n2).
		await markCardMailboxConsumedUpTo("t", n2.createdAt, opts);
		const stillPending = await listPendingCardMailbox("t", opts);
		expect(stillPending.map((note) => note.text)).toEqual(["three"]);
		expect(n1.createdAt).toBeLessThan(n2.createdAt);
	});

	it("is a no-op for a non-finite timestamp (defensive)", async () => {
		const opts = { rootDir: rootDir2 };
		await appendCardMailboxNote({ taskId: "t", text: "keep" }, { ...opts, now: () => 1000 });
		await markCardMailboxConsumedUpTo("t", Number.NaN, opts);
		expect(await countPendingCardMailbox("t", opts)).toBe(1);
	});

	it("a FAILED start (notes read but never consumed) leaves guidance pending for the next attempt", async () => {
		const opts = { rootDir: rootDir2 };
		await appendCardMailboxNote({ taskId: "t", text: "prefer streaming parser" }, { ...opts, now: () => 1000 });
		// Simulate the fixed start path: read non-destructively, then the start THROWS -> we never mark consumed.
		const read = await listPendingCardMailbox("t", opts);
		expect(read).toHaveLength(1);
		// (no markCardMailboxConsumedUpTo call — the start failed)
		expect(await countPendingCardMailbox("t", opts)).toBe(1); // still there for the retry
	});
});
