/**
 * F4.7 / §5.O — live result-handle bridge for bulk tool output.
 *
 * Tool output is already part of the next model request, so one unexpectedly large read/search/command result can
 * consume a material share of a 32k window before the normal history compactor has anything old to discard. Keep a
 * short head+tail preview in the transcript, store the exact value in a per-session {@link ResultHandleStore}, and let
 * the model fetch it explicitly through `resolve_result` only when the omitted body is actually needed.
 *
 * This is intentionally conservative: only read/search/command-shaped tools are eligible, failed results are never
 * hidden, and control-plane verdicts/mutations are never replaced. The resolver itself is excluded so resolving a
 * handle cannot recursively produce another handle.
 */

import { createResultHandleStore, parseResultHandle, type ResultHandleStore } from "../core/result-handle.js";
import type { AgentTool, AgentToolResult } from "./sdk-agent-types.js";

export const RESULT_HANDLE_RESOLVER_TOOL_NAME = "resolve_result";

const MIN_HANDLE_THRESHOLD_TOKENS = 2_000;
const MAX_HANDLE_THRESHOLD_TOKENS = 8_000;
const HANDLE_THRESHOLD_WINDOW_FRACTION = 0.1;
const RESULT_PREVIEW_CHARS = 1_600;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;
const DEFAULT_RESOLVE_CHARS = 8_000;
const MAX_RESOLVE_CHARS = 16_000;

const BULK_RESULT_TOOL_NAME =
	/(?:^|[_-])(read|search|grep|find|list|browse|fetch)(?:$|[_-])|^(?:bash|terminal|run_command|execute_command)$/i;

function serializeForMeasurement(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function thresholdTokens(contextWindow: number | null | undefined): number {
	const window =
		typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
			? contextWindow
			: DEFAULT_CONTEXT_WINDOW_TOKENS;
	return Math.max(
		MIN_HANDLE_THRESHOLD_TOKENS,
		Math.min(MAX_HANDLE_THRESHOLD_TOKENS, Math.floor(window * HANDLE_THRESHOLD_WINDOW_FRACTION)),
	);
}

function preview(text: string): string {
	if (text.length <= RESULT_PREVIEW_CHARS) {
		return text;
	}
	const half = Math.floor(RESULT_PREVIEW_CHARS / 2);
	return `${text.slice(0, half)}\n\n… [middle omitted] …\n\n${text.slice(-half)}`;
}

export interface HandleLargeToolResultInput {
	toolName: string;
	result: AgentToolResult;
	store: ResultHandleStore;
	contextWindow?: number | null;
}

/**
 * Replace an oversized, successful bulk-tool result with a compact handle notice. Returns the original result object
 * when no replacement is needed, which makes the no-op path observable and allocation-free.
 */
export function handleLargeToolResult(input: HandleLargeToolResultInput): AgentToolResult {
	if (
		input.result.isError === true ||
		input.toolName === RESULT_HANDLE_RESOLVER_TOOL_NAME ||
		!BULK_RESULT_TOOL_NAME.test(input.toolName)
	) {
		return input.result;
	}
	const serialized = serializeForMeasurement(input.result.output);
	const estimatedTokens = Math.ceil(serialized.length / 4);
	if (estimatedTokens <= thresholdTokens(input.contextWindow)) {
		return input.result;
	}

	const handle = input.store.put(input.toolName, input.result.output);
	return {
		...input.result,
		output: [
			`Large ${input.toolName} result stored as ${handle} (~${estimatedTokens} tokens).`,
			`Use ${RESULT_HANDLE_RESOLVER_TOOL_NAME} with this handle only if the omitted body is necessary.`,
			"Preview (head + tail):",
			preview(serialized),
		].join("\n\n"),
		metadata: {
			...(input.result.metadata ?? {}),
			resultHandle: handle,
			originalEstimatedTokens: estimatedTokens,
		},
	};
}

/** Coerce a number-ish input (number or numeric string) to a finite integer, else null — parse-and-recover. */
function coerceInteger(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
	}
	return null;
}

/** Create the per-session store plus the resolver tool that reads bounded slices from exact stored values. */
export function createSessionResultHandles(): { store: ResultHandleStore; tool: AgentTool } {
	const store = createResultHandleStore();
	// Live 20260810-194712: the model read chunk 0-16000 and then asked — in its own words — to continue "from
	// character 16000 onwards" while emitting the SAME offset-less call three times; the tool re-served page one
	// until the loop guard killed the session. An identical offset-less repeat means "next page" to the caller,
	// so an omitted offset now continues from where the last call on that handle left off. An explicit offset
	// (including 0 to re-read) always wins and re-anchors the cursor.
	const cursorByHandle = new Map<string, number>();
	const tool: AgentTool = {
		name: RESULT_HANDLE_RESOLVER_TOOL_NAME,
		description:
			"Resolve a result:// handle returned for an omitted large tool result. Call only when the preview is insufficient. Omitting offset continues from where the previous call on that handle left off; pass offset 0 to re-read from the start.",
		// The SAME live run also pre-rejected the model's first, reasonable attempt (maxChars 75000 for an 85KB
		// document) with a multi-KB Zod dump — for a bound execute() clamps gracefully anyway. The boundary
		// schema carries NO validation keywords beyond the root object; the defensive parsing below governs.
		inputSchema: {
			type: "object",
			properties: {
				handle: { description: "The exact result:// handle to retrieve." },
				offset: {
					description:
						"Character offset into the stored result. Omit to continue from the previous call; 0 restarts.",
				},
				maxChars: {
					description: `Maximum characters to return (default ${DEFAULT_RESOLVE_CHARS}, cap ${MAX_RESOLVE_CHARS}).`,
				},
			},
			required: ["handle"],
			additionalProperties: true,
		},
		execute(input) {
			const handle =
				input && typeof input === "object" && typeof (input as { handle?: unknown }).handle === "string"
					? (input as { handle: string }).handle.trim()
					: "";
			if (!handle || parseResultHandle(handle) === null) {
				throw new Error("resolve_result requires a valid result://<tool>/<id> handle.");
			}
			const value = store.get(handle);
			if (value === undefined) {
				throw new Error(`Unknown or expired result handle: ${handle}`);
			}
			const record = input as { offset?: unknown; maxChars?: unknown };
			const explicitOffset = coerceInteger(record.offset);
			const coercedMaxChars = coerceInteger(record.maxChars);
			const maxChars =
				coercedMaxChars !== null
					? Math.max(1, Math.min(MAX_RESOLVE_CHARS, coercedMaxChars))
					: DEFAULT_RESOLVE_CHARS;
			const serialized = serializeForMeasurement(value);
			const requestedOffset =
				explicitOffset !== null ? Math.max(0, explicitOffset) : (cursorByHandle.get(handle) ?? 0);
			const offset = Math.min(serialized.length, requestedOffset);
			const end = Math.min(serialized.length, offset + maxChars);
			// At the end, an offset-less repeat re-serves the final page (with the end marker) instead of advancing
			// past the document — the cursor never moves beyond the last byte.
			cursorByHandle.set(handle, end < serialized.length ? end : offset);
			const next = end < serialized.length ? `\n\n[next offset: ${end}]` : "\n\n[end of result]";
			return `[${handle} characters ${offset}-${end} of ${serialized.length}]\n${serialized.slice(offset, end)}${next}`;
		},
	};
	return { store, tool };
}
