/**
 * P23.5 (2) — triage of a turn's STREAMED tool calls against the offered schemas, BEFORE the SDK dispatches them.
 * PURE core.
 *
 * ── THE FAILURE THIS COMES FROM (P23.5 campaign, 2026-08-12) ──
 * A worker "could not even COPY the provided contents — three empty `write_file` calls with the full payload
 * sitting in its prompt; the emission wall in its purest form, clean stops so no budget ladder applies". The swarm
 * recovery model classified each of those turns as a SUCCESS: it only asked "did a tool call happen?", and one had.
 * The SDK then salvaged the empty argument text to `{}`, the tool refused it, and the model got another chance to
 * emit the same empty call. Nothing model-side ever changed between attempts.
 *
 * ── WHAT THIS DOES ──
 * Reassemble the turn's `tool-call-delta` events into calls exactly the way the SDK runtime does (same grouping key,
 * same merge rule), then judge each call's arguments with the shared repair assessor (`tool-argument-repair`):
 *   - usable / repairable  → the call can be dispatched (a lossless local repair is applied IN the event stream);
 *   - reprompt / reject    → the call carries no usable arguments — the turn is `malformed`, and the recovery ladder's
 *                            `constrained_schema` rung (the strongest model-side lever) gets its chance.
 * A turn is `malformed` only when EVERY call is unusable: a batch with one bad call among good ones keeps its good
 * calls (re-forcing the whole turn through a single-call rung would lose them), and the bad call's tool error carries
 * the re-ask exactly as before.
 *
 * Pure + total: no clock, no I/O; a tool without a declared `required` list accepts an empty call (nothing to miss).
 */

import {
	assessToolArgumentRepair,
	dispatchArgumentsAfterRepair,
	type ToolArgumentRepairResult,
	ToolArgumentVerdict,
} from "./tool-argument-repair";

/** Structural mirror of the SDK's `tool-call-delta` model event — the core never imports the vendored SDK. */
export interface StreamedToolCallDelta {
	readonly type: "tool-call-delta";
	readonly index?: number;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly inputText?: string;
	readonly input?: unknown;
	readonly metadata?: unknown;
}

/** Any model event of a turn: the delta shape above, or anything else the stream carries (kept as-is). */
export type StreamedTurnEvent = StreamedToolCallDelta | { readonly type: string; readonly [key: string]: unknown };

/** The offered tool's shape as the SDK declares it (`AgentToolDefinition` is assignable). */
export interface OfferedTool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
}

/** One tool call reassembled from its streamed deltas, the way the SDK runtime assembles it. */
export interface AssembledToolCall {
	/** Grouping key: the provider's `toolCallId`, else a synthetic index key (the SDK's own rule). */
	readonly key: string;
	readonly toolCallId: string | null;
	readonly toolName: string | null;
	/** The argument text as streamed, after the SDK's merge rule (a fresh `{`/`[` chunk RESTARTS the text). */
	readonly inputText: string;
	/** A whole argument object when the provider delivered one (takes precedence over the text). */
	readonly input: unknown;
	/** Indexes (into the event list) of every delta belonging to this call, in stream order. */
	readonly eventIndexes: readonly number[];
}

/** Mirror of the SDK runtime's `mergeToolInputText`: a chunk that starts a new JSON value replaces what came before. */
function mergeInputText(current: string, incoming: string): string {
	if (!current) return incoming;
	const trimmed = incoming.trimStart();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) return incoming;
	return current + incoming;
}

/** Group a turn's `tool-call-delta` events into calls with the SDK runtime's keying and merge rules. */
export function assembleStreamedToolCalls(events: readonly StreamedTurnEvent[]): AssembledToolCall[] {
	const byKey = new Map<
		string,
		{ toolCallId: string | null; toolName: string | null; inputText: string; input: unknown; eventIndexes: number[] }
	>();
	let nextToolIndex = 0;
	events.forEach((event, index) => {
		if (event.type !== "tool-call-delta") return;
		const delta = event as StreamedToolCallDelta;
		const key = delta.toolCallId ?? `tool_${delta.index ?? nextToolIndex}`;
		if (delta.index === undefined && delta.toolCallId === undefined) nextToolIndex += 1;
		let assembly = byKey.get(key);
		if (!assembly) {
			assembly = { toolCallId: null, toolName: null, inputText: "", input: undefined, eventIndexes: [] };
			byKey.set(key, assembly);
		}
		assembly.eventIndexes.push(index);
		if (delta.toolCallId) assembly.toolCallId = delta.toolCallId;
		if (delta.toolName) assembly.toolName = delta.toolName;
		if (delta.input !== undefined) assembly.input = delta.input;
		if (delta.inputText) assembly.inputText = mergeInputText(assembly.inputText, delta.inputText);
	});
	return [...byKey.entries()].map(([key, assembly]) => ({ key, ...assembly }));
}

/** The arguments the SDK would hand the tool: the delivered object, else the parsed text, else the raw text. */
function assembledArguments(call: AssembledToolCall): unknown {
	if (call.input !== undefined) return call.input;
	const trimmed = call.inputText.trim();
	// The SDK salvages empty argument text to `{}` — judge exactly what the tool would receive.
	if (!trimmed) return {};
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		// Unparseable text: the assessor rejects a non-object outright — the honest verdict for broken JSON.
		return call.inputText;
	}
}

export interface TriagedToolCall {
	readonly call: AssembledToolCall;
	readonly tool: OfferedTool | undefined;
	/** The arguments as the SDK would dispatch them BEFORE any repair. */
	readonly arguments: unknown;
	readonly assessment: ToolArgumentRepairResult;
	/** The arguments to dispatch (repaired when a lossless repair applied); undefined when the call is unusable. */
	readonly dispatchArguments: Record<string, unknown> | undefined;
}

export type ToolCallTurnVerdict =
	/** The turn emitted no tool call — nothing to triage. */
	| "no_calls"
	/** Every call is dispatchable as emitted. */
	| "usable"
	/** Every call is dispatchable; at least one needed a lossless local repair (applied in `events`). */
	| "repaired"
	/** EVERY call is unusable — the turn carries no dispatchable action. */
	| "malformed"
	/** Some calls are dispatchable and some are not — the good ones ship, the bad ones carry their tool errors. */
	| "mixed";

export interface ToolCallTurnTriage<TEvent extends StreamedTurnEvent = StreamedTurnEvent> {
	readonly verdict: ToolCallTurnVerdict;
	readonly calls: readonly TriagedToolCall[];
	/**
	 * The turn's events with every repairable call rewritten to its repaired arguments (one delta per repaired call).
	 * Identical to the input when nothing was repaired.
	 */
	readonly events: readonly TEvent[];
	/** The first unusable call — the one the constrained re-ask names. Null unless the verdict is malformed/mixed. */
	readonly firstUnusable: TriagedToolCall | null;
}

/** Rewrite the deltas of every repaired call into ONE delta carrying the repaired arguments. */
function rewriteRepairedCalls<TEvent extends StreamedTurnEvent>(
	events: readonly TEvent[],
	repaired: readonly TriagedToolCall[],
): readonly TEvent[] {
	if (repaired.length === 0) return events;
	const drop = new Set<number>();
	const replace = new Map<number, TEvent>();
	for (const triaged of repaired) {
		const [first, ...rest] = triaged.call.eventIndexes;
		if (first === undefined || !triaged.dispatchArguments) continue;
		const original = events[first] as StreamedToolCallDelta;
		const rewritten: StreamedToolCallDelta = {
			...original,
			type: "tool-call-delta",
			...(triaged.call.toolCallId ? { toolCallId: triaged.call.toolCallId } : {}),
			...(triaged.call.toolName ? { toolName: triaged.call.toolName } : {}),
			input: triaged.dispatchArguments,
			inputText: JSON.stringify(triaged.dispatchArguments),
		};
		replace.set(first, rewritten as TEvent);
		for (const index of rest) drop.add(index);
	}
	return events.flatMap((event, index) => {
		if (drop.has(index)) return [];
		return [replace.get(index) ?? event];
	});
}

/**
 * Judge every streamed tool call of a turn against the offered tools. The verdict is the turn's; each call keeps its
 * own assessment so a caller can name exactly which call failed and which fields it must re-ask.
 */
export function triageStreamedToolCalls<TEvent extends StreamedTurnEvent>(
	events: readonly TEvent[],
	tools: readonly OfferedTool[],
): ToolCallTurnTriage<TEvent> {
	const assembled = assembleStreamedToolCalls(events);
	if (assembled.length === 0) return { verdict: "no_calls", calls: [], events, firstUnusable: null };
	const calls: TriagedToolCall[] = assembled.map((call) => {
		const tool = call.toolName ? tools.find((candidate) => candidate.name === call.toolName) : undefined;
		const args = assembledArguments(call);
		const parsed = { name: call.toolName ?? "", arguments: args };
		const assessment = assessToolArgumentRepair(
			parsed,
			tool ? { name: tool.name, description: tool.description, parameters: tool.inputSchema } : undefined,
		);
		return {
			call,
			tool,
			arguments: args,
			assessment,
			dispatchArguments: dispatchArgumentsAfterRepair(parsed, assessment),
		};
	});
	const dispatchable = calls.filter((triaged) => triaged.dispatchArguments !== undefined);
	const repaired = dispatchable.filter((triaged) => triaged.assessment.verdict === ToolArgumentVerdict.Repairable);
	const firstUnusable = calls.find((triaged) => triaged.dispatchArguments === undefined) ?? null;
	const verdict: ToolCallTurnVerdict =
		dispatchable.length === 0
			? "malformed"
			: dispatchable.length < calls.length
				? "mixed"
				: repaired.length > 0
					? "repaired"
					: "usable";
	return { verdict, calls, events: rewriteRepairedCalls(events, repaired), firstUnusable };
}

/** One line naming an unusable call for evidence/notes: `write_file: re-ask 2 required field(s): path, content`. */
export function describeUnusableToolCall(triaged: TriagedToolCall): string {
	return `${triaged.call.toolName ?? "(unnamed tool)"}: ${triaged.assessment.reason}`;
}
