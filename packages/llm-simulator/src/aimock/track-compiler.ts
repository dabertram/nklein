/**
 * Compile {@link ScenarioScript} tracks into aimock fixtures. This is the buy/build seam: tracks are OUR portable
 * JSON (keyed by the failure catalog, carrying reflection-loop provenance); aimock is the transport that serves
 * them (HTTP + SSE + latency physics + chaos). If the transport ever changes, only this file follows.
 *
 * Multi-turn scripting uses aimock's `sequenceIndex` (Nth occurrence of the same match): turn k compiles to a
 * fixture with sequenceIndex k; `repeatLastTurn` appends an UN-indexed twin of the final turn that catches every
 * later occurrence (aimock skips sequence-indexed fixtures whose occurrence already passed).
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

/** Compile one track into its fixtures (one per turn + the optional repeat catch-all). */
export function compileTrack(track: ScenarioTrack, options: CompileOptions = {}): Fixture[] {
	const markers = options.markers ?? DEFAULT_REQUEST_CLASS_MARKERS;
	const match: Fixture["match"] = {
		...(track.userMessageIncludes ? { userMessage: track.userMessageIncludes } : {}),
		predicate: (request) =>
			track.requestClass === "any" ||
			classifyRequest(request as Parameters<typeof classifyRequest>[0], markers) === track.requestClass,
	};
	const fixtures: Fixture[] = track.turns.map((turn, index) => ({
		match: { ...match, sequenceIndex: index },
		response: behaviorToResponse(turn),
		...behaviorToFixtureOptions(turn),
	}));
	if (track.repeatLastTurn && track.turns.length > 0) {
		const last = track.turns[track.turns.length - 1] as ScenarioTurn;
		fixtures.push({ match, response: behaviorToResponse(last), ...behaviorToFixtureOptions(last) });
	}
	return fixtures;
}

/** Compile a whole script. Track order is preserved (earlier tracks win ties in aimock's matcher). */
export function compileScenarioScript(script: ScenarioScript, options: CompileOptions = {}): Fixture[] {
	return script.tracks.flatMap((track) => compileTrack(track, options));
}
