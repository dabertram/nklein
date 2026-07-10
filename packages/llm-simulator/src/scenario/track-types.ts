/**
 * Scenario TRACKS — the simulator's unit of scripted behavior. A track describes how the simulated model behaves
 * for one class of request (decompose / worker edit / review / chat / acceptance), over one or more turns, in one
 * of the catalog's modes (perfect / a specific failure). Tracks are keyed by the failure-catalog ids
 * (docs/dev/llm-simulator/failure-catalog.md: t-* transport, c-* content, a-* agent-loop; "perfect" for the happy
 * path) so every real-world-observed failure maps 1:1 to a testable scripted behavior — and the record→distill
 * reflection loop files new real-world observations under the same ids.
 *
 * Tracks are pure data (JSON-serializable). The compiler (aimock adapter) turns them into transport fixtures;
 * the driver (seeded RNG) decides which track handles which request. No !Klein imports — separable product.
 */

/** How the simulated model behaves for one matched request. Exactly one behavior per turn. */
export type TurnBehavior =
	| {
			kind: "text";
			content: string;
			/** DeepSeek/LM Studio-style reasoning channel (emitted as `reasoning_content`). */
			reasoning?: string;
			finishReason?: "stop" | "length";
	  }
	| {
			kind: "tool_calls";
			calls: Array<{ name: string; arguments: Record<string, unknown> }>;
			/** Optional content alongside the calls (some models narrate). */
			content?: string;
	  }
	| {
			kind: "http_error";
			status: 400 | 401 | 403 | 404 | 413 | 422 | 429 | 500 | 502 | 503 | 504 | 529;
			message: string;
			/** For 429s: the Retry-After seconds header. */
			retryAfterSeconds?: number;
	  }
	| { kind: "malformed_json" }
	| { kind: "empty_completion" }
	| {
			kind: "stall";
			/** No first byte for this long (Infinity-like values simulate a dead stream). */
			ttftMs: number;
	  }
	| {
			kind: "truncate_stream";
			content: string;
			/** Kill the socket after N chunks of `chunkSize` characters (no [DONE], no finish_reason). */
			afterChunks: number;
			chunkSize?: number;
	  }
	| { kind: "disconnect"; afterMs: number };

/** One scripted turn: optional per-turn latency shaping on top of the behavior. */
export interface ScenarioTurn {
	behavior: TurnBehavior;
	/** Flat added latency before responding (ms). */
	latencyMs?: number;
	/** Streaming physics for this turn (time-to-first-token, tokens/sec, jitter). */
	streaming?: { ttftMs?: number; tokensPerSecond?: number; jitter?: number };
}

/** The request classes !Klein's prompt shells make distinguishable (matched via system-message markers). */
export type RequestClass = "decompose" | "worker" | "review" | "acceptance" | "chat" | "any";

export interface ScenarioTrack {
	/** Stable id: a failure-catalog id (`t-*`, `c-*`, `a-*`) or `perfect-*` for happy paths. */
	id: string;
	/** Which request class this track responds to. */
	requestClass: RequestClass;
	/** Optional user-message matcher (substring or regex source) narrowing within the class. */
	userMessageIncludes?: string;
	/** The scripted turns, in order. `repeatLastTurn` keeps replaying the final turn (loops!). */
	turns: ScenarioTurn[];
	repeatLastTurn?: boolean;
	/**
	 * Pin the track's FIRST turn to a specific per-session assistant-message count instead of 0 — used by
	 * distilled single-turn tracks (aimock's recorded `match.turnIndex` is exactly this count).
	 */
	atAssistantCount?: number;
	/** Human note: what real-world observation this track encodes (the reflection-loop provenance). */
	provenance?: string;
}

/** A named, seedable composition of tracks — one per test scenario ("perfect run", "flaky worker", "chaos 7%"). */
export interface ScenarioScript {
	name: string;
	/** Seed for ALL randomness in this scenario (same seed ⇒ identical run). */
	seed: number;
	tracks: ScenarioTrack[];
	/**
	 * Global chaos probability applied per request ON TOP of scripted tracks (0 = fully scripted). Chaos picks
	 * uniformly (seeded) among the transport failure behaviors.
	 */
	chaosProbability?: number;
}
