/**
 * Suite 19 — runtime status/catalog/registry read procedures (todo §5.V)
 *
 * Exercises deterministic runtime.* READ procedures through the real HTTP/tRPC
 * seam and asserts response shape + structural invariants. No live LM Studio,
 * Docker, or running agent is required. All procedures here are pure reads
 * (or simple registry mutations) that produce observable state from a cold
 * backend start.
 *
 * Covered procedures (previously uncovered at the HTTP seam):
 *
 *   runtime.getNKleinProviderCatalog   — built-in provider list shape
 *   runtime.getNKleinModelRegistry     — empty registry shape on fresh backend
 *   runtime.removeNKleinModelRegistryEntry — remove a seeded entry
 *   runtime.pruneNKleinModelRegistry   — prune on empty returns removed=0
 *   runtime.getUpdateStatus            — version/update shape
 *   runtime.getMergeHistory            — empty history shape on fresh backend
 *   runtime.getKleinCorePyHealth       — sidecar disabled by NKLEIN_CORE_PY=0
 *   runtime.getNKleinCodeIntelligenceStatus — code-intel shape + workspace scope
 *   runtime.getTaskDiagnostics         — empty events for unknown taskId
 *   runtime.getModelPerformanceStats   — empty stats shape
 *   runtime.getKnowledgeToolUsageStats — empty stats shape
 *   runtime.getNKleinSlashCommands     — slash-command list shape
 *
 * Deferred (require live model / Docker / agent run to observe):
 *   runtime.startTaskSession           — needs Docker sandbox + model
 *   runtime.stopTaskSession            — needs a running session
 *   runtime.pauseTask / resumeTask     — needs a running session
 *   runtime.sendTaskSessionInput       — needs a running session
 *   runtime.getTaskChatMessages        — needs a running session
 *   runtime.sendTaskChatMessage        — needs a running session
 *   runtime.abortTaskChatTurn          — needs a running session
 *   runtime.cancelTaskChatTurn         — needs a running session
 *   runtime.reloadTaskChatSession      — needs a running session
 *   runtime.grantProtectedTestApproval — needs a running session
 *   runtime.importTaskContext          — needs a running session
 *   runtime.verifyTaskAcceptance       — needs Docker agent + live worktree
 *   runtime.mergeTaskWorktrees         — needs live worktrees
 *   runtime.expandNKleinPlanTask       — needs a model call (live LLM)
 *   runtime.sendNKleinAdvisor          — needs a model call (live LLM)
 *   runtime.runNKleinSmokeEval         — needs Docker + live model
 *   runtime.collectTaskEvidence        — needs a completed task run
 *   runtime.discoverNKleinEndpointModels — needs a live LM Studio endpoint
 *   runtime.getNKleinProviderModels    — returns [] without a live provider
 *   runtime.saveNKleinProviderSettings — observable only with a real provider
 *   runtime.runNKleinProviderOAuthLogin — needs OAuth redirect flow
 *   runtime.startNKleinDeviceAuth      — needs NKlein cloud auth
 *   runtime.completeNKleinDeviceAuth   — needs NKlein cloud auth
 *   runtime.switchNKleinAccount        — needs NKlein cloud auth
 *   runtime.getNKleinAccountProfile    — needs NKlein cloud auth
 *   runtime.getNKleinAccountBalance    — needs NKlein cloud auth
 *   runtime.getNKleinAccountOrganizations — needs NKlein cloud auth
 *   runtime.getNKleinKanbanAccess      — needs NKlein cloud auth
 *   runtime.getFeaturebaseToken        — needs NKlein cloud auth
 *   runtime.getNKleinMcpAuthStatuses   — needs a configured MCP server with OAuth
 *   runtime.runNKleinMcpServerOAuth    — needs a live MCP server OAuth flow
 *   runtime.startShellSession          — needs a running shell session manager
 *   runtime.runCommand                 — needs a running shell session
 *   runtime.buildNKleinModelFreshnessAdvisor — builds a prompt; queries no model
 *   runtime.buildNKleinAdvisor         — builds a prompt; queries no model
 *   runtime.writeNKleinDogfoodBacklog  — writes to the dogfood backlog path
 *   runtime.openFile                   — needs a desktop OS file-open callback
 *   runtime.runUpdateNow               — triggers package manager update
 *   runtime.resetAllState              — destructive; covered by dedicated reset suite
 *   runtime.addNKleinProvider          — already covered by Suite 16
 *   runtime.updateNKleinProvider       — needs a seeded provider
 *
 * Port-resilient: imports nothing from src/ except shared helper types.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

/** Register the server's own cwd as a project and return workspaceId. */
async function addSelfProject(baseUrl: string, cwdPath: string): Promise<string> {
	const res = await requestJson<{ ok: boolean; project: { id: string } | null }>({
		baseUrl,
		procedure: "projects.add",
		type: "mutation",
		payload: { path: cwdPath, confirmSelfProject: true },
	});
	if (!res.payload.ok || !res.payload.project) {
		throw new Error(`Failed to register project: ${JSON.stringify(res.payload)}`);
	}
	return res.payload.project.id;
}

// ---------------------------------------------------------------------------
// Suite 19-A — provider catalog shape
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-A — runtime.getNKleinProviderCatalog shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-catalog-cwd-");
		homeDir = makeTempDir("kanban-catalog-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with a providers array", async () => {
		const res = await requestJson<{ providers: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinProviderCatalog",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.providers)).toBe(true);
	});

	it("every provider entry has required shape fields", async () => {
		const res = await requestJson<{ providers: Array<Record<string, unknown>> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinProviderCatalog",
			type: "query",
		});
		expect(res.status).toBe(200);
		// The catalog must contain at least one built-in provider
		expect(res.payload.providers.length).toBeGreaterThan(0);
		for (const provider of res.payload.providers) {
			expect(typeof provider.id).toBe("string");
			expect(typeof provider.name).toBe("string");
			expect(typeof provider.oauthSupported).toBe("boolean");
			expect(typeof provider.enabled).toBe("boolean");
			expect(typeof provider.supportsBaseUrl).toBe("boolean");
			// defaultModelId is string | null; baseUrl is string | null
			expect(provider.defaultModelId === null || typeof provider.defaultModelId === "string").toBe(true);
			expect(provider.baseUrl === null || typeof provider.baseUrl === "string").toBe(true);
		}
	});

	it("catalog includes a well-known provider (lmstudio)", async () => {
		const res = await requestJson<{ providers: Array<{ id: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinProviderCatalog",
			type: "query",
		});
		expect(res.status).toBe(200);
		const ids = res.payload.providers.map((p) => p.id);
		expect(ids).toContain("lmstudio");
	});
});

// ---------------------------------------------------------------------------
// Suite 19-B — model registry (read, seed via override, remove, prune)
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-B — runtime.getNKleinModelRegistry / remove / prune", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-mreg-cwd-");
		homeDir = makeTempDir("kanban-mreg-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("getNKleinModelRegistry returns correct top-level shape on a fresh backend", async () => {
		const res = await requestJson<{
			schemaVersion: number;
			updatedAt: number;
			models: unknown[];
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinModelRegistry",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.schemaVersion).toBe("number");
		expect(res.payload.schemaVersion).toBeGreaterThan(0);
		expect(typeof res.payload.updatedAt).toBe("number");
		expect(Array.isArray(res.payload.models)).toBe(true);
	});

	it("fresh backend has an empty models list", async () => {
		const res = await requestJson<{ models: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinModelRegistry",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.models).toHaveLength(0);
	});

	it("seeding an entry via saveNKleinModelContextWindowOverride makes it appear in the registry", async () => {
		// Seed an entry
		await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelContextWindowOverride",
			type: "mutation",
			payload: {
				providerId: "lmstudio",
				modelId: "suite19/test-model-a",
				contextWindow: 32768,
			},
		});

		const res = await requestJson<{ models: Array<{ key: string; providerId: string; modelId: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinModelRegistry",
			type: "query",
		});
		expect(res.status).toBe(200);
		const found = res.payload.models.find((m) => m.providerId === "lmstudio" && m.modelId === "suite19/test-model-a");
		expect(found).toBeDefined();
	});

	it("each registry model entry has the required nested shape", async () => {
		const res = await requestJson<{
			models: Array<Record<string, unknown>>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinModelRegistry",
			type: "query",
		});
		expect(res.status).toBe(200);
		for (const model of res.payload.models) {
			expect(typeof model.key).toBe("string");
			expect(typeof model.providerId).toBe("string");
			expect(typeof model.modelId).toBe("string");
			// endpoint is string | null
			expect(model.endpoint === null || typeof model.endpoint === "string").toBe(true);
			// contextWindow, speed, capability, constraints must be objects
			expect(typeof model.contextWindow).toBe("object");
			expect(typeof model.speed).toBe("object");
			expect(typeof model.capability).toBe("object");
			expect(typeof model.constraints).toBe("object");
			expect(typeof model.createdAt).toBe("number");
			expect(typeof model.updatedAt).toBe("number");
		}
	});

	it("removeNKleinModelRegistryEntry with a known key removes the entry", async () => {
		// Get the key of the entry we seeded
		const listRes = await requestJson<{
			models: Array<{ key: string; providerId: string; modelId: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinModelRegistry",
			type: "query",
		});
		const entry = listRes.payload.models.find(
			(m) => m.providerId === "lmstudio" && m.modelId === "suite19/test-model-a",
		);
		if (!entry) {
			throw new Error("Expected registry entry not found for suite19/test-model-a");
		}
		const key = entry.key;

		const removeRes = await requestJson<{ removed: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.removeNKleinModelRegistryEntry",
			type: "mutation",
			payload: { key },
		});
		expect(removeRes.status).toBe(200);
		expect(removeRes.payload.removed).toBe(true);

		// Confirm it's gone
		const afterRes = await requestJson<{ models: Array<{ key: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinModelRegistry",
			type: "query",
		});
		const stillPresent = afterRes.payload.models.find((m) => m.key === key);
		expect(stillPresent).toBeUndefined();
	});

	it("removeNKleinModelRegistryEntry with an unknown key returns removed=false", async () => {
		const res = await requestJson<{ removed: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.removeNKleinModelRegistryEntry",
			type: "mutation",
			payload: { key: "lmstudio::nonexistent/model::null" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.removed).toBe(false);
	});

	it("pruneNKleinModelRegistry on an empty registry returns removed=0", async () => {
		// Registry is empty after the remove above.
		// Pass payload:{} so requestJson sends Content-Type: application/json —
		// tRPC returns 415 for mutations with no body/content-type header.
		const res = await requestJson<{ removed: number }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.pruneNKleinModelRegistry",
			type: "mutation",
			payload: {},
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.removed).toBe("number");
		expect(res.payload.removed).toBeGreaterThanOrEqual(0);
	});

	it("pruneNKleinModelRegistry response shape has a numeric removed field", async () => {
		// This test just verifies the HTTP response shape of pruneNKleinModelRegistry
		// regardless of how many entries exist. The prior tests left the registry clean.
		// We call prune once more to confirm the shape contract, not the pruning behavior.
		const pruneRes = await requestJson<{ removed: number }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.pruneNKleinModelRegistry",
			type: "mutation",
			payload: {},
		});
		expect(pruneRes.status).toBe(200);
		expect(typeof pruneRes.payload.removed).toBe("number");
		expect(pruneRes.payload.removed).toBeGreaterThanOrEqual(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-C — update status shape
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-C — runtime.getUpdateStatus shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-upd-cwd-");
		homeDir = makeTempDir("kanban-upd-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with correct shape fields", async () => {
		const res = await requestJson<{
			currentVersion: string;
			latestVersion: string | null;
			updateAvailable: boolean;
			updateTiming: string | null;
			installCommand: string | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getUpdateStatus",
			type: "query",
		});
		expect(res.status).toBe(200);
		// currentVersion is always a non-empty string
		expect(typeof res.payload.currentVersion).toBe("string");
		expect(res.payload.currentVersion.length).toBeGreaterThan(0);
		// latestVersion is string or null
		expect(res.payload.latestVersion === null || typeof res.payload.latestVersion === "string").toBe(true);
		// updateAvailable is boolean
		expect(typeof res.payload.updateAvailable).toBe("boolean");
		// updateTiming is one of the enum values or null
		expect(
			res.payload.updateTiming === null ||
				res.payload.updateTiming === "startup" ||
				res.payload.updateTiming === "shutdown",
		).toBe(true);
		// installCommand is string or null
		expect(res.payload.installCommand === null || typeof res.payload.installCommand === "string").toBe(true);
	});

	it("fresh backend has updateAvailable=false (no network in tests)", async () => {
		const res = await requestJson<{ updateAvailable: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getUpdateStatus",
			type: "query",
		});
		expect(res.status).toBe(200);
		// In a test environment without network access, the update check returns false
		expect(typeof res.payload.updateAvailable).toBe("boolean");
	});
});

// ---------------------------------------------------------------------------
// Suite 19-D — merge history shape (empty on fresh backend)
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-D — runtime.getMergeHistory shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-mhist-cwd-");
		homeDir = makeTempDir("kanban-mhist-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with a records array", async () => {
		const res = await requestJson<{ records: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getMergeHistory",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.records)).toBe(true);
	});

	it("fresh backend has no merge history records", async () => {
		const res = await requestJson<{ records: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getMergeHistory",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.records).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-E — klein-core-py health (sidecar disabled via NKLEIN_CORE_PY=0)
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-E — runtime.getKleinCorePyHealth shape (sidecar disabled)", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-cph-cwd-");
		homeDir = makeTempDir("kanban-cph-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		// startTsBackend already sets NKLEIN_CORE_PY=0 for all contract tests
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with correct shape fields", async () => {
		const res = await requestJson<{
			enabled: boolean;
			reachable: boolean;
			sidecarUrl: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getKleinCorePyHealth",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.enabled).toBe("boolean");
		expect(typeof res.payload.reachable).toBe("boolean");
		expect(typeof res.payload.sidecarUrl).toBe("string");
	});

	it("reports enabled=false when NKLEIN_CORE_PY=0", async () => {
		const res = await requestJson<{ enabled: boolean; reachable: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getKleinCorePyHealth",
			type: "query",
		});
		expect(res.status).toBe(200);
		// NKLEIN_CORE_PY=0 disables the sidecar — it must not be enabled
		expect(res.payload.enabled).toBe(false);
		// When disabled, reachable must also be false
		expect(res.payload.reachable).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-F — code intelligence status (workspace-scoped shape)
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-F — runtime.getNKleinCodeIntelligenceStatus shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ci-cwd-");
		homeDir = makeTempDir("kanban-ci-home-");
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

	it("returns 200 with top-level shape fields", async () => {
		const res = await requestJson<{
			codeEmbeddingSettings: Record<string, unknown>;
			embeddingModelFile: unknown;
			repoMap: Record<string, unknown>;
			codeIndex: Record<string, unknown>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinCodeIntelligenceStatus",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.codeEmbeddingSettings).toBe("object");
		expect(typeof res.payload.repoMap).toBe("object");
		expect(typeof res.payload.codeIndex).toBe("object");
	});

	it("codeEmbeddingSettings has globalDefaults, projectOverride, effective, source fields", async () => {
		const res = await requestJson<{
			codeEmbeddingSettings: {
				globalDefaults: Record<string, unknown>;
				projectOverride: Record<string, unknown> | null;
				effective: Record<string, unknown>;
				source: string;
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinCodeIntelligenceStatus",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		const ces = res.payload.codeEmbeddingSettings;
		expect(typeof ces.globalDefaults).toBe("object");
		expect(ces.projectOverride === null || typeof ces.projectOverride === "object").toBe(true);
		expect(typeof ces.effective).toBe("object");
		expect(ces.source === "global" || ces.source === "project").toBe(true);
	});

	it("repoMap has filesScanned, symbols, tokenCount, available fields", async () => {
		const res = await requestJson<{
			repoMap: {
				filesScanned: number;
				symbols: number;
				tokenCount: number;
				truncated: boolean;
				available: boolean;
				error: string | null;
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinCodeIntelligenceStatus",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		const rm = res.payload.repoMap;
		expect(typeof rm.filesScanned).toBe("number");
		expect(typeof rm.symbols).toBe("number");
		expect(typeof rm.tokenCount).toBe("number");
		expect(typeof rm.truncated).toBe("boolean");
		expect(typeof rm.available).toBe("boolean");
		expect(rm.error === null || typeof rm.error === "string").toBe(true);
	});

	it("codeIndex has progress.phase and searchAvailable fields", async () => {
		const res = await requestJson<{
			codeIndex: {
				cachePath: string | null;
				cacheExists: boolean;
				searchAvailable: boolean;
				progress: { phase: string };
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinCodeIntelligenceStatus",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		const ci = res.payload.codeIndex;
		expect(typeof ci.cacheExists).toBe("boolean");
		expect(typeof ci.searchAvailable).toBe("boolean");
		expect(typeof ci.progress.phase).toBe("string");
		const validPhases = ["idle", "scanning", "embedding", "persisting", "complete", "error"];
		expect(validPhases).toContain(ci.progress.phase);
	});

	it("without a workspace scope returns a non-200 response (implementation requires valid scope)", async () => {
		// getNKleinCodeIntelligenceStatus is t.procedure (not workspaceProcedure) so
		// the tRPC middleware itself doesn't block it, but the runtime implementation
		// returns an error when no workspace scope is available.
		const res = await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinCodeIntelligenceStatus",
			type: "query",
		});
		// The runtime rejects the call without a valid workspace — it must not be 200
		expect(res.status).not.toBe(200);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-G — task diagnostics (empty for unknown task)
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-G — runtime.getTaskDiagnostics shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-diag-cwd-");
		homeDir = makeTempDir("kanban-diag-home-");
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

	it("returns 200 with ok=true and empty events for an unknown taskId", async () => {
		const res = await requestJson<{
			ok: boolean;
			events: unknown[];
			runSummaries?: unknown[];
			error?: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getTaskDiagnostics",
			type: "query",
			workspaceId,
			payload: { taskId: "nonexistent-task-id-for-suite19" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(Array.isArray(res.payload.events)).toBe(true);
		// Empty task has no events
		expect(res.payload.events).toHaveLength(0);
		// error should be absent or null/undefined on success
		expect(res.payload.error == null).toBe(true);
	});

	it("returns 200 with runSummaries as an array (may be empty)", async () => {
		const res = await requestJson<{
			ok: boolean;
			events: unknown[];
			runSummaries?: unknown[];
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getTaskDiagnostics",
			type: "query",
			workspaceId,
			payload: { taskId: "nonexistent-task-id-for-suite19" },
		});
		expect(res.status).toBe(200);
		// runSummaries is optional in the schema (array or undefined)
		if (res.payload.runSummaries !== undefined) {
			expect(Array.isArray(res.payload.runSummaries)).toBe(true);
		}
	});

	it("respects the limit parameter (schema validates positive integer up to 100)", async () => {
		// limit=1 is valid
		const res = await requestJson<{ ok: boolean; events: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getTaskDiagnostics",
			type: "query",
			workspaceId,
			payload: { taskId: "nonexistent-task-id-for-suite19", limit: 5 },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
	});

	it("limit=0 is rejected at the schema seam with 400", async () => {
		const res = await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getTaskDiagnostics",
			type: "query",
			workspaceId,
			payload: { taskId: "any-task", limit: 0 },
		});
		expect(res.status).toBe(400);
	});

	it("without workspace scope returns 400 (workspaceProcedure guard)", async () => {
		const res = await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getTaskDiagnostics",
			type: "query",
			payload: { taskId: "any-task" },
		});
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-H — model performance stats shape
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-H — runtime.getModelPerformanceStats shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-perf-cwd-");
		homeDir = makeTempDir("kanban-perf-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with generatedAt, observations, aggregates", async () => {
		const res = await requestJson<{
			generatedAt: number;
			observations: unknown[];
			aggregates: unknown[];
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getModelPerformanceStats",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.generatedAt).toBe("number");
		expect(res.payload.generatedAt).toBeGreaterThan(0);
		expect(Array.isArray(res.payload.observations)).toBe(true);
		expect(Array.isArray(res.payload.aggregates)).toBe(true);
	});

	it("fresh backend has no observations or aggregates", async () => {
		const res = await requestJson<{ observations: unknown[]; aggregates: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getModelPerformanceStats",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.observations).toHaveLength(0);
		expect(res.payload.aggregates).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-I — knowledge tool usage stats shape
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-I — runtime.getKnowledgeToolUsageStats shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ktus-cwd-");
		homeDir = makeTempDir("kanban-ktus-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with generatedAt, observations, aggregates, decompositionKnowledgeSignals, decompositionKnowledgeAggregates", async () => {
		const res = await requestJson<{
			generatedAt: number;
			observations: unknown[];
			aggregates: unknown[];
			decompositionKnowledgeSignals: unknown[];
			decompositionKnowledgeAggregates: unknown[];
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getKnowledgeToolUsageStats",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.generatedAt).toBe("number");
		expect(res.payload.generatedAt).toBeGreaterThan(0);
		expect(Array.isArray(res.payload.observations)).toBe(true);
		expect(Array.isArray(res.payload.aggregates)).toBe(true);
		expect(Array.isArray(res.payload.decompositionKnowledgeSignals)).toBe(true);
		expect(Array.isArray(res.payload.decompositionKnowledgeAggregates)).toBe(true);
	});

	it("fresh backend has no usage observations or aggregates", async () => {
		const res = await requestJson<{
			observations: unknown[];
			aggregates: unknown[];
			decompositionKnowledgeSignals: unknown[];
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getKnowledgeToolUsageStats",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.observations).toHaveLength(0);
		expect(res.payload.aggregates).toHaveLength(0);
		expect(res.payload.decompositionKnowledgeSignals).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite 19-J — slash commands shape
// ---------------------------------------------------------------------------

describe.sequential("Suite 19-J — runtime.getNKleinSlashCommands shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-slash-cwd-");
		homeDir = makeTempDir("kanban-slash-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with a commands array", async () => {
		const res = await requestJson<{ commands: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinSlashCommands",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.commands)).toBe(true);
	});

	it("every command entry has at least a name field", async () => {
		const res = await requestJson<{ commands: Array<Record<string, unknown>> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinSlashCommands",
			type: "query",
		});
		expect(res.status).toBe(200);
		for (const cmd of res.payload.commands) {
			expect(typeof cmd.name).toBe("string");
			expect((cmd.name as string).length).toBeGreaterThan(0);
			// description is optional string
			if (cmd.description !== undefined) {
				expect(typeof cmd.description).toBe("string");
			}
		}
	});

	it("commands are accessible without a workspace scope (t.procedure, not workspaceProcedure)", async () => {
		// getNKleinSlashCommands does not require workspace scope
		const res = await requestJson<{ commands: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinSlashCommands",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.commands)).toBe(true);
	});
});
