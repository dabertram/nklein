import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readChatEgressAttemptAudit, recordChatEgressAttempt } from "../../../src/chat/chat-egress-attempt-audit-store";

describe("chat-egress-attempt-audit-store", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-egress-audit-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("records a URL egress attempt with confirmation/execution flags and normalized host", async () => {
		const entry = await recordChatEgressAttempt(
			{
				sessionId: "s1",
				mode: "host",
				toolName: "browse_url",
				action: "egress_read",
				decision: "confirm",
				confirmed: true,
				executed: true,
				targetKind: "url",
				target: "https://Example.com./docs",
				detail: "https://Example.com./docs",
			},
			{ rootDir, now: () => 5 },
		);
		expect(entry).toMatchObject({
			sessionId: "s1",
			toolName: "browse_url",
			action: "egress_read",
			decision: "confirm",
			confirmed: true,
			executed: true,
			targetKind: "url",
			target: "https://Example.com./docs",
			host: "example.com",
			detail: "https://Example.com./docs",
			recordedAt: 5,
		});
		expect(entry.id).toBeTruthy();
	});

	it("records web-search egress attempts without pretending the query is a host", async () => {
		const entry = await recordChatEgressAttempt(
			{
				sessionId: "s1",
				mode: "sandbox_with_host_escape",
				toolName: "web_search",
				action: "egress_read",
				decision: "confirm",
				confirmed: false,
				executed: false,
				targetKind: "search_query",
				target: "nklein release signing",
				detail: "web_search: nklein release signing",
			},
			{ rootDir },
		);
		expect(entry).toMatchObject({
			toolName: "web_search",
			targetKind: "search_query",
			target: "nklein release signing",
			host: null,
			executed: false,
		});
	});

	it("reads back newest-first, filtered by session, with an optional limit", async () => {
		await recordChatEgressAttempt(
			{
				sessionId: "s1",
				mode: "host",
				toolName: "browse_url",
				action: "egress_read",
				decision: "confirm",
				confirmed: true,
				executed: true,
				targetKind: "url",
				target: "https://a.example",
				detail: "https://a.example",
			},
			{ rootDir, now: () => 10 },
		);
		await recordChatEgressAttempt(
			{
				sessionId: "s2",
				mode: "host",
				toolName: "browse_url",
				action: "egress_read",
				decision: "confirm",
				confirmed: false,
				executed: false,
				targetKind: "url",
				target: "https://b.example",
				detail: "https://b.example",
			},
			{ rootDir, now: () => 20 },
		);
		await recordChatEgressAttempt(
			{
				sessionId: "s1",
				mode: "sandbox_with_host_escape",
				toolName: "web_search",
				action: "egress_read",
				decision: "confirm",
				confirmed: true,
				executed: true,
				targetKind: "search_query",
				target: "docs",
				detail: "web_search: docs",
			},
			{ rootDir, now: () => 30 },
		);

		const s1 = await readChatEgressAttemptAudit({ rootDir, sessionId: "s1" });
		expect(s1.map((entry) => entry.recordedAt)).toEqual([30, 10]);

		const all = await readChatEgressAttemptAudit({ rootDir });
		expect(all.map((entry) => entry.recordedAt)).toEqual([30, 20, 10]);

		const recent = await readChatEgressAttemptAudit({ rootDir, limit: 1 });
		expect(recent.map((entry) => entry.recordedAt)).toEqual([30]);

		expect(await readChatEgressAttemptAudit({ rootDir, sessionId: "missing" })).toEqual([]);
	});
});
