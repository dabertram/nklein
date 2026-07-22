import type { AgentModel, AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	ACTION_PLAN_EXECUTION_TOOL_NAME,
	type ActionPlanDirectClient,
	ActionPlanStepFailure,
	createActionPlanExecutionTool,
	createActionPlanProducerModel,
} from "../../../src/nklein-agent/nklein-action-plan-mode";
import type { AgentTool, AgentToolContext } from "../../../src/nklein-agent/sdk-agent-types";

const context: AgentToolContext = {
	sessionId: "session-1",
	agentId: "agent-1",
	conversationId: "conversation-1",
	iteration: 1,
	toolCallId: "plan-call",
};

function tool(name: string, execute: AgentTool["execute"]): AgentTool {
	return { name, description: `${name} description`, inputSchema: { type: "object" }, execute };
}

function baseModel(events: AgentModelEvent[] = []): AgentModel {
	return {
		stream: vi.fn(() =>
			(async function* () {
				for (const event of events) yield event;
			})(),
		),
	};
}

async function collect(model: AgentModel, offeredTools: AgentTool[]): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of model.stream({
		messages: [
			{ id: "m1", role: "user", content: [{ type: "text", text: "Inspect then edit the file." }], createdAt: 1 },
		],
		tools: offeredTools,
	})) {
		events.push(event);
	}
	return events;
}

describe("ActionPlan producer model", () => {
	it("turns constrained JSON into the internal execution tool call", async () => {
		const base = baseModel();
		const read = tool("read_files", async () => "read");
		const edit = tool("edit_file", async () => "edited");
		const executePlan = createActionPlanExecutionTool({ tools: [read, edit] });
		const complete = vi.fn(async (_request: Parameters<ActionPlanDirectClient["complete"]>[0]) => ({
			content: JSON.stringify({
				steps: [
					{ id: "read", tool: "read_files", args: { paths: ["src/a.ts"] }, dependsOn: [] },
					{ id: "edit", tool: "edit_file", args: { path: "src/a.ts" }, dependsOn: ["read"] },
				],
			}),
			raw: { usage: { prompt_tokens: 40, completion_tokens: 20 } },
		}));
		const directClient: ActionPlanDirectClient = { complete };
		const model = createActionPlanProducerModel(base, { directClient, tools: [read, edit] });

		const events = await collect(model, [executePlan]);

		expect(base.stream).not.toHaveBeenCalled();
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "usage" }),
				expect.objectContaining({ type: "tool-call-delta", toolName: ACTION_PLAN_EXECUTION_TOOL_NAME }),
				{ type: "finish", reason: "tool-calls" },
			]),
		);
		const request = complete.mock.calls[0]?.[0];
		expect(request?.format?.jsonSchema?.schema).toMatchObject({
			properties: { steps: { minItems: 1, maxItems: 6 } },
		});
		expect(request?.messages.at(-1)?.content).toContain("read_files");
		expect(request?.messages.at(-1)?.content).toContain("edit_file");
	});

	it("fails closed when constrained output still violates semantic validation", async () => {
		const read = tool("read_files", async () => "read");
		const executePlan = createActionPlanExecutionTool({ tools: [read] });
		const model = createActionPlanProducerModel(baseModel(), {
			directClient: {
				complete: async () => ({
					content: JSON.stringify({
						steps: [{ id: "read", tool: "made_up", args: {}, dependsOn: [] }],
					}),
				}),
			},
			tools: [read],
		});

		await expect(collect(model, [executePlan])).rejects.toThrow("invalid plan");
	});
});

describe("ActionPlan execution tool", () => {
	it("dispatches in dependency order through approvals and checkpoints", async () => {
		const order: string[] = [];
		const approvals: string[] = [];
		const checkpoints: string[] = [];
		const executePlan = createActionPlanExecutionTool({
			tools: [
				tool("edit_file", async () => {
					order.push("edit");
					return { ok: true };
				}),
				tool("read_files", async () => {
					order.push("read");
					return { ok: true };
				}),
			],
			requestToolApproval: async (request) => {
				approvals.push(request.toolName);
				return { approved: true };
			},
			onCheckpoint: ({ latestStepId }) => checkpoints.push(latestStepId),
		});

		const output = await executePlan.execute(
			{
				steps: [
					{ id: "edit", tool: "edit_file", args: { path: "src/a.ts" }, dependsOn: ["read"] },
					{ id: "read", tool: "read_files", args: { paths: ["src/a.ts"] }, dependsOn: [] },
				],
			},
			context,
		);

		expect(output).toMatchObject({ ok: true, mode: "action_plan", result: { status: "completed" } });
		expect(order).toEqual(["read", "edit"]);
		expect(approvals).toEqual(["read_files", "edit_file"]);
		expect(checkpoints).toEqual(["read", "edit"]);
	});

	it("reuses completed mutations but refreshes reads when replanning after a failed step", async () => {
		const read = vi.fn(async () => ({ content: "a" }));
		const edit = vi.fn(async () => ({ ok: true }));
		const verify = vi
			.fn<AgentTool["execute"]>()
			.mockRejectedValueOnce(new Error("verification mismatch"))
			.mockResolvedValueOnce({ ok: true });
		const executePlan = createActionPlanExecutionTool({
			tools: [tool("read_files", read), tool("edit_file", edit), tool("write_files", verify)],
		});
		const plan = {
			steps: [
				{ id: "read", tool: "read_files", args: { paths: ["src/a.ts"] }, dependsOn: [] },
				{ id: "edit", tool: "edit_file", args: { path: "src/a.ts" }, dependsOn: ["read"] },
				{ id: "verify", tool: "write_files", args: { path: "proof" }, dependsOn: ["edit"] },
			],
		};

		await expect(executePlan.execute(plan, context)).rejects.toBeInstanceOf(ActionPlanStepFailure);
		await expect(executePlan.execute(plan, { ...context, iteration: 2 })).resolves.toMatchObject({ ok: true });
		expect(read).toHaveBeenCalledTimes(2);
		expect(edit).toHaveBeenCalledTimes(1);
		expect(verify).toHaveBeenCalledTimes(2);
	});

	it("excludes tools without a swarm capability manifest", async () => {
		const unknown = tool("unregistered_host_escape", async () => "should not run");
		const executePlan = createActionPlanExecutionTool({ tools: [unknown] });
		expect(JSON.stringify(executePlan.inputSchema)).not.toContain("unregistered_host_escape");
		await expect(
			executePlan.execute(
				{ steps: [{ id: "escape", tool: "unregistered_host_escape", args: {}, dependsOn: [] }] },
				context,
			),
		).rejects.toThrow("invalid or unmanifested");
	});
});
