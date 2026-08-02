/**
 * A2A v1.0 wire shapes — P17.8, PURE. Every shape here was read from the NORMATIVE sources on 2026-08-03,
 * never from memory: `specification/a2a.proto` (the v1.0 source of truth) and `docs/specification.md` (the
 * JSON-RPC binding + JSON examples) in github.com/a2aproject/A2A@main.
 *
 * ── WHY THIS FILE EXISTS AT ALL ──
 * The first two extraction passes over the RENDERED spec site produced confidently wrong shapes: an invented
 * `a2a.`-prefix on every JSON-RPC method and a wrong well-known path (`/.well-known/a2a/agent`). Training-data
 * recall was wrong too — v0.2/0.3 used `message/send` + lowercase `"submitted"` states, all renamed at v1.0
 * when the proto became normative. A server built from either would be uncallable by a real v1.0 client while
 * looking perfectly plausible in review. So: one module owns the wire truth, cites its lines, and everything
 * else imports from here.
 *
 * Verified facts (source → fact):
 *  - spec.md:2273/2352/2370/2390 → JSON-RPC `method` strings are UNPREFIXED: "SendMessage", "GetTask", …
 *  - spec.md:1220 → enums serialize as PROTO NAMES: `ROLE_USER` → JSON `"ROLE_USER"` (likewise TASK_STATE_*).
 *  - spec.md:1988 → discovery at `/.well-known/agent-card.json`.
 *  - spec.md:1182-1187 → A2A error codes -32001…-32006 with exact names.
 *  - spec.md:2153-2155 → `protocolBinding` canonical values "JSONRPC" | "GRPC" | "HTTP+JSON", protocolVersion "1.0".
 *  - a2a.proto `Message`/`Part`/`Task`/`TaskStatus`/`Artifact`/`AgentCard`/`AgentInterface` → field names below
 *    (proto3 JSON mapping: snake_case → lowerCamelCase; `bytes raw` → base64 string; Timestamp → ISO 8601).
 *  - a2a.proto `SendMessageRequest{tenant, message, configuration, metadata}` and JSON-RPC `params` IS that
 *    request object (spec.md:2296-2305); `SendMessageResponse` is a oneof — exactly one of `task` | `message`.
 */

import { z } from "zod";

/** spec.md:1988 — the discovery document's well-known path. */
export const A2A_WELL_KNOWN_AGENT_CARD_PATH = "/.well-known/agent-card.json";

/** spec.md:2153 — the canonical binding identifier this pilot serves. */
export const A2A_PROTOCOL_BINDING_JSONRPC = "JSONRPC";
export const A2A_PROTOCOL_VERSION = "1.0";

/** spec.md §9.4 — unprefixed method names (the rendered-site extraction that said `a2a.SendMessage` was wrong). */
export const A2A_METHODS = {
	sendMessage: "SendMessage",
	sendStreamingMessage: "SendStreamingMessage",
	getTask: "GetTask",
	listTasks: "ListTasks",
	cancelTask: "CancelTask",
	subscribeToTask: "SubscribeToTask",
	getExtendedAgentCard: "GetExtendedAgentCard",
} as const;

/** spec.md:1182-1187 — A2A-specific JSON-RPC error codes, plus the standard JSON-RPC ones the wire needs. */
export const A2A_ERROR_CODES = {
	taskNotFound: -32001,
	taskNotCancelable: -32002,
	pushNotificationNotSupported: -32003,
	unsupportedOperation: -32004,
	contentTypeNotSupported: -32005,
	invalidAgentResponse: -32006,
	// Standard JSON-RPC 2.0 (spec.md §9.5 defers to these for parse/shape problems).
	parseError: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internalError: -32603,
} as const;

/** a2a.proto enum TaskState — serialized as these exact strings (spec.md:1220, examples :1339/:1376). */
export const A2A_TASK_STATES = [
	"TASK_STATE_UNSPECIFIED",
	"TASK_STATE_SUBMITTED",
	"TASK_STATE_WORKING",
	"TASK_STATE_COMPLETED",
	"TASK_STATE_FAILED",
	"TASK_STATE_CANCELED",
	"TASK_STATE_INPUT_REQUIRED",
	"TASK_STATE_REJECTED",
	"TASK_STATE_AUTH_REQUIRED",
] as const;
export type A2aTaskState = (typeof A2A_TASK_STATES)[number];

/** a2a.proto enum Role. */
export const a2aRoleSchema = z.enum(["ROLE_UNSPECIFIED", "ROLE_USER", "ROLE_AGENT"]);
export type A2aRole = z.infer<typeof a2aRoleSchema>;

/**
 * a2a.proto `Part` — a oneof over {text|raw|url|data} plus part-wide metadata/filename/mediaType. Modeled as
 * an object with all optional content fields; {@link readTextFromParts} enforces the oneof discipline where
 * the pilot consumes parts. `raw` is base64 in JSON (proto3 bytes mapping).
 */
export const a2aPartSchema = z
	.object({
		text: z.string().optional(),
		raw: z.string().optional(),
		url: z.string().optional(),
		data: z.unknown().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		filename: z.string().optional(),
		mediaType: z.string().optional(),
	})
	.strict();
export type A2aPart = z.infer<typeof a2aPartSchema>;

/** a2a.proto `Message` (proto3 JSON: message_id → messageId, …). */
export const a2aMessageSchema = z
	.object({
		messageId: z.string().min(1),
		contextId: z.string().optional(),
		taskId: z.string().optional(),
		role: a2aRoleSchema,
		parts: z.array(a2aPartSchema).min(1),
		metadata: z.record(z.string(), z.unknown()).optional(),
		extensions: z.array(z.string()).optional(),
		referenceTaskIds: z.array(z.string()).optional(),
	})
	.strict();
export type A2aMessage = z.infer<typeof a2aMessageSchema>;

/**
 * a2a.proto `SendMessageRequest` — the JSON-RPC `params` object for "SendMessage" (spec.md:2296-2305: params
 * IS the request object, not a wrapper). `configuration` is accepted loosely: the pilot ignores blocking/
 * historyLength hints rather than rejecting clients that send them.
 */
export const a2aSendMessageParamsSchema = z
	.object({
		tenant: z.string().optional(),
		message: a2aMessageSchema,
		configuration: z.record(z.string(), z.unknown()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type A2aSendMessageParams = z.infer<typeof a2aSendMessageParamsSchema>;

/** spec.md:2352 — GetTask params: `{ "id": "task-uuid", "historyLength": 10 }`. */
export const a2aGetTaskParamsSchema = z
	.object({
		id: z.string().min(1),
		historyLength: z.number().int().nonnegative().optional(),
	})
	.strict();

/** a2a.proto `CancelTaskRequest` carries the task id (same JSON shape as GetTask minus history). */
export const a2aCancelTaskParamsSchema = z.object({ id: z.string().min(1) }).strict();

/** a2a.proto `TaskStatus` — `timestamp` is ISO 8601 in JSON (proto3 Timestamp mapping; spec example :1339). */
export interface A2aTaskStatus {
	state: A2aTaskState;
	message?: A2aMessage;
	timestamp?: string;
}

/** a2a.proto `Artifact`. */
export interface A2aArtifact {
	artifactId: string;
	name?: string;
	description?: string;
	parts: A2aPart[];
	metadata?: Record<string, unknown>;
}

/** a2a.proto `Task` — the outbound shape `GetTask`/`SendMessage` return. */
export interface A2aTask {
	id: string;
	contextId?: string;
	status: A2aTaskStatus;
	artifacts?: A2aArtifact[];
	history?: A2aMessage[];
	metadata?: Record<string, unknown>;
}

/** a2a.proto `AgentInterface` — every field REQUIRED except tenant. */
export interface A2aAgentInterface {
	url: string;
	protocolBinding: string;
	tenant?: string;
	protocolVersion: string;
}

/** a2a.proto `AgentCard` — required fields per field_behavior annotations; signatures/security omitted (pilot). */
export interface A2aAgentCard {
	name: string;
	description: string;
	supportedInterfaces: A2aAgentInterface[];
	version: string;
	documentationUrl?: string;
	capabilities: {
		streaming?: boolean;
		pushNotifications?: boolean;
		extendedAgentCard?: boolean;
	};
	defaultInputModes: string[];
	defaultOutputModes: string[];
	skills: {
		id: string;
		name: string;
		description: string;
		tags: string[];
	}[];
}

/**
 * Enforce the Part oneof for the pilot's TEXT-ONLY intake: exactly one content field set, and it must be
 * `text`. Returns the concatenated text of all parts, or a typed refusal naming the offending part kind —
 * mapped to `contentTypeNotSupported` (-32005) at the wire. `data`/`raw`/`url` intake is a deliberate
 * non-goal until a consumer exists; accepting bytes/URLs from a peer agent is an S-track decision, not a
 * parsing convenience.
 */
export function readTextFromParts(
	parts: readonly A2aPart[],
): { ok: true; text: string } | { ok: false; unsupported: string } {
	const texts: string[] = [];
	for (const part of parts) {
		const contentFields = (["text", "raw", "url", "data"] as const).filter((field) => part[field] !== undefined);
		if (contentFields.length !== 1) {
			return {
				ok: false,
				unsupported: `part with ${contentFields.length} content fields (oneof requires exactly 1)`,
			};
		}
		if (contentFields[0] !== "text") {
			return { ok: false, unsupported: `${contentFields[0]} part` };
		}
		texts.push(part.text as string);
	}
	const text = texts.join("\n").trim();
	return text.length > 0 ? { ok: true, text } : { ok: false, unsupported: "empty text content" };
}
