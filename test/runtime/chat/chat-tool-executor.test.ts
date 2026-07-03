import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../../../src/chat/chat-agent-loop";
import {
	type ChatTool,
	type ChatToolAuditRecord,
	createGatedChatToolExecutor,
} from "../../../src/chat/chat-tool-executor";
import type { LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";

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

	// -------------------------------------------------------------------------
	// Audit detail — records meaningful summaries, not just tool names
	// -------------------------------------------------------------------------

	it("audit detail: records the actual command for run_command, not just the tool name", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "run_command",
					actionKind: "sandbox_read",
					run: async () => "ok",
				},
			],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		await exec(call("run_command", { command: "npm test" }));
		expect(audit[0].detail).toBe("npm test");
		expect(audit[0].detail).not.toBe("run_command");
	});

	it("audit detail: records the URL for browse_url, not just the tool name", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "browse_url",
					actionKind: "sandbox_read",
					run: async () => "ok",
				},
			],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		await exec(call("browse_url", { url: "https://example.com/docs" }));
		expect(audit[0].detail).toBe("https://example.com/docs");
		expect(audit[0].detail).not.toBe("browse_url");
	});

	it("audit detail: records the workspace-relative path for write_file, not just the tool name", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "write_file",
					actionKind: "sandbox_write",
					run: async () => "ok",
				},
			],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		await exec(call("write_file", { path: "src/utils.ts", content: "export {}" }));
		expect(audit[0].detail).toBe("write_file: src/utils.ts");
		expect(audit[0].detail).not.toBe("write_file");
	});

	it("audit detail: redacts a secret in a run_command argument", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "run_command",
					actionKind: "sandbox_read",
					run: async () => "ok",
				},
			],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		await exec(call("run_command", { command: "deploy --token=supersecretvalue123 --env=prod" }));
		expect(audit[0].detail).not.toContain("supersecretvalue123");
		expect(audit[0].detail).toContain("--token=…");
		// Non-secret flags are preserved
		expect(audit[0].detail).toContain("--env=prod");
	});

	it("audit detail: does not leak a host-absolute path for write_file", async () => {
		const audit: ChatToolAuditRecord[] = [];
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "write_file",
					actionKind: "sandbox_write",
					run: async () => "ok",
				},
			],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		await exec(call("write_file", { path: "/private/tmp/nklein-xyz/src/app.ts", content: "x" }));
		// Falls back to tool name — never the host path
		expect(audit[0].detail).toBe("write_file");
		expect(audit[0].detail).not.toContain("/private");
	});

	// -------------------------------------------------------------------------
	// §5.AA tool-argument repair — opt-in schema coercion before tool.run
	// -------------------------------------------------------------------------

	// A tool whose schema declares a strict required `count: number`. Only present when `definitions` is passed.
	const countToolDefinition: LocalLlmToolDefinition = {
		name: "set_count",
		description: "set the count",
		parameters: {
			type: "object",
			properties: { count: { type: "number" } },
			required: ["count"],
		},
	};

	it("repairs a stringified number against the schema and runs with the coerced value", async () => {
		const audit: ChatToolAuditRecord[] = [];
		let received: Record<string, unknown> | undefined;
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "set_count",
					actionKind: "sandbox_read",
					run: async (args) => {
						received = args;
						return "ok";
					},
				},
			],
			definitions: [countToolDefinition],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		const result = await exec(call("set_count", { count: "3" }));
		// The tool ran, and got the COERCED numeric value — not the raw "3".
		expect(received).toEqual({ count: 3 });
		expect(received?.count).toBe(3);
		expect(typeof received?.count).toBe("number");
		expect(result.content).toBe("ok");
		expect(audit[0]).toMatchObject({ executed: true, decision: "allow" });
	});

	it("refuses an un-coercible required value: does not run and flags the field to re-ask", async () => {
		const audit: ChatToolAuditRecord[] = [];
		let ran = false;
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "set_count",
					actionKind: "sandbox_read",
					run: async () => {
						ran = true;
						return "ok";
					},
				},
			],
			definitions: [countToolDefinition],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		const result = await exec(call("set_count", { count: "abc" }));
		// The tool was NOT run, and the result names `count` as needing a re-ask.
		expect(ran).toBe(false);
		expect(result.content).toContain("count");
		expect(result.content.toLowerCase()).toContain("re-ask");
		// A refused-before-dispatch call is not audited as an execution.
		expect(audit).toHaveLength(0);
	});

	it("passes already-valid args through unchanged when a matching definition is supplied", async () => {
		const audit: ChatToolAuditRecord[] = [];
		let received: Record<string, unknown> | undefined;
		const exec = createGatedChatToolExecutor({
			sessionId: "s1",
			mode: "isolated_readonly",
			tools: [
				{
					name: "set_count",
					actionKind: "sandbox_read",
					run: async (args) => {
						received = args;
						return "ok";
					},
				},
			],
			definitions: [countToolDefinition],
			recordAudit: async (record) => {
				audit.push(record);
			},
		});
		const result = await exec(call("set_count", { count: 5 }));
		expect(received).toEqual({ count: 5 });
		expect(result.content).toBe("ok");
		expect(audit[0]).toMatchObject({ executed: true });
	});
});
