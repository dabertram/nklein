import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatService } from "../../../src/chat/chat-service";
import { appendChatMessage } from "../../../src/chat/chat-transcript-store";
import { type RuntimeTrpcContext, runtimeAppRouter } from "../../../src/trpc/app-router";

/**
 * Exercises the §5.M chat sub-router end-to-end against a temp-rooted chat service. We build a minimal context
 * whose `runtimeApi` provides only the chat methods (the procedures touch nothing else), so this validates the
 * router's request/response wrapping ({ sessions } / { session } / { deleted } / { messages }) over the real service.
 */
function makeContext(rootDir: string): RuntimeTrpcContext {
	const service = createChatService({ rootDir });
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
});
