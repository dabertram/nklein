import type { AgentToolContext } from "@clinebot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveShellExecution, runClineAcceptanceGateInSandbox } from "../../../src/cline-sdk/cline-acceptance-gate";
import {
	type AgentSandboxExecResult,
	type AgentSandboxManager,
	createAgentSandboxToolExecutors,
} from "../../../src/cline-sdk/cline-agent-sandbox";

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(() => {
		throw new Error("Host child_process.execFile must not run for sandboxed agent execution.");
	}),
}));
const fsPromisesMocks = vi.hoisted(() => ({
	appendFile: vi.fn(),
	mkdir: vi.fn(),
	readdir: vi.fn(async () => []),
	readFile: vi.fn(async () => ""),
	rm: vi.fn(),
	unlink: vi.fn(),
	writeFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: childProcessMocks.execFile,
}));
vi.mock("node:fs/promises", () => ({
	appendFile: fsPromisesMocks.appendFile,
	mkdir: fsPromisesMocks.mkdir,
	readdir: fsPromisesMocks.readdir,
	readFile: fsPromisesMocks.readFile,
	rm: fsPromisesMocks.rm,
	unlink: fsPromisesMocks.unlink,
	writeFile: fsPromisesMocks.writeFile,
}));

function createToolContext(): AgentToolContext {
	return {} as AgentToolContext;
}

describe("sandbox no-host-execution guard", () => {
	beforeEach(() => {
		childProcessMocks.execFile.mockClear();
		fsPromisesMocks.appendFile.mockClear();
		fsPromisesMocks.mkdir.mockClear();
		fsPromisesMocks.rm.mockClear();
		fsPromisesMocks.writeFile.mockClear();
	});

	it("routes SDK default tool executors through the sandbox manager", async () => {
		const runTool = vi.fn(async () => "sandbox result");
		const manager = { runTool } as unknown as AgentSandboxManager;
		const executors = createAgentSandboxToolExecutors(manager, "task-1");
		const context = createToolContext();

		if (!executors.bash || !executors.readFile || !executors.search || !executors.editor || !executors.applyPatch) {
			throw new Error("Expected all sandbox default tool executors.");
		}

		await expect(executors.bash("npm test", "/host/repo", context)).resolves.toBe("sandbox result");
		await expect(executors.readFile({ path: "src/index.ts" }, context)).resolves.toBe("sandbox result");
		await expect(executors.search("needle", "/host/repo", context)).resolves.toBe("sandbox result");
		await expect(
			executors.editor({ path: "src/index.ts", old_text: "old", new_text: "new" }, "/host/repo", context),
		).resolves.toBe("sandbox result");
		await expect(
			executors.applyPatch({ input: "*** Begin Patch\n*** End Patch\n" }, "/host/repo", context),
		).resolves.toBe("sandbox result");

		expect(runTool).toHaveBeenNthCalledWith(1, "task-1", "bash", "npm test");
		expect(runTool).toHaveBeenNthCalledWith(2, "task-1", "readFile", { path: "src/index.ts" });
		expect(runTool).toHaveBeenNthCalledWith(3, "task-1", "search", "needle");
		expect(runTool).toHaveBeenNthCalledWith(4, "task-1", "editor", {
			path: "src/index.ts",
			old_text: "old",
			new_text: "new",
		});
		expect(runTool).toHaveBeenNthCalledWith(5, "task-1", "applyPatch", {
			input: "*** Begin Patch\n*** End Patch\n",
		});
		expect(childProcessMocks.execFile).not.toHaveBeenCalled();
		expect(fsPromisesMocks.appendFile).not.toHaveBeenCalled();
		expect(fsPromisesMocks.mkdir).not.toHaveBeenCalled();
		expect(fsPromisesMocks.rm).not.toHaveBeenCalled();
		expect(fsPromisesMocks.writeFile).not.toHaveBeenCalled();
	});

	it("runs acceptance commands through docker exec instead of host child_process", async () => {
		const sandboxResult: AgentSandboxExecResult = {
			exitCode: 0,
			stdout: "ok",
			stderr: "",
		};
		const assertAvailable = vi.fn(async () => {});
		const prepareWorkspace = vi.fn(async () => ({
			workdir: "/workspaces/task-1",
			uid: 70_001,
		}));
		const exec = vi.fn(async () => sandboxResult);
		const disposeWorkspace = vi.fn(async () => {});
		const sandboxManager = {
			assertAvailable,
			prepareWorkspace,
			exec,
			disposeWorkspace,
		} as unknown as AgentSandboxManager;

		await expect(
			runClineAcceptanceGateInSandbox({
				taskId: "task-1",
				projectRepoPath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				sandboxManager,
			}),
		).resolves.toMatchObject({
			present: true,
			passed: true,
			output: "ok",
		});

		const shellExecution = resolveShellExecution("npm test");
		expect(exec).toHaveBeenCalledWith("task-1", [shellExecution.binary, ...shellExecution.args], {
			timeoutMs: 300_000,
		});
		expect(disposeWorkspace).toHaveBeenCalledWith("task-1");
		expect(childProcessMocks.execFile).not.toHaveBeenCalled();
		expect(fsPromisesMocks.appendFile).not.toHaveBeenCalled();
		expect(fsPromisesMocks.mkdir).not.toHaveBeenCalled();
		expect(fsPromisesMocks.rm).not.toHaveBeenCalled();
		expect(fsPromisesMocks.writeFile).not.toHaveBeenCalled();
	});
});
