/**
 * Distill CAPTURED aimock fixtures (from a {@link createRecordProxy} campaign) into simulator scenario TRACKS.
 * This closes the reflection loop: real-LLM behavior observed while working on !Klein → tracks keyed by request
 * class + failure-catalog id → grow the deterministic mock library. Pure over the parsed fixture entries — I/O
 * (reading the fixture files) lives in the caller/CLI so this stays trivially testable.
 *
 * SHAPE (dist-verified against @copilotkit/aimock 1.35.1 recorder.js): a recorded fixture does NOT retain the
 * full request — only `match { userMessage (LAST user text), model, turnIndex (assistant-message count),
 * hasToolResult, context? }` plus `metadata { systemHash, toolsHash }` and the response. So classification here
 * runs on the userMessage text alone (tool-list signals are unavailable — only a hash survives), and distilled
 * tracks pin themselves to the recorded turnIndex via `atAssistantCount` (the compiler's per-session
 * transcript-shape conditioning uses the same count).
 *
 * Failure-mode classification is deliberately CONSERVATIVE: it recognizes the mechanically-detectable catalog
 * ids (empty content, reasoning-only, http error, truncated tool-JSON) and leaves the rest as
 * `perfect-observed` for a human to reclassify. Over-labeling would poison the library.
 */

import { classifyRequest, DEFAULT_REQUEST_CLASS_MARKERS, type RequestClassMarkers } from "../aimock/request-classifier.js";
import type { RequestClass, ScenarioTrack, TurnBehavior } from "../scenario/track-types.js";

/** One recorded fixture entry as aimock persists it (subset we consume; files hold one entry or {fixtures:[…]}). */
export interface RecordedFixtureEntry {
	match?: {
		userMessage?: string;
		model?: string;
		/** Assistant-message count of the recorded request — the per-session turn index. */
		turnIndex?: number;
		hasToolResult?: boolean;
		context?: string;
	};
	response?: {
		status?: number;
		content?: string | null;
		reasoning?: string | null;
		toolCalls?: Array<{ name: string; arguments: unknown }>;
		finishReason?: string;
	};
	metadata?: { systemHash?: string; toolsHash?: string };
}

/** The failure-catalog id a captured interaction most conservatively maps to (or a `perfect`/`observed` bucket). */
export function classifyObservedFailure(entry: RecordedFixtureEntry): string {
	const response = entry.response ?? {};
	if (typeof response.status === "number" && response.status >= 400) {
		return `t-${response.status}`;
	}
	const hasContent = typeof response.content === "string" && response.content.trim().length > 0;
	const hasReasoning = typeof response.reasoning === "string" && response.reasoning.trim().length > 0;
	const hasTools = Array.isArray(response.toolCalls) && response.toolCalls.length > 0;
	if (!hasContent && !hasTools && hasReasoning) {
		return "c-reasoning-only";
	}
	if (!hasContent && !hasTools && !hasReasoning) {
		return "c-empty-completion";
	}
	if (hasTools) {
		for (const call of response.toolCalls ?? []) {
			if (typeof call.arguments === "string") {
				try {
					JSON.parse(call.arguments);
				} catch {
					return "c-bad-json-args";
				}
			}
		}
	}
	if (response.finishReason === "length") {
		return "c-trunc-length";
	}
	return "perfect-observed";
}

/** Classify the request class from the recorded userMessage text (the only request signal that survives capture). */
export function classifyRecordedClass(
	entry: RecordedFixtureEntry,
	markers: RequestClassMarkers = DEFAULT_REQUEST_CLASS_MARKERS,
): RequestClass {
	return classifyRequest(
		{ messages: [{ role: "user", content: entry.match?.userMessage ?? "" }] },
		markers,
	);
}

function responseToBehavior(response: NonNullable<RecordedFixtureEntry["response"]>): TurnBehavior {
	if (typeof response.status === "number" && response.status >= 400) {
		return { kind: "http_error", status: response.status as never, message: "captured upstream error" };
	}
	if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
		return {
			kind: "tool_calls",
			calls: response.toolCalls.map((call) => ({
				name: call.name,
				arguments: typeof call.arguments === "string" ? safeParse(call.arguments) : (call.arguments as Record<string, unknown>),
			})),
			...(typeof response.content === "string" && response.content ? { content: response.content } : {}),
		};
	}
	const content = typeof response.content === "string" ? response.content : "";
	return {
		kind: "text",
		content,
		...(response.reasoning ? { reasoning: response.reasoning } : {}),
		...(response.finishReason === "length" ? { finishReason: "length" as const } : {}),
	};
}

function safeParse(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { raw: value };
	} catch {
		return { raw: value };
	}
}

/** A short, stable slice of the recorded userMessage keys the track without over-fitting to the full prompt. */
function needleFromUserMessage(entry: RecordedFixtureEntry): string | undefined {
	const text = entry.match?.userMessage?.trim();
	if (!text) {
		return undefined;
	}
	return text.split("\n")[0]?.slice(0, 60)?.trim() || undefined;
}

/**
 * Distill one captured fixture into a scenario track pinned to its recorded per-session turn. `index`
 * disambiguates ids when many captures share a request class + failure id in one campaign.
 */
export function distillInteraction(entry: RecordedFixtureEntry, index: number): ScenarioTrack {
	const requestClass = classifyRecordedClass(entry);
	const failureId = classifyObservedFailure(entry);
	const userMessageIncludes = needleFromUserMessage(entry);
	const turnIndex = entry.match?.turnIndex;
	return {
		id: `${failureId}:${requestClass}:${index}`,
		requestClass,
		...(userMessageIncludes ? { userMessageIncludes } : {}),
		...(typeof turnIndex === "number" && turnIndex > 0 ? { atAssistantCount: turnIndex } : {}),
		turns: [{ behavior: responseToBehavior(entry.response ?? {}) }],
		provenance: `distilled from real capture (${failureId}${entry.match?.model ? `, ${entry.match.model}` : ""})`,
	};
}

/** Distill a whole campaign of captured fixtures into tracks. */
export function distillCampaign(entries: readonly RecordedFixtureEntry[]): ScenarioTrack[] {
	return entries.map((entry, index) => distillInteraction(entry, index));
}

/** Flatten a parsed capture FILE (either one fixture entry or `{fixtures:[…]}`) into entries. */
export function entriesFromCaptureFile(parsed: unknown): RecordedFixtureEntry[] {
	if (parsed && typeof parsed === "object" && Array.isArray((parsed as { fixtures?: unknown }).fixtures)) {
		return (parsed as { fixtures: RecordedFixtureEntry[] }).fixtures;
	}
	if (parsed && typeof parsed === "object" && "response" in (parsed as Record<string, unknown>)) {
		return [parsed as RecordedFixtureEntry];
	}
	return [];
}
