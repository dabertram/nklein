/**
 * Suite 2 — plan-artifact pipeline contract
 *
 * Drives the plan-artifact review pipeline over REAL HTTP against a spawned server and asserts:
 *   - HTTP status codes
 *   - JSON response shape (raw field checks, no Zod imports)
 *   - On-disk board state verified by reading back via the API
 *
 * Model-free: applying a pre-written artifact is a board mutation; no LLM required.
 * Port-resilient: each test suite allocates its own free port.
 *
 * Flow:
 *   seed workspace → writeNKleinPlanArtifacts (direct FS) →
 *   listNKleinPlanArtifacts (HTTP) →
 *   applyNKleinPlanArtifact (HTTP) →
 *   workspace.getState (HTTP) → assert cards in planning lane
 *   + reject test: rejectNKleinPlanArtifact (HTTP) → artifact removed from pending list
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeNKleinPlanArtifacts } from "../../src/nklein-agent/nklein-plan-artifacts";
import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";

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
 * return the assigned workspace ID.
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
// Shared fixture: a minimal task graph with two tasks and one dependency
// ---------------------------------------------------------------------------

const FIXTURE_SLUG = "suite2-plan-contract";
const FIXTURE_TASK_ID = "suite2-source-task";

const fixtureTaskGraph = {
	schemaVersion: 1 as const,
	slug: FIXTURE_SLUG,
	title: "Suite 2 Plan Contract",
	tasks: [
		{
			id: "task-a",
			title: "Task A",
			prompt: "Implement feature A",
			dependsOn: [],
			complexity: 40,
			suggestedRole: null,
			filesLikelyTouched: [],
			acceptanceCommand: "echo ok-a",
			testFirst: false,
			acceptanceTestPrompt: null,
		},
		{
			id: "task-b",
			title: "Task B",
			prompt: "Implement feature B, depends on A",
			dependsOn: ["task-a"],
			complexity: 60,
			suggestedRole: null,
			filesLikelyTouched: [],
			acceptanceCommand: "echo ok-b",
			testFirst: false,
			acceptanceTestPrompt: null,
		},
	],
};

// ---------------------------------------------------------------------------
// Suite: list shows a seeded artifact
// ---------------------------------------------------------------------------

describe.sequential("Suite 2 — list shows a seeded artifact", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-plan-list-cwd-");
		homeDir = makeTempDir("kanban-contract-plan-list-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);

		// Seed the artifact on disk before starting the server — the server reads
		// directly from .nklein/nklein/plans/ at request time so order doesn't matter.
		await writeNKleinPlanArtifacts({
			workspacePath: cwd,
			workspaceId: null,
			sourceTaskId: FIXTURE_TASK_ID,
			slug: FIXTURE_SLUG,
			spec: "# Spec\n\nContract test spec.\n",
			plan: "# Plan\n\nContract test plan.\n",
			taskGraph: fixtureTaskGraph,
		});

		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("runtime.listNKleinPlanArtifacts returns status 200 and an artifacts array", async () => {
		const res = await requestJson<{ artifacts: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: FIXTURE_TASK_ID },
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.artifacts)).toBe(true);
	});

	it("the seeded artifact's slug and metadata are present in the list", async () => {
		const res = await requestJson<{
			artifacts: Array<{
				artifactId: string;
				planSlug: string;
				title: string;
				applicationStatus: string;
				validationStatus: string;
				taskCount: number;
				dependencyCount: number;
				sourceTaskId: string | null;
			}>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: FIXTURE_TASK_ID },
		});
		expect(res.status).toBe(200);
		expect(res.payload.artifacts).toHaveLength(1);
		const artifact = res.payload.artifacts[0];
		expect(artifact).toBeDefined();
		expect(artifact?.artifactId).toBe(`decomposition:${FIXTURE_SLUG}`);
		expect(artifact?.planSlug).toBe(FIXTURE_SLUG);
		expect(artifact?.title).toBe(fixtureTaskGraph.title);
		expect(artifact?.applicationStatus).toBe("pending");
		expect(artifact?.validationStatus).toBe("valid");
		expect(artifact?.taskCount).toBe(2);
		expect(artifact?.dependencyCount).toBe(1);
		expect(artifact?.sourceTaskId).toBe(FIXTURE_TASK_ID);
	});

	it("a different taskId returns an empty artifact list", async () => {
		const res = await requestJson<{ artifacts: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: "unrelated-task-id" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.artifacts).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: apply creates the cards on the board
// ---------------------------------------------------------------------------

describe.sequential("Suite 2 — apply creates cards in the planning lane", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;
	let artifactId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-plan-apply-cwd-");
		homeDir = makeTempDir("kanban-contract-plan-apply-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);

		await writeNKleinPlanArtifacts({
			workspacePath: cwd,
			workspaceId: null,
			sourceTaskId: null, // no source card required — baseRef from git branch
			slug: FIXTURE_SLUG,
			spec: "# Spec\n\nContract test spec.\n",
			plan: "# Plan\n\nContract test plan.\n",
			taskGraph: fixtureTaskGraph,
		});

		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);

		artifactId = `decomposition:${FIXTURE_SLUG}`;
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("runtime.applyNKleinPlanArtifact returns status 200 with ok=true", async () => {
		const res = await requestJson<{
			ok: boolean;
			createdTaskCount: number;
			createdDependencyCount: number;
			message: string;
			artifact: {
				artifactId: string;
				applicationStatus: string;
			};
			workspaceState: {
				board: {
					columns: Array<{ id: string; cards: unknown[] }>;
				};
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.applyNKleinPlanArtifact",
			type: "mutation",
			workspaceId,
			payload: { artifactId },
		});
		if (res.status !== 200) {
			console.error("applyNKleinPlanArtifact failed:", JSON.stringify(res.payload));
		}
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.createdTaskCount).toBe(2);
		expect(res.payload.createdDependencyCount).toBe(1);
		expect(typeof res.payload.message).toBe("string");
		expect(res.payload.message.length).toBeGreaterThan(0);
		expect(res.payload.artifact.artifactId).toBe(artifactId);
		expect(res.payload.artifact.applicationStatus).toBe("applied");
	});

	it("workspace.getState shows the generated cards in the planning lane", async () => {
		const res = await requestJson<{
			board: {
				columns: Array<{
					id: string;
					cards: Array<{
						id: string;
						prompt: string;
						startInPlanMode: boolean;
						generatedFromPlan?: {
							artifactKind: string;
							planSlug: string;
							planTaskId: string;
						};
					}>;
				}>;
				dependencies: Array<{
					id: string;
					fromTaskId: string;
					toTaskId: string;
				}>;
			};
			revision: number;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);

		const planningColumn = res.payload.board.columns.find((col) => col.id === "planning");
		expect(planningColumn).toBeDefined();
		expect(planningColumn?.cards).toHaveLength(2);

		// All generated cards should be in planning with startInPlanMode: false
		for (const card of planningColumn?.cards ?? []) {
			expect(card.startInPlanMode).toBe(false);
			expect(card.generatedFromPlan?.artifactKind).toBe("decomposition");
			expect(card.generatedFromPlan?.planSlug).toBe(FIXTURE_SLUG);
		}

		// The dependency should be wired (task-b depends on task-a)
		expect(res.payload.board.dependencies).toHaveLength(1);
		const dep = res.payload.board.dependencies[0];
		expect(dep).toBeDefined();
		// fromTaskId → toTaskId represents "toTaskId must wait for fromTaskId"
		// Both IDs are generated from slug-task-id pattern; just verify they're both planning card IDs
		const planningCardIds = new Set(planningColumn?.cards.map((c) => c.id) ?? []);
		expect(planningCardIds.has(dep?.fromTaskId ?? "")).toBe(true);
		expect(planningCardIds.has(dep?.toTaskId ?? "")).toBe(true);
		expect(dep?.fromTaskId).not.toBe(dep?.toTaskId);
	});

	it("the applied artifact no longer appears in the pending list", async () => {
		const res = await requestJson<{ artifacts: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: FIXTURE_TASK_ID },
		});
		expect(res.status).toBe(200);
		// listNKleinPlanArtifacts only returns pending artifacts; applied artifacts are gone
		expect(res.payload.artifacts).toHaveLength(0);
	});

	it("re-applying an already-applied artifact is idempotent (succeeds, creates no new cards)", async () => {
		// Re-applying is allowed (HTTP ok), but the generated cards already exist on the board and are deduped by
		// plan-task-id, so a second apply creates ZERO new cards rather than duplicating the graph.
		const res = await requestJson<{ ok: boolean; createdTaskCount: number }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.applyNKleinPlanArtifact",
			type: "mutation",
			workspaceId,
			payload: { artifactId },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.createdTaskCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: reject removes the artifact from the pending list without creating cards
// ---------------------------------------------------------------------------

describe.sequential("Suite 2 — reject removes artifact from the pending list", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;
	let artifactId: string;

	const REJECT_SLUG = "suite2-plan-reject";
	const REJECT_TASK_ID = "suite2-reject-source-task";

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-plan-reject-cwd-");
		homeDir = makeTempDir("kanban-contract-plan-reject-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);

		await writeNKleinPlanArtifacts({
			workspacePath: cwd,
			workspaceId: null,
			sourceTaskId: REJECT_TASK_ID,
			slug: REJECT_SLUG,
			spec: "# Spec\n\nReject test spec.\n",
			plan: "# Plan\n\nReject test plan.\n",
			taskGraph: {
				schemaVersion: 1,
				slug: REJECT_SLUG,
				title: "Suite 2 Reject Contract",
				tasks: [
					{
						id: "task-only",
						title: "The Only Task",
						prompt: "Do the thing",
						dependsOn: [],
						complexity: 50,
						suggestedRole: null,
						filesLikelyTouched: [],
						acceptanceCommand: "echo ok-only",
						testFirst: false,
						acceptanceTestPrompt: null,
					},
				],
			},
		});

		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);

		artifactId = `decomposition:${REJECT_SLUG}`;
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("the artifact appears as pending before rejection", async () => {
		const res = await requestJson<{ artifacts: Array<{ artifactId: string; applicationStatus: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: REJECT_TASK_ID },
		});
		expect(res.status).toBe(200);
		expect(res.payload.artifacts).toHaveLength(1);
		expect(res.payload.artifacts[0]?.applicationStatus).toBe("pending");
	});

	it("runtime.rejectNKleinPlanArtifact returns status 200 with ok=true and applicationStatus=rejected", async () => {
		const res = await requestJson<{
			ok: boolean;
			message: string;
			artifact: {
				artifactId: string;
				applicationStatus: string;
			};
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.rejectNKleinPlanArtifact",
			type: "mutation",
			workspaceId,
			payload: { artifactId },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(typeof res.payload.message).toBe("string");
		expect(res.payload.message.length).toBeGreaterThan(0);
		expect(res.payload.artifact.artifactId).toBe(artifactId);
		expect(res.payload.artifact.applicationStatus).toBe("rejected");
	});

	it("the artifact no longer appears in the pending list after rejection", async () => {
		const res = await requestJson<{ artifacts: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.listNKleinPlanArtifacts",
			type: "query",
			workspaceId,
			payload: { taskId: REJECT_TASK_ID },
		});
		expect(res.status).toBe(200);
		expect(res.payload.artifacts).toHaveLength(0);
	});

	it("workspace.getState shows no cards were created by the rejection", async () => {
		const res = await requestJson<{
			board: { columns: Array<{ id: string; cards: unknown[] }> };
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		const planningColumn = res.payload.board.columns.find((col) => col.id === "planning");
		expect(planningColumn?.cards).toHaveLength(0);
	});

	it("applying a rejected artifact fails with BAD_REQUEST (400)", async () => {
		const res = await requestJson<{ message?: string; code?: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.applyNKleinPlanArtifact",
			type: "mutation",
			workspaceId,
			payload: { artifactId },
		});
		// tRPC maps BAD_REQUEST to HTTP 400
		expect(res.status).toBe(400);
	});
});
