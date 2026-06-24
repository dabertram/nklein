import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../../../src/chat/chat-agent-loop";
import {
	type ChatTool,
	type ChatToolAuditRecord,
	createGatedChatToolExecutor,
} from "../../../src/chat/chat-tool-executor";

function call(name: string, args: Record<string, unknown> = {}): ChatToolCall {
	return { id: "c1", name, arguments: args };
}

const sandboxReadTool: ChatTool = { name: "read_file", actionKind: "sandbox_read", run: async () => "file body" };
const hostCommandTool: ChatTool = { name: "run_host", actionKind: "host_command", run: async () => "ran" };

describe("createGatedChatToolExecutor", () => {
	it("runs an allowed tool and audits the execution", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [sandboxReadTool],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		const result = await exec(call("read_file"));
		expect(result.content).toBe("file body");
		expect(audit[0]).toMatchObject({ action: "sandbox_read", decision: "allow", executed: true, confirmed: false });
	});

	it("denies a host command in isolated mode without running it", async () => {
		const audit: ChatToolAuditRecord[] = [];
		let ran = false;
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					...hostCommandTool,
					run: async () => {
						ran = true;
						return "ran";
					},
				},
			],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		const result = await exec(call("run_host"));
		expect(ran).toBe(false);
		expect(result.content).toContain("Denied");
		expect(audit[0]).toMatchObject({ decision: "deny", executed: false });
	});

	it("runs a confirm-gated host command only when confirmed, auditing both outcomes", async () => {
		const audit: ChatToolAuditRecord[] = [];
		let runs = 0;
		const make = (confirm: boolean) =>
			createGatedChatToolExecutor({
				sessionId: "s1",
				mode: "host",
				tools: [
					{
						...hostCommandTool,
						run: async () => {
							runs++;
							return "ran";
						},
					},
				],
				confirm: async () => confirm,
				recordAudit: async (record) => {
					audit.push(record);
				},
			});

		const declined = await make(false)(call("run_host"));
		expect(declined.content).toContain("awaiting confirmation");
		expect(audit[0]).toMatchObject({ decision: "confirm", confirmed: false, executed: false });

		const approved = await make(true)(call("run_host"));
		expect(approved.content).toBe("ran");
		expect(runs).toBe(1);
		expect(audit[1]).toMatchObject({ decision: "confirm", confirmed: true, executed: true });
	});

	it("reports an unknown tool without auditing", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "host",
			tools: [sandboxReadTool],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		const result = await exec(call("nope"));
		expect(result.content).toContain("Unknown tool");
		expect(audit).toHaveLength(0);
	});
});
