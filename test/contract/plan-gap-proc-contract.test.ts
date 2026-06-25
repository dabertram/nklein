/**
 * Contract test: runtime.recordNKleinPlanGap tRPC mutation.
 *
 * Exercises the HTTP+tRPC boundary end-to-end against a spawned server:
 *   - Returns 200 + ok=true for observation-only kinds (other, missing_dependency).
 *   - Returns 200 + ok=true for card-creating kinds (missing_decision, integration_needed).
 *   - Returns the taskId and kind back in the response.
 *   - Returns 400 for an invalid kind or empty description.
 *
 * Does not require a live model. Mirrors the shape of plan-artifact-pipeline-contract.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const FIXTURE_TASK_ID = "plan-gap-contract-task";

describe.sequential("Suite — runtime.recordNKleinPlanGap", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-plangap-cwd-");
		homeDir = makeTempDir("kanban-contract-plangap-home-");
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

	it("returns 200 + ok=true for kind=other (observation-only)", async () => {
		const res = await requestJson<{ ok: boolean; taskId: string; kind: string; message: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.recordNKleinPlanGap",
			type: "mutation",
			workspaceId,
			payload: { taskId: FIXTURE_TASK_ID, kind: "other", description: "Observed something unexpected." },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.taskId).toBe(FIXTURE_TASK_ID);
		expect(res.payload.kind).toBe("other");
		expect(typeof res.payload.message).toBe("string");
	});

	it("returns 200 + ok=true for kind=missing_dependency (observation-only)", async () => {
		const res = await requestJson<{ ok: boolean; kind: string }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.recordNKleinPlanGap",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: FIXTURE_TASK_ID,
				kind: "missing_dependency",
				description: "Auth types missing from plan.",
				evidence: "src/auth/types.ts does not exist.",
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.kind).toBe("missing_dependency");
	});

	it("returns 200 + ok=true for kind=missing_decision (creates companion card)", async () => {
		const res = await requestJson<{ ok: boolean; kind: string; workspaceState?: unknown }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.recordNKleinPlanGap",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: FIXTURE_TASK_ID,
				kind: "missing_decision",
				description: "Need to decide the API pagination strategy.",
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.kind).toBe("missing_decision");
		// Card-creating kinds return workspaceState so the client can refresh.
		expect(res.payload.workspaceState).toBeDefined();
	});

	it("returns 200 + ok=true for kind=integration_needed (creates companion card)", async () => {
		const res = await requestJson<{ ok: boolean; kind: string; workspaceState?: { board: unknown } }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.recordNKleinPlanGap",
			type: "mutation",
			workspaceId,
			payload: {
				taskId: FIXTURE_TASK_ID,
				kind: "integration_needed",
				description: "Auth middleware must be wired before this task can complete.",
			},
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.kind).toBe("integration_needed");
		expect(res.payload.workspaceState).toBeDefined();
	});

	it("returns 400 for an invalid kind", async () => {
		const res = await requestJson<{ ok?: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.recordNKleinPlanGap",
			type: "mutation",
			workspaceId,
			payload: { taskId: FIXTURE_TASK_ID, kind: "not_a_real_kind", description: "Should fail validation." },
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 when description is empty", async () => {
		const res = await requestJson<{ ok?: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "runtime.recordNKleinPlanGap",
			type: "mutation",
			workspaceId,
			payload: { taskId: FIXTURE_TASK_ID, kind: "other", description: "" },
		});
		expect(res.status).toBe(400);
	});
});
