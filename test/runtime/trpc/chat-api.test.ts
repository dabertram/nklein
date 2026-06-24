import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatService } from "../../../src/chat/chat-service";
import { appendChatMessage } from "../../../src/chat/chat-transcript-store";
import type { RuntimeChatStreamEvent } from "../../../src/core/chat-api-contract";
import { type RuntimeTrpcContext, runtimeAppRouter } from "../../../src/trpc/app-router";

/**
 * Exercises the §5.M chat sub-router end-to-end against a temp-rooted chat service. We build a minimal context
 * whose `runtimeApi` provides only the chat methods (the procedures touch nothing else), so this validates the
 * router's request/response wrapping ({ sessions } / { session } / { deleted } / { messages }) over the real service.
 */
function makeContext(rootDir: string): RuntimeTrpcContext {
	const service = createChatService({
		rootDir,
		resolveModelDeps: async () => ({
			// Stream the reply in two deltas so the streaming subscription has multiple token events to emit.
			complete: async (_prompt, onToken) => {
				onToken?.("Ack");
				onToken?.("nowledged.");
				return "Acknowledged.";
			},
			summarize: async () => "",
		}),
	});
	// Only the chat methods are exercised; the rest of the context is unused by the chat procedures.
	return {
		requestedWorkspaceId: null,
		workspaceScope: null,
		runtimeApi: {
			listChatSessions: () => service.listSessions(),
			getChatSession: (id: string) => service.getSession(id),
			createChatSession: service.createSession,
			updateChatSession: service.updateSession,
			deleteChatSession: (id: string) => service.deleteSession(id),
			readChatTranscript: (sessionId: string, limit?: number) => service.readTranscript(sessionId, limit),
			sendChatMessage: async (input: { sessionId: string; message: string }, onToken?: (delta: string) => void) => {
				const result = await service.sendMessage(input, onToken);
				return { userMessage: result?.userMessage ?? null, assistantMessage: result?.assistantMessage ?? null };
			},
		},
	} as unknown as RuntimeTrpcContext;
}

describe("chat tRPC sub-router", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-api-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("creates, lists, gets, updates, and deletes sessions through the router", async () => {
		const caller = runtimeAppRouter.createCaller(makeContext(rootDir));

		const created = await caller.chat.createSession({
			title: "Design review",
			role: "reviewer",
			goal: "audit the API",
		});
		expect(created.session).toMatchObject({ title: "Design review", role: "reviewer", goal: "audit the API" });
		const id = created.session?.id;
		if (!id) {
			throw new Error("expected a created session id");
		}

		const listed = await caller.chat.listSessions();
		expect(listed.sessions.map((s) => s.id)).toContain(id);

		const fetched = await caller.chat.getSession({ id });
		expect(fetched.session?.title).toBe("Design review");

		const updated = await caller.chat.updateSession({ id, title: "Design review (done)", goal: null });
		expect(updated.session?.title).toBe("Design review (done)");
		expect(updated.session?.goal).toBeNull();

		const deleted = await caller.chat.deleteSession({ id });
		expect(deleted.deleted).toBe(true);
		expect((await caller.chat.getSession({ id })).session).toBeNull();
	});

	it("returns a session's transcript through the router (with newest-N limiting)", async () => {
		const ctx = makeContext(rootDir);
		const caller = runtimeAppRouter.createCaller(ctx);
		const created = await caller.chat.createSession({ title: "Chat" });
		const sessionId = created.session?.id ?? "";

		await appendChatMessage(sessionId, { role: "user", content: "q1" }, { rootDir: join(rootDir, "transcripts") });
		await appendChatMessage(
			sessionId,
			{ role: "assistant", content: "a1" },
			{ rootDir: join(rootDir, "transcripts") },
		);

		const all = await caller.chat.getTranscript({ sessionId });
		expect(all.sessionId).toBe(sessionId);
		expect(all.messages.map((m) => m.content)).toEqual(["q1", "a1"]);

		const last = await caller.chat.getTranscript({ sessionId, limit: 1 });
		expect(last.messages.map((m) => m.content)).toEqual(["a1"]);
	});

	it("runs a turn via sendMessage and persists it to the transcript", async () => {
		const caller = runtimeAppRouter.createCaller(makeContext(rootDir));
		const created = await caller.chat.createSession({ title: "Talk" });
		const sessionId = created.session?.id ?? "";

		const sent = await caller.chat.sendMessage({ sessionId, message: "ping" });
		expect(sent.userMessage?.content).toBe("ping");
		expect(sent.assistantMessage?.content).toBe("Acknowledged.");

		const transcript = await caller.chat.getTranscript({ sessionId });
		expect(transcript.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
			{ role: "user", content: "ping" },
			{ role: "assistant", content: "Acknowledged." },
		]);

		// Unknown session → both messages null (the procedure stays well-typed).
		const missing = await caller.chat.sendMessage({ sessionId: "nope", message: "hi" });
		expect(missing.userMessage).toBeNull();
		expect(missing.assistantMessage).toBeNull();
	});

	it("streams token events then a terminal done over the streamMessage subscription", async () => {
		const caller = runtimeAppRouter.createCaller(makeContext(rootDir));
		const created = await caller.chat.createSession({ title: "Stream" });
		const sessionId = created.session?.id ?? "";

		const events: RuntimeChatStreamEvent[] = [];
		// createCaller returns the subscription's async generator directly.
		const stream = await caller.chat.streamMessage({ sessionId, message: "go" });
		for await (const event of stream) {
			events.push(event);
		}

		const tokens = events.flatMap((event) => (event.type === "token" ? [event.delta] : []));
		expect(tokens).toEqual(["Ack", "nowledged."]);
		const done = events.at(-1);
		expect(done?.type).toBe("done");
		if (done?.type !== "done") {
			throw new Error("expected a terminal done event");
		}
		expect(done.assistantMessage?.content).toBe("Acknowledged.");

		// The turn was persisted, so the transcript now has the user + assistant messages.
		const transcript = await caller.chat.getTranscript({ sessionId });
		expect(transcript.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});
});
