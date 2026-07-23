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

type UnknownRecord = Record<string, unknown>;

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
	const persistedClass = entry.match?.context?.match(
		/^persisted-session:[^;]*;class:(decompose|worker|review|acceptance|chat|any)$/u,
	)?.[1] as RequestClass | undefined;
	if (persistedClass) {
		return persistedClass;
	}
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
	const text = entry.match?.userMessage
		?.replace(/\[!Klein context focus brief\][\s\S]*?\[\/!Klein context focus brief\]/giu, "\n")
		.replace(/<\/?user_input(?:\s[^>]*)?>/giu, "")
		.trim();
	if (!text) {
		return undefined;
	}
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	// Skill-backed worker prompts prepend a shared checklist to every card. Keying on its first sentence makes all
	// workers collide and lets aimock's first fixture shadow the rest. `Guidance topic:` is the stable runtime boundary;
	// the next prose line is the card-specific objective. Reviewer seeds are exempt because they may quote the entire
	// worker prompt (including that boundary) later in their own request.
	const isReviewerSeed = /second-opinion review(?:er)?/iu.test(lines[0] ?? "");
	const guidanceIndex = isReviewerSeed ? -1 : lines.findIndex((line) => /^guidance topic:/iu.test(line));
	const candidateLines = guidanceIndex >= 0 ? lines.slice(guidanceIndex + 1) : lines;
	const meaningful = candidateLines.find(
		(line) =>
			line.length >= 12 &&
			!/^#{1,6}\s/u.test(line) &&
			!/^\[(?:\/)?!Klein\b/iu.test(line) &&
			!/^instructions:?$/iu.test(line) &&
			!/^use this skill when\b/iu.test(line) &&
			!/^checklist:?$/iu.test(line),
	);
	return (meaningful ?? candidateLines[0] ?? lines[0])?.slice(0, 60)?.trim() || undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function partText(part: UnknownRecord, key: "text" | "thinking"): string {
	return typeof part[key] === "string" ? part[key] : "";
}

function messageText(message: UnknownRecord): string {
	return Array.isArray(message.content)
		? message.content
				.map(asRecord)
				.filter((part): part is UnknownRecord => part !== null && part.type === "text")
				.map((part) => partText(part, "text"))
				.join("\n")
		: typeof message.content === "string"
			? message.content
			: "";
}

function assistantResponse(message: UnknownRecord): NonNullable<RecordedFixtureEntry["response"]> {
	const parts = Array.isArray(message.content)
		? message.content.map(asRecord).filter((part): part is UnknownRecord => part !== null)
		: [];
	const content =
		parts
			.filter((part) => part.type === "text")
			.map((part) => partText(part, "text"))
			.join("\n") || (typeof message.content === "string" ? message.content : "");
	const reasoning = parts
		.filter((part) => part.type === "thinking")
		.map((part) => partText(part, "thinking"))
		.filter(Boolean)
		.join("\n");
	const toolCalls = parts
		.filter((part) => part.type === "tool_use" && typeof part.name === "string")
		.map((part) => ({
			name: part.name as string,
			arguments: asRecord(part.input) ?? { raw: part.input },
		}));
	return {
		content,
		...(reasoning ? { reasoning } : {}),
		...(toolCalls.length > 0 ? { toolCalls } : {}),
	};
}

function transcriptRequestClass(
	messages: readonly UnknownRecord[],
	firstUserText: string,
	systemPrompt: string,
): RequestClass {
	// A bounced worker later quotes reviewer feedback in the same transcript. Only the FIRST user seed identifies the
	// session's role without that ambiguity; reviewers declare themselves there before quoting the worker card.
	if (/second-opinion review(?:er)?/iu.test(firstUserText)) {
		return "review";
	}
	const emittedToolNames = messages.flatMap((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			return [];
		}
		return message.content
			.map(asRecord)
			.filter((part): part is UnknownRecord => part !== null && part.type === "tool_use" && typeof part.name === "string")
			.map((part) => part.name as string);
	});
	if (emittedToolNames.includes("submit_review")) {
		return "review";
	}
	if (emittedToolNames.includes("decompose_project")) {
		return "decompose";
	}
	return classifyRequest({
		messages: [
			...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
			{ role: "user", content: firstUserText },
		],
		tools: emittedToolNames.map((name) => ({ function: { name } })),
	});
}

/**
 * Convert !Klein's persisted SDK message envelope into aimock's recorded-fixture shape. This is intentionally a
 * tolerant structural decoder: evidence snapshots may omit the outer metadata, while durable session files carry
 * `system_prompt`, `agent`, timestamps, and modelInfo. Tool RESULTS are not model responses and are therefore omitted;
 * replay executes the captured tool calls against the real harness and conditions the next response on the per-session
 * assistant count, exactly like aimock's own recorder.
 */
export function entriesFromPersistedTranscript(parsed: unknown): RecordedFixtureEntry[] {
	const document = asRecord(parsed);
	if (!document || !Array.isArray(document.messages)) {
		return [];
	}
	const messages = document.messages.map(asRecord).filter((message): message is UnknownRecord => message !== null);
	const firstUserText = messages
		.filter((message) => message.role === "user")
		.map(messageText)
		.find((text) => text.trim().length > 0)
		?.trim();
	if (!firstUserText) {
		return [];
	}
	const systemPrompt = typeof document.system_prompt === "string" ? document.system_prompt : "";
	const requestClass = transcriptRequestClass(messages, firstUserText, systemPrompt);
	const sessionId = typeof document.sessionId === "string" ? document.sessionId : "unknown-session";
	let turnIndex = 0;
	const entries: RecordedFixtureEntry[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}
		const modelInfo = asRecord(message.modelInfo);
		entries.push({
			match: {
				userMessage: firstUserText,
				...(typeof modelInfo?.id === "string" ? { model: modelInfo.id } : {}),
				turnIndex,
				context: `persisted-session:${sessionId};class:${requestClass}`,
			},
			response: assistantResponse(message),
		});
		turnIndex += 1;
	}
	return entries;
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
	// On the production wire a decomposition seed carries the same worker scaffold + full tool registry as a card.
	// The generic classifier therefore sees it as worker; the stable project-specific needle is the authoritative
	// discriminator. Compile recorded decomposition turns as needle-scoped `any`, matching the hand-authored scenario
	// contract and preserving the logical decompose class in the id/provenance.
	const replayRequestClass = requestClass === "decompose" && userMessageIncludes ? "any" : requestClass;
	return {
		id: `${failureId}:${requestClass}:${index}`,
		requestClass: replayRequestClass,
		...(userMessageIncludes ? { userMessageIncludes } : {}),
		...(typeof turnIndex === "number" && turnIndex > 0 ? { atAssistantCount: turnIndex } : {}),
		turns: [{ behavior: responseToBehavior(entry.response ?? {}) }],
		provenance: `distilled from real capture (${[failureId, entry.match?.model, entry.match?.context].filter(Boolean).join(", ")})`,
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
	if (parsed && typeof parsed === "object" && "messages" in (parsed as Record<string, unknown>)) {
		return entriesFromPersistedTranscript(parsed);
	}
	return [];
}
