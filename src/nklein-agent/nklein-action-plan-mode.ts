/** F3.T3b — opt-in bounded ActionPlan production and manifest-backed execution for one worker card. */

import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { type ActionPlanExecutionResult, executeActionPlan } from "../core/action-plan-executor.js";
import {
	buildActionPlanResponseSchema,
	buildActionPlanRuntimePrompt,
	parseActionPlanJson,
} from "../core/action-plan-producer.js";
import { extractCompletionUsage } from "../core/completion-usage.js";
import { swarmToolManifest } from "../core/swarm-tool-capability.js";
import { isEffectiveToolResultError } from "../core/tool-result-failure.js";
import { agentMessageToEndpointText } from "./local-alternate-endpoint-model.js";
import type {
	LocalLlmChatMessage,
	LocalLlmSamplingOptions,
	LocalLlmStructuredFormat,
} from "./nklein-local-llm-client.js";
import { computeNKleinToolInputFingerprint } from "./nklein-tool-call-fingerprint.js";
import type { AgentTool, AgentToolContext } from "./sdk-agent-types.js";
import type { NKleinSdkToolApprovalRequest, NKleinSdkToolApprovalResult } from "./sdk-runtime-boundary.js";

export const ACTION_PLAN_EXECUTION_TOOL_NAME = "execute_action_plan";
const ACTION_PLAN_SCHEMA_NAME = "klein_action_plan";
const ACTION_PLAN_DEFAULT_MAX_TOKENS = 1_024;

export interface ActionPlanDirectClient {
	complete(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
		format?: LocalLlmStructuredFormat;
		signal?: AbortSignal;
	}): Promise<{ content: string; raw?: unknown }>;
}

export interface CreateActionPlanProducerModelOptions {
	directClient: ActionPlanDirectClient;
	tools: readonly AgentTool[];
	onPlanProduced?: (plan: { stepCount: number; toolNames: readonly string[] }) => void;
}

function toDirectMessages(request: AgentModelRequest, instruction: string): LocalLlmChatMessage[] {
	return [
		...(request.systemPrompt?.trim() ? [{ role: "system" as const, content: request.systemPrompt }] : []),
		...request.messages.map((message) => ({
			role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
			content: agentMessageToEndpointText(message),
		})),
		{ role: "system", content: instruction },
	];
}

function maxTokensFromRequest(request: AgentModelRequest): number {
	const value = request.options?.maxTokens;
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.min(Math.trunc(value), ACTION_PLAN_DEFAULT_MAX_TOKENS)
		: ACTION_PLAN_DEFAULT_MAX_TOKENS;
}

function producerEvents(plan: unknown, raw: unknown): AgentModelEvent[] {
	const usage = extractCompletionUsage(raw);
	return [
		...(usage.promptTokens !== null || usage.totalCompletionTokens !== null
			? [
					{
						type: "usage" as const,
						usage: {
							inputTokens: usage.promptTokens ?? 0,
							outputTokens: usage.totalCompletionTokens ?? 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0,
							...(usage.reasoningTokens !== null ? { reasoningTokenCount: usage.reasoningTokens } : {}),
						},
					},
				]
			: []),
		{
			type: "tool-call-delta",
			toolCallId: `action-plan-${Date.now().toString(36)}`,
			toolName: ACTION_PLAN_EXECUTION_TOOL_NAME,
			inputText: JSON.stringify(plan),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

/**
 * Replace each ActionPlan-mode model request with one constrained planning request. A failed nested step returns to
 * the SDK loop, whose next request contains the failure evidence; this decorator then asks for only the remaining
 * work. A valid plan is converted to the internal execution tool call so the normal session persists the plan/result.
 */
export function createActionPlanProducerModel(
	base: AgentModel,
	options: CreateActionPlanProducerModelOptions,
): AgentModel {
	const tools = [...options.tools];
	const allowedToolNames = tools.map((tool) => tool.name);
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			if (!request.tools.some((tool) => tool.name === ACTION_PLAN_EXECUTION_TOOL_NAME)) {
				return (async function* () {
					for await (const event of await base.stream(request)) yield event;
				})();
			}
			return (async function* () {
				if (allowedToolNames.length === 0) {
					throw new Error("ActionPlan mode has no manifested tools available for this card.");
				}
				const completion = await options.directClient.complete({
					messages: toDirectMessages(request, buildActionPlanRuntimePrompt(tools)),
					sampling: { temperature: 0.1, maxTokens: maxTokensFromRequest(request) },
					format: {
						jsonSchema: {
							name: ACTION_PLAN_SCHEMA_NAME,
							schema: buildActionPlanResponseSchema(allowedToolNames),
							strict: true,
						},
					},
					signal: request.signal,
				});
				const parsed = parseActionPlanJson(completion.content, allowedToolNames);
				if (!parsed.plan) {
					throw new Error(`ActionPlan producer returned an invalid plan: ${parsed.errors.join("; ")}`);
				}
				options.onPlanProduced?.({
					stepCount: parsed.plan.steps.length,
					toolNames: parsed.plan.steps.map((step) => step.tool),
				});
				for (const event of producerEvents(parsed.plan, completion.raw)) yield event;
			})();
		},
	};
}

type RequestToolApproval = (request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>;

export interface CreateActionPlanExecutionToolOptions {
	tools: readonly AgentTool[];
	requestToolApproval?: RequestToolApproval;
	mcpToolNames?: ReadonlySet<string>;
	onCheckpoint?: (result: { completedStepIds: readonly string[]; latestStepId: string }) => void;
}

export function selectActionPlanTools(tools: readonly AgentTool[], mcpToolNames?: ReadonlySet<string>): AgentTool[] {
	return tools.filter((tool) => swarmToolManifest(tool.name, { mcpToolNames }) !== null);
}

function toolResultError(output: unknown): string {
	if (typeof output === "string") return output;
	try {
		return JSON.stringify(output);
	} catch {
		return "tool returned a structured failure";
	}
}

function nestedContext(context: AgentToolContext, stepId: string, index: number): AgentToolContext {
	return {
		...context,
		iteration: context.iteration * 10 + index + 1,
		toolCallId: `${context.toolCallId ?? "action-plan"}:${stepId}`,
	};
}

function approvalRequest(
	tool: AgentTool,
	args: Record<string, unknown>,
	context: AgentToolContext,
): NKleinSdkToolApprovalRequest {
	return {
		sessionId: context.sessionId ?? "action-plan-session",
		agentId: context.agentId,
		conversationId: context.conversationId ?? "action-plan-conversation",
		iteration: context.iteration,
		toolName: tool.name,
		toolCallId: context.toolCallId ?? `action-plan:${tool.name}`,
		input: args,
	} as NKleinSdkToolApprovalRequest;
}

/** Build the only SDK-visible tool in ActionPlan mode; its nested calls reuse the already policy-filtered tools. */
export function createActionPlanExecutionTool(options: CreateActionPlanExecutionToolOptions): AgentTool {
	const tools = selectActionPlanTools(options.tools, options.mcpToolNames);
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const successfulCallOutputs = new Map<string, unknown>();
	const allowedToolNames = tools.map((tool) => tool.name);
	return {
		name: ACTION_PLAN_EXECUTION_TOOL_NAME,
		description:
			"Internal !Klein ActionPlan executor. It validates a bounded dependency graph, then dispatches each nested step through the card's manifested sandbox tools and approval policy.",
		inputSchema: buildActionPlanResponseSchema(allowedToolNames),
		lifecycle: { completesRun: true },
		async execute(input, context) {
			const parsed = typeof input === "object" ? input : null;
			const candidate = parsed ? parseActionPlanJson(JSON.stringify(parsed), allowedToolNames) : { plan: null };
			if (!candidate.plan) {
				throw new Error("ActionPlan execution rejected an invalid or unmanifested plan before dispatch.");
			}
			const result = await executeActionPlan(candidate.plan, {
				dispatch: async (step) => {
					const tool = byName.get(step.tool);
					const manifest = tool ? swarmToolManifest(tool.name, { mcpToolNames: options.mcpToolNames }) : null;
					if (!tool || !manifest) {
						return { ok: false, error: `Tool is not available through the ActionPlan manifest: ${step.tool}` };
					}
					const fingerprint = computeNKleinToolInputFingerprint({ tool: step.tool, args: step.args });
					// Reads are observations, not completed effects: replaying a read after an edit must see fresh workspace
					// state. Retain only mutation results across corrective plans, where replay could duplicate an effect.
					const preservesCompletedEffect = manifest.mutationLevel !== "read";
					if (preservesCompletedEffect && fingerprint && successfulCallOutputs.has(fingerprint)) {
						return { ok: true, output: successfulCallOutputs.get(fingerprint) };
					}
					const stepIndex = candidate.plan?.steps.findIndex((candidateStep) => candidateStep.id === step.id) ?? 0;
					const stepContext = nestedContext(context, step.id, stepIndex);
					if (options.requestToolApproval) {
						const approval = await options.requestToolApproval(approvalRequest(tool, step.args, stepContext));
						if (!approval.approved) {
							return { ok: false, error: approval.reason ?? `Approval denied for ${tool.name}.` };
						}
					}
					try {
						const output = await tool.execute(step.args, stepContext);
						if (isEffectiveToolResultError(false, output)) {
							return { ok: false, error: toolResultError(output) };
						}
						if (preservesCompletedEffect && fingerprint) successfulCallOutputs.set(fingerprint, output);
						return { ok: true, output };
					} catch (error) {
						return { ok: false, error: error instanceof Error ? error.message : String(error) };
					}
				},
				onCheckpoint: (completed) => {
					const latest = completed[completed.length - 1];
					if (latest) {
						options.onCheckpoint?.({
							completedStepIds: completed.map((step) => step.stepId),
							latestStepId: latest.stepId,
						});
					}
				},
			});
			if (result.status !== "completed") {
				throw new ActionPlanStepFailure(result);
			}
			return { ok: true, mode: "action_plan", result };
		},
	};
}

export class ActionPlanStepFailure extends Error {
	readonly result: ActionPlanExecutionResult;
	constructor(result: ActionPlanExecutionResult) {
		super(
			`ActionPlan stopped after a nested step failure. Completed effects are checkpointed and MUST NOT be repeated. Replan only the failed/remaining work. Evidence: ${JSON.stringify(result)}`,
		);
		this.name = "ActionPlanStepFailure";
		this.result = result;
	}
}
