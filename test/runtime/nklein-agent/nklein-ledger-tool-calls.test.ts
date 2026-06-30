import { describe, expect, it } from "vitest";
import { extractTerminalToolCalls } from "../../../src/nklein-agent/nklein-ledger-tool-calls";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";

function toolUse(id: string, name: string, input: Record<string, unknown>): NKleinSdkPersistedMessage {
	return { role: "assistant", content: [{ type: "tool_use", id, name, input }] };
}

function toolResult(toolUseId: string, isError = false): NKleinSdkPersistedMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name: "run_command",
				content: "result",
				...(isError ? { is_error: true } : {}),
			},
		],
	};
}

describe("extractTerminalToolCalls", () => {
	it("records each tool call with name + input fingerprint + success outcome, in order", () => {
		const calls = extractTerminalToolCalls([
			toolUse("u1", "read_files", { files: [{ path: "a.ts" }] }),
			toolResult("u1"),
			toolUse("u2", "run_command", { command: "ls" }),
			toolResult("u2"),
		]);
		expect(calls.map((call) => call.name)).toEqual(["read_files", "run_command"]);
		expect(calls.map((call) => call.outcome)).toEqual(["success", "success"]);
		expect(calls[0]?.fingerprint).toBeTruthy();
	});

	it("marks a call whose tool_result is an error as 'error'", () => {
		const calls = extractTerminalToolCalls([
			toolUse("u1", "run_command", { command: "boom" }),
			toolResult("u1", true),
		]);
		expect(calls[0]?.outcome).toBe("error");
	});

	it("leaves a call with no tool_result outcome null (the run ended before it completed)", () => {
		const calls = extractTerminalToolCalls([toolUse("u1", "run_command", { command: "hang" })]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.outcome).toBeNull();
	});

	it("ignores string-content messages and yields no calls when there are none", () => {
		expect(
			extractTerminalToolCalls([
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi there" },
			]),
		).toEqual([]);
	});

	it("fingerprints identical inputs the same and different inputs differently", () => {
		const calls = extractTerminalToolCalls([
			toolUse("u1", "read_files", { files: [{ path: "a.ts" }] }),
			toolUse("u2", "read_files", { files: [{ path: "a.ts" }] }),
			toolUse("u3", "read_files", { files: [{ path: "b.ts" }] }),
		]);
		expect(calls[0]?.fingerprint).toBe(calls[1]?.fingerprint);
		expect(calls[0]?.fingerprint).not.toBe(calls[2]?.fingerprint);
	});
});
