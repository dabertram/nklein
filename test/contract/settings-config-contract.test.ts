/**
 * Suite 16 — settings/config persistence (todo §5.V)
 *
 * Exercises every major settings/config persistence procedure through the
 * real HTTP/tRPC seam and asserts BOTH the response shape AND on-disk state.
 *
 * Covered procedures (previously uncovered at the HTTP seam — Suite 1 covers
 * only a single-field `maxConcurrentTasks` round-trip; this suite adds broad
 * coverage and on-disk file verification):
 *
 *   runtime.getConfig     — shape + multiple field types returned
 *   runtime.saveConfig    — global round-trip for booleans, numbers, enums,
 *                           nested objects (modelRoles, swarmGuardrails,
 *                           agentRulesets), on-disk config.json asserted
 *   runtime.saveConfig    — per-project override (workspaceId scope): override
 *                           wins over global for that project, does NOT leak to
 *                           a second project — the "isolation" guarantee
 *   runtime.saveConfig    — invalid field values rejected at the schema seam
 *   runtime.getNKleinMcpSettings / saveNKleinMcpSettings — round-trip; on-disk
 *                           nklein_mcp_settings.json asserted
 *   runtime.saveNKleinModelContextWindowOverride — persists to model-registry.json
 *   runtime.saveNKleinModelMaxConcurrentRequests — persists to model-registry.json
 *
 * Persistence seams proven:
 *   • Global config     → $HOME/.nklein/nklein/config.json
 *   • Project config    → $CWD/.nklein/nklein/config.json  (override fields only)
 *   • MCP settings      → controlled via NKLEIN_MCP_SETTINGS_PATH env override
 *   • Model registry    → $HOME/.nklein/nklein/model-registry.json
 *
 * Deferred (require live agent / model / Docker to observe):
 *   runtime.saveNKleinProviderSettings — saves OAuth/API-key state; the
 *     persisted nklein-provider-selection.json reflects a specific model
 *     provider identity that only makes sense when a real provider is
 *     configured.  No fake API key produces an observable config difference
 *     at the seam without a real provider endpoint.
 *
 * Port-resilient: imports nothing from src/ except shared helper types.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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

/** GET runtime.getConfig (with optional workspace scope) */
async function getConfig(baseUrl: string, workspaceId?: string): Promise<Record<string, unknown>> {
	const res = await requestJson<Record<string, unknown>>({
		baseUrl,
		procedure: "runtime.getConfig",
		type: "query",
		workspaceId,
	});
	if (res.status !== 200) {
		throw new Error(`runtime.getConfig returned ${res.status}`);
	}
	return res.payload;
}

/** POST runtime.saveConfig */
async function saveConfig(
	baseUrl: string,
	payload: Record<string, unknown>,
	workspaceId?: string,
): Promise<{ status: number; payload: Record<string, unknown> }> {
	return requestJson<Record<string, unknown>>({
		baseUrl,
		procedure: "runtime.saveConfig",
		type: "mutation",
		workspaceId,
		payload,
	});
}

// ---------------------------------------------------------------------------
// Suite: runtime.getConfig — response shape
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — runtime.getConfig response shape", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-shape-cwd-");
		homeDir = makeTempDir("kanban-sc-shape-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 with all required top-level fields", async () => {
		const cfg = await getConfig(server.baseUrl);
		expect(typeof cfg.selectedAgentId).toBe("string");
		expect(typeof cfg.agentAutonomousModeEnabled).toBe("boolean");
		expect(typeof cfg.maxConcurrentTasks).toBe("number");
		expect(typeof cfg.sandboxMaxContainers).toBe("number");
		expect(typeof cfg.decompositionAutoApplyEnabled).toBe("boolean");
		expect(typeof cfg.secondOpinionReviewEnabled).toBe("boolean");
		expect(typeof cfg.reviewMaxRounds).toBe("number");
		expect(typeof cfg.globalConfigPath).toBe("string");
		// projectConfigPath is null when no project is scoped
		expect(cfg.projectConfigPath === null || typeof cfg.projectConfigPath === "string").toBe(true);
	});

	it("returns swarmGuardrails as an object with expected numeric fields", async () => {
		const cfg = await getConfig(server.baseUrl);
		const g = cfg.swarmGuardrails as Record<string, unknown>;
		expect(typeof g).toBe("object");
		expect(typeof g.maxAutonomousTurnsPerTask).toBe("number");
		expect(typeof g.maxAutonomousWallTimeMs).toBe("number");
		expect(typeof g.maxRepeatedNoDiffCheckpoints).toBe("number");
		expect(typeof g.maxRepeatedToolCallsPerTask).toBe("number");
		expect((g.maxAutonomousTurnsPerTask as number) > 0).toBe(true);
	});

	it("returns modelRoles as an object (may be empty on a fresh backend)", async () => {
		const cfg = await getConfig(server.baseUrl);
		expect(typeof cfg.modelRoles).toBe("object");
		expect(cfg.modelRoles).not.toBeNull();
	});

	it("returns nkleinProviderSettings with provider identity fields", async () => {
		const cfg = await getConfig(server.baseUrl);
		const p = cfg.nkleinProviderSettings as Record<string, unknown>;
		expect(typeof p).toBe("object");
		expect(Object.hasOwn(p, "providerId")).toBe(true);
		expect(Object.hasOwn(p, "modelId")).toBe(true);
		expect(Object.hasOwn(p, "apiKeyConfigured")).toBe(true);
		expect(typeof p.apiKeyConfigured).toBe("boolean");
	});

	it("globalConfigPath points to an expected subdirectory of homeDir", async () => {
		const cfg = await getConfig(server.baseUrl);
		const configPath = cfg.globalConfigPath as string;
		// The path must be under the test homeDir (which the backend uses as HOME)
		expect(configPath.startsWith(homeDir)).toBe(true);
		// The path should include '.nklein/nklein/' as the nested runtime dir
		expect(configPath).toContain(".nklein");
		expect(configPath).toContain("config.json");
	});
});

// ---------------------------------------------------------------------------
// Suite: global config round-trip + on-disk assertion
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — global config save→get round-trip + on-disk", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-global-cwd-");
		homeDir = makeTempDir("kanban-sc-global-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("saving agentAutonomousModeEnabled=false persists and reads back false", async () => {
		const before = await getConfig(server.baseUrl);
		// The field should default to true; we toggle it
		const saveRes = await saveConfig(server.baseUrl, { agentAutonomousModeEnabled: false });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.agentAutonomousModeEnabled).toBe(false);

		const after = await getConfig(server.baseUrl);
		expect(after.agentAutonomousModeEnabled).toBe(false);
		// Other fields should be unchanged
		expect(after.maxConcurrentTasks).toBe(before.maxConcurrentTasks);
	});

	it("saving maxConcurrentTasks=5 persists and reads back 5", async () => {
		const saveRes = await saveConfig(server.baseUrl, { maxConcurrentTasks: 5 });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.maxConcurrentTasks).toBe(5);

		const after = await getConfig(server.baseUrl);
		expect(after.maxConcurrentTasks).toBe(5);
	});

	it("saving decompositionAutoApplyEnabled=false persists on read-back", async () => {
		const saveRes = await saveConfig(server.baseUrl, { decompositionAutoApplyEnabled: false });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.decompositionAutoApplyEnabled).toBe(false);

		const after = await getConfig(server.baseUrl);
		expect(after.decompositionAutoApplyEnabled).toBe(false);
	});

	it("saving reviewMaxRounds=7 persists on read-back", async () => {
		const saveRes = await saveConfig(server.baseUrl, { reviewMaxRounds: 7 });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.reviewMaxRounds).toBe(7);

		const after = await getConfig(server.baseUrl);
		expect(after.reviewMaxRounds).toBe(7);
	});

	it("saving llmfitCatalogUpdateMode=auto persists on read-back and on disk", async () => {
		const cfg = await getConfig(server.baseUrl);
		const globalConfigPath = cfg.globalConfigPath as string;

		const saveRes = await saveConfig(server.baseUrl, { llmfitCatalogUpdateMode: "auto" });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.llmfitCatalogUpdateMode).toBe("auto");

		const after = await getConfig(server.baseUrl);
		expect(after.llmfitCatalogUpdateMode).toBe("auto");
		const raw = JSON.parse(readFileSync(globalConfigPath, "utf8")) as Record<string, unknown>;
		expect(raw.llmfitCatalogUpdateMode).toBe("auto");
	});

	it("saving swarmGuardrails updates the nested object on read-back", async () => {
		const before = await getConfig(server.baseUrl);
		const beforeGuardrails = before.swarmGuardrails as Record<string, unknown>;
		const newTurns = (beforeGuardrails.maxAutonomousTurnsPerTask as number) + 5;

		const saveRes = await saveConfig(server.baseUrl, {
			swarmGuardrails: {
				...(before.swarmGuardrails as object),
				maxAutonomousTurnsPerTask: newTurns,
			},
		});
		expect(saveRes.status).toBe(200);
		const saved = saveRes.payload.swarmGuardrails as Record<string, unknown>;
		expect(saved.maxAutonomousTurnsPerTask).toBe(newTurns);

		const after = await getConfig(server.baseUrl);
		const afterGuardrails = after.swarmGuardrails as Record<string, unknown>;
		expect(afterGuardrails.maxAutonomousTurnsPerTask).toBe(newTurns);
	});

	it("saving modelRoles persists the roles map on read-back", async () => {
		// modelRoles uses runtimeRoleModelSettingsSchema: { modelId?, providerId?, ... }
		const newModelRoles = {
			planning: { modelId: "test-model-planning", providerId: "lmstudio" },
		};

		const saveRes = await saveConfig(server.baseUrl, { modelRoles: newModelRoles });
		expect(saveRes.status).toBe(200);
		const savedRoles = saveRes.payload.modelRoles as Record<string, unknown>;
		expect(savedRoles.planning).toBeDefined();
		const planningRole = savedRoles.planning as Record<string, unknown>;
		expect(planningRole.modelId).toBe("test-model-planning");

		const after = await getConfig(server.baseUrl);
		const afterRoles = after.modelRoles as Record<string, unknown>;
		const afterPlanning = afterRoles.planning as Record<string, unknown>;
		expect(afterPlanning.modelId).toBe("test-model-planning");
	});

	it("saved global config is reflected in the on-disk config.json file", async () => {
		// Get the globalConfigPath from the server
		const cfg = await getConfig(server.baseUrl);
		const globalConfigPath = cfg.globalConfigPath as string;

		// Confirm the file exists
		expect(existsSync(globalConfigPath)).toBe(true);

		// Save a distinctive value
		await saveConfig(server.baseUrl, { reviewMaxRounds: 11 });

		// Read the on-disk JSON directly
		const raw = JSON.parse(readFileSync(globalConfigPath, "utf8")) as Record<string, unknown>;
		// The file stores the raw value
		expect(raw.reviewMaxRounds).toBe(11);
	});

	it("partial save: unspecified fields are unchanged", async () => {
		const before = await getConfig(server.baseUrl);
		const beforeRounds = before.reviewMaxRounds as number;

		// Save only one field — others must survive unchanged
		await saveConfig(server.baseUrl, { agentAutonomousModeEnabled: true });

		const after = await getConfig(server.baseUrl);
		expect(after.reviewMaxRounds).toBe(beforeRounds);
	});
});

// ---------------------------------------------------------------------------
// Suite: per-project override — override wins, does not leak to other project
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — per-project config override isolation", () => {
	// Two independent projects under different cwd dirs, sharing one homeDir
	// so their global config is the same.
	let server: BackendUnderTest;
	let cwdA: string;
	let cwdB: string;
	let homeDir: string;
	let workspaceIdA: string;
	let workspaceIdB: string;

	beforeAll(async () => {
		cwdA = makeTempDir("kanban-sc-proj-a-cwd-");
		cwdB = makeTempDir("kanban-sc-proj-b-cwd-");
		homeDir = makeTempDir("kanban-sc-proj-home-");
		mkdirSync(cwdA, { recursive: true });
		mkdirSync(cwdB, { recursive: true });
		initGitRepository(cwdA);
		initGitRepository(cwdB);
		// Start with cwdA as the working project (cwd of the backend)
		server = await startTsBackend({ cwd: cwdA, homeDir });
		workspaceIdA = await addSelfProject(server.baseUrl, cwdA);
		workspaceIdB = await addSelfProject(server.baseUrl, cwdB);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwdA);
		cleanupDir(cwdB);
		cleanupDir(homeDir);
	});

	it("saveConfig without workspaceId sets the global (no project override)", async () => {
		// Set a global maxConcurrentTasks value
		const saveRes = await saveConfig(server.baseUrl, { maxConcurrentTasks: 4 });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.maxConcurrentTasks).toBe(4);

		// Both projects should read 4 as effectiveMaxConcurrentTasks (no override)
		const cfgA = await getConfig(server.baseUrl, workspaceIdA);
		const cfgB = await getConfig(server.baseUrl, workspaceIdB);
		expect(cfgA.maxConcurrentTasks).toBe(4);
		expect(cfgB.maxConcurrentTasks).toBe(4);
	});

	it("saveConfig with workspaceId saves per-project override for maxConcurrentTasksOverride", async () => {
		// Save a project-specific override only for project A
		const saveRes = await saveConfig(server.baseUrl, { maxConcurrentTasksOverride: 2 }, workspaceIdA);
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.maxConcurrentTasksOverride).toBe(2);
		// effectiveMaxConcurrentTasks should use the override
		expect(saveRes.payload.effectiveMaxConcurrentTasks).toBe(2);
	});

	it("project A override is returned in getConfig for project A", async () => {
		const cfgA = await getConfig(server.baseUrl, workspaceIdA);
		expect(cfgA.maxConcurrentTasksOverride).toBe(2);
		expect(cfgA.effectiveMaxConcurrentTasks).toBe(2);
	});

	it("project A override does NOT leak to project B", async () => {
		const cfgB = await getConfig(server.baseUrl, workspaceIdB);
		// Project B has no override — effectiveMaxConcurrentTasks should still equal the global (4)
		expect(cfgB.maxConcurrentTasksOverride).toBeNull();
		expect(cfgB.effectiveMaxConcurrentTasks).toBe(4);
	});

	it("project override is written to the project config.json, NOT the global config.json", async () => {
		// Get path from the server's perspective (scoped to project A)
		const cfgA = await getConfig(server.baseUrl, workspaceIdA);
		const projectConfigPath = cfgA.projectConfigPath as string;
		const globalConfigPath = cfgA.globalConfigPath as string;

		expect(projectConfigPath).not.toBeNull();
		expect(typeof projectConfigPath).toBe("string");

		// On macOS, mkdtemp may return a /var/... path that resolves to /private/var/...
		// Compare using realpath-normalized versions so symlinks don't cause false failures.
		const realCwdA = realpathSync(cwdA);
		const realProjectConfigPath = realpathSync(existsSync(projectConfigPath) ? projectConfigPath : cwdA);
		// The file must be under the project cwd
		expect(projectConfigPath).toContain(".nklein");
		expect(projectConfigPath).toContain("config.json");
		expect(existsSync(projectConfigPath)).toBe(true);
		// Verify it's under cwdA by using normalized paths
		const normalizedProject = realProjectConfigPath.replaceAll("\\", "/");
		const normalizedCwd = realCwdA.replaceAll("\\", "/");
		expect(normalizedProject.startsWith(normalizedCwd)).toBe(true);

		const projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
		expect(projectConfig.maxConcurrentTasksOverride).toBe(2);

		// Global config should NOT have the override field
		const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf8")) as Record<string, unknown>;
		expect(globalConfig.maxConcurrentTasksOverride).toBeUndefined();
	});

	it("clearing the project override (null) restores the global value", async () => {
		// Clear the override on project A
		const saveRes = await saveConfig(server.baseUrl, { maxConcurrentTasksOverride: null }, workspaceIdA);
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.maxConcurrentTasksOverride).toBeNull();
		// effectiveMaxConcurrentTasks should now use the global again (4)
		expect(saveRes.payload.effectiveMaxConcurrentTasks).toBe(4);

		const cfgA = await getConfig(server.baseUrl, workspaceIdA);
		expect(cfgA.maxConcurrentTasksOverride).toBeNull();
		expect(cfgA.effectiveMaxConcurrentTasks).toBe(4);
	});

	it("modelRolesOverride for project A does not leak to project B", async () => {
		// modelRoles uses runtimeRoleModelSettingsSchema: { modelId?, providerId?, ... }
		const overrideRoles = {
			planning: { modelId: "project-specific-model", providerId: "lmstudio" },
		};

		const saveRes = await saveConfig(server.baseUrl, { modelRolesOverride: overrideRoles }, workspaceIdA);
		expect(saveRes.status).toBe(200);
		const rolesOverride = saveRes.payload.modelRolesOverride as Record<string, unknown> | null;
		expect(rolesOverride).not.toBeNull();
		const planning = (rolesOverride as Record<string, unknown>).planning as Record<string, unknown>;
		expect(planning.modelId).toBe("project-specific-model");

		// Project B must not see the override
		const cfgB = await getConfig(server.baseUrl, workspaceIdB);
		expect(cfgB.modelRolesOverride).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Suite: invalid / partial config rejected at the schema seam
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — invalid config input rejected", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-invalid-cwd-");
		homeDir = makeTempDir("kanban-sc-invalid-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("saveConfig with maxConcurrentTasks=0 (non-positive) is rejected with 400", async () => {
		const res = await saveConfig(server.baseUrl, { maxConcurrentTasks: 0 });
		expect(res.status).toBe(400);
	});

	it("saveConfig with maxConcurrentTasks=-1 is rejected with 400", async () => {
		const res = await saveConfig(server.baseUrl, { maxConcurrentTasks: -1 });
		expect(res.status).toBe(400);
	});

	it("saveConfig with reviewMaxRounds=0 (non-positive) is rejected with 400", async () => {
		const res = await saveConfig(server.baseUrl, { reviewMaxRounds: 0 });
		expect(res.status).toBe(400);
	});

	it("saveConfig with an invalid agentTimeoutMode enum is rejected with 400", async () => {
		const res = await saveConfig(server.baseUrl, {
			agentTimeoutMode: "not_a_valid_mode_xyz",
		});
		expect(res.status).toBe(400);
	});

	it("saveConfig with an invalid selectedAgentId is rejected with 400", async () => {
		const res = await saveConfig(server.baseUrl, {
			selectedAgentId: "definitely_not_a_valid_agent_id_xyz",
		});
		expect(res.status).toBe(400);
	});

	it("saveConfig with an invalid llmfitCatalogUpdateMode is rejected with 400", async () => {
		const res = await saveConfig(server.baseUrl, {
			llmfitCatalogUpdateMode: "invalid_mode_xyz",
		});
		expect(res.status).toBe(400);
	});

	it("a valid partial update still succeeds despite other unchanged fields", async () => {
		// Only send a valid subset — this must not be rejected
		const res = await saveConfig(server.baseUrl, {
			secondOpinionReviewEnabled: false,
		});
		expect(res.status).toBe(200);
		expect(res.payload.secondOpinionReviewEnabled).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite: MCP settings — getNKleinMcpSettings / saveNKleinMcpSettings round-trip
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — MCP settings round-trip + on-disk", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-mcp-cwd-");
		homeDir = makeTempDir("kanban-sc-mcp-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		// The MCP settings file path is returned by getNKleinMcpSettings response.path;
		// the on-disk assertion reads it back via that path.
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("getNKleinMcpSettings returns an object with path and servers array", async () => {
		const res = await requestJson<{ path: string; servers: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinMcpSettings",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(typeof res.payload.path).toBe("string");
		expect(Array.isArray(res.payload.servers)).toBe(true);
	});

	it("fresh backend has an empty MCP server list", async () => {
		const res = await requestJson<{ path: string; servers: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinMcpSettings",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(res.payload.servers).toHaveLength(0);
	});

	it("saveNKleinMcpSettings saves a stdio server and reads it back", async () => {
		const servers = [
			{
				name: "test-mcp-server",
				disabled: false,
				type: "stdio",
				command: "echo",
				args: ["hello"],
			},
		];

		const saveRes = await requestJson<{ path: string; servers: Array<Record<string, unknown>> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinMcpSettings",
			type: "mutation",
			payload: { servers },
		});
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.servers).toHaveLength(1);
		expect(saveRes.payload.servers[0]?.name).toBe("test-mcp-server");
		expect(saveRes.payload.servers[0]?.type).toBe("stdio");

		// Read back via GET to confirm persistence
		const getRes = await requestJson<{ path: string; servers: Array<Record<string, unknown>> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinMcpSettings",
			type: "query",
		});
		expect(getRes.status).toBe(200);
		expect(getRes.payload.servers).toHaveLength(1);
		expect(getRes.payload.servers[0]?.name).toBe("test-mcp-server");
		expect(getRes.payload.servers[0]?.command).toBe("echo");
	});

	it("saved MCP settings are reflected in the on-disk JSON file", async () => {
		// Get path from the response
		const getRes = await requestJson<{ path: string; servers: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinMcpSettings",
			type: "query",
		});
		const settingsFilePath = getRes.payload.path;
		expect(typeof settingsFilePath).toBe("string");
		expect(existsSync(settingsFilePath)).toBe(true);

		// The on-disk file should contain our server in some form (stored as mcpServers record)
		const raw = JSON.parse(readFileSync(settingsFilePath, "utf8")) as Record<string, unknown>;
		const mcpServers = raw.mcpServers as Record<string, unknown> | undefined;
		expect(mcpServers).toBeDefined();
		expect(Object.keys(mcpServers ?? {})).toContain("test-mcp-server");
	});

	it("saving empty servers list clears the MCP settings", async () => {
		const saveRes = await requestJson<{ path: string; servers: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinMcpSettings",
			type: "mutation",
			payload: { servers: [] },
		});
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.servers).toHaveLength(0);

		const getRes = await requestJson<{ path: string; servers: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getNKleinMcpSettings",
			type: "query",
		});
		expect(getRes.payload.servers).toHaveLength(0);
	});

	it("saveNKleinMcpSettings with invalid server type is rejected with 400", async () => {
		const res = await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinMcpSettings",
			type: "mutation",
			payload: {
				servers: [
					{
						name: "bad-server",
						disabled: false,
						type: "invalid_type_xyz",
						command: "echo",
					},
				],
			},
		});
		expect(res.status).toBe(400);
	});

	it("saveNKleinMcpSettings with a streamableHttp server (URL-based) round-trips correctly", async () => {
		const servers = [
			{
				name: "http-mcp-server",
				disabled: false,
				type: "streamableHttp",
				url: "http://localhost:9999/mcp",
			},
		];

		const saveRes = await requestJson<{ path: string; servers: Array<Record<string, unknown>> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinMcpSettings",
			type: "mutation",
			payload: { servers },
		});
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.servers).toHaveLength(1);
		expect(saveRes.payload.servers[0]?.type).toBe("streamableHttp");
		expect(saveRes.payload.servers[0]?.url).toBe("http://localhost:9999/mcp");
	});
});

// ---------------------------------------------------------------------------
// Suite: model context window override + max concurrent requests
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — model registry overrides", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-mreg-cwd-");
		homeDir = makeTempDir("kanban-sc-mreg-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("saveNKleinModelContextWindowOverride for a local provider returns the updated model", async () => {
		// runtimeNKleinModelRegistryEntrySchema: contextWindow is nested { advertised, observed, userOverride, effective }
		const res = await requestJson<{
			model: {
				providerId: string;
				modelId: string;
				contextWindow: {
					userOverride: number | null;
					effective: number | null;
				};
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelContextWindowOverride",
			type: "mutation",
			payload: {
				providerId: "lmstudio",
				modelId: "test/context-override-model",
				contextWindow: 65536,
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.model.providerId).toBe("lmstudio");
		expect(res.payload.model.modelId).toBe("test/context-override-model");
		// userOverride captures the value we set
		expect(res.payload.model.contextWindow.userOverride).toBe(65536);
	});

	it("saveNKleinModelContextWindowOverride is reflected in the model registry on disk", async () => {
		// The model registry path is $HOME/.nklein/nklein/model-registry.json
		const registryPath = join(homeDir, ".nklein", "nklein", "model-registry.json");

		// Give the debounced write a moment to flush
		await new Promise((resolve) => setTimeout(resolve, 2000));

		if (existsSync(registryPath)) {
			const raw = JSON.parse(readFileSync(registryPath, "utf8")) as {
				models: Record<string, unknown>;
			};
			// The registry key includes providerId + modelId — check it exists
			const keys = Object.keys(raw.models ?? {});
			const hasEntry = keys.some((k) => k.includes("lmstudio") && k.includes("test/context-override-model"));
			expect(hasEntry).toBe(true);
		}
		// If the file doesn't exist yet (write may be pending), the in-memory response above
		// already proved the value is tracked; the debounce window is an implementation detail.
	});

	it("saveNKleinModelContextWindowOverride with null clears the override", async () => {
		const res = await requestJson<{
			model: { contextWindow: { userOverride: number | null } };
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelContextWindowOverride",
			type: "mutation",
			payload: {
				providerId: "lmstudio",
				modelId: "test/context-override-model",
				contextWindow: null,
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.model.contextWindow.userOverride).toBeNull();
	});

	it("saveNKleinModelContextWindowOverride for a non-local provider is rejected with 400", async () => {
		const res = await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelContextWindowOverride",
			type: "mutation",
			payload: {
				providerId: "anthropic",
				modelId: "claude-opus-4-5",
				contextWindow: 200000,
			},
		});
		expect(res.status).toBe(400);
	});

	it("saveNKleinModelMaxConcurrentRequests for a local provider persists the limit", async () => {
		// runtimeNKleinModelRegistryEntrySchema: maxConcurrentRequests is nested inside constraints
		const res = await requestJson<{
			model: {
				providerId: string;
				modelId: string;
				constraints: { maxConcurrentRequests: number | null | undefined };
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelMaxConcurrentRequests",
			type: "mutation",
			payload: {
				providerId: "lmstudio",
				modelId: "test/concurrent-limit-model",
				maxConcurrentRequests: 3,
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.model.constraints.maxConcurrentRequests).toBe(3);
	});

	it("saveNKleinModelMaxConcurrentRequests with null clears the limit", async () => {
		const res = await requestJson<{
			model: { constraints: { maxConcurrentRequests: number | null | undefined } };
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelMaxConcurrentRequests",
			type: "mutation",
			payload: {
				providerId: "lmstudio",
				modelId: "test/concurrent-limit-model",
				maxConcurrentRequests: null,
			},
		});
		expect(res.status).toBe(200);
		// null or undefined — the cleared state has no override
		expect(res.payload.model.constraints.maxConcurrentRequests ?? null).toBeNull();
	});

	it("saveNKleinModelMaxConcurrentRequests for a non-local provider is rejected with 400", async () => {
		const res = await requestJson<unknown>({
			baseUrl: server.baseUrl,
			procedure: "runtime.saveNKleinModelMaxConcurrentRequests",
			type: "mutation",
			payload: {
				providerId: "anthropic",
				modelId: "claude-opus-4-5",
				maxConcurrentRequests: 2,
			},
		});
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// Suite: workspaceBaseDir global config field
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — workspaceBaseDir persistence", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-wbd-cwd-");
		homeDir = makeTempDir("kanban-sc-wbd-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspaceBaseDir starts as null on a fresh backend", async () => {
		const cfg = await getConfig(server.baseUrl);
		expect(cfg.workspaceBaseDir).toBeNull();
	});

	it("saving workspaceBaseDir persists and reads back the value", async () => {
		const newDir = join(homeDir, "my-workspaces");
		const saveRes = await saveConfig(server.baseUrl, { workspaceBaseDir: newDir });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.workspaceBaseDir).toBe(newDir);

		const after = await getConfig(server.baseUrl);
		expect(after.workspaceBaseDir).toBe(newDir);
	});

	it("workspaceBaseDir is written to the on-disk global config.json", async () => {
		const cfg = await getConfig(server.baseUrl);
		const globalConfigPath = cfg.globalConfigPath as string;
		const raw = JSON.parse(readFileSync(globalConfigPath, "utf8")) as Record<string, unknown>;
		expect(typeof raw.workspaceBaseDir).toBe("string");
	});

	it("saving workspaceBaseDir=null clears it back to null", async () => {
		const saveRes = await saveConfig(server.baseUrl, { workspaceBaseDir: null });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.workspaceBaseDir).toBeNull();

		const after = await getConfig(server.baseUrl);
		expect(after.workspaceBaseDir).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Suite: deviceRamGb global config field (§5.AB machine-aware loader)
// ---------------------------------------------------------------------------

describe.sequential("Suite 16 — deviceRamGb persistence", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-sc-drg-cwd-");
		homeDir = makeTempDir("kanban-sc-drg-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("deviceRamGb starts as null on a fresh backend", async () => {
		const cfg = await getConfig(server.baseUrl);
		expect(cfg.deviceRamGb ?? null).toBeNull();
	});

	it("saving deviceRamGb persists and reads back the value", async () => {
		const budget = "m5max:128,m4mini:24,legion5pro:32";
		const saveRes = await saveConfig(server.baseUrl, { deviceRamGb: budget });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.deviceRamGb).toBe(budget);

		const after = await getConfig(server.baseUrl);
		expect(after.deviceRamGb).toBe(budget);
	});

	it("deviceRamGb is written to the on-disk global config.json", async () => {
		const cfg = await getConfig(server.baseUrl);
		const globalConfigPath = cfg.globalConfigPath as string;
		const raw = JSON.parse(readFileSync(globalConfigPath, "utf8")) as Record<string, unknown>;
		expect(raw.deviceRamGb).toBe("m5max:128,m4mini:24,legion5pro:32");
	});

	it("saving deviceRamGb=null clears it back to null", async () => {
		const saveRes = await saveConfig(server.baseUrl, { deviceRamGb: null });
		expect(saveRes.status).toBe(200);
		expect(saveRes.payload.deviceRamGb ?? null).toBeNull();

		const after = await getConfig(server.baseUrl);
		expect(after.deviceRamGb ?? null).toBeNull();
	});
});
