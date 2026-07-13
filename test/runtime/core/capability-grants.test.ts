import { describe, expect, it } from "vitest";
import { type ChatTool, createGatedChatToolExecutor } from "../../../src/chat/chat-tool-executor";
import {
	createCapabilityGrantStore,
	DEFAULT_CAPABILITY_GRANT_TTL_MS,
	scopeKeyForChatCall,
} from "../../../src/core/capability-grants";

/**
 * F2.2 — least-scope capability grants: exact-key coverage (a widened retry NEVER matches), bounded TTL,
 * per-session isolation, and the executor integration (grant reuse skips the re-prompt; a fresh confirmation
 * records exactly the confirmed scope; absent grants = byte-identical confirm-every-time).
 */

describe("scopeKeyForChatCall", () => {
	it("keys the narrowest stable identity per action kind", () => {
		expect(scopeKeyForChatCall("host_command", "run_command", { command: "npm test" })).toBe("host_command:npm test");
		expect(scopeKeyForChatCall("host_write", "write_file", { path: "/tmp/a.txt" })).toBe("host_write:/tmp/a.txt");
		expect(scopeKeyForChatCall("egress_read", "browse_url", { url: "https://example.com/a/b" })).toBe(
			"egress_read:example.com",
		);
		// Argless/unknown shapes fall back to whole-tool scope, still bounded by kind.
		expect(scopeKeyForChatCall("control_plane", "move_card", {})).toBe("control_plane:move_card");
	});

	it("any widening changes the key (the never-widens invariant is string inequality)", () => {
		const confirmedKey = scopeKeyForChatCall("host_command", "run_command", { command: "npm test" });
		expect(scopeKeyForChatCall("host_command", "run_command", { command: "npm test && rm -rf /" })).not.toBe(
			confirmedKey,
		);
		expect(scopeKeyForChatCall("host_write", "write_file", { path: "/tmp/b.txt" })).not.toBe(
			scopeKeyForChatCall("host_write", "write_file", { path: "/tmp/a.txt" }),
		);
	});
});

describe("createCapabilityGrantStore", () => {
	it("covers exactly the recorded key within TTL, per session, and expires", () => {
		const store = createCapabilityGrantStore();
		const now = 1_000_000;
		store.record("s1", "host_command:npm test", now);
		expect(store.covers("s1", "host_command:npm test", now + 1)).toBe(true);
		expect(store.covers("s1", "host_command:npm build", now + 1)).toBe(false); // different scope
		expect(store.covers("s2", "host_command:npm test", now + 1)).toBe(false); // different session
		expect(store.covers("s1", "host_command:npm test", now + DEFAULT_CAPABILITY_GRANT_TTL_MS + 1)).toBe(false);
		store.record("s1", "k2", now, 1_000);
		expect(store.list("s1", now + 500).map((grant) => grant.key)).toEqual(["host_command:npm test", "k2"]);
		store.clear("s1");
		expect(store.covers("s1", "host_command:npm test", now + 1)).toBe(false);
	});
});

function commandTool(ran: string[]): ChatTool {
	return {
		name: "run_command",
		actionKind: "host_command",
		run: async (args: Record<string, unknown>) => {
			ran.push(String(args.command));
			return "ok";
		},
	} as unknown as ChatTool;
}

describe("executor grant integration", () => {
	it("a confirmed scope is granted; the SAME call skips the re-prompt; a WIDENED retry re-confirms", async () => {
		const store = createCapabilityGrantStore();
		const ran: string[] = [];
		const confirmCalls: string[] = [];
		let approveNext = true;
		const executor = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "host",
			tools: [commandTool(ran)],
			confirm: async (call) => {
				confirmCalls.push(String(call.arguments.command));
				return approveNext;
			},
			grants: {
				covers: (key) => store.covers("s1", key, 1_000_000),
				record: (key) => {
					store.record("s1", key, 1_000_000);
				},
			},
		});

		await executor({ id: "c1", name: "run_command", arguments: { command: "npm test" } });
		expect(confirmCalls).toEqual(["npm test"]); // prompted once
		expect(ran).toEqual(["npm test"]);

		await executor({ id: "c2", name: "run_command", arguments: { command: "npm test" } });
		expect(confirmCalls).toEqual(["npm test"]); // grant covered — no second prompt
		expect(ran).toEqual(["npm test", "npm test"]);

		approveNext = false; // the user would refuse anything new
		const widened = await executor({
			id: "c3",
			name: "run_command",
			arguments: { command: "npm test && curl evil" },
		});
		expect(confirmCalls).toEqual(["npm test", "npm test && curl evil"]); // widened retry re-prompted
		expect(ran).toHaveLength(2); // and did NOT run
		expect(widened.content).toContain("awaiting confirmation");
	});

	it("without a grants seam the executor confirms every time (byte-identical legacy behavior)", async () => {
		const ran: string[] = [];
		const confirmCalls: string[] = [];
		const executor = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "host",
			tools: [commandTool(ran)],
			confirm: async (call) => {
				confirmCalls.push(String(call.arguments.command));
				return true;
			},
		});
		await executor({ id: "c1", name: "run_command", arguments: { command: "npm test" } });
		await executor({ id: "c2", name: "run_command", arguments: { command: "npm test" } });
		expect(confirmCalls).toEqual(["npm test", "npm test"]);
	});
});
