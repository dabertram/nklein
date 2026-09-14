/**
 * P23.5 (2) — the `constrained_schema` rung of the SWARM recovery ladder: force the tool call the model failed to fill.
 *
 * ── WHY A RUNG, NOT ANOTHER TOOL ERROR ──
 * The P23.5 campaign's wall was a worker that "could not even COPY the provided contents — three empty `write_file`
 * calls with the full payload sitting in its prompt; clean stops, so no budget ladder applies" (2026-08-12). The tool
 * error ("path is required") is the model's own channel, and it had already shown it would answer that channel with
 * the same empty call. The chat loop has had a model-side answer since §5.AA: re-ask on the NATIVE forcing wire
 * (`tool_choice:"required"`), then with a `response_format: json_schema` that structurally cannot emit `{}` for a
 * schema with required fields. This model brings the same two-step lever to the swarm path.
 *
 * ── THE TWO STEPS, IN THIS ORDER ──
 * 1. `native_tool_choice` — the offered tool(s), `tool_choice: "required"`, the model picks the arguments freely.
 * 2. `json_schema` — a per-tool constrained schema (`anyOf` over the tools' OWN parameter schemas): the grammar makes
 *    the required fields present. Second because grammar-forced payloads can degrade to minimal-valid junk
 *    (`{"id":"0","title":"1"}`, dschinn 2026-08-30) — the freer wire gets the first shot, and every result is judged
 *    by the shared argument assessor before it is emitted. An unusable result is still EMITTED (as the call the model
 *    made) so the recovery classifier judges it `malformed` again and the ladder moves on; only when neither step
 *    produced a call at all does this throw {@link ConstrainedToolCallNoCallError} — the classifier keeps the outcome
 *    `malformed` for that too.
 *
 * ── CAVEATS CARRIED FROM THE ALTERNATE WIRES ──
 * The direct client speaks a text wire: history tool calls are flattened to `[tool_call …]` pseudo-text, which once
 * taught a live architect that syntax (the reason `NKLEIN_ALTERNATE_ENDPOINT=off` exists). This rung fires ONLY after
 * a malformed call, on one turn, and asks for a STRUCTURED reply — so the exposure is one flattened prompt, not a
 * session on the wire. `NKLEIN_CONSTRAINED_TOOL_CALL=off` removes the rung for rigs that must not risk it.
 */

import type { AgentModel, AgentModelEvent, AgentModelRequest, AgentToolDefinition } from "@cline/shared";
import { assessToolArgumentRepair, dispatchArgumentsAfterRepair } from "../core/tool-argument-repair.js";
import { agentMessageToEndpointText } from "./local-alternate-endpoint-model.js";
import { buildConstrainedToolCallSchema, parseConstrainedToolCall } from "./nklein-constrained-tool-call.js";
import type {
	LocalLlmChatMessage,
	LocalLlmSamplingOptions,
	LocalLlmToolDefinition,
} from "./nklein-local-llm-client.js";
import type { SkillApiProfileDirectClient } from "./skill-api-profile-agent-model.js";

/** `request.options.metadata` key under which the recovery model names the call that failed. */
export const CONSTRAINED_TOOL_CALL_CONTEXT_KEY = "nkleinConstrainedToolCall";

/** What the previous attempt got wrong — carried on the request so the re-ask can name it. */
export interface ConstrainedToolCallContext {
	readonly toolName: string;
	readonly fieldsToReask: readonly string[];
	readonly reason: string;
}

export type ConstrainedToolCallRung = "native_tool_choice" | "json_schema";

export interface ConstrainedToolCallObservation {
	readonly rung: ConstrainedToolCallRung;
	readonly toolName: string | null;
	/** The assessor's verdict for the call this rung produced (`no_call` when it produced none). */
	readonly verdict: string;
	readonly reason: string;
	readonly usable: boolean;
}

export interface ConstrainedToolCallModelOptions {
	readonly directClient: SkillApiProfileDirectClient;
	readonly modelId: string;
	readonly baseMaxTokens?: number | null;
	readonly onObservation?: (observation: ConstrainedToolCallObservation) => void;
}

/** Neither forcing step produced ANY tool call — the classifier keeps the turn `malformed` and moves down the ladder. */
export class ConstrainedToolCallNoCallError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConstrainedToolCallNoCallError";
	}
}

export function readConstrainedToolCallContext(request: AgentModelRequest): ConstrainedToolCallContext | null {
	const metadata = request.options?.metadata;
	if (!metadata || typeof metadata !== "object") return null;
	const raw = (metadata as Record<string, unknown>)[CONSTRAINED_TOOL_CALL_CONTEXT_KEY];
	if (!raw || typeof raw !== "object") return null;
	const context = raw as Partial<ConstrainedToolCallContext>;
	if (typeof context.toolName !== "string" || !context.toolName) return null;
	return {
		toolName: context.toolName,
		fieldsToReask: Array.isArray(context.fieldsToReask)
			? context.fieldsToReask.filter((field): field is string => typeof field === "string")
			: [],
		reason: typeof context.reason === "string" ? context.reason : "",
	};
}

/** The re-ask, worded for a model that just emitted the call without its arguments. */
export function constrainedToolCallReask(context: ConstrainedToolCallContext | null, tools: readonly string[]): string {
	const target = context?.toolName ?? tools[0] ?? "the required tool";
	const fields =
		context && context.fieldsToReask.length > 0
			? ` It was missing or unusable for: ${context.fieldsToReask.join(", ")}.`
			: context?.reason
				? ` (${context.reason}).`
				: "";
	return (
		`Your previous \`${target}\` call carried no usable arguments.${fields} ` +
		`Call \`${target}\` again now with EVERY required argument filled in from the task above — ` +
		"the complete values, never placeholders or empty strings. Emit the tool call only; do not explain."
	);
}

function toDirectTools(tools: readonly AgentToolDefinition[]): LocalLlmToolDefinition[] {
	return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema }));
}

function toDirectMessages(request: AgentModelRequest, reask: string): LocalLlmChatMessage[] {
	const messages: LocalLlmChatMessage[] = [
		...(request.systemPrompt?.trim() ? [{ role: "system" as const, content: request.systemPrompt }] : []),
		...request.messages.map((message) => ({
			role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
			content: agentMessageToEndpointText(message),
		})),
	];
	// Alternation-safe (Mistral-family templates hard-500 on consecutive same-role turns): merge the re-ask into a
	// trailing user turn rather than appending a second one.
	const last = messages.at(-1);
	if (last && last.role === "user") {
		messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${reask}` };
	} else {
		messages.push({ role: "user", content: reask });
	}
	return messages;
}

function samplingFor(request: AgentModelRequest, baseMaxTokens: number | null | undefined): LocalLlmSamplingOptions {
	const temperature = request.options?.temperature;
	const maxTokens = request.options?.maxTokens;
	return {
		...(typeof temperature === "number" && Number.isFinite(temperature) ? { temperature } : {}),
		...(typeof maxTokens === "number" && Number.isFinite(maxTokens)
			? { maxTokens }
			: typeof baseMaxTokens === "number" && Number.isFinite(baseMaxTokens)
				? { maxTokens: baseMaxTokens }
				: {}),
	};
}

interface JudgedCall {
	readonly id: string;
	readonly name: string;
	readonly rawArguments: unknown;
	readonly dispatchArguments: Record<string, unknown> | undefined;
	readonly verdict: string;
	readonly reason: string;
}

function judge(
	call: { id: string; name: string; arguments: unknown },
	tools: readonly LocalLlmToolDefinition[],
): JudgedCall {
	const tool = tools.find((candidate) => candidate.name === call.name);
	const assessment = assessToolArgumentRepair({ name: call.name, arguments: call.arguments }, tool);
	return {
		id: call.id,
		name: call.name,
		rawArguments: call.arguments,
		dispatchArguments: dispatchArgumentsAfterRepair({ name: call.name, arguments: call.arguments }, assessment),
		verdict: assessment.verdict,
		reason: assessment.reason,
	};
}

function callEvents(calls: readonly { id: string; name: string; arguments: unknown }[]): AgentModelEvent[] {
	const seen = new Set<string>();
	const events: AgentModelEvent[] = calls.map((call, index) => {
		let toolCallId = call.id;
		if (!toolCallId || seen.has(toolCallId)) toolCallId = `${call.id || "constrained"}_${index}`;
		seen.add(toolCallId);
		const input = call.arguments;
		return {
			type: "tool-call-delta",
			toolCallId,
			toolName: call.name,
			...(input !== null && typeof input === "object" ? { input } : {}),
			inputText: typeof input === "string" ? input : JSON.stringify(input),
		};
	});
	events.push({ type: "finish", reason: "tool-calls" });
	return events;
}

function observe(options: ConstrainedToolCallModelOptions, observation: ConstrainedToolCallObservation): void {
	try {
		options.onObservation?.(observation);
	} catch {
		// Observability must never alter recovery semantics.
	}
}

/**
 * Build the constrained rung as an {@link AgentModel}. The recovery model selects it for `constrained_schema`, narrows
 * `request.tools` to the tool the model failed to call properly, and stamps {@link CONSTRAINED_TOOL_CALL_CONTEXT_KEY}.
 */
export function createConstrainedToolCallModel(options: ConstrainedToolCallModelOptions): AgentModel {
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				if (request.signal?.aborted) throw request.signal.reason ?? new Error("request aborted");
				if (request.tools.length === 0) {
					throw new ConstrainedToolCallNoCallError("constrained tool call: no tools offered on this turn");
				}
				const tools = toDirectTools(request.tools);
				const context = readConstrainedToolCallContext(request);
				const messages = toDirectMessages(
					request,
					constrainedToolCallReask(
						context,
						tools.map((tool) => tool.name),
					),
				);
				const sampling = samplingFor(request, options.baseMaxTokens);
				let lastUnusable: JudgedCall | null = null;

				// 1) Native forcing: the model fills the arguments itself.
				const native = await options.directClient.completeWithTools(
					{ messages, sampling, signal: request.signal },
					tools,
					{ toolChoice: "required" },
				);
				const judgedNative = native.toolCalls.map((call) => judge(call, tools));
				const usableNative = judgedNative.filter((call) => call.dispatchArguments !== undefined);
				const firstNative = judgedNative[0] ?? null;
				observe(options, {
					rung: "native_tool_choice",
					toolName: firstNative?.name ?? null,
					verdict: firstNative ? (usableNative[0] ?? firstNative).verdict : "no_call",
					reason: firstNative ? (usableNative[0] ?? firstNative).reason : "the forced turn returned no tool call",
					usable: usableNative.length > 0,
				});
				if (usableNative.length > 0) {
					if (native.content.trim().length > 0) yield { type: "text-delta", text: native.content };
					for (const event of callEvents(
						usableNative.map((call) => ({ id: call.id, name: call.name, arguments: call.dispatchArguments })),
					))
						yield event;
					return;
				}
				lastUnusable = firstNative;

				// 2) Grammar: the per-tool schema makes the required fields present by construction.
				const schema = buildConstrainedToolCallSchema(tools, {
					perToolArguments: true,
					schemaName: "klein_constrained_tool_call",
				});
				if (schema) {
					const constrained = await options.directClient.complete({
						messages,
						sampling,
						format: { jsonSchema: schema },
						signal: request.signal,
					});
					const parsed = parseConstrainedToolCall(constrained.content, tools);
					const judgedSchema = parsed
						? judge(
								{
									id: `constrained-${Date.now().toString(36)}`,
									name: parsed.name,
									arguments: parsed.arguments,
								},
								tools,
							)
						: null;
					observe(options, {
						rung: "json_schema",
						toolName: judgedSchema?.name ?? null,
						verdict: judgedSchema?.verdict ?? "no_call",
						reason: judgedSchema?.reason ?? "the constrained reply named no offered tool",
						usable: judgedSchema?.dispatchArguments !== undefined,
					});
					if (judgedSchema?.dispatchArguments !== undefined) {
						for (const event of callEvents([
							{ id: judgedSchema.id, name: judgedSchema.name, arguments: judgedSchema.dispatchArguments },
						]))
							yield event;
						return;
					}
					if (judgedSchema) lastUnusable = judgedSchema;
				}

				// Neither step produced a usable call. Emit the call the model DID make so the classifier judges it
				// malformed again (and the ladder moves on); with no call at all, say so in a typed error.
				if (lastUnusable) {
					for (const event of callEvents([
						{ id: lastUnusable.id, name: lastUnusable.name, arguments: lastUnusable.rawArguments },
					]))
						yield event;
					return;
				}
				throw new ConstrainedToolCallNoCallError(
					`constrained tool call: neither native forcing nor json_schema produced a call to ${
						context?.toolName ?? tools.map((tool) => tool.name).join("/")
					}`,
				);
			})();
		},
	};
}
