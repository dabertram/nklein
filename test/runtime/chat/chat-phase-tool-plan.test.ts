import { describe, expect, it } from "vitest";
import type { ChatActionKind } from "../../../src/chat/chat-execution-mode";
import { buildChatPhaseToolPlan } from "../../../src/chat/chat-phase-tool-plan";
import type { ChatTool } from "../../../src/chat/chat-tool-executor";
import { runPhasePolicy } from "../../../src/core/run-state-machine";
import type { LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";

function tool(name: string, actionKind: ChatActionKind): ChatTool {
	return { name, actionKind, run: async () => name };
}

function definition(name: string): LocalLlmToolDefinition {
	return {
		name,
		description: `${name} test tool`,
		parameters: { type: "object", properties: {} },
	};
}

describe("buildChatPhaseToolPlan", () => {
	const tools = [
		tool("read_file", "sandbox_read"),
		tool("write_file", "sandbox_write"),
		tool("create_card", "control_plane"),
		tool("run_command", "host_command"),
	];
	const definitions = [
		definition("read_file"),
		definition("write_file"),
		definition("create_card"),
		definition("run_command"),
		definition("stale_schema_only"),
	];

	it("keeps only read tools and matching schemas in read-only phases", () => {
		const plan = buildChatPhaseToolPlan({ phase: "localize", tools, definitions });

		expect(plan.phase).toBe("localize");
		expect(plan.tools.map((candidate) => candidate.name)).toEqual(["read_file"]);
		expect(plan.definitions.map((candidate) => candidate.name)).toEqual(["read_file"]);
		expect(plan.offeredToolNames).toEqual(["read_file"]);
		expect(plan.maxIterations).toBe(runPhasePolicy("localize").maxToolCalls);
	});

	it("keeps read + sandbox writes for execute_step while excluding control-plane and host tools", () => {
		const plan = buildChatPhaseToolPlan({ phase: "execute_step", tools, definitions });

		expect(plan.tools.map((candidate) => candidate.name)).toEqual(["read_file", "write_file"]);
		expect(plan.definitions.map((candidate) => candidate.name)).toEqual(["read_file", "write_file"]);
		expect(plan.maxIterations).toBe(runPhasePolicy("execute_step").maxToolCalls);
	});

	it("keeps control-plane tools in plan phases but still excludes host tools", () => {
		const plan = buildChatPhaseToolPlan({ phase: "plan", tools, definitions });

		expect(plan.tools.map((candidate) => candidate.name)).toEqual(["read_file", "write_file", "create_card"]);
		expect(plan.definitions.map((candidate) => candidate.name)).toEqual(["read_file", "write_file", "create_card"]);
	});

	it("offers no tools for terminal zero-budget phases", () => {
		const plan = buildChatPhaseToolPlan({ phase: "done", tools, definitions });

		expect(plan.tools).toEqual([]);
		expect(plan.definitions).toEqual([]);
		expect(plan.offeredToolNames).toEqual([]);
		expect(plan.maxIterations).toBe(0);
	});
});
