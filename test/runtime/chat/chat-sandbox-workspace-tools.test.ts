import { describe, expect, it, vi } from "vitest";
import type { ChatToolSet } from "../../../src/chat/chat-board-tools";
import {
	type AgentSandboxChatWorkspaceManager,
	type ChatSandboxWorkspace,
	type ChatSandboxWorkspaceProvider,
	createAgentSandboxChatWorkspaceProvider,
	createSandboxWorkspaceReadTools,
	createSandboxWorkspaceWriteTools,
	isSandboxWritePathApproved,
	resolveSandboxWritablePathMounts,
} from "../../../src/chat/chat-sandbox-workspace-tools";
import type { ChatSession } from "../../../src/chat/chat-session-store";
import type { AgentSandboxExecResult } from "../../../src/nklein-agent/nklein-agent-sandbox";

const ROOT = "/workspaces/chat-session";
const WORKSPACE_PATH = "/host/project";

function makeSession(id = "session-1"): ChatSession {
	return {
		schemaVersion: 1,
		id,
		title: "Test chat",
		scope: "chat_only",
		role: "planner_architect",
		goal: null,
		riskAcknowledged: false,
		browserEnabled: false,
		sandboxWritablePaths: [],
		feedbackMuted: false,
		feedbackVerbosity: "normal",
		feedbackQuiet: false,
		ownedWorkspaceId: null,
		focus: null,
		outstandingAsks: [],
		selectedSkillIds: [],
		totalTokensUsed: 0,
		taintLabels: [],
		createdAt: 1,
		updatedAt: 1,
	};
}

function result(stdout: string, exitCode = 0, stderr = ""): AgentSandboxExecResult {
	return { exitCode, stdout, stderr };
}

function tool(tools: ChatToolSet["tools"], name: string) {
	const found = tools.find((candidate) => candidate.name === name);
	if (!found) {
		throw new Error(`tool ${name} not found`);
	}
	return found;
}

function commandKey(argv: readonly string[]): string {
	return argv.join("\0");
}

function makeWorkspace(script: Record<string, AgentSandboxExecResult>) {
	const calls: string[][] = [];
	const dispose = vi.fn(async () => undefined);
	return {
		calls,
		dispose,
		workspace: {
			exec: async (argv: readonly string[]) => {
				calls.push([...argv]);
				return script[commandKey(argv)] ?? result("", 1, "unexpected command");
			},
			dispose,
		},
	};
}

function makeProvider(workspace: ChatSandboxWorkspace | null): ChatSandboxWorkspaceProvider {
	return {
		prepare: vi.fn(async () => workspace),
	};
}

function makeTools(provider: ChatSandboxWorkspaceProvider, maxBytes?: number) {
	return createSandboxWorkspaceReadTools({
		session: makeSession(),
		workspacePath: WORKSPACE_PATH,
		provider,
		...(maxBytes !== undefined ? { maxBytes } : {}),
	});
}

function makeWriteTools(provider: ChatSandboxWorkspaceProvider, writablePaths: readonly string[]) {
	return createSandboxWorkspaceWriteTools({
		session: makeSession(),
		workspacePath: WORKSPACE_PATH,
		provider,
		writableMounts: resolveSandboxWritablePathMounts(WORKSPACE_PATH, writablePaths),
	});
}

describe("createSandboxWorkspaceReadTools", () => {
	it("exposes read_file + list_dir as sandbox_read tools with matching definitions", () => {
		const { tools, definitions } = makeTools(makeProvider(null));
		expect(tools.map((candidate) => candidate.name).sort()).toEqual(["list_dir", "read_file"]);
		expect(tools.every((candidate) => candidate.actionKind === "sandbox_read")).toBe(true);
		expect(definitions.map((definition) => definition.name).sort()).toEqual(["list_dir", "read_file"]);
	});

	it("requires read_file paths without preparing a sandbox", async () => {
		const provider = makeProvider(null);
		const { tools } = makeTools(provider);

		const out = await tool(tools, "read_file").run({});

		expect(out).toContain("Provide a `path`");
		expect(provider.prepare).not.toHaveBeenCalled();
	});

	it("refuses absolute paths without preparing a sandbox", async () => {
		const provider = makeProvider(null);
		const { tools } = makeTools(provider);

		const out = await tool(tools, "read_file").run({ path: "/etc/passwd" });

		expect(out).toContain("workspace-relative");
		expect(provider.prepare).not.toHaveBeenCalled();
	});

	it("refuses lexical workspace escapes without preparing a sandbox", async () => {
		const provider = makeProvider(null);
		const { tools } = makeTools(provider);

		const out = await tool(tools, "read_file").run({ path: "../../secret.txt" });

		expect(out).toContain("escapes the workspace");
		expect(provider.prepare).not.toHaveBeenCalled();
	});

	it("reads a file through the sandbox and disposes the prepared workspace", async () => {
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "README.md"])]: result(`${ROOT}/README.md\n`),
			[commandKey(["wc", "-c", "--", "README.md"])]: result("10 README.md\n"),
			[commandKey(["cat", "--", "README.md"])]: result("# Project\n"),
		});
		const { tools } = makeTools(makeProvider(prepared.workspace));

		const out = await tool(tools, "read_file").run({ path: "README.md" });

		expect(out).toBe("# Project\n");
		expect(prepared.calls).toEqual([
			["pwd", "-P"],
			["realpath", "--", "README.md"],
			["wc", "-c", "--", "README.md"],
			["cat", "--", "README.md"],
		]);
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});

	it("truncates oversized reads with head -c and never leaks host paths", async () => {
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "big.txt"])]: result(`${ROOT}/big.txt\n`),
			[commandKey(["wc", "-c", "--", "big.txt"])]: result("100 big.txt\n"),
			[commandKey(["head", "-c", "8", "--", "big.txt"])]: result("abcdefgh"),
		});
		const { tools } = makeTools(makeProvider(prepared.workspace), 8);

		const out = await tool(tools, "read_file").run({ path: "big.txt" });

		expect(out).toContain("abcdefgh");
		expect(out).toContain("truncated: big.txt");
		expect(out).not.toContain(WORKSPACE_PATH);
		expect(prepared.calls).toContainEqual(["head", "-c", "8", "--", "big.txt"]);
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});

	it("rejects sandbox symlink escapes before reading content", async () => {
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "link-to-secret"])]: result("/outside/secret.txt\n"),
		});
		const { tools } = makeTools(makeProvider(prepared.workspace));

		const out = await tool(tools, "read_file").run({ path: "link-to-secret" });

		expect(out).toContain("link-to-secret escapes the workspace");
		expect(out).not.toContain("/outside");
		expect(prepared.calls).toEqual([
			["pwd", "-P"],
			["realpath", "--", "link-to-secret"],
		]);
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});

	it("reports missing files with a relative path", async () => {
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "missing.txt"])]: result("", 1, "not found"),
		});
		const { tools } = makeTools(makeProvider(prepared.workspace));

		const out = await tool(tools, "read_file").run({ path: "missing.txt" });

		expect(out).toContain("Could not read missing.txt");
		expect(out).not.toContain(WORKSPACE_PATH);
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});

	it("lists the workspace root by default with sorted directory suffixes", async () => {
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "."])]: result(`${ROOT}\n`),
			[commandKey(["find", ".", "-mindepth", "1", "-maxdepth", "1", "-printf", "%f\t%y\n"])]:
				result("src\td\nREADME.md\tf\n"),
		});
		const { tools } = makeTools(makeProvider(prepared.workspace));

		const out = await tool(tools, "list_dir").run({});

		expect(out).toBe("README.md\nsrc/");
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});

	it("returns an unavailable message when no sandbox workspace can be prepared", async () => {
		const { tools } = makeTools(makeProvider(null));

		const out = await tool(tools, "list_dir").run({});

		expect(out).toBe("Sandbox workspace is unavailable.");
	});

	it("turns sandbox preparation failures into a non-leaky unavailable message", async () => {
		const provider: ChatSandboxWorkspaceProvider = {
			prepare: vi.fn(async () => {
				throw new Error(`${WORKSPACE_PATH}/should-not-leak`);
			}),
		};
		const { tools } = makeTools(provider);

		const out = await tool(tools, "list_dir").run({});

		expect(out).toBe("Sandbox workspace is unavailable.");
		expect(out).not.toContain(WORKSPACE_PATH);
	});
});

describe("sandbox writable path mounts", () => {
	it("normalizes approved workspace-relative directories and rejects escapes", () => {
		const mounts = resolveSandboxWritablePathMounts(WORKSPACE_PATH, [
			"src",
			"./src/",
			"../secret",
			`${WORKSPACE_PATH}/docs`,
			"/outside",
			".",
		]);

		expect(mounts.map((mount) => mount.relativePath).sort()).toEqual([".", "docs", "src"]);
		expect(mounts.find((mount) => mount.relativePath === "src")?.hostPath).toBe(`${WORKSPACE_PATH}/src`);
		expect(mounts.every((mount) => mount.containerPath.startsWith("/nklein/user-writable/"))).toBe(true);
	});

	it("checks candidate write paths against the normalized mount list", () => {
		const mounts = resolveSandboxWritablePathMounts(WORKSPACE_PATH, ["src"]);

		expect(isSandboxWritePathApproved("src/app.ts", mounts)).toBe(true);
		expect(isSandboxWritePathApproved("README.md", mounts)).toBe(false);
		expect(isSandboxWritePathApproved("../secret.txt", mounts)).toBe(false);
		expect(isSandboxWritePathApproved(".", mounts)).toBe(false);
	});
});

describe("createSandboxWorkspaceWriteTools", () => {
	it("exposes write_file as a sandbox_write tool with a matching definition", () => {
		const { tools, definitions } = makeWriteTools(makeProvider(null), ["src"]);
		expect(tools.map((candidate) => candidate.name)).toEqual(["write_file"]);
		expect(tools[0]?.actionKind).toBe("sandbox_write");
		expect(definitions.map((definition) => definition.name)).toEqual(["write_file"]);
	});

	it("refuses writes outside the approved writable paths without preparing a sandbox", async () => {
		const provider = makeProvider(null);
		const { tools } = makeWriteTools(provider, ["src"]);

		const out = await tool(tools, "write_file").run({ path: "README.md", content: "hello" });

		expect(out).toContain("not under an approved writable path");
		expect(provider.prepare).not.toHaveBeenCalled();
	});

	it("requires string content", async () => {
		const provider = makeProvider(null);
		const { tools } = makeWriteTools(provider, ["src"]);

		const out = await tool(tools, "write_file").run({ path: "src/app.ts" });

		expect(out).toContain("Provide `content`");
		expect(provider.prepare).not.toHaveBeenCalled();
	});

	it("writes approved paths through the sandbox clone and the approved writable mount", async () => {
		const mount = resolveSandboxWritablePathMounts(WORKSPACE_PATH, ["src"])[0];
		if (!mount) {
			throw new Error("expected writable mount");
		}
		const mountedPath = `${mount.containerPath}/app.ts`;
		const encoded = Buffer.from("hello", "utf8").toString("base64");
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "src/app.ts"])]: result("", 1, "missing"),
			[commandKey(["realpath", "--", "src"])]: result(`${ROOT}/src\n`),
			[commandKey(["mkdir", "-p", "--", "src"])]: result(""),
			[commandKey(["sh", "-c", 'printf "%s" "$2" | base64 -d > "$1"', "nklein-write-file", "src/app.ts", encoded])]:
				result(""),
			[commandKey(["mkdir", "-p", "--", mount.containerPath])]: result(""),
			[commandKey(["sh", "-c", 'printf "%s" "$2" | base64 -d > "$1"', "nklein-write-file", mountedPath, encoded])]:
				result(""),
		});
		const { tools } = makeWriteTools(makeProvider(prepared.workspace), ["src"]);

		const out = await tool(tools, "write_file").run({ path: "src/app.ts", content: "hello" });

		expect(out).toBe("Wrote 5 bytes to src/app.ts.");
		expect(prepared.calls).toContainEqual(["realpath", "--", "src"]);
		expect(prepared.calls).toContainEqual(["mkdir", "-p", "--", "src"]);
		expect(prepared.calls).toContainEqual(["mkdir", "-p", "--", mount.containerPath]);
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});

	it("rejects symlink escapes before writing either target", async () => {
		const mount = resolveSandboxWritablePathMounts(WORKSPACE_PATH, ["link"])[0];
		if (!mount) {
			throw new Error("expected writable mount");
		}
		const prepared = makeWorkspace({
			[commandKey(["pwd", "-P"])]: result(`${ROOT}\n`),
			[commandKey(["realpath", "--", "link/file.txt"])]: result("", 1, "missing"),
			[commandKey(["realpath", "--", "link"])]: result("/outside/link\n"),
		});
		const { tools } = makeWriteTools(makeProvider(prepared.workspace), ["link"]);

		const out = await tool(tools, "write_file").run({ path: "link/file.txt", content: "hello" });

		expect(out).toContain("escapes the workspace");
		expect(prepared.calls.some((call) => call[0] === "mkdir")).toBe(false);
		expect(prepared.dispose).toHaveBeenCalledTimes(1);
	});
});

describe("createAgentSandboxChatWorkspaceProvider", () => {
	it("prepares, execs, and disposes through the sandbox manager task id", async () => {
		const manager: AgentSandboxChatWorkspaceManager = {
			assertAvailable: vi.fn(async () => undefined),
			prepareWorkspace: vi.fn(async () => ({ workdir: ROOT, uid: 1000 })),
			exec: vi.fn(async () => result("ok\n")),
			disposeWorkspace: vi.fn(async () => undefined),
		};
		const session = makeSession("Session 1 / weird");
		const provider = createAgentSandboxChatWorkspaceProvider(manager);

		const workspace = await provider.prepare({ session, workspacePath: WORKSPACE_PATH });
		const execResult = await workspace?.exec(["pwd", "-P"]);
		await workspace?.dispose();

		expect(execResult).toEqual(result("ok\n"));
		expect(manager.assertAvailable).toHaveBeenCalledTimes(1);
		expect(manager.prepareWorkspace).toHaveBeenCalledWith({
			taskId: "chat-Session-1-weird",
			projectRepoPath: WORKSPACE_PATH,
		});
		expect(manager.exec).toHaveBeenCalledWith("chat-Session-1-weird", ["pwd", "-P"], undefined);
		expect(manager.disposeWorkspace).toHaveBeenCalledWith("chat-Session-1-weird");
	});
});
