/**
 * Compile {@link ScenarioScript} tracks into aimock fixtures. This is the buy/build seam: tracks are OUR portable
 * JSON (keyed by the failure catalog, carrying reflection-loop provenance); aimock is the transport that serves
 * them (HTTP + SSE + latency physics + chaos). If the transport ever changes, only this file follows.
 *
 * Multi-turn scripting conditions each turn on the REQUEST'S OWN TRANSCRIPT SHAPE: the number of assistant
 * messages already in the conversation IS the per-session turn index (0 assistants → turn 0, k → turn k;
 * `repeatLastTurn` matches every count ≥ the final index). This replaced aimock's `sequenceIndex` (live-found,
 * project-02 runs 2026-07-10): occurrence counting is GLOBAL per fixture, so concurrent sessions and !Klein's
 * redrives/restarts desynchronized ladders — a restarted worker resumed mid-ladder and never wrote its files.
 * Transcript-shape conditioning is per-session by construction and restart-idempotent (a fresh session starts
 * back at turn 0). Caveat: it assumes the harness does not prune ASSISTANT messages out of short transcripts
 * (!Klein summarizes file chunks, not assistant turns; ladders here are ≤6 turns).
 */

import type { Fixture } from "@copilotkit/aimock";
import { classifyRequest, DEFAULT_REQUEST_CLASS_MARKERS, type RequestClassMarkers } from "./request-classifier.js";
import type { ScenarioScript, ScenarioTrack, ScenarioTurn } from "../scenario/track-types.js";

/** An effectively-infinite TTFT: the stream stays open with no bytes (the t-sse-never-starts family). */
const STALL_TTFT_MS = 3_600_000;

type FixtureResponse = Fixture["response"];

function behaviorToResponse(turn: ScenarioTurn): FixtureResponse {
	const behavior = turn.behavior;
	switch (behavior.kind) {
		case "text":
			return {
				content: behavior.content,
				...(behavior.reasoning ? { reasoning: behavior.reasoning } : {}),
				...(behavior.finishReason ? { finishReason: behavior.finishReason } : {}),
			};
		case "tool_calls":
			return {
				...(behavior.content ? { content: behavior.content } : {}),
				toolCalls: behavior.calls.map((call) => ({
					name: call.name,
					// aimock serializes object arguments as-is; real providers send a JSON string. We pass the
					// STRING form so !Klein exercises its production parse path (parseToolCallArguments).
					arguments: JSON.stringify(call.arguments),
				})),
			} as FixtureResponse;
		case "http_error":
			return {
				error: { message: behavior.message, type: "simulated_error" },
				status: behavior.status,
				...(behavior.retryAfterSeconds !== undefined ? { retryAfter: behavior.retryAfterSeconds } : {}),
			};
		case "malformed_json":
			// RawJSON that is intentionally NOT valid JSON once serialized is not expressible; aimock's chaos
			// "malformed" mode covers the transport variant. At the track level we emit a content payload that
			// LOOKS like broken JSON to exercise content-level parsers (c-bad-json-args family).
			return { content: '{"result": "unterminated string' };
		case "empty_completion":
			return { content: "" };
		case "stall":
			return { content: "unreachable — the stream never starts" };
		case "truncate_stream":
			return { content: behavior.content };
		case "disconnect":
			return { content: "unreachable — the socket drops first" };
	}
}

function behaviorToFixtureOptions(turn: ScenarioTurn): Partial<Fixture> {
	const behavior = turn.behavior;
	const base: Partial<Fixture> = {
		...(turn.latencyMs !== undefined ? { latency: turn.latencyMs } : {}),
		...(turn.streaming
			? {
					streamingProfile: {
						...(turn.streaming.ttftMs !== undefined ? { ttft: turn.streaming.ttftMs } : {}),
						...(turn.streaming.tokensPerSecond !== undefined ? { tps: turn.streaming.tokensPerSecond } : {}),
						...(turn.streaming.jitter !== undefined ? { jitter: turn.streaming.jitter } : {}),
					},
				}
			: {}),
	};
	switch (behavior.kind) {
		case "stall":
			return { ...base, streamingProfile: { ...(base.streamingProfile ?? {}), ttft: behavior.ttftMs || STALL_TTFT_MS } };
		case "truncate_stream":
			return {
				...base,
				chunkSize: behavior.chunkSize ?? 8,
				truncateAfterChunks: behavior.afterChunks,
			};
		case "disconnect":
			return { ...base, disconnectAfterMs: behavior.afterMs };
		default:
			return base;
	}
}

export interface CompileOptions {
	markers?: RequestClassMarkers;
}

/** Flatten a message's content (plain string OR OpenAI content-part array) to text. */
function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
			.join("\n");
	}
	return "";
}

function userText(request: { messages?: Array<{ role?: string; content?: unknown }> }): string {
	return (request.messages ?? [])
		.filter((message) => message.role === "user")
		.map((message) => contentToText(message.content))
		.join("\n");
}

/** Compile one track into its fixtures (one per turn + the optional repeat catch-all). */
export function compileTrack(track: ScenarioTrack, options: CompileOptions = {}): Fixture[] {
	const markers = options.markers ?? DEFAULT_REQUEST_CLASS_MARKERS;
	// The userMessageIncludes check lives in OUR predicate, not aimock's `userMessage` matcher: !Klein sends
	// OpenAI content-part ARRAYS ([{type:"text",text:…}]) and aimock's matcher only reads string content
	// (live-found bringing up the fast path, 2026-07-10 — real worker requests silently missed their tracks).
	const needle = track.userMessageIncludes?.toLowerCase();
	const matchesTrack = (request: unknown): boolean => {
		const shaped = request as Parameters<typeof classifyRequest>[0] & {
			messages?: Array<{ role?: string; content?: unknown }>;
		};
		if (needle && !userText(shaped).toLowerCase().includes(needle)) {
			return false;
		}
		return track.requestClass === "any" || classifyRequest(shaped, markers) === track.requestClass;
	};
	const assistantTurnCount = (request: unknown): number =>
		((request as { messages?: Array<{ role?: string }> }).messages ?? []).filter(
			(message) => message.role === "assistant",
		).length;
	const lastIndex = track.turns.length - 1;
	// Distilled tracks pin turn 0 to the RECORDED assistant count (aimock's match.turnIndex); scripted tracks
	// start at 0. Either way, turn k answers the session round with (base + k) assistant messages.
	const baseCount = track.atAssistantCount ?? 0;
	const fixtures: Fixture[] = track.turns.map((turn, index) => ({
		match: {
			predicate: (request) => {
				if (!matchesTrack(request)) {
					return false;
				}
				const count = assistantTurnCount(request);
				// The final turn absorbs every later per-session round when the track repeats.
				return track.repeatLastTurn && index === lastIndex ? count >= baseCount + index : count === baseCount + index;
			},
		},
		response: behaviorToResponse(turn),
		...behaviorToFixtureOptions(turn),
	}));
	return fixtures;
}

/**
 * Matching specificity of a track — aimock picks the FIRST matching fixture, so compile order decides ties.
 * Most-specific-first ordering makes merged multi-scenario scripts safe: a needle-keyed track can never be
 * shadowed by an earlier catch-all (live-found 2026-07-10 — merging project sets in the dev stack let project
 * 02's no-needle `any` fallback swallow project 05's decompose request, stranding its board in Planning).
 */
function trackSpecificity(track: ScenarioTrack): number {
	if (track.userMessageIncludes) {
		return 0; // needle-keyed — most specific
	}
	if (track.requestClass !== "any") {
		return 1; // class-scoped
	}
	return 2; // catch-all — always last
}

/**
 * Compile a whole script. Tracks compile most-specific-first (needle > class > catch-all; stable within a
 * tier, so same-specificity tracks keep authoring order for ties).
 */
export function compileScenarioScript(script: ScenarioScript, options: CompileOptions = {}): Fixture[] {
	return script.tracks
		.map((track, index) => ({ track, index }))
		.sort((a, b) => trackSpecificity(a.track) - trackSpecificity(b.track) || a.index - b.index)
		.flatMap(({ track }) => compileTrack(track, options));
}
