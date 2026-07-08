/**
 * Live verification of unified-chat steering over the tRPC streaming path.
 *
 * This uses the real `chat.streamMessage` subscription and `chat.steerTurn` mutation. The first tool-discovery call is
 * deterministic and blocks in a fake tool so the script can post a steer while the turn is active; the final answer is
 * streamed from one already-loaded local model. It never loads/unloads models and does not sweep.
 *
 * Run:  tsx scripts/verify-chat-steer.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatAgentModelResponse } from "../src/chat/chat-agent-loop";
import { createChatService } from "../src/chat/chat-service";
import { resolveLocalChatModelDeps } from "../src/chat/local-chat-model";
import type { RuntimeChatStreamEvent } from "../src/core/chat-api-contract";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { type RuntimeTrpcContext, runtimeAppRouter } from "../src/trpc/app-router";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim();
const MARKER = `STEER_OK_${Date.now().toString(36)}`;

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function resolveLoadedModelId(): Promise<string> {
	if (MODEL_ID) {
		await assertModelLoaded(BASE_URL, MODEL_ID);
		return MODEL_ID;
	}
	const base = BASE_URL.replace(/\/v1\/?$/, "");
	const response = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
	const payload = (await response.json()) as {
		data?: Array<{ id?: string; type?: string; state?: string }>;
	};
	const loaded =
		payload.data?.filter((entry) => entry.state === "loaded" && entry.type === "llm" && entry.id) ?? [];
	const preferred =
		loaded.find((entry) => entry.id?.includes("phi-4-mini-instruct")) ??
		loaded.find((entry) => !entry.id?.includes("deepseek")) ??
		loaded[0];
	if (!preferred?.id) {
		throw new Error(`Could not resolve a loaded LLM from ${base}/api/v0/models`);
	}
	return preferred.id;
}

async function main(): Promise<void> {
	const modelId = await resolveLoadedModelId();
	const rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-steer-verify-"));
	let releaseTool!: () => void;
	const toolGate = new Promise<void>((resolve) => {
		releaseTool = resolve;
	});
	let toolStarted!: () => void;
	const toolStartedPromise = new Promise<void>((resolve) => {
		toolStarted = resolve;
	});
	let finalPromptSawSteer = false;
	let modelCalls = 0;

	try {
		const liveDeps = await resolveLocalChatModelDeps({ baseUrl: BASE_URL, modelId });
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => liveDeps,
			resolveAgentToolDeps: async () => ({
				model: async (messages, allowTools, onToken): Promise<ChatAgentModelResponse> => {
					modelCalls += 1;
					const promptText = messages.map((message) => message.content).join("\n\n");
					if (modelCalls === 1) {
						return {
							text: "",
							toolCalls: [{ id: "wait-for-steer", name: "wait_for_steer", arguments: {} }],
						};
					}
					if (allowTools) {
						return { text: "Ready for the final answer.", toolCalls: [] };
					}
					finalPromptSawSteer = promptText.includes(MARKER);
					const text = await liveDeps.complete(messages, onToken);
					return { text, toolCalls: [] };
				},
				executeTool: async (call) => {
					toolStarted();
					await toolGate;
					return { callId: call.id, content: "steering window opened" };
				},
				appendToolExchange: (messages, _response, results) => [
					...messages,
					...results.map((result) => ({ role: "system" as const, content: result.content })),
				],
			}),
		});

		const ctx = {
			requestedWorkspaceId: null,
			workspaceScope: null,
			runtimeApi: {
				listChatSessions: () => service.listSessions(),
				getChatSession: (id: string) => service.getSession(id),
				createChatSession: service.createSession,
				updateChatSession: service.updateSession,
				deleteChatSession: (id: string) => service.deleteSession(id),
				readChatTranscript: (sessionId: string, limit?: number) => service.readTranscript(sessionId, limit),
				sendChatMessage: async (
					input: { sessionId: string; message: string },
					onToken?: (delta: string) => void,
					onToolEvent?: (event: { phase: "start" | "end"; toolName: string }) => void,
				) => {
					const result = await service.sendMessage(input, onToken, onToolEvent);
					return {
						userMessage: result?.userMessage ?? null,
						assistantMessage: result?.assistantMessage ?? null,
					};
				},
				steerChatTurn: (input: { sessionId: string; message: string; delivery?: "queue" | "steer" }) =>
					service.steerTurn(input),
			},
		} as unknown as RuntimeTrpcContext;
		const caller = runtimeAppRouter.createCaller(ctx);
		const created = await caller.chat.createSession({
			title: "Live steer",
			goal: `When a steering update arrives, follow it. If it mentions ${MARKER}, include that marker.`,
		});
		const sessionId = created.session?.id;
		if (!sessionId) {
			throw new Error("Failed to create chat session.");
		}

		const events: RuntimeChatStreamEvent[] = [];
		const stream = await caller.chat.streamMessage({
			sessionId,
			message: "Start the turn, wait for any steering update, then answer briefly.",
		});
		const readStream = (async () => {
			for await (const event of stream) {
				events.push(event);
			}
		})();

		await toolStartedPromise;
		const steered = await caller.chat.steerTurn({
			sessionId,
			message: `Final answer requirement: include exactly this marker once: ${MARKER}`,
			delivery: "steer",
		});
		releaseTool();
		await readStream;

		const done = events.findLast((event) => event.type === "done");
		const tokenText = events.flatMap((event) => (event.type === "token" ? [event.delta] : [])).join("");
		const transcript = await caller.chat.getTranscript({ sessionId });
		const persistedSteer = transcript.messages.some((message) => message.role === "user" && message.content.includes(MARKER));
		const answer = done?.type === "done" ? (done.assistantMessage?.content ?? "") : "";
		const streamed = tokenText.trim().length > 0;
		const modelObeyedMarker = answer.includes(MARKER);
		const ok = steered.ok && finalPromptSawSteer && persistedSteer && streamed && answer.trim().length > 0;

		log("");
		log("=== Chat steering live verification ===");
		log(`Model: ${modelId}`);
		log(`steerTurn accepted:                  ${steered.ok ? "YES ✓" : "NO ⚠️"}`);
		log(`Steer persisted to transcript:       ${persistedSteer ? "YES ✓" : "NO ⚠️"}`);
		log(`Final live prompt included steer:    ${finalPromptSawSteer ? "YES ✓" : "NO ⚠️"}`);
		log(`SSE streamed final tokens:           ${streamed ? "YES ✓" : "NO ⚠️"}`);
		log(`Model echoed marker (quality check): ${modelObeyedMarker ? "YES ✓" : "NO ⚠️"}`);
		log(`Assistant: ${answer.trim().slice(0, 220)}`);
		log("");
		log(ok ? "PASS ✓ chat.steerTurn folded into a live streamed turn." : "INCOMPLETE — see above.");
		process.exit(ok ? 0 : 1);
	} finally {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
