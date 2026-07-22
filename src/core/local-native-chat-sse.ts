/**
 * F4.34 — incremental parser/state machine for LM Studio native `/api/v1/chat` SSE.
 *
 * The wire is ordinary named SSE, but generation is a protocol: `chat.start` opens it, reasoning/message deltas build
 * partial channels, MCP tool events describe a server-executed action/result, and `chat.end.result` is the authoritative
 * aggregate. A transport EOF without `chat.end` is preserved as an explicit termination state, never mistaken for a
 * successful stop. Unknown events remain observable so a future LM Studio addition cannot silently disappear.
 */

import { type ParsedNativeChatResponse, parseNativeChatResponse } from "./local-native-chat-shape.js";

export interface NativeChatSseEvent {
	type: string;
	data: Readonly<Record<string, unknown>>;
}

export interface NativeChatStreamError {
	type: string;
	message: string;
	code: string | null;
	param: string | null;
}

export interface ParsedNativeChatStream {
	result: ParsedNativeChatResponse;
	errors: NativeChatStreamError[];
	termination: "chat_end" | "json_response" | "eof_without_chat_end";
	eventTypes: string[];
	protocolErrors: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseBlock(block: string): { event: NativeChatSseEvent | null; error: string | null } {
	let wireType = "message";
	const dataLines: string[] = [];
	for (const rawLine of block.split(/\r?\n/u)) {
		if (!rawLine || rawLine.startsWith(":")) continue;
		const colon = rawLine.indexOf(":");
		const field = colon < 0 ? rawLine : rawLine.slice(0, colon);
		const value = colon < 0 ? "" : rawLine.slice(colon + 1).replace(/^ /u, "");
		if (field === "event") wireType = value;
		else if (field === "data") dataLines.push(value);
	}
	if (dataLines.length === 0) return { event: null, error: null };
	try {
		const data = asRecord(JSON.parse(dataLines.join("\n")));
		if (!data) return { event: null, error: `SSE ${wireType} data was not a JSON object.` };
		const payloadType = typeof data.type === "string" ? data.type : wireType;
		return {
			event: { type: payloadType, data },
			error:
				payloadType === wireType ? null : `SSE event name ${wireType} disagreed with payload type ${payloadType}.`,
		};
	} catch (error) {
		return {
			event: null,
			error: `SSE ${wireType} carried invalid JSON: ${error instanceof Error ? error.message : error}.`,
		};
	}
}

/** Incremental, chunk-boundary-safe native chat SSE state machine. */
export class NativeChatSseStateMachine {
	#buffer = "";
	#eventTypes: string[] = [];
	#protocolErrors: string[] = [];
	#errors: NativeChatStreamError[] = [];
	#text = "";
	#reasoning = "";
	#modelInstanceId: string | null = null;
	#toolOutputs: Record<string, unknown>[] = [];
	#final: ParsedNativeChatResponse | null = null;
	#ended = false;

	push(chunk: string): NativeChatSseEvent[] {
		if (!chunk) return [];
		if (this.#ended) {
			this.#protocolErrors.push("Received SSE bytes after chat.end.");
			return [];
		}
		this.#buffer += chunk;
		const emitted: NativeChatSseEvent[] = [];
		while (true) {
			const boundary = /\r?\n\r?\n/u.exec(this.#buffer);
			if (!boundary || boundary.index === undefined) break;
			const block = this.#buffer.slice(0, boundary.index);
			this.#buffer = this.#buffer.slice(boundary.index + boundary[0].length);
			const parsed = parseBlock(block);
			if (parsed.error) this.#protocolErrors.push(parsed.error);
			if (parsed.event) {
				this.#accept(parsed.event);
				emitted.push(parsed.event);
			}
		}
		return emitted;
	}

	finish(): ParsedNativeChatStream {
		if (this.#buffer.trim()) {
			const parsed = parseBlock(this.#buffer);
			if (parsed.error) this.#protocolErrors.push(parsed.error);
			if (parsed.event) this.#accept(parsed.event);
		}
		this.#buffer = "";
		const fallback = parseNativeChatResponse({
			model_instance_id: this.#modelInstanceId,
			output: [
				...(this.#reasoning ? [{ type: "reasoning", content: this.#reasoning }] : []),
				...this.#toolOutputs,
				...(this.#text ? [{ type: "message", content: this.#text }] : []),
			],
			stats: {},
		});
		return {
			result: this.#final ?? fallback,
			errors: [...this.#errors],
			termination: this.#ended ? "chat_end" : "eof_without_chat_end",
			eventTypes: [...this.#eventTypes],
			protocolErrors: [...this.#protocolErrors],
		};
	}

	#accept(event: NativeChatSseEvent): void {
		this.#eventTypes.push(event.type);
		if (event.type === "chat.start" && typeof event.data.model_instance_id === "string") {
			this.#modelInstanceId = event.data.model_instance_id;
		} else if (event.type === "reasoning.delta" && typeof event.data.content === "string") {
			this.#reasoning += event.data.content;
		} else if (event.type === "message.delta" && typeof event.data.content === "string") {
			this.#text += event.data.content;
		} else if (event.type === "tool_call.success") {
			this.#toolOutputs.push({
				type: "tool_call",
				tool: event.data.tool,
				arguments: event.data.arguments,
				output: event.data.output,
				provider_info: event.data.provider_info,
			});
		} else if (event.type === "tool_call.failure") {
			this.#toolOutputs.push({
				type: "invalid_tool_call",
				reason: event.data.reason,
				metadata: event.data.metadata,
			});
		} else if (event.type === "error") {
			const error = asRecord(event.data.error) ?? {};
			this.#errors.push({
				type: typeof error.type === "string" ? error.type : "unknown",
				message: typeof error.message === "string" ? error.message : "Unknown native chat stream error.",
				code: typeof error.code === "string" ? error.code : null,
				param: typeof error.param === "string" ? error.param : null,
			});
		} else if (event.type === "chat.end") {
			if (this.#ended) this.#protocolErrors.push("Received duplicate chat.end.");
			const result = asRecord(event.data.result);
			if (result) this.#final = parseNativeChatResponse(result);
			else this.#protocolErrors.push("chat.end did not contain an object result.");
			this.#ended = true;
		}
	}
}
