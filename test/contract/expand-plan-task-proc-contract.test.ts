/**
 * Contract test: runtime.expandNKleinPlanTask tRPC mutation.
 *
 * Exercises the HTTP+tRPC boundary end-to-end against a spawned server:
 *   - Returns 200 + ok=true when splitting a valid plan task into replacements.
 *   - Returns 200 + ok=true with explicit planSlug + planTaskId provided.
 *   - Returns 404 when the plan cannot be inferred (unknown taskId, no plans on disk).
 *   - Returns 400 when replacements is empty (Zod validation).
 *   - Returns 400 when a replacement has an empty title (Zod validation).
 *
 * Model-free: the mutation only touches the plan DAG on disk, no LLM required.
 * Mirrors the shape of plan-gap-proc-contract.test.ts and plan-artifact-pipeline-contract.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeNKleinPlanArtifacts } from "../../src/nklein-sdk/nklein-plan-artifacts";
import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

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
// Fixture plan
// ---------------------------------------------------------------------------

const FIXTURE_SLUG = "expand-contract-plan";
const FIXTURE_PLAN_TASK_ID = "task-to-expand";

const fixturePlanTaskGraph = {
	schemaVersion: 1 as const,
	slug: FIXTURE_SLUG,
	title: "Expand Contract Plan",
	tasks: [
		{
			id: FIXTURE_PLAN_TASK_ID,
			title: "Task to expand",
			prompt: "This task will be split into subtasks.",
			dependsOn: [],
			complexity: 70,
			suggestedRole: null,
			filesLikelyTouched: [],
			acceptanceCommand: null,
			testFirst: false,
			acceptanceTestPrompt: null,
		},
	],
};

// The board task ID is: slugify(slug) + "-" + slugify(planTaskId)
const BOARD_TASK_ID = `${FIXTURE_SLUG}-${FIXTURE_PLAN_TASK_ID}`;

const VALID_REPLACEMENTS = [
	{
		id: "sub-a",
		title: "Sub-task A",
		prompt: "Implement the first half.",
		dependsOn: [],
		complexity: 40,
		acceptanceCommand: "echo ok-a",
	},
	{
		id: "sub-b",
		title: "Sub-task B",
		prompt: "Implement the second half.",
		dependsOn: ["sub-a"],
		complexity: 40,
		acceptanceCommand: "echo ok-b",
	},
];

// ---------------------------------------------------------------------------
// Suite: basic apply (slug inferred from board taskId)
// ---------------------------------------------------------------------------

describe.sequential("Suite — runtime.expandNKleinPlanTask basic apply", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-expand-basic-cwd-");
		homeDir = makeTempDir("kanban-contract-expand-basic-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);

		await writeNKleinPlanArtifacts({
			workspacePath: cwd,
			workspaceId: null,
			sourceTaskId: null,
			slug: FIXTURE_SLUG,
			spec: "# Spec\n\nExpand contract test spec.\n",
			plan: "# Plan\n\nExpand contract test plan.\n",
			taskGraph: fixturePlanTaskGraph,
		});

		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 + ok=true with inferred slug and correct replacement IDs", async () => {
		const res = await requestJson<{
			ok: boolean;
			taskId: string;
			planSlug: string;
			planTaskId: string;
			replacementTaskIds: string[];
			entryTaskIds: string[];
			terminalTaskIds: string[];
			taskGraphPath: string;
			revisionsPath: string;
			message: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "runtime.expandNKleinPlanTask",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: BOARD_TASK_ID,
				replacements: VALID_REPLACEMENTS,
				description: "Splitting into two focused subtasks.",
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.taskId).toBe(BOARD_TASK_ID);
		expect(res.payload.planSlug).toBe(FIXTURE_SLUG);
		expect(res.payload.planTaskId).toBe(FIXTURE_PLAN_TASK_ID);
		expect(res.payload.replacementTaskIds).toEqual(["sub-a", "sub-b"]);
		expect(res.payload.entryTaskIds).toContain("sub-a");
		expect(res.payload.terminalTaskIds).toContain("sub-b");
		expect(typeof res.payload.taskGraphPath).toBe("string");
		expect(typeof res.payload.revisionsPath).toBe("string");
		expect(typeof res.payload.message).toBe("string");
		expect(res.payload.message).toContain(FIXTURE_PLAN_TASK_ID);
	});
});

// ---------------------------------------------------------------------------
// Suite: explicit planSlug + planTaskId (no inference needed)
// ---------------------------------------------------------------------------

describe.sequential("Suite — runtime.expandNKleinPlanTask with explicit slug and planTaskId", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-expand-explicit-cwd-");
		homeDir = makeTempDir("kanban-contract-expand-explicit-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);

		await writeNKleinPlanArtifacts({
			workspacePath: cwd,
			workspaceId: null,
			sourceTaskId: null,
			slug: FIXTURE_SLUG,
			spec: "# Spec\n\nExpand explicit contract test spec.\n",
			plan: "# Plan\n\nExpand explicit contract test plan.\n",
			taskGraph: fixturePlanTaskGraph,
		});

		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("returns 200 + ok=true when planSlug and planTaskId are provided explicitly", async () => {
		const res = await requestJson<{ ok: boolean; planSlug: string; planTaskId: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.expandNKleinPlanTask",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: "any-board-task-id",
				planSlug: FIXTURE_SLUG,
				planTaskId: FIXTURE_PLAN_TASK_ID,
				replacements: VALID_REPLACEMENTS,
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.planSlug).toBe(FIXTURE_SLUG);
		expect(res.payload.planTaskId).toBe(FIXTURE_PLAN_TASK_ID);
	});
});

// ---------------------------------------------------------------------------
// Suite: validation errors
// ---------------------------------------------------------------------------

describe.sequential("Suite — runtime.expandNKleinPlanTask validation errors", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-expand-err-cwd-");
		homeDir = makeTempDir("kanban-contract-expand-err-home-");
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

	it("returns 400 when replacements is empty (Zod min(1))", async () => {
		const res = await requestJson<{ ok?: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.expandNKleinPlanTask",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: BOARD_TASK_ID,
				planSlug: FIXTURE_SLUG,
				planTaskId: FIXTURE_PLAN_TASK_ID,
				replacements: [],
			},
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 when a replacement item has an empty title (Zod min(1))", async () => {
		const res = await requestJson<{ ok?: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.expandNKleinPlanTask",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: BOARD_TASK_ID,
				planSlug: FIXTURE_SLUG,
				planTaskId: FIXTURE_PLAN_TASK_ID,
				replacements: [
					{
						id: "ok-item",
						title: "OK",
						prompt: "Fine.",
						dependsOn: [],
						complexity: 50,
						acceptanceCommand: "echo ok",
					},
					{
						id: "bad-item",
						title: "",
						prompt: "Fine.",
						dependsOn: [],
						complexity: 50,
						acceptanceCommand: "echo ok",
					},
				],
			},
		});
		expect(res.status).toBe(400);
	});

	it("returns 404 when no plan can be inferred for the taskId and no planSlug is given", async () => {
		const res = await requestJson<{ ok?: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.expandNKleinPlanTask",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: "totally-unknown-task-id",
				replacements: VALID_REPLACEMENTS,
			},
		});
		// tRPC maps NOT_FOUND to HTTP 404
		expect(res.status).toBe(404);
	});
});
