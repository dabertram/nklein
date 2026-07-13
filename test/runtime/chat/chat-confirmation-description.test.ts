import { describe, expect, it } from "vitest";
import {
	describeHostActionConfirmation,
	filterChatHostActionAudit,
} from "../../../src/chat/chat-confirmation-description";
import type { ChatHostActionAuditEntry } from "../../../src/chat/chat-host-action-audit-store";

/**
 * F2.12 — the typed confirmation names action/target/scope/consequence/duration (target byte-identical to the
 * F2.2 grant scope), and the audit history projection filters by action/decision/time/text/executed.
 */

describe("describeHostActionConfirmation", () => {
	it("names all five fields for a host command, with the target matching the grant scope", () => {
		const description = describeHostActionConfirmation({
			toolName: "run_command",
			actionKind: "host_command",
			args: { command: "npm test" },
		});
		expect(description).toMatchObject({
			action: "Host command",
			target: "npm test",
			scope: "your host machine",
			duration: "15 minutes for this exact target",
		});
		expect(description.consequence).toContain("YOUR machine");
		expect(description.headline).toBe("Host command: npm test");
	});

	it("network fetches name the host as target and the network as scope", () => {
		const description = describeHostActionConfirmation({
			toolName: "browse_url",
			actionKind: "egress_read",
			args: { url: "https://api.example.com/x" },
		});
		expect(description.target).toBe("api.example.com");
		expect(description.scope).toContain("network");
		expect(description.consequence).toContain("allowlist");
	});
});

describe("filterChatHostActionAudit", () => {
	function entry(overrides: Partial<ChatHostActionAuditEntry>): ChatHostActionAuditEntry {
		return {
			schemaVersion: 1,
			id: "a",
			sessionId: "s1",
			mode: "host",
			action: "host_command",
			decision: "confirm",
			confirmed: true,
			executed: true,
			detail: "run_command: npm test",
			recordedAt: 1_000,
			...overrides,
		};
	}

	it("filters by action, decision, time, text, and executed — newest first", () => {
		const entries = [
			entry({ id: "old", recordedAt: 500, detail: "run_command: npm build" }),
			entry({ id: "denied", decision: "deny", executed: false, recordedAt: 2_000 }),
			entry({ id: "recent", recordedAt: 3_000 }),
			entry({ id: "read", action: "host_read", recordedAt: 4_000, detail: "read_file: /tmp/x" }),
		];
		expect(filterChatHostActionAudit(entries, { action: "host_command", sinceMs: 1_000 }).map((e) => e.id)).toEqual([
			"recent",
			"denied",
		]);
		expect(filterChatHostActionAudit(entries, { decision: "deny" }).map((e) => e.id)).toEqual(["denied"]);
		expect(filterChatHostActionAudit(entries, { contains: "NPM BUILD" }).map((e) => e.id)).toEqual(["old"]);
		expect(filterChatHostActionAudit(entries, { executed: false }).map((e) => e.id)).toEqual(["denied"]);
		expect(filterChatHostActionAudit(entries).map((e) => e.id)).toEqual(["read", "recent", "denied", "old"]);
	});
});
