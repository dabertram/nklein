import { z } from "zod";

/**
 * tRPC contract for the board-independent unified chat agent (todo §5.M). These Zod schemas are the single source
 * of truth shared by the runtime API, the app router, and the web-ui chat surface — they mirror the persisted
 * `ChatSession` / `ChatMessage` shapes from `src/chat/` so the wire types and the store types can't drift. This
 * first slice covers session management + transcript reads (no model); the live "send a turn" endpoint layers on
 * top. Kept in its own module rather than the 2500-line `api-contract.ts` so the chat surface stays navigable.
 */

export const runtimeChatSessionScopeSchema = z.enum([
	"project_sandboxed",
	"all_projects",
	"host_access",
	// "chat only": the most-restrictive, read-only floor — the agent may use read tools (read_file/list_dir/get_board)
	// but nothing that mutates (no write_file/run_command/board-mutation). Additive 4th peer (todo §5.M G3a); the
	// default scope stays `project_sandboxed` (set in the session store).
	"chat_only",
]);
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
	// §5.M G3b: the user has acknowledged the risk of letting this session run UNSAFE commands (the general-ack;
	// set via a deliberate extra-confirmation toggle). Default false — unsafe commands are denied until then.
	riskAcknowledged: z.boolean().default(false),
	// §5.M G6: the user has enabled the headless-browser/internet tool for this session (orthogonal to scope).
	// Default false — `browse_url` is not offered until then. Browsing is a host action, so it still only runs in
	// a host-capable scope (denied in chat-only).
	browserEnabled: z.boolean().default(false),
	// §5.AU: the session's sticky addressing focus (set server-side by an explicit @handle) — drives the client's
	// persistent "talking to X" chip. Additive optional so older clients/records are unaffected.
	focus: z
		.object({ kind: z.enum(["card", "stream"]), id: z.string(), at: z.number() })
		.nullable()
		.optional(),
	// §5.AT/§5.AU: the ONE workspace this chat owns (one-chat-per-project) — the routing key the board→chat feedback
	// bridge appends digests to. Additive optional; null for an unowned/global chat.
	ownedWorkspaceId: z.string().nullable().optional(),
	// §5.AE: the skills the user has enabled for this session (their merged apiProfile is folded into the model call).
	// Additive optional with a default so older clients/records are unaffected.
	selectedSkillIds: z.array(z.string()).default([]),
	// §5.M: running total of tokens this session's turns have consumed (for the session-label token count).
	totalTokensUsed: z.number().default(0),
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
	riskAcknowledged: z.boolean().optional(),
	browserEnabled: z.boolean().optional(),
	// §5.AT/§5.AU: bind the new chat to a workspace it owns (one-chat-per-project).
	ownedWorkspaceId: z.string().nullable().optional(),
	// §5.AE: the skills the user enables for the new session.
	selectedSkillIds: z.array(z.string()).optional(),
});
export type RuntimeChatCreateSessionRequest = z.infer<typeof runtimeChatCreateSessionRequestSchema>;

export const runtimeChatUpdateSessionRequestSchema = z.object({
	id: z.string(),
	title: z.string().optional(),
	scope: runtimeChatSessionScopeSchema.optional(),
	role: runtimeChatSessionRoleSchema.optional(),
	goal: z.string().nullable().optional(),
	riskAcknowledged: z.boolean().optional(),
	browserEnabled: z.boolean().optional(),
	/** §5.AU: clear the sticky addressing focus (the "talking to X" chip's ✕). Clients never SET focus over the
	 *  wire — only an explicit @handle does, server-side — so this is deliberately clear-only. */
	clearFocus: z.boolean().optional(),
	/** §5.AE: replace the session's enabled skills (the user's selection). */
	selectedSkillIds: z.array(z.string()).optional(),
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
	/** §5.AL/§5.AG: a model-capability caveat to surface (the model is flagged warn/unknown but the turn still ran). */
	capabilityNotice: z.string().nullable().optional(),
	/** §5.AU: the resolved target's "talking to X" label (card/stream/answer), null/absent for a goal-routed turn. */
	targetLabel: z.string().nullable().optional(),
});
export type RuntimeChatSendMessageResponse = z.infer<typeof runtimeChatSendMessageResponseSchema>;

/** Events emitted by the `chat.streamMessage` subscription: incremental tokens, then a terminal `done`. */
export const runtimeChatStreamEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("token"), delta: z.string() }),
	z.object({
		type: z.literal("done"),
		userMessage: runtimeChatMessageSchema.nullable(),
		assistantMessage: runtimeChatMessageSchema.nullable(),
		capabilityNotice: z.string().nullable().optional(),
		/** §5.AU: the resolved target's "talking to X" label, null/absent for a goal-routed turn. */
		targetLabel: z.string().nullable().optional(),
	}),
]);
export type RuntimeChatStreamEvent = z.infer<typeof runtimeChatStreamEventSchema>;

/** The autonomous-run stop reasons (todo §5.0.1) — mirrors the driver's `AutonomousChatAgentStopReason` union. */
export const runtimeChatAutonomousStopReasonSchema = z.enum([
	"completed",
	"paused_needs_user",
	"budget_turns_exhausted",
	"budget_wall_time_exhausted",
	"stalled_no_progress",
]);
export type RuntimeChatAutonomousStopReason = z.infer<typeof runtimeChatAutonomousStopReasonSchema>;

/** Snapshot of a session's autonomous run (todo §5.0.1): whether it's live + the last result. */
export const runtimeChatAutonomousRunStatusSchema = z.object({
	running: z.boolean(),
	goal: z.string().nullable(),
	stopReason: runtimeChatAutonomousStopReasonSchema.nullable(),
	turns: z.number().int().nonnegative(),
	finalText: z.string().nullable(),
	planProgress: z.object({
		total: z.number().int().nonnegative(),
		done: z.number().int().nonnegative(),
	}),
});
export type RuntimeChatAutonomousRunStatus = z.infer<typeof runtimeChatAutonomousRunStatusSchema>;

export const runtimeChatStartAutonomousRequestSchema = z.object({
	sessionId: z.string(),
	goal: z.string().min(1),
});
export type RuntimeChatStartAutonomousRequest = z.infer<typeof runtimeChatStartAutonomousRequestSchema>;

export const runtimeChatStartAutonomousResponseSchema = z.object({
	/** False when a run is already active for the session (the existing status is returned unchanged). */
	started: z.boolean(),
	status: runtimeChatAutonomousRunStatusSchema,
});
export type RuntimeChatStartAutonomousResponse = z.infer<typeof runtimeChatStartAutonomousResponseSchema>;

export const runtimeChatAutonomousStatusRequestSchema = z.object({ sessionId: z.string() });
export type RuntimeChatAutonomousStatusRequest = z.infer<typeof runtimeChatAutonomousStatusRequestSchema>;
