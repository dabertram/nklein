// The `chat` tRPC sub-router (§5.AK app-router decomposition). Extracted verbatim from app-router.ts so chat-endpoint
// changes get their own lane. Built from the shared `t` (typed via `RuntimeTrpcBuilder`, a type-only import — no runtime
// cycle), so the router type composes identically.
import { z } from "zod";
import { createAsyncQueue } from "../../chat/async-queue.js";
import type { RuntimeChatStreamEvent } from "../../core/chat-api-contract.js";
import {
	runtimeChatAutonomousRunStatusSchema,
	runtimeChatAutonomousStatusRequestSchema,
	runtimeChatBoardStreamsResponseSchema,
	runtimeChatCreateSessionRequestSchema,
	runtimeChatDeleteSessionRequestSchema,
	runtimeChatDeleteSessionResponseSchema,
	runtimeChatSendMessageRequestSchema,
	runtimeChatSendMessageResponseSchema,
	runtimeChatSessionResponseSchema,
	runtimeChatSessionsResponseSchema,
	runtimeChatStartAutonomousRequestSchema,
	runtimeChatStartAutonomousResponseSchema,
	runtimeChatTranscriptRequestSchema,
	runtimeChatTranscriptResponseSchema,
	runtimeChatUpdateSessionRequestSchema,
} from "../../core/chat-api-contract.js";
import type { RuntimeTrpcBuilder } from "../app-router";

export function buildChatRouter(t: RuntimeTrpcBuilder) {
	return t.router({
		listSessions: t.procedure.output(runtimeChatSessionsResponseSchema).query(async ({ ctx }) => {
			return { sessions: await ctx.runtimeApi.listChatSessions() };
		}),
		getSession: t.procedure
			.input(z.object({ id: z.string() }))
			.output(runtimeChatSessionResponseSchema)
			.query(async ({ ctx, input }) => {
				return { session: await ctx.runtimeApi.getChatSession(input.id) };
			}),
		createSession: t.procedure
			.input(runtimeChatCreateSessionRequestSchema)
			.output(runtimeChatSessionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return { session: await ctx.runtimeApi.createChatSession(input) };
			}),
		updateSession: t.procedure
			.input(runtimeChatUpdateSessionRequestSchema)
			.output(runtimeChatSessionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return { session: await ctx.runtimeApi.updateChatSession(input) };
			}),
		deleteSession: t.procedure
			.input(runtimeChatDeleteSessionRequestSchema)
			.output(runtimeChatDeleteSessionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return { deleted: await ctx.runtimeApi.deleteChatSession(input.id) };
			}),
		getTranscript: t.procedure
			.input(runtimeChatTranscriptRequestSchema)
			.output(runtimeChatTranscriptResponseSchema)
			.query(async ({ ctx, input }) => {
				return {
					sessionId: input.sessionId,
					messages: await ctx.runtimeApi.readChatTranscript(input.sessionId, input.limit),
				};
			}),
		getBoardStreams: t.procedure
			.output(runtimeChatBoardStreamsResponseSchema)
			.query(async ({ ctx }) => ctx.runtimeApi.getChatBoardStreams()),
		sendMessage: t.procedure
			.input(runtimeChatSendMessageRequestSchema)
			.output(runtimeChatSendMessageResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendChatMessage(input);
			}),
		startAutonomousRun: t.procedure
			.input(runtimeChatStartAutonomousRequestSchema)
			.output(runtimeChatStartAutonomousResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startAutonomousChatRun(input);
			}),
		autonomousRunStatus: t.procedure
			.input(runtimeChatAutonomousStatusRequestSchema)
			.output(runtimeChatAutonomousRunStatusSchema)
			.query(({ ctx, input }) => {
				return ctx.runtimeApi.getAutonomousChatRunStatus(input);
			}),
		streamMessage: t.procedure.input(runtimeChatSendMessageRequestSchema).subscription(async function* ({
			ctx,
			input,
		}) {
			// Bridge the model's push-style onToken into this pull-style generator via an async queue, so tokens
			// stream to the client as SSE while the turn runs; the terminal `done` carries the persisted messages.
			const queue = createAsyncQueue<RuntimeChatStreamEvent>();
			void ctx.runtimeApi
				.sendChatMessage(
					input,
					(delta) => queue.push({ type: "token", delta }),
					// W3.1: live tool activity — the composer shows what the agent is doing while the turn runs.
					(event) => queue.push({ type: "tool", phase: event.phase, toolName: event.toolName }),
				)
				.then((result) => {
					queue.push({
						type: "done",
						userMessage: result.userMessage,
						assistantMessage: result.assistantMessage,
						capabilityNotice: result.capabilityNotice ?? null,
						targetLabel: result.targetLabel ?? null,
						...(result.clarifyCandidates ? { clarifyCandidates: result.clarifyCandidates } : {}),
					});
					queue.close();
				})
				.catch((error) => queue.fail(error));
			yield* queue;
		}),
	});
}
