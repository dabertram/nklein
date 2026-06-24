import { z } from "zod";

/**
 * tRPC contract for the board-independent unified chat agent (todo §5.M). These Zod schemas are the single source
 * of truth shared by the runtime API, the app router, and the web-ui chat surface — they mirror the persisted
 * `ChatSession` / `ChatMessage` shapes from `src/chat/` so the wire types and the store types can't drift. This
 * first slice covers session management + transcript reads (no model); the live "send a turn" endpoint layers on
 * top. Kept in its own module rather than the 2500-line `api-contract.ts` so the chat surface stays navigable.
 */

export const runtimeChatSessionScopeSchema = z.enum(["project_sandboxed", "all_projects", "host_access"]);
export type RuntimeChatSessionScope = z.infer<typeof runtimeChatSessionScopeSchema>;

export const runtimeChatSessionRoleSchema = z.enum([
	"planner_architect",
	"reviewer",
	"debugger",
	"researcher",
	"system_operator",
]);
export type RuntimeChatSessionRole = z.infer<typeof runtimeChatSessionRoleSchema>;

export const runtimeChatSessionSchema = z.object({
	id: z.string(),
	title: z.string(),
	scope: runtimeChatSessionScopeSchema,
	role: runtimeChatSessionRoleSchema,
	goal: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type RuntimeChatSession = z.infer<typeof runtimeChatSessionSchema>;

export const runtimeChatSessionsResponseSchema = z.object({
	sessions: z.array(runtimeChatSessionSchema),
});
export type RuntimeChatSessionsResponse = z.infer<typeof runtimeChatSessionsResponseSchema>;

export const runtimeChatSessionResponseSchema = z.object({
	session: runtimeChatSessionSchema.nullable(),
});
export type RuntimeChatSessionResponse = z.infer<typeof runtimeChatSessionResponseSchema>;

export const runtimeChatCreateSessionRequestSchema = z.object({
	title: z.string(),
	scope: runtimeChatSessionScopeSchema.optional(),
	role: runtimeChatSessionRoleSchema.optional(),
	goal: z.string().nullable().optional(),
});
export type RuntimeChatCreateSessionRequest = z.infer<typeof runtimeChatCreateSessionRequestSchema>;

export const runtimeChatUpdateSessionRequestSchema = z.object({
	id: z.string(),
	title: z.string().optional(),
	scope: runtimeChatSessionScopeSchema.optional(),
	role: runtimeChatSessionRoleSchema.optional(),
	goal: z.string().nullable().optional(),
});
export type RuntimeChatUpdateSessionRequest = z.infer<typeof runtimeChatUpdateSessionRequestSchema>;

export const runtimeChatDeleteSessionRequestSchema = z.object({ id: z.string() });
export type RuntimeChatDeleteSessionRequest = z.infer<typeof runtimeChatDeleteSessionRequestSchema>;

export const runtimeChatDeleteSessionResponseSchema = z.object({ deleted: z.boolean() });
export type RuntimeChatDeleteSessionResponse = z.infer<typeof runtimeChatDeleteSessionResponseSchema>;

export const runtimeChatMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type RuntimeChatMessageRole = z.infer<typeof runtimeChatMessageRoleSchema>;

export const runtimeChatMessageSchema = z.object({
	id: z.string(),
	role: runtimeChatMessageRoleSchema,
	content: z.string(),
	createdAt: z.number(),
});
export type RuntimeChatMessage = z.infer<typeof runtimeChatMessageSchema>;

export const runtimeChatTranscriptRequestSchema = z.object({
	sessionId: z.string(),
	limit: z.number().int().positive().optional(),
});
export type RuntimeChatTranscriptRequest = z.infer<typeof runtimeChatTranscriptRequestSchema>;

export const runtimeChatTranscriptResponseSchema = z.object({
	sessionId: z.string(),
	messages: z.array(runtimeChatMessageSchema),
});
export type RuntimeChatTranscriptResponse = z.infer<typeof runtimeChatTranscriptResponseSchema>;

export const runtimeChatSendMessageRequestSchema = z.object({
	sessionId: z.string(),
	message: z.string().min(1),
	tokenBudget: z.number().int().positive().optional(),
	memoryLimit: z.number().int().positive().optional(),
});
export type RuntimeChatSendMessageRequest = z.infer<typeof runtimeChatSendMessageRequestSchema>;

export const runtimeChatSendMessageResponseSchema = z.object({
	/** Null when the session no longer exists; otherwise the persisted user + assistant messages. */
	userMessage: runtimeChatMessageSchema.nullable(),
	assistantMessage: runtimeChatMessageSchema.nullable(),
});
export type RuntimeChatSendMessageResponse = z.infer<typeof runtimeChatSendMessageResponseSchema>;

/** Events emitted by the `chat.streamMessage` subscription: incremental tokens, then a terminal `done`. */
export const runtimeChatStreamEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("token"), delta: z.string() }),
	z.object({
		type: z.literal("done"),
		userMessage: runtimeChatMessageSchema.nullable(),
		assistantMessage: runtimeChatMessageSchema.nullable(),
	}),
]);
export type RuntimeChatStreamEvent = z.infer<typeof runtimeChatStreamEventSchema>;
