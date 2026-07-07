import { describe, expect, it } from "vitest";

import { recoverRedundantSandboxToolPath } from "../../../src/nklein-agent/nklein-agent-sandbox";
import { AGENT_SANDBOX_EXTRA_TOOL_RUNNER } from "../../../src/nklein-agent/nklein-agent-sandbox-extra-tools";

// §5.O recovery dispatch at the sandbox tool boundary: a model that mistakes its cwd (the sandbox workdir) for the repo
// root emits a redundant relative `workspaces/<taskId>/` prefix; this strips it across both proxy shapes so the write
// lands correctly. Exercises the exact shapes runTool sees (SDK editor/readFile vs. the kanbanExtraTool proxy).

const taskId = "verify-completion-1";

describe("recoverRedundantSandboxToolPath", () => {
	it("recovers the SDK editor path (input.path)", () => {
		const input = { command: "create", path: "workspaces/verify-completion-1/hello.txt", file_text: "hi" };
		expect(recoverRedundantSandboxToolPath("editor", input, taskId)).toEqual({
			command: "create",
			path: "hello.txt",
			file_text: "hi",
		});
	});

	it("recovers the SDK readFile path (input.path)", () => {
		const input = { path: "workspaces/verify-completion-1/src/app.ts" };
		expect(recoverRedundantSandboxToolPath("readFile", input, taskId)).toEqual({ path: "src/app.ts" });
	});

	it("recovers a proxied single-file tool (write_file → input.input.path)", () => {
		const input = {
			toolName: "write_file",
			input: { path: "workspaces/verify-completion-1/hello.txt", content: "x" },
		};
		expect(recoverRedundantSandboxToolPath(AGENT_SANDBOX_EXTRA_TOOL_RUNNER, input, taskId)).toEqual({
			toolName: "write_file",
			input: { path: "hello.txt", content: "x" },
		});
	});

	it("recovers a proxied multi-file tool (write_files → input.input.files[].path)", () => {
		const input = {
			toolName: "write_files",
			input: {
				files: [
					{ path: "workspaces/verify-completion-1/a.ts", content: "a" },
					{ path: "b.ts", content: "b" },
				],
			},
		};
		expect(recoverRedundantSandboxToolPath(AGENT_SANDBOX_EXTRA_TOOL_RUNNER, input, taskId)).toEqual({
			toolName: "write_files",
			input: {
				files: [
					{ path: "a.ts", content: "a" },
					{ path: "b.ts", content: "b" },
				],
			},
		});
	});

	it("leaves an absolute /workspaces/<taskId>/ path untouched (same reference)", () => {
		const input = {
			toolName: "write_file",
			input: { path: "/workspaces/verify-completion-1/hello.txt", content: "x" },
		};
		expect(recoverRedundantSandboxToolPath(AGENT_SANDBOX_EXTRA_TOOL_RUNNER, input, taskId)).toBe(input);
	});

	it("leaves a correct root-relative path untouched (same reference)", () => {
		const input = { command: "create", path: "hello.txt" };
		expect(recoverRedundantSandboxToolPath("editor", input, taskId)).toBe(input);
	});

	it("leaves a non-path tool (bash) untouched (same reference)", () => {
		const input = { command: "ls workspaces/verify-completion-1" };
		expect(recoverRedundantSandboxToolPath("bash", input, taskId)).toBe(input);
	});

	it("does not strip a different task's prefix", () => {
		const input = { toolName: "write_file", input: { path: "workspaces/other-task/hello.txt", content: "x" } };
		expect(recoverRedundantSandboxToolPath(AGENT_SANDBOX_EXTRA_TOOL_RUNNER, input, taskId)).toBe(input);
	});
});
