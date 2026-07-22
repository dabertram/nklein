/** F4.45b — transcript-owning stateful `/v1/responses` AgentModel decorator. */
import { createHash } from "node:crypto";
import type {
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentUsage,
} from "@cline/shared";
import { canonicalJson } from "../core/content-addressable-cache.js";

type StatefulResponsesPlanMode = "stateful_delta" | "stateless_full";

interface StatefulResponsesPlan {
	mode: StatefulResponsesPlanMode;
	messages: readonly AgentMessage[];
	fullMessages: readonly AgentMessage[];
	previousResponseId: string | null;
	invalidatedPriorState: boolean;
	generation: number;
	systemPrompt: string;
	policyKey: string;
}

interface StatefulResponsesState {
	responseId: string;
	requestFingerprints: readonly string[];
	assistantFingerprint: string;
	systemPrompt: string;
	policyKey: string;
}

export interface StatefulResponsesObservation {
	type: "session_started" | "stateful_delta" | "stateless_fallback" | "invalidated";
	detail: string;
}

export interface StatefulResponsesModelOptions {
	onObservation?: (observation: StatefulResponsesObservation) => void;
}

function isAdaptiveRetryInstruction(message: AgentMessage): boolean {
	return message.role === "user" && message.id.startsWith("nklein-retry-");
}

function binaryBase64(value: Uint8Array | ArrayBuffer): string {
	return value instanceof ArrayBuffer
		? Buffer.from(value).toString("base64")
		: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
}

function wirePartFingerprint(part: AgentMessagePart): unknown {
	if (part.type === "text") return { type: part.type, text: part.text };
	if (part.type === "reasoning") return { type: part.type, text: part.text, redacted: part.redacted === true };
	if (part.type === "file") return { type: part.type, path: part.path, content: part.content };
	if (part.type === "image") {
		const image = part.image;
		return {
			type: part.type,
			mediaType: part.mediaType ?? null,
			image:
				typeof image === "string"
					? { kind: "string", value: image }
					: image instanceof URL
						? { kind: "url", value: image.href }
						: { kind: "binary", value: binaryBase64(image) },
		};
	}
	if (part.type === "tool-call") {
		return {
			type: part.type,
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			input: part.input,
		};
	}
	return {
		type: part.type,
		toolCallId: part.toolCallId,
		toolName: part.toolName,
		output: part.output,
		isError: part.isError === true,
	};
}

function stableHash(value: unknown): string {
	try {
		return createHash("sha256").update(canonicalJson(value)).digest("hex");
	} catch {
		return createHash("sha256").update(String(value)).digest("hex");
	}
}

function messageFingerprint(message: AgentMessage): string {
	return stableHash({ role: message.role, content: message.content.map(wirePartFingerprint) });
}

function startsWithFingerprints(current: readonly string[], prefix: readonly string[]): boolean {
	return prefix.length <= current.length && prefix.every((fingerprint, index) => current[index] === fingerprint);
}

function safeJson(value: unknown): string {
	try {
		return canonicalJson(value);
	} catch {
		return String(value);
	}
}

function policyKey(request: AgentModelRequest): string {
	return safeJson({
		tools: request.tools,
		temperature: request.options?.temperature,
		reasoning: request.options?.reasoning,
		thinking: request.options?.thinking,
		reasoningEffort: request.options?.reasoningEffort,
	});
}

class StatefulResponsesController {
	#state: StatefulResponsesState | null = null;
	#generation = 0;

	plan(request: AgentModelRequest): StatefulResponsesPlan {
		const fullMessages = request.messages.filter((message) => !isAdaptiveRetryInstruction(message));
		const attemptMessages = request.messages.filter(isAdaptiveRetryInstruction);
		const fingerprints = fullMessages.map(messageFingerprint);
		const currentPolicyKey = policyKey(request);
		const currentSystemPrompt = request.systemPrompt ?? "";
		const state = this.#state;
		if (
			state &&
			state.systemPrompt === currentSystemPrompt &&
			state.policyKey === currentPolicyKey &&
			startsWithFingerprints(fingerprints, state.requestFingerprints)
		) {
			const tail = fullMessages.slice(state.requestFingerprints.length);
			const priorAssistant = tail[0];
			if (
				tail.length >= 2 &&
				priorAssistant?.role === "assistant" &&
				messageFingerprint(priorAssistant) === state.assistantFingerprint
			) {
				return {
					mode: "stateful_delta",
					messages: [...tail.slice(1), ...attemptMessages],
					fullMessages,
					previousResponseId: state.responseId,
					invalidatedPriorState: false,
					generation: this.#generation,
					systemPrompt: currentSystemPrompt,
					policyKey: currentPolicyKey,
				};
			}
		}
		const invalidatedPriorState = state ? this.invalidate() : false;
		return {
			mode: "stateless_full",
			messages: [...fullMessages, ...attemptMessages],
			fullMessages,
			previousResponseId: null,
			invalidatedPriorState,
			generation: this.#generation,
			systemPrompt: currentSystemPrompt,
			policyKey: currentPolicyKey,
		};
	}

	accept(plan: StatefulResponsesPlan, responseId: string, assistantFingerprint: string): boolean {
		if (plan.generation !== this.#generation || !responseId || !assistantFingerprint) return false;
		this.#state = {
			responseId,
			requestFingerprints: plan.fullMessages.map(messageFingerprint),
			assistantFingerprint,
			systemPrompt: plan.systemPrompt,
			policyKey: plan.policyKey,
		};
		this.#generation += 1;
		return true;
	}

	invalidate(): boolean {
		const hadState = this.#state !== null;
		this.#state = null;
		this.#generation += 1;
		return hadState;
	}
}

interface ToolAssembly {
	id: string | null;
	name: string | null;
	input: unknown;
	inputText: string;
}

function parseInputText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function assistantFingerprint(events: readonly AgentModelEvent[]): string | null {
	const parts: AgentMessagePart[] = [];
	const tools = new Map<string, ToolAssembly>();
	const sequence: Array<{ type: "part"; index: number } | { type: "tool"; key: string }> = [];
	let anonymousToolIndex = 0;
	for (const event of events) {
		if (event.type === "text-delta" || event.type === "reasoning-delta") {
			const type = event.type === "text-delta" ? "text" : "reasoning";
			const lastSequence = sequence.at(-1);
			const last = lastSequence?.type === "part" ? parts[lastSequence.index] : undefined;
			if (last?.type === type) last.text += event.text;
			else {
				parts.push(type === "text" ? { type, text: event.text } : { type, text: event.text });
				sequence.push({ type: "part", index: parts.length - 1 });
			}
			continue;
		}
		if (event.type !== "tool-call-delta") continue;
		const key = event.toolCallId ?? `anonymous-${event.index ?? anonymousToolIndex++}`;
		let tool = tools.get(key);
		if (!tool) {
			tool = { id: event.toolCallId ?? null, name: event.toolName ?? null, input: event.input, inputText: "" };
			tools.set(key, tool);
			sequence.push({ type: "tool", key });
		}
		if (event.toolCallId) tool.id = event.toolCallId;
		if (event.toolName) tool.name = event.toolName;
		if (event.input !== undefined) tool.input = event.input;
		if (event.inputText) tool.inputText += event.inputText;
	}
	const content: AgentMessagePart[] = [];
	for (const item of sequence) {
		if (item.type === "part") {
			const part = parts[item.index];
			if (part) content.push(part);
			continue;
		}
		const tool = tools.get(item.key);
		if (!tool?.id || !tool.name) return null;
		content.push({
			type: "tool-call",
			toolCallId: tool.id,
			toolName: tool.name,
			input: tool.input !== undefined ? tool.input : parseInputText(tool.inputText),
		});
	}
	if (content.length === 0) return null;
	return messageFingerprint({ id: "provider-response", role: "assistant", createdAt: 0, content });
}

function responseId(events: readonly AgentModelEvent[]): string | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== "finish" || !event.metadata || typeof event.metadata !== "object") continue;
		const openai = (event.metadata as Record<string, unknown>).openai;
		if (!openai || typeof openai !== "object") continue;
		const id = (openai as Record<string, unknown>).responseId;
		if (typeof id === "string" && id.length > 0) return id;
	}
	return null;
}

function lastFinish(events: readonly AgentModelEvent[]): Extract<AgentModelEvent, { type: "finish" }> | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "finish") return event;
	}
	return null;
}

function successful(events: readonly AgentModelEvent[]): boolean {
	const finish = lastFinish(events);
	return finish?.reason === "stop" || finish?.reason === "tool-calls";
}

async function collect(base: AgentModel, request: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await base.stream(request)) events.push(event);
	return events;
}

function withStatefulMetadata(request: AgentModelRequest, plan: StatefulResponsesPlan): AgentModelRequest {
	const currentMetadata = (request.options?.metadata as Record<string, unknown> | undefined) ?? {};
	const { nkleinPreviousResponseId: _previous, nkleinStatefulResponses: _stateful, ...baseMetadata } = currentMetadata;
	const metadata = {
		...baseMetadata,
		nkleinStatefulResponses: true,
		...(plan.previousResponseId ? { nkleinPreviousResponseId: plan.previousResponseId } : {}),
	};
	return {
		...request,
		messages: plan.messages,
		// Keep the exact system prompt on every request. The verified SDK route moves it to top-level `instructions`
		// (which Responses does not inherit through previous_response_id) without duplicating stored system messages.
		options: { ...request.options, metadata },
	};
}

function summedUsage(events: readonly AgentModelEvent[]): Partial<AgentUsage> | null {
	let sawUsage = false;
	const total: Partial<AgentUsage> = {};
	for (const event of events) {
		if (event.type !== "usage") continue;
		sawUsage = true;
		for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
			const value = event.usage[key];
			if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
		}
		if (typeof event.usage.reasoningTokenCount === "number") {
			total.reasoningTokenCount = (total.reasoningTokenCount ?? 0) + event.usage.reasoningTokenCount;
		}
	}
	return sawUsage ? total : null;
}

function retainFailedAttemptUsage(
	failed: readonly AgentModelEvent[],
	fallback: readonly AgentModelEvent[],
): AgentModelEvent[] {
	const usage = summedUsage([...failed, ...fallback]);
	if (!usage || !failed.some((event) => event.type === "usage")) return [...fallback];
	const withoutUsage = fallback.filter((event) => event.type !== "usage");
	const finishIndex = withoutUsage.findIndex((event) => event.type === "finish");
	const insertion = finishIndex < 0 ? withoutUsage.length : finishIndex;
	return [...withoutUsage.slice(0, insertion), { type: "usage", usage }, ...withoutUsage.slice(insertion)];
}

function observe(options: StatefulResponsesModelOptions, observation: StatefulResponsesObservation): void {
	try {
		options.onObservation?.(observation);
	} catch {
		// Observability never changes provider behavior.
	}
}

/** Wrap a verified Responses model with delta chaining and one per-turn full-transcript fallback. */
export function createStatefulResponsesModel(
	base: AgentModel,
	options: StatefulResponsesModelOptions = {},
): AgentModel {
	const controller = new StatefulResponsesController();
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				let plan = controller.plan(request);
				if (plan.invalidatedPriorState) {
					observe(options, {
						type: "invalidated",
						detail: "The authoritative transcript or generation policy diverged from the stored response chain.",
					});
				}
				let firstEvents: AgentModelEvent[] = [];
				try {
					firstEvents = await collect(base, withStatefulMetadata(request, plan));
				} catch (error) {
					if (request.signal?.aborted || plan.mode === "stateless_full") throw error;
				}
				if (successful(firstEvents)) {
					const id = responseId(firstEvents);
					const fingerprint = assistantFingerprint(firstEvents);
					if (id && fingerprint && controller.accept(plan, id, fingerprint)) {
						observe(options, {
							type: plan.mode === "stateful_delta" ? "stateful_delta" : "session_started",
							detail: plan.mode,
						});
					} else if (controller.invalidate()) {
						observe(options, {
							type: "invalidated",
							detail: "Response completed without a chainable exact result.",
						});
					}
					for (const event of firstEvents) yield event;
					return;
				}
				if (plan.mode === "stateless_full") {
					for (const event of firstEvents) yield event;
					return;
				}
				if (request.signal?.aborted) {
					for (const event of firstEvents) yield event;
					return;
				}
				if (lastFinish(firstEvents)?.reason === "max-tokens") {
					// Truncation is a valid response, not evidence that server state vanished. Preserve the prior handle so
					// the outer adaptive wrapper can retry the same delta with a larger budget and no redundant full replay.
					for (const event of firstEvents) yield event;
					return;
				}
				controller.invalidate();
				observe(options, {
					type: "stateless_fallback",
					detail: "Stateful Responses continuation failed; replaying the authoritative transcript once.",
				});
				plan = controller.plan(request);
				const fallbackEvents = await collect(base, withStatefulMetadata(request, plan));
				if (successful(fallbackEvents)) {
					const id = responseId(fallbackEvents);
					const fingerprint = assistantFingerprint(fallbackEvents);
					if (id && fingerprint && controller.accept(plan, id, fingerprint)) {
						observe(options, { type: "session_started", detail: "stateless_fallback_reseeded" });
					}
				}
				for (const event of retainFailedAttemptUsage(firstEvents, fallbackEvents)) yield event;
			})();
		},
	};
}
