import { describe, expect, it, vi } from "vitest";
import { createLocalLlmActionDecider } from "../../../src/agent-core/agent-action-decider";
import { type AgentAction, type AgentCoreTool, runAgentLoop } from "../../../src/agent-core/agent-loop";

function tool(name: string, execute: (input: unknown) => unknown): AgentCoreTool {
	return { name, description: `${name} tool`, execute };
}

describe("runAgentLoop", () => {
	it("runs tools then finishes, recording observations", async () => {
		const calls: unknown[] = [];
		const tools = [
			tool("write_file", (input) => {
				calls.push(input);
				return { written: 1 };
			}),
		];
		const actions: AgentAction[] = [
			{ kind: "tool", tool: "write_file", input: { path: "a.ts" } },
			{ kind: "final", message: "done" },
		];
		let i = 0;
		const result = await runAgentLoop({
			task: "do it",
			tools,
			decideAction: async () => actions[i++],
		});
		expect(result.status).toBe("completed");
		expect(result.finalMessage).toBe("done");
		expect(result.turns).toBe(2);
		expect(result.transcript[0].observation).toContain("written");
		expect(calls).toEqual([{ path: "a.ts" }]);
	});

	it("feeds back an error observation for an unknown tool without crashing", async () => {
		const actions: AgentAction[] = [
			{ kind: "tool", tool: "nope", input: {} },
			{ kind: "final", message: "ok" },
		];
		let i = 0;
		const result = await runAgentLoop({ task: "t", tools: [], decideAction: async () => actions[i++] });
		expect(result.status).toBe("completed");
		expect(result.transcript[0].observation).toContain('unknown tool "nope"');
	});

	it("captures a thrown tool error as an observation", async () => {
		const tools = [
			tool("boom", () => {
				throw new Error("kaboom");
			}),
		];
		const actions: AgentAction[] = [
			{ kind: "tool", tool: "boom", input: {} },
			{ kind: "final", message: "ok" },
		];
		let i = 0;
		const result = await runAgentLoop({ task: "t", tools, decideAction: async () => actions[i++] });
		expect(result.transcript[0].observation).toContain("kaboom");
		expect(result.status).toBe("completed");
	});

	it("parks as stalled when the same action repeats", async () => {
		const tools = [tool("read", () => "same")];
		const result = await runAgentLoop({
			task: "t",
			tools,
			decideAction: async () => ({ kind: "tool", tool: "read", input: { path: "x" } }),
			repeatedActionLimit: 3,
		});
		expect(result.status).toBe("stalled");
		expect(result.turns).toBe(3);
	});

	it("stops at max_turns", async () => {
		let n = 0;
		const tools = [tool("read", () => `obs-${n++}`)];
		const result = await runAgentLoop({
			task: "t",
			tools,
			decideAction: async () => ({ kind: "tool", tool: "read", input: { n: n } }),
			maxTurns: 4,
		});
		expect(result.status).toBe("max_turns");
		expect(result.turns).toBe(4);
	});

	it("returns error status when the decider throws", async () => {
		const result = await runAgentLoop({
			task: "t",
			tools: [],
			decideAction: async () => {
				throw new Error("model down");
			},
		});
		expect(result.status).toBe("error");
		expect(result.transcript[0].error).toContain("model down");
	});
});

describe("createLocalLlmActionDecider", () => {
	it("constrains the action via generateStructured and parses tool/final actions", async () => {
		const generateStructured = vi.fn(async ({ parse }: { parse: (v: unknown) => unknown }) =>
			parse({ thought: "edit it", action: "edit_file", input: { path: "a.ts" } }),
		);
		const decide = createLocalLlmActionDecider({
			client: { generateStructured } as never,
			modelId: "qwen",
		});
		const action = (await decide({
			task: "fix bug",
			tools: [{ name: "edit_file", description: "edit", execute: () => null }],
			transcript: [],
		})) as Extract<AgentAction, { kind: "tool" }>;
		expect(action.kind).toBe("tool");
		expect(action.tool).toBe("edit_file");
		expect(action.input).toEqual({ path: "a.ts" });
		// The action schema enumerates the available tools + "final".
		const callArg = generateStructured.mock.calls[0][0] as unknown as {
			jsonSchema: { schema: { properties: { action: { enum: string[] } } } };
		};
		expect(callArg.jsonSchema.schema.properties.action.enum).toEqual(["edit_file", "final"]);
	});
});
