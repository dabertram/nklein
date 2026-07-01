import { describe, expect, it } from "vitest";
import {
	buildSandboxMcpDockerExecArgs,
	listAvailableSandboxMcpServers,
	SANDBOX_MCP_SERVERS,
	selectSandboxMcpServersForModel,
} from "../../../src/core/sandbox-mcp-catalog";

describe("sandbox MCP catalog", () => {
	it("registers sequential-thinking as available and codebase-memory as not-yet-available", () => {
		const byId = new Map(SANDBOX_MCP_SERVERS.map((s) => [s.id, s]));
		expect(byId.get("sequential-thinking")?.available).toBe(true);
		expect(byId.get("codebase-memory")?.available).toBe(false);
		expect(listAvailableSandboxMcpServers().map((s) => s.id)).toEqual(["sequential-thinking"]);
	});

	it("each server's fit profile serverId matches its catalog id (so gate + opt-out key line up)", () => {
		for (const server of SANDBOX_MCP_SERVERS) {
			expect(server.fit.serverId).toBe(server.id);
		}
	});
});

describe("selectSandboxMcpServersForModel — applies the §5.AL fit gate over AVAILABLE servers", () => {
	it("offers sequential-thinking to a non-reasoning, tool-capable, chaining model", () => {
		// qwen3-8b is catalogued as a tool-capable coder/instruct family (non-reasoning) — the fitting case.
		const ids = selectSandboxMcpServersForModel("qwen/qwen3-8b").map((s) => s.id);
		expect(ids).toContain("sequential-thinking");
	});

	it("withholds sequential-thinking from a native-reasoning model (redundant/overthinking)", () => {
		// A reasoning-only family: sequential-thinking is skipped by SEQUENTIAL_THINKING_FIT.
		const ids = selectSandboxMcpServersForModel("phi-4-reasoning-plus").map((s) => s.id);
		expect(ids).not.toContain("sequential-thinking");
	});

	it("never returns a not-yet-available server (codebase-memory) regardless of model", () => {
		for (const modelId of ["qwen/qwen3-8b", "phi-4-reasoning-plus", "no-such-model-xyz"]) {
			expect(selectSandboxMcpServersForModel(modelId).map((s) => s.id)).not.toContain("codebase-memory");
		}
	});
});

describe("buildSandboxMcpDockerExecArgs — persistent docker-exec stdio command", () => {
	it("mirrors execAsTaskUser (-u/-w/container) and adds -i for the bidirectional MCP pipe", () => {
		const args = buildSandboxMcpDockerExecArgs(
			{ containerName: "nklein-agent-sandbox-3", uid: 10003, workdir: "/workspaces/task-abc" },
			["mcp-server-sequential-thinking"],
		);
		expect(args).toEqual([
			"exec",
			"-i",
			"-u",
			"10003",
			"-w",
			"/workspaces/task-abc",
			"nklein-agent-sandbox-3",
			"mcp-server-sequential-thinking",
		]);
	});

	it("passes through a multi-arg in-container argv after the container name", () => {
		const args = buildSandboxMcpDockerExecArgs({ containerName: "c1", uid: 0, workdir: "/w" }, [
			"codebase-memory-mcp",
			"serve",
			"--stdio",
		]);
		expect(args.slice(-3)).toEqual(["codebase-memory-mcp", "serve", "--stdio"]);
		expect(args[0]).toBe("exec");
		expect(args).toContain("-i");
	});
});
