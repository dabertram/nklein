import { describe, expect, it } from "vitest";
import {
	deriveToolCallCommandLine,
	extractTerminalToolCalls,
} from "../../../src/nklein-agent/nklein-ledger-tool-calls";
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

function nestedFailedToolResult(toolUseId: string): NKleinSdkPersistedMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name: "run_commands",
				content: [
					{
						type: "text",
						text: JSON.stringify({ query: "npm test", result: "", error: "exit 1", success: false }),
					},
				],
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

	it("marks a structured nested command failure as error even when top-level is_error is absent", () => {
		const calls = extractTerminalToolCalls([
			toolUse("u1", "run_commands", { commands: ["npm test"] }),
			nestedFailedToolResult("u1"),
		]);
		expect(calls[0]).toMatchObject({ outcome: "error", resultSummary: expect.stringContaining('"success":false') });
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

describe("deriveToolCallCommandLine (P21.13c — the ledger answers 'what did it actually RUN?')", () => {
	it("extracts the command string across exec-tool naming conventions, whitespace-collapsed", () => {
		expect(deriveToolCallCommandLine({ command: "npm  test\n--silent" })).toBe("npm test --silent");
		expect(deriveToolCallCommandLine({ cmd: " ls -la " })).toBe("ls -la");
		expect(deriveToolCallCommandLine({ argv: ["git", "status", "--porcelain"] })).toBe("git status --porcelain");
		expect(deriveToolCallCommandLine({ commands: ["npm ci", "npm test"] })).toBe("npm ci && npm test");
	});
	it("yields null for non-exec tools and caps runaway command lines", () => {
		expect(deriveToolCallCommandLine({ path: "a.ts", content: "x" })).toBeNull();
		expect(deriveToolCallCommandLine(null)).toBeNull();
		const capped = deriveToolCallCommandLine({ command: "x".repeat(1_000) });
		expect(capped?.length).toBeLessThanOrEqual(501);
		expect(capped?.endsWith("…")).toBe(true);
	});
	it("rides onto the attempt tool-call record for exec calls only", () => {
		const calls = extractTerminalToolCalls([
			toolUse("u1", "execute_command", { command: "npm test" }),
			toolUse("u2", "read_files", { files: [{ path: "a.ts" }] }),
		]);
		expect(calls[0]?.commandLine).toBe("npm test");
		expect(calls[1]?.commandLine).toBeUndefined();
	});
});
