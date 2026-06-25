/**
 * Suite 5 — chat HTTP + streaming contract (todo §5.V)
 *
 * Drives the board-independent chat (`chat.*` tRPC sub-router) over REAL HTTP against a spawned server
 * and asserts contract shape + persistence. Session CRUD is fully covered. The `sendMessage` /
 * `streamMessage` tests require a mock LLM — see the note below about the wiring gap.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * MOCK-LLM WIRING — FINDING (2026-06-25) + the fix
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * BUG this suite surfaced: `resolveLocalChatModelDeps()` was called with NO options from
 * `runtime-api.ts`, so the chat ALWAYS used `DEFAULT_LOCAL_CHAT_BASE_URL` = `http://127.0.0.1:1234/v1`
 * and ignored the configured provider endpoint.
 *
 * FIXED: runtime-api now threads `nkleinProviderService.getLocalChatBaseUrl()` (the selected LOCAL
 * provider's saved baseUrl) into `resolveLocalChatModelDeps({ baseUrl })`, so the chat hits the same
 * local model server the user configured (cloud selections resolve to null → the default local
 * endpoint, since chat is local-only).
 *
 * `sendMessage` / `streamMessage` stay `it.todo` for one remaining TEST-SIDE reason: to point the
 * spawned server's chat at `mock.baseUrl` the test must SELECT a local provider pointing at the mock
 * (saving provider settings over HTTP does not also select it), and streaming additionally needs an
 * SSE/WS subscription client. The session CRUD suite runs with no LLM and is fully green.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Port-resilient: each suite allocates its own free port.
 * Language-agnostic: assertions target raw JSON, not TypeScript types.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";
import type { MockLlmServer } from "./helpers/mock-llm";
import { startMockLlm } from "./helpers/mock-llm";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ---------------------------------------------------------------------------
// Suite A — session CRUD (no model required)
// ---------------------------------------------------------------------------

describe.sequential("Suite 5A — chat.createSession / listSessions / getSession", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-chat-cwd-");
		homeDir = makeTempDir("kanban-chat-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("chat.listSessions returns an empty array before any session is created", async () => {
		const res = await requestJson<{ sessions: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.sessions)).toBe(true);
		expect(res.payload.sessions).toHaveLength(0);
	});

	it("chat.createSession returns a session with the expected contract shape", async () => {
		const res = await requestJson<{
			session: {
				id: string;
				title: string;
				scope: string;
				role: string;
				goal: unknown;
				createdAt: number;
				updatedAt: number;
			} | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: {
				title: "Contract test session",
				scope: "all_projects",
				role: "researcher",
				goal: "verify the chat contract",
			},
		});
		expect(res.status).toBe(200);
		const session = res.payload.session;
		expect(session).not.toBeNull();
		expect(typeof session?.id).toBe("string");
		expect(session?.id.length).toBeGreaterThan(0);
		expect(session?.title).toBe("Contract test session");
		expect(session?.scope).toBe("all_projects");
		expect(session?.role).toBe("researcher");
		expect(session?.goal).toBe("verify the chat contract");
		expect(typeof session?.createdAt).toBe("number");
		expect(typeof session?.updatedAt).toBe("number");
		expect(session?.createdAt).toBeGreaterThan(0);
	});

	it("chat.listSessions shows the newly created session", async () => {
		const res = await requestJson<{
			sessions: Array<{
				id: string;
				title: string;
				scope: string;
				role: string;
				goal: unknown;
				createdAt: number;
				updatedAt: number;
			}>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.sessions).toHaveLength(1);
		const session = res.payload.sessions[0];
		expect(session?.title).toBe("Contract test session");
		expect(session?.scope).toBe("all_projects");
		expect(session?.role).toBe("researcher");
	});

	it("chat.getSession retrieves the session by id", async () => {
		// First list to get the id.
		const listRes = await requestJson<{ sessions: Array<{ id: string; title: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		const sessionId = listRes.payload.sessions[0]?.id;
		expect(typeof sessionId).toBe("string");

		const res = await requestJson<{ session: { id: string; title: string; scope: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getSession",
			type: "query",
			payload: { id: sessionId },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session).not.toBeNull();
		expect(res.payload.session?.id).toBe(sessionId);
		expect(res.payload.session?.title).toBe("Contract test session");
	});

	it("chat.getSession returns null for an unknown id", async () => {
		const res = await requestJson<{ session: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getSession",
			type: "query",
			payload: { id: "non-existent-session-id" },
		});
		// Either 200 with null session or a 4xx; either way session must be absent.
		if (res.status === 200) {
			expect(res.payload.session).toBeNull();
		} else {
			expect(res.status).toBeGreaterThanOrEqual(400);
		}
	});

	it("chat.getTranscript returns an empty message list for a fresh session", async () => {
		const listRes = await requestJson<{ sessions: Array<{ id: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		const sessionId = listRes.payload.sessions[0]?.id;
		expect(typeof sessionId).toBe("string");

		const res = await requestJson<{ sessionId: string; messages: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getTranscript",
			type: "query",
			payload: { sessionId },
		});
		expect(res.status).toBe(200);
		expect(res.payload.sessionId).toBe(sessionId);
		expect(Array.isArray(res.payload.messages)).toBe(true);
		expect(res.payload.messages).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite B — chat.updateSession / deleteSession
// ---------------------------------------------------------------------------

describe.sequential("Suite 5B — chat.updateSession / deleteSession", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let sessionId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-chat-upd-cwd-");
		homeDir = makeTempDir("kanban-chat-upd-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });

		// Pre-create a session for update/delete tests.
		const createRes = await requestJson<{ session: { id: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: { title: "original title", scope: "project_sandboxed", role: "debugger" },
		});
		if (!createRes.payload.session) {
			throw new Error("Suite 5B setup: failed to create seed session");
		}
		sessionId = createRes.payload.session.id;
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("chat.updateSession persists a new title", async () => {
		const res = await requestJson<{ session: { id: string; title: string; goal: unknown } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, title: "renamed title" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session).not.toBeNull();
		expect(res.payload.session?.id).toBe(sessionId);
		expect(res.payload.session?.title).toBe("renamed title");
	});

	it("chat.updateSession persists a new goal", async () => {
		const res = await requestJson<{ session: { id: string; goal: unknown } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, goal: "investigate the bug" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.goal).toBe("investigate the bug");
	});

	it("chat.getSession reflects all persisted updates", async () => {
		const res = await requestJson<{ session: { id: string; title: string; goal: unknown } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getSession",
			type: "query",
			payload: { id: sessionId },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.title).toBe("renamed title");
		expect(res.payload.session?.goal).toBe("investigate the bug");
	});

	it("chat.deleteSession removes the session", async () => {
		const deleteRes = await requestJson<{ deleted: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "chat.deleteSession",
			type: "mutation",
			payload: { id: sessionId },
		});
		expect(deleteRes.status).toBe(200);
		expect(deleteRes.payload.deleted).toBe(true);
	});

	it("chat.listSessions no longer shows the deleted session", async () => {
		const listRes = await requestJson<{ sessions: Array<{ id: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		expect(listRes.status).toBe(200);
		const ids = listRes.payload.sessions.map((s) => s.id);
		expect(ids).not.toContain(sessionId);
	});

	it("chat.getSession returns null after deletion", async () => {
		const res = await requestJson<{ session: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getSession",
			type: "query",
			payload: { id: sessionId },
		});
		if (res.status === 200) {
			expect(res.payload.session).toBeNull();
		} else {
			expect(res.status).toBeGreaterThanOrEqual(400);
		}
	});
});

// ---------------------------------------------------------------------------
// Suite C — chat.sendMessage + transcript persistence (mock-LLM)
// ---------------------------------------------------------------------------
//
// WIRING STATUS: the mock LLM server is started and `runtime.saveNKleinProviderSettings` is called
// with `{ providerId: "lmstudio", baseUrl: mock.baseUrl + "/v1", modelId: "mock-model" }` to document
// the intended wiring path. However, `resolveLocalChatModelDeps()` (runtime-api.ts:383) currently
// uses a hardcoded `DEFAULT_LOCAL_CHAT_BASE_URL` and does NOT read from the saved provider settings.
// Until that bridge is wired (the chat model resolver should read from `getSdkProviderSettings("lmstudio")`),
// sendMessage / streamMessage will attempt to hit `http://127.0.0.1:1234` and fail.
//
// These tests are marked it.todo. When the wiring is added to `src/chat/local-chat-model.ts`, remove
// the it.todo wrappers and they should pass against the mock.
// ---------------------------------------------------------------------------

describe.sequential("Suite 5C — chat.sendMessage (mock-LLM wiring gap, see header)", () => {
	let server: BackendUnderTest;
	let mock: MockLlmServer;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		mock = await startMockLlm();
		cwd = makeTempDir("kanban-chat-send-cwd-");
		homeDir = makeTempDir("kanban-chat-send-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });

		// Attempt to wire the mock: save lmstudio provider settings so the server knows the mock URL.
		// NOTE: resolveLocalChatModelDeps() does NOT read from these saved settings (see suite header).
		await requestJson({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinProviderSettings",
			type: "mutation",
			payload: {
				providerId: "lmstudio",
				baseUrl: `${mock.baseUrl}/v1`,
				modelId: mock.modelId,
			},
		});
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		await mock.close();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	// The endpoint-resolution half of the wiring gap is now FIXED: runtime-api routes the chat's
	// `resolveLocalChatModelDeps` to the configured LOCAL provider endpoint via
	// `nkleinProviderService.getLocalChatBaseUrl()` (the selected local provider's saved baseUrl). What remains for
	// these two to run against the mock is the TEST-SIDE step of *selecting* a local provider that points at
	// `mock.baseUrl` (saving provider settings via HTTP does not also select it), plus an SSE/WS subscription
	// client for the streaming case. Until then they stay it.todo (the fix itself is unit-safe + shipped).
	it.todo(
		"chat.sendMessage routes to the configured endpoint + persists the turn [owes: HTTP path to SELECT a local provider pointing at the mock]",
	);

	it.todo(
		"chat.streamMessage streams token deltas to a 'done' event [owes: provider-select + an SSE/WS subscription test client]",
	);
});
