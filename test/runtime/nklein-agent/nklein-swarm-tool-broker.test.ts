import type { ToolExecutors } from "@cline/sdk";
import { describe, expect, it } from "vitest";
import {
	createSwarmToolBrokerState,
	wrapSwarmAgentTools,
	wrapSwarmToolExecutors,
} from "../../../src/nklein-agent/nklein-swarm-tool-broker";
import type { AgentTool, AgentToolContext } from "../../../src/nklein-agent/sdk-agent-types";

const TOOL_CONTEXT: AgentToolContext = {
	agentId: "agent-1",
	iteration: 1,
};

describe("nklein swarm tool broker wrappers", () => {
	it("taints extra-tool web output with content-derived secret_like", async () => {
		const state = createSwarmToolBrokerState();
		const tool: AgentTool = {
			name: "web_search",
			description: "search",
			inputSchema: {},
			execute: async () => ({
				ok: true,
				results: [{ title: "leak", snippet: "token = 'ghp_0123456789abcdefghijABCDEFGHIJ'" }],
			}),
		};

		const [wrapped] = wrapSwarmAgentTools([tool], state);
		await wrapped.execute({ query: "token" }, TOOL_CONTEXT);

		expect(state.taintLabels).toEqual(["web", "secret_like"]);
	});

	it("labels exact MCP bundle tool outputs as mcp", async () => {
		const state = createSwarmToolBrokerState();
		const tool: AgentTool = {
			name: "codebase_memory__search_graph",
			description: "mcp",
			inputSchema: {},
			execute: async () => "password: hunter2hunter2hunter2hunter2extra",
		};

		const [wrapped] = wrapSwarmAgentTools([tool], state, {
			mcpToolNames: new Set(["codebase_memory__search_graph"]),
		});
		await wrapped.execute({}, TOOL_CONTEXT);

		expect(state.taintLabels).toEqual(["mcp", "secret_like"]);
	});

	it("taints SDK read/search executor outputs as repository content", async () => {
		const state = createSwarmToolBrokerState();
		const readFile: NonNullable<ToolExecutors["readFile"]> = async () => "api_key=AbCdEf0123456789AbCdEf0123456789";
		const search: NonNullable<ToolExecutors["search"]> = async () => "ordinary search hit";

		const wrapped = wrapSwarmToolExecutors({ readFile, search }, state);
		if (!wrapped?.readFile || !wrapped.search) {
			throw new Error("expected wrapped executors");
		}

		await wrapped.search("needle", "/workspace", TOOL_CONTEXT);
		expect(state.taintLabels).toEqual(["repo_instruction"]);

		await wrapped.readFile({ path: "src/index.ts" }, TOOL_CONTEXT);
		expect(state.taintLabels).toEqual(["repo_instruction", "secret_like"]);
	});

	it("does not taint sandbox command output", async () => {
		const state = createSwarmToolBrokerState();
		const bash: NonNullable<ToolExecutors["bash"]> = async () => "password: hunter2hunter2hunter2hunter2extra";

		const wrapped = wrapSwarmToolExecutors({ bash }, state);
		if (!wrapped?.bash) {
			throw new Error("expected wrapped bash executor");
		}

		await wrapped.bash("npm test", "/workspace", TOOL_CONTEXT);

		expect(state.taintLabels).toEqual([]);
	});
});
