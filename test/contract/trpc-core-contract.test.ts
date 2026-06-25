/**
 * Suite 1 — HTTP tRPC core CRUD contract
 *
 * Drives core tRPC procedures over REAL HTTP against a spawned server and asserts:
 *   - HTTP status codes
 *   - JSON response shape (raw field checks, no Zod imports)
 *   - On-disk side effects verified by loading back via the API
 *
 * Model-free: no startTaskSession or anything requiring a live model.
 * Port-resilient: each test suite allocates its own free port.
 * Language-agnostic: assertions target raw JSON, not TypeScript types.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { createBoard, initGitRepository, requestJson, startTsBackend } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/**
 * Register the server's own cwd as a project (confirmSelfProject: true) and
 * return the assigned workspace ID.  The server no longer auto-registers its cwd
 * at startup; the client must explicitly add it.
 */
async function addSelfProject(baseUrl: string, cwdPath: string): Promise<string> {
	const res = await requestJson<{ ok: boolean; project: { id: string } | null }>({
		baseUrl,
		procedure: "projects.add",
		type: "mutation",
		payload: { path: cwdPath, confirmSelfProject: true },
	});
	if (!res.payload.ok || !res.payload.project) {
		throw new Error(`Failed to register self-project: ${JSON.stringify(res.payload)}`);
	}
	return res.payload.project.id;
}

// ---------------------------------------------------------------------------
// Suite: projects — list / add / remove
// ---------------------------------------------------------------------------

describe.sequential("Suite 1 — projects CRUD", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-proj-cwd-");
		homeDir = makeTempDir("kanban-contract-proj-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("projects.list returns empty project list before any project is added", async () => {
		const res = await requestJson<{ currentProjectId: unknown; projects: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "projects.list",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.projects).toEqual([]);
		expect(res.payload.currentProjectId).toBeNull();
	});

	it("projects.add registers the server cwd as a project and returns a workspace id", async () => {
		const res = await requestJson<{
			ok: boolean;
			project: { id: string; path: string; name: string; taskCounts: Record<string, number> } | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "projects.add",
			type: "mutation",
			payload: { path: cwd, confirmSelfProject: true },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.project).not.toBeNull();
		expect(typeof res.payload.project?.id).toBe("string");
		expect(res.payload.project?.id.length).toBeGreaterThan(0);
		expect(typeof res.payload.project?.path).toBe("string");
		expect(typeof res.payload.project?.name).toBe("string");
		expect(typeof res.payload.project?.taskCounts).toBe("object");
		workspaceId = res.payload.project?.id ?? "";
	});

	it("projects.list shows the registered project", async () => {
		const res = await requestJson<{
			currentProjectId: string | null;
			projects: Array<{ id: string; path: string; name: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "projects.list",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.projects).toHaveLength(1);
		expect(res.payload.projects[0]?.id).toBe(workspaceId);
	});

	it("projects.add a second git project (no confirmSelfProject needed)", async () => {
		const secondCwd = makeTempDir("kanban-contract-proj2-cwd-");
		try {
			mkdirSync(secondCwd, { recursive: true });
			initGitRepository(secondCwd);

			const res = await requestJson<{
				ok: boolean;
				project: { id: string } | null;
			}>({
				baseUrl: server.baseUrl,
				procedure: "projects.add",
				type: "mutation",
				workspaceId,
				payload: { path: secondCwd },
			});
			expect(res.status).toBe(200);
			expect(res.payload.ok).toBe(true);
			expect(res.payload.project).not.toBeNull();

			// Should now show 2 projects
			const listRes = await requestJson<{ projects: unknown[] }>({
				baseUrl: server.baseUrl,
				procedure: "projects.list",
				type: "query",
				workspaceId,
			});
			expect(listRes.status).toBe(200);
			expect(listRes.payload.projects).toHaveLength(2);

			// Remove second project to keep state clean for later suites
			const secondProjectId = (res.payload.project as { id: string }).id;
			const removeRes = await requestJson<{ ok: boolean }>({
				baseUrl: server.baseUrl,
				procedure: "projects.remove",
				type: "mutation",
				workspaceId,
				payload: { projectId: secondProjectId },
			});
			expect(removeRes.status).toBe(200);
			expect(removeRes.payload.ok).toBe(true);
		} finally {
			cleanupDir(secondCwd);
		}
	});

	it("projects.remove the main project leaves an empty list", async () => {
		const removeRes = await requestJson<{ ok: boolean; error?: string }>({
			baseUrl: server.baseUrl,
			procedure: "projects.remove",
			type: "mutation",
			workspaceId,
			payload: { projectId: workspaceId },
		});
		expect(removeRes.status).toBe(200);
		expect(removeRes.payload.ok).toBe(true);

		const listRes = await requestJson<{ projects: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "projects.list",
			type: "query",
		});
		expect(listRes.status).toBe(200);
		expect(listRes.payload.projects).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace — loadState / saveState / revision conflict
// ---------------------------------------------------------------------------

describe.sequential("Suite 1 — workspace.getState / saveState", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-ws-cwd-");
		homeDir = makeTempDir("kanban-contract-ws-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.getState returns the initial board state with a revision", async () => {
		const res = await requestJson<{
			repoPath: string;
			statePath: string;
			board: { columns: Array<{ id: string; cards: unknown[] }> };
			sessions: Record<string, unknown>;
			revision: number;
			git: { currentBranch: string | null };
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.repoPath).toBe("string");
		expect(typeof res.payload.statePath).toBe("string");
		expect(typeof res.payload.revision).toBe("number");
		expect(Array.isArray(res.payload.board.columns)).toBe(true);
		expect(typeof res.payload.sessions).toBe("object");
		expect(typeof res.payload.git).toBe("object");
	});

	it("workspace.saveState persists a board and increments the revision", async () => {
		// Load current state to get the revision
		const loadRes = await requestJson<{
			revision: number;
			board: { columns: Array<{ id: string; cards: unknown[] }> };
			sessions: Record<string, unknown>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		expect(loadRes.status).toBe(200);
		const prevRevision = loadRes.payload.revision;

		const board = createBoard("Contract Test Task");

		const saveRes = await requestJson<{
			revision: number;
			board: { columns: Array<{ id: string; cards: Array<{ prompt: string }> }> };
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {
				board,
				sessions: loadRes.payload.sessions,
				expectedRevision: prevRevision,
			},
		});
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.revision).toBe(prevRevision + 1);

		// The first column (backlog) should contain our task
		const backlogColumn = saveRes.payload.board.columns.find((c) => c.id === "backlog");
		expect(backlogColumn).toBeDefined();
		expect(backlogColumn?.cards[0]?.prompt).toBe("Contract Test Task");
	});

	it("workspace.saveState round-trips: reading back reflects the saved board", async () => {
		// Read back and verify the board was persisted on-disk
		const reloadRes = await requestJson<{
			board: { columns: Array<{ id: string; cards: Array<{ prompt: string }> }> };
			revision: number;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		expect(reloadRes.status).toBe(200);
		const backlog = reloadRes.payload.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards[0]?.prompt).toBe("Contract Test Task");
	});

	it("workspace.saveState rejects a stale expectedRevision with a conflict error", async () => {
		// Load to get current revision
		const loadRes = await requestJson<{ revision: number; sessions: Record<string, unknown> }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		const currentRevision = loadRes.payload.revision;
		const staleRevision = currentRevision - 1; // intentionally stale

		const board = createBoard("Stale Conflict Task");
		const conflictRes = await requestJson<{ message?: string; code?: string; conflictRevision?: number }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {
				board,
				sessions: loadRes.payload.sessions,
				expectedRevision: staleRevision,
			},
		});
		// tRPC surfaces a CONFLICT as HTTP 409
		expect(conflictRes.status).toBe(409);
	});
});

// ---------------------------------------------------------------------------
// Suite: runtime — getConfig / saveConfig
// ---------------------------------------------------------------------------

describe.sequential("Suite 1 — runtime.getConfig / saveConfig", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-cfg-cwd-");
		homeDir = makeTempDir("kanban-contract-cfg-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("runtime.getConfig returns a config object with expected fields", async () => {
		const res = await requestJson<{
			selectedAgentId: string;
			maxConcurrentTasks: number;
			agentAutonomousModeEnabled: boolean;
			swarmGuardrails: {
				maxAutonomousTurnsPerTask: number;
				maxAutonomousWallTimeMs: number;
				maxRepeatedNoDiffCheckpoints: number;
				maxRepeatedToolCallsPerTask: number;
			};
			globalConfigPath: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getConfig",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.selectedAgentId).toBe("string");
		expect(typeof res.payload.maxConcurrentTasks).toBe("number");
		expect(typeof res.payload.agentAutonomousModeEnabled).toBe("boolean");
		expect(typeof res.payload.swarmGuardrails).toBe("object");
		expect(typeof res.payload.swarmGuardrails.maxAutonomousTurnsPerTask).toBe("number");
		expect(typeof res.payload.swarmGuardrails.maxRepeatedToolCallsPerTask).toBe("number");
		expect(typeof res.payload.globalConfigPath).toBe("string");
	});

	it("runtime.saveConfig persists a change and reads back the updated value", async () => {
		// Read the current config
		const getRes = await requestJson<{ maxConcurrentTasks: number }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getConfig",
			type: "query",
		});
		expect(getRes.status).toBe(200);
		const originalMaxConcurrent = getRes.payload.maxConcurrentTasks;

		// Choose a different value (toggle between 2 and 3)
		const newMaxConcurrent = originalMaxConcurrent === 2 ? 3 : 2;

		const saveRes = await requestJson<{ maxConcurrentTasks: number }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveConfig",
			type: "mutation",
			payload: { maxConcurrentTasks: newMaxConcurrent },
		});
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.maxConcurrentTasks).toBe(newMaxConcurrent);

		// Read back to confirm persistence
		const rereadRes = await requestJson<{ maxConcurrentTasks: number }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getConfig",
			type: "query",
		});
		expect(rereadRes.status).toBe(200);
		expect(rereadRes.payload.maxConcurrentTasks).toBe(newMaxConcurrent);
	});
});

// ---------------------------------------------------------------------------
// Suite: runtime — getSwarmStop / requestSwarmStop / clearSwarmStop
// ---------------------------------------------------------------------------

describe.sequential("Suite 1 — runtime swarm stop signal", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-swarm-cwd-");
		homeDir = makeTempDir("kanban-contract-swarm-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("runtime.getSwarmStop returns ok=true and signal=null on a fresh workspace", async () => {
		const res = await requestJson<{ ok: boolean; signal: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getSwarmStop",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.signal).toBeNull();
	});

	it("runtime.requestSwarmStop sets the stop signal with the provided reason", async () => {
		const res = await requestJson<{
			ok: boolean;
			signal: { stopped: boolean; reason: string; createdAt: number } | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.requestSwarmStop",
			type: "mutation",
			workspaceId,
			payload: { reason: "contract test stop" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.signal).not.toBeNull();
		expect(res.payload.signal?.stopped).toBe(true);
		expect(res.payload.signal?.reason).toBe("contract test stop");
		expect(typeof res.payload.signal?.createdAt).toBe("number");
	});

	it("runtime.getSwarmStop now reflects the active stop signal", async () => {
		const res = await requestJson<{
			ok: boolean;
			signal: { stopped: boolean; reason: string } | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getSwarmStop",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.signal).not.toBeNull();
		expect(res.payload.signal?.stopped).toBe(true);
		expect(res.payload.signal?.reason).toBe("contract test stop");
	});

	it("runtime.clearSwarmStop removes the stop signal", async () => {
		// Pass an empty payload so requestJson sets Content-Type: application/json;
		// tRPC returns 415 for mutations with no body / no content-type header.
		const clearRes = await requestJson<{ ok: boolean; signal: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.clearSwarmStop",
			type: "mutation",
			workspaceId,
			payload: {},
		});
		expect(clearRes.status).toBe(200);
		expect(clearRes.payload.ok).toBe(true);
		expect(clearRes.payload.signal).toBeNull();

		// Verify it reads back as null
		const verifyRes = await requestJson<{ ok: boolean; signal: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getSwarmStop",
			type: "query",
			workspaceId,
		});
		expect(verifyRes.status).toBe(200);
		expect(verifyRes.payload.signal).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Suite: runtime — listNKleinPlanArtifacts (workspace-scoped)
// ---------------------------------------------------------------------------

describe.sequential("Suite 1 — runtime.listNKleinPlanArtifacts", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-artifacts-cwd-");
		homeDir = makeTempDir("kanban-contract-artifacts-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("runtime.listNKleinPlanArtifacts returns an empty artifacts array on a fresh workspace", async () => {
		const res = await requestJson<{ artifacts: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: "nonexistent-task-id" },
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.artifacts)).toBe(true);
		expect(res.payload.artifacts).toHaveLength(0);
	});
});
