import { describe, expect, it } from "vitest";
import { agentLedgerEventSchema } from "../../../src/core/agent-attempt-ledger";
import { buildChatAttemptEvent } from "../../../src/nklein-agent/nklein-ledger-chat-attempt";

const base = {
	sessionId: "sess-1",
	workspacePath: "/Users/me/proj",
	providerId: "lmstudio",
	modelId: "qwen/qwen3-8b",
	endpoint: "http://127.0.0.1:1234/v1",
	startedAt: 1000,
	endedAt: 4000,
};

describe("buildChatAttemptEvent", () => {
	it("builds a valid attempt event with flow=chat, canonical model id, and the executed tool calls", () => {
		const event = buildChatAttemptEvent({
			...base,
			hitIterationLimit: false,
			toolCalls: [
				{ name: "read_file", fingerprint: "fp-1", outcome: null },
				{ name: "create_card", fingerprint: "fp-2", outcome: null },
			],
		});
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
		expect(event.kind).toBe("attempt");
		expect(event.flow).toBe("chat");
		expect(event.workflowId).toBe("sess-1");
		// Endpoint is canonicalized (127.0.0.1 → localhost) — same key shape as the terminal writer, so chat + task
		// attempts for one model group together in the projections.
		expect(event.modelId).toBe("lmstudio:qwen/qwen3-8b:http://localhost:1234/v1");
		expect(event.toolCalls.map((c) => c.name)).toEqual(["read_file", "create_card"]);
		// workspace path is hashed, never stored raw.
		expect(event.workspacePathHash).not.toContain("/Users/me");
		expect(event.workspacePathHash.length).toBeGreaterThan(0);
	});

	it("a completed turn is `success` (qualityOk true); an iteration-capped turn is `loop`", () => {
		expect(buildChatAttemptEvent({ ...base, hitIterationLimit: false, toolCalls: [] }).outcome).toBe("success");
		expect(buildChatAttemptEvent({ ...base, hitIterationLimit: false, toolCalls: [] }).qualityOk).toBe(true);
		const looped = buildChatAttemptEvent({ ...base, hitIterationLimit: true, toolCalls: [] });
		expect(looped.outcome).toBe("loop");
		expect(looped.qualityOk).toBe(false);
	});

	it("stamps flow=autonomous (and the attemptId prefix) when the turn is an autonomous run", () => {
		const event = buildChatAttemptEvent({ ...base, flow: "autonomous", hitIterationLimit: false, toolCalls: [] });
		expect(event.flow).toBe("autonomous");
		expect(event.attemptId.startsWith("autonomous:")).toBe(true);
	});

	it("hashes a null workspace path to the shared 'unknown' bucket (board-independent chat)", () => {
		const event = buildChatAttemptEvent({ ...base, workspacePath: null, hitIterationLimit: false, toolCalls: [] });
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
		expect(event.workspacePathHash.length).toBeGreaterThan(0);
	});
});
