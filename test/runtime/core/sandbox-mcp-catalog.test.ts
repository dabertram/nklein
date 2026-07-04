import { describe, expect, it } from "vitest";
import {
	buildSandboxMcpDockerExecArgs,
	listAvailableSandboxMcpServers,
	SANDBOX_MCP_SERVERS,
	selectSandboxMcpServersForModel,
} from "../../../src/core/sandbox-mcp-catalog";

describe("sandbox MCP catalog", () => {
	it("registers all three curated servers as available (all baked into the image)", () => {
		const byId = new Map(SANDBOX_MCP_SERVERS.map((s) => [s.id, s]));
		expect(byId.get("sequential-thinking")?.available).toBe(true);
		expect(byId.get("codebase-memory")?.available).toBe(true);
		expect(byId.get("basic-memory")?.available).toBe(true);
		expect(byId.get("basic-memory")?.inContainerArgv).toEqual(["basic-memory", "mcp"]);
		expect(listAvailableSandboxMcpServers().map((s) => s.id)).toEqual([
			"sequential-thinking",
			"codebase-memory",
			"basic-memory",
		]);
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

	it("offers codebase-memory broadly — to a capable model AND an uncatalogued one (a token-cutter that helps all sizes)", () => {
		// CODEBASE_MEMORY_FIT is minToolUse TOOL_WEAK + allowUnknownToolUse, no reasoning/chaining gate.
		expect(selectSandboxMcpServersForModel("qwen/qwen3-8b").map((s) => s.id)).toContain("codebase-memory");
		expect(selectSandboxMcpServersForModel("no-such-model-xyz").map((s) => s.id)).toContain("codebase-memory");
	});

	it("still withholds codebase-memory from a genuinely tool-UNSUITABLE model (offering it would just burn context)", () => {
		// phi-4-reasoning-plus is catalogued TOOL_UNSUITABLE — below the TOOL_WEAK floor, so even the broad tool is skipped.
		expect(selectSandboxMcpServersForModel("phi-4-reasoning-plus").map((s) => s.id)).not.toContain("codebase-memory");
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
