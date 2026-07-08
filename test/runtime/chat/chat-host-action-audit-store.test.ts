import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readChatHostActionAudit, recordChatHostAction } from "../../../src/chat/chat-host-action-audit-store";

describe("chat-host-action-audit-store", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-audit-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("records a host action with its policy decision + confirmation + execution flags", async () => {
		const entry = await recordChatHostAction(
			{
				sessionId: "s1",
				mode: "host",
				action: "host_command",
				decision: "confirm",
				confirmed: true,
				executed: true,
				detail: "rm -rf build",
			},
			{ rootDir, now: () => 5 },
		);
		expect(entry).toMatchObject({
			sessionId: "s1",
			action: "host_command",
			decision: "confirm",
			confirmed: true,
			executed: true,
			detail: "rm -rf build",
			recordedAt: 5,
		});
		expect(entry.id).toBeTruthy();
	});

	it("defaults confirmed/executed to false and detail to null", async () => {
		const entry = await recordChatHostAction(
			{ sessionId: "s1", mode: "isolated_readonly", action: "egress_read", decision: "deny" },
			{ rootDir },
		);
		const readback = await readChatHostActionAudit({ rootDir });
		expect(entry).toMatchObject({ action: "egress_read", confirmed: false, executed: false, detail: null });
		expect(readback[0]).toMatchObject({ action: "egress_read", decision: "deny" });
	});

	it("reads back newest-first, filtered by session, with an optional limit", async () => {
		await recordChatHostAction(
			{ sessionId: "s1", mode: "host", action: "host_read", decision: "allow" },
			{ rootDir, now: () => 10 },
		);
		await recordChatHostAction(
			{ sessionId: "s2", mode: "host", action: "host_read", decision: "allow" },
			{ rootDir, now: () => 20 },
		);
		await recordChatHostAction(
			{ sessionId: "s1", mode: "host", action: "host_write", decision: "confirm", confirmed: true, executed: true },
			{ rootDir, now: () => 30 },
		);

		const s1 = await readChatHostActionAudit({ rootDir, sessionId: "s1" });
		expect(s1.map((entry) => entry.recordedAt)).toEqual([30, 10]);

		const all = await readChatHostActionAudit({ rootDir });
		expect(all.map((entry) => entry.recordedAt)).toEqual([30, 20, 10]);

		const recent = await readChatHostActionAudit({ rootDir, limit: 1 });
		expect(recent.map((entry) => entry.recordedAt)).toEqual([30]);

		expect(await readChatHostActionAudit({ rootDir, sessionId: "missing" })).toEqual([]);
	});
});
