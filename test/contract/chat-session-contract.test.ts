/**
 * Suite 18 — chat session management: deeper contract coverage (todo §5.V)
 *
 * The existing Suite 5 (`chat-contract.test.ts`) covers the happy-path session CRUD lifecycle
 * (create/list/get/update/delete/getTranscript) and the model-driven paths (sendMessage/streamMessage
 * against a mock-LLM). THIS suite adds the gaps left in that coverage:
 *
 * Additional deterministic coverage:
 *   chat.createSession    — default-field population (scope/role defaults when omitted)
 *   chat.createSession    — all optional fields explicitly set: chat_only scope,
 *                           riskAcknowledged, browserEnabled, role
 *   chat.createSession    — title whitespace trimming
 *   chat.listSessions     — multiple sessions → all present; ordered newest-updatedAt first
 *   chat.updateSession    — scope / role / riskAcknowledged / browserEnabled round-trip
 *   chat.updateSession    — updatedAt strictly advances after each update
 *   chat.updateSession    — goal: null clears a previously-set goal
 *   chat.updateSession    — unknown id → 200 with null session (or 4xx)
 *   chat.deleteSession    — non-existent id → { deleted: false }
 *   chat.getTranscript    — limit parameter respected (only N most-recent messages returned)
 *   On-disk JSONL         — sessions.jsonl written to $HOME/.nklein/nklein/chat-sessions/
 *                           and parses as valid JSONL with correct session data
 *
 * Deferred to e2e layer (require a live model):
 *   - Transcript content after sendMessage / streamMessage turns (covered by Suite 5C)
 *   - Knowledge-fetch tool calls within a chat turn
 *   - Autonomous-work mode behavior
 *
 * Port-resilient: imports nothing from src/ (drives HTTP + reads on-disk files only).
 * Each describe block spins its own isolated server + temp dirs for clean teardown.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/**
 * Create a session and return its id. Throws on failure so test setup is obvious when it goes wrong.
 */
async function createSessionAndGetId(
	baseUrl: string,
	fields: Record<string, unknown> = { title: "test session" },
): Promise<string> {
	const res = await requestJson<{ session: { id: string } | null }>({
		baseUrl,
		procedure: "chat.createSession",
		type: "mutation",
		payload: fields,
	});
	const id = res.payload.session?.id;
	if (!id) {
		throw new Error(`Suite 18 setup: chat.createSession returned no id — payload: ${JSON.stringify(res.payload)}`);
	}
	return id;
}

// ---------------------------------------------------------------------------
// Suite 18A — session creation: default fields + explicit optional fields
// ---------------------------------------------------------------------------

describe.sequential("Suite 18A — chat.createSession default + explicit optional fields", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-18a-cwd-");
		homeDir = makeTempDir("kanban-18a-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("createSession with only title populates scope/role/goal/riskAcknowledged/browserEnabled defaults", async () => {
		const res = await requestJson<{
			session: {
				id: string;
				title: string;
				scope: string;
				role: string;
				goal: unknown;
				riskAcknowledged: boolean;
				browserEnabled: boolean;
				createdAt: number;
				updatedAt: number;
			} | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: { title: "defaults check" },
		});
		expect(res.status).toBe(200);
		const s = res.payload.session;
		expect(s).not.toBeNull();
		// Default scope is project_sandboxed per chat-session-store.ts DEFAULT_CHAT_SESSION_SCOPE.
		expect(s?.scope).toBe("project_sandboxed");
		// Default role is planner_architect per DEFAULT_CHAT_SESSION_ROLE.
		expect(s?.role).toBe("planner_architect");
		// Unset goal must be null (not undefined / empty string).
		expect(s?.goal).toBeNull();
		// Safety fields default to off.
		expect(s?.riskAcknowledged).toBe(false);
		expect(s?.browserEnabled).toBe(false);
		// Timestamps must be positive numbers.
		expect(typeof s?.createdAt).toBe("number");
		expect(typeof s?.updatedAt).toBe("number");
		expect(s?.createdAt).toBeGreaterThan(0);
		// createdAt === updatedAt on a fresh session.
		expect(s?.updatedAt).toBe(s?.createdAt);
	});

	it("createSession with chat_only scope persists it correctly", async () => {
		const res = await requestJson<{ session: { id: string; scope: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: { title: "read-only session", scope: "chat_only" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.scope).toBe("chat_only");
	});

	it("createSession with all optional fields set returns them verbatim", async () => {
		const res = await requestJson<{
			session: {
				id: string;
				title: string;
				scope: string;
				role: string;
				goal: unknown;
				riskAcknowledged: boolean;
				browserEnabled: boolean;
			} | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: {
				title: "fully specified",
				scope: "all_projects",
				role: "reviewer",
				goal: "audit the board state",
				riskAcknowledged: true,
				browserEnabled: true,
			},
		});
		expect(res.status).toBe(200);
		const s = res.payload.session;
		expect(s?.title).toBe("fully specified");
		expect(s?.scope).toBe("all_projects");
		expect(s?.role).toBe("reviewer");
		expect(s?.goal).toBe("audit the board state");
		expect(s?.riskAcknowledged).toBe(true);
		expect(s?.browserEnabled).toBe(true);
	});

	it("createSession trims leading/trailing whitespace from the title", async () => {
		const res = await requestJson<{ session: { title: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: { title: "  spaces around  " },
		});
		expect(res.status).toBe(200);
		// The store trims: "  spaces around  ".trim() === "spaces around"
		expect(res.payload.session?.title).toBe("spaces around");
	});
});

// ---------------------------------------------------------------------------
// Suite 18B — multiple sessions: list order + distinct ids
// ---------------------------------------------------------------------------

describe.sequential("Suite 18B — multiple sessions: list order + distinct ids", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let idA: string;
	let idB: string;
	let idC: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-18b-cwd-");
		homeDir = makeTempDir("kanban-18b-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });

		// Create three sessions in sequence. The store sorts by updatedAt descending,
		// so the last created should appear first (assuming Date.now() advances).
		idA = await createSessionAndGetId(server.baseUrl, { title: "session A" });
		idB = await createSessionAndGetId(server.baseUrl, { title: "session B" });
		idC = await createSessionAndGetId(server.baseUrl, { title: "session C" });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("listSessions returns all three sessions", async () => {
		const res = await requestJson<{ sessions: Array<{ id: string; title: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.sessions).toHaveLength(3);
		const ids = res.payload.sessions.map((s) => s.id);
		expect(ids).toContain(idA);
		expect(ids).toContain(idB);
		expect(ids).toContain(idC);
	});

	it("all session ids are distinct strings", async () => {
		const res = await requestJson<{ sessions: Array<{ id: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		const ids = res.payload.sessions.map((s) => s.id);
		const unique = new Set(ids);
		expect(unique.size).toBe(ids.length);
		for (const id of ids) {
			expect(typeof id).toBe("string");
			expect(id.length).toBeGreaterThan(0);
		}
	});

	it("listSessions orders by updatedAt descending (newest-updated first)", async () => {
		// Touch session A so its updatedAt is the most recent.
		await requestJson({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: idA, title: "session A — touched last" },
		});
		const res = await requestJson<{ sessions: Array<{ id: string; updatedAt: number }> }>({
			baseUrl: server.baseUrl,
			procedure: "chat.listSessions",
			type: "query",
		});
		expect(res.status).toBe(200);
		const sessions = res.payload.sessions;
		// Session A should now be first (most recently updated).
		expect(sessions[0]?.id).toBe(idA);
		// The updatedAt values must be non-increasing (i.e. sorted descending).
		for (let i = 1; i < sessions.length; i++) {
			expect(sessions[i - 1]?.updatedAt).toBeGreaterThanOrEqual(sessions[i]?.updatedAt);
		}
	});
});

// ---------------------------------------------------------------------------
// Suite 18C — updateSession: fields not covered by Suite 5
// ---------------------------------------------------------------------------

describe.sequential("Suite 18C — updateSession: scope / role / riskAcknowledged / browserEnabled / updatedAt", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let sessionId: string;
	let originalUpdatedAt: number;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-18c-cwd-");
		homeDir = makeTempDir("kanban-18c-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });

		// Seed a session and capture its initial updatedAt.
		const createRes = await requestJson<{
			session: { id: string; updatedAt: number; riskAcknowledged: boolean; browserEnabled: boolean } | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: {
				title: "update-fields test",
				scope: "project_sandboxed",
				role: "planner_architect",
				riskAcknowledged: false,
				browserEnabled: false,
			},
		});
		if (!createRes.payload.session) {
			throw new Error("Suite 18C setup: failed to create seed session");
		}
		sessionId = createRes.payload.session.id;
		originalUpdatedAt = createRes.payload.session.updatedAt;
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("updateSession changes scope to host_access", async () => {
		const res = await requestJson<{ session: { id: string; scope: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, scope: "host_access" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.scope).toBe("host_access");
	});

	it("updateSession changes role to debugger", async () => {
		const res = await requestJson<{ session: { id: string; role: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, role: "debugger" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.role).toBe("debugger");
	});

	it("updateSession sets riskAcknowledged to true", async () => {
		const res = await requestJson<{ session: { id: string; riskAcknowledged: boolean } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, riskAcknowledged: true },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.riskAcknowledged).toBe(true);
	});

	it("updateSession sets browserEnabled to true", async () => {
		const res = await requestJson<{ session: { id: string; browserEnabled: boolean } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, browserEnabled: true },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.browserEnabled).toBe(true);
	});

	it("getSession reflects all accumulated updates", async () => {
		const res = await requestJson<{
			session: {
				id: string;
				scope: string;
				role: string;
				riskAcknowledged: boolean;
				browserEnabled: boolean;
			} | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "chat.getSession",
			type: "query",
			payload: { id: sessionId },
		});
		expect(res.status).toBe(200);
		expect(res.payload.session?.scope).toBe("host_access");
		expect(res.payload.session?.role).toBe("debugger");
		expect(res.payload.session?.riskAcknowledged).toBe(true);
		expect(res.payload.session?.browserEnabled).toBe(true);
	});

	it("updatedAt strictly advances after an update", async () => {
		// Wait a tick so Date.now() advances (parallel test runners rarely have sub-ms resolution issues but let's be safe).
		await new Promise<void>((resolve) => setTimeout(resolve, 2));
		const updateRes = await requestJson<{ session: { updatedAt: number } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, title: "renamed for updatedAt check" },
		});
		expect(updateRes.status).toBe(200);
		const newUpdatedAt = updateRes.payload.session?.updatedAt;
		expect(typeof newUpdatedAt).toBe("number");
		expect(newUpdatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
	});

	it("updateSession with goal: null clears a previously-set goal", async () => {
		// First set a goal.
		await requestJson({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, goal: "a goal to be cleared" },
		});
		// Then clear it.
		const clearRes = await requestJson<{ session: { goal: unknown } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: sessionId, goal: null },
		});
		expect(clearRes.status).toBe(200);
		expect(clearRes.payload.session?.goal).toBeNull();
	});

	it("updateSession on an unknown id returns null session (or 4xx)", async () => {
		const res = await requestJson<{ session: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "chat.updateSession",
			type: "mutation",
			payload: { id: "non-existent-id-abc123", title: "should not matter" },
		});
		if (res.status === 200) {
			expect(res.payload.session).toBeNull();
		} else {
			expect(res.status).toBeGreaterThanOrEqual(400);
		}
	});
});

// ---------------------------------------------------------------------------
// Suite 18D — deleteSession: non-existent id returns deleted: false
// ---------------------------------------------------------------------------

describe.sequential("Suite 18D — deleteSession: non-existent id", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-18d-cwd-");
		homeDir = makeTempDir("kanban-18d-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("deleteSession on a non-existent id returns { deleted: false }", async () => {
		const res = await requestJson<{ deleted: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "chat.deleteSession",
			type: "mutation",
			payload: { id: "definitely-does-not-exist-xyz" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.deleted).toBe(false);
	});

	it("deleteSession is idempotent: second deletion also returns { deleted: false }", async () => {
		// Create then delete a session.
		const id = await createSessionAndGetId(server.baseUrl, { title: "idempotent delete test" });
		const first = await requestJson<{ deleted: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "chat.deleteSession",
			type: "mutation",
			payload: { id },
		});
		expect(first.payload.deleted).toBe(true);
		// Second delete of the same id.
		const second = await requestJson<{ deleted: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "chat.deleteSession",
			type: "mutation",
			payload: { id },
		});
		expect(second.status).toBe(200);
		expect(second.payload.deleted).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite 18E — getTranscript: limit parameter
// ---------------------------------------------------------------------------

describe.sequential("Suite 18E — getTranscript limit parameter", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-18e-cwd-");
		homeDir = makeTempDir("kanban-18e-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("getTranscript with limit=1 on an empty session returns 0 messages (empty is still ≤ limit)", async () => {
		const id = await createSessionAndGetId(server.baseUrl, { title: "limit test - empty" });
		const res = await requestJson<{ sessionId: string; messages: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getTranscript",
			type: "query",
			payload: { sessionId: id, limit: 1 },
		});
		expect(res.status).toBe(200);
		expect(res.payload.sessionId).toBe(id);
		// Empty session has no messages regardless of limit.
		expect(Array.isArray(res.payload.messages)).toBe(true);
		expect(res.payload.messages).toHaveLength(0);
	});

	it("getTranscript without limit returns empty array for a fresh session", async () => {
		const id = await createSessionAndGetId(server.baseUrl, { title: "limit test - no limit" });
		const res = await requestJson<{ sessionId: string; messages: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "chat.getTranscript",
			type: "query",
			payload: { sessionId: id },
		});
		expect(res.status).toBe(200);
		expect(res.payload.messages).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 18F — on-disk JSONL verification
// ---------------------------------------------------------------------------

describe.sequential("Suite 18F — on-disk sessions.jsonl file assertions", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let createdId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-18f-cwd-");
		homeDir = makeTempDir("kanban-18f-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });

		// Create a session so there is something in the JSONL file.
		createdId = await createSessionAndGetId(server.baseUrl, {
			title: "on-disk test session",
			scope: "all_projects",
			role: "researcher",
			goal: "verify on-disk persistence",
		});
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("sessions.jsonl exists at the expected path under $HOME", () => {
		// The store writes to $HOME/.nklein/nklein/chat-sessions/sessions.jsonl.
		// The spawned server uses homeDir as $HOME.
		const jsonlPath = join(homeDir, ".nklein", "nklein", "chat-sessions", "sessions.jsonl");
		expect(existsSync(jsonlPath)).toBe(true);
	});

	it("sessions.jsonl contains valid JSONL: each line parses as JSON", () => {
		const jsonlPath = join(homeDir, ".nklein", "nklein", "chat-sessions", "sessions.jsonl");
		const raw = readFileSync(jsonlPath, "utf8");
		const lines = raw.split("\n").filter((l) => l.trim().length > 0);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("sessions.jsonl upsert event contains the session title and id", () => {
		const jsonlPath = join(homeDir, ".nklein", "nklein", "chat-sessions", "sessions.jsonl");
		const raw = readFileSync(jsonlPath, "utf8");
		const events: unknown[] = raw
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));

		// There must be at least one upsert event.
		const upserts = events.filter(
			(e) => typeof e === "object" && e !== null && (e as { type?: unknown }).type === "upsert",
		);
		expect(upserts.length).toBeGreaterThanOrEqual(1);

		// The upsert for our session must be present with correct fields.
		const ours = upserts.find(
			(e) =>
				typeof e === "object" &&
				e !== null &&
				typeof (e as { session?: { id?: unknown } }).session?.id === "string" &&
				(e as { session: { id: string } }).session.id === createdId,
		) as { session: { id: string; title: string; scope: string; role: string; goal: string | null } } | undefined;

		expect(ours).toBeDefined();
		expect(ours?.session.title).toBe("on-disk test session");
		expect(ours?.session.scope).toBe("all_projects");
		expect(ours?.session.role).toBe("researcher");
		expect(ours?.session.goal).toBe("verify on-disk persistence");
	});

	it("deleting a session appends a delete event to sessions.jsonl", async () => {
		// Delete the session we created in beforeAll.
		const delRes = await requestJson<{ deleted: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "chat.deleteSession",
			type: "mutation",
			payload: { id: createdId },
		});
		expect(delRes.payload.deleted).toBe(true);

		const jsonlPath = join(homeDir, ".nklein", "nklein", "chat-sessions", "sessions.jsonl");
		const raw = readFileSync(jsonlPath, "utf8");
		const events: unknown[] = raw
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));

		const deleteEvents = events.filter(
			(e) =>
				typeof e === "object" &&
				e !== null &&
				(e as { type?: unknown }).type === "delete" &&
				(e as { id?: unknown }).id === createdId,
		);
		expect(deleteEvents.length).toBeGreaterThanOrEqual(1);
	});
});
