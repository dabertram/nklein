/**
 * Contract tests for the dev-test project registry tRPC procedures:
 *   - projects.listDevTestProjects  (query — no gate, always available)
 *   - projects.createDevTestProject with registryId  (mutation — gated to NODE_ENV=development)
 *
 * The spawned test backend inherits NODE_ENV=test so the create gate is closed here.
 * The list procedure has no gate and covers the full shape contract.
 * The create-by-id routing (registryId → loadDevTestProjectScenario) is exercised by the
 * server-side unit test suite (test:fast).  The gate rejection is verified below.
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

describe.sequential("dev-test registry contract", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-contract-registry-cwd-");
		homeDir = makeTempDir("kanban-contract-registry-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("projects.listDevTestProjects returns an array of registry entries with expected shape", async () => {
		const res = await requestJson<{
			entries: Array<{
				id: string;
				title: string;
				tier?: string;
				tags?: string[];
				complexity?: number;
			}>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "projects.listDevTestProjects",
			type: "query",
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.payload.entries)).toBe(true);
		// Registry has at least the migrated legacy projects
		expect(res.payload.entries.length).toBeGreaterThan(0);
		// Every entry has id + title
		for (const entry of res.payload.entries) {
			expect(typeof entry.id).toBe("string");
			expect(entry.id.length).toBeGreaterThan(0);
			expect(typeof entry.title).toBe("string");
			expect(entry.title.length).toBeGreaterThan(0);
		}
		// At least one entry has a tier (the enhanced numbered projects all do)
		const withTier = res.payload.entries.filter((e) => e.tier !== undefined);
		expect(withTier.length).toBeGreaterThan(0);
	});

	it("projects.listDevTestProjects includes both legacy (complexity) and enhanced (tier) projects", async () => {
		const res = await requestJson<{
			entries: Array<{ id: string; complexity?: number; tier?: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "projects.listDevTestProjects",
			type: "query",
		});
		const withComplexity = res.payload.entries.filter((e) => e.complexity !== undefined);
		const withTier = res.payload.entries.filter((e) => e.tier !== undefined);
		expect(withComplexity.length).toBeGreaterThan(0);
		expect(withTier.length).toBeGreaterThan(0);
	});

	it("projects.createDevTestProject with registryId returns ok:false outside NODE_ENV=development", async () => {
		// The gate requires NODE_ENV=development; the contract test backend runs under NODE_ENV=test.
		// Verify the gate response shape is correct (ok:false + error string).
		const listRes = await requestJson<{ entries: Array<{ id: string }> }>({
			baseUrl: server.baseUrl,
			procedure: "projects.listDevTestProjects",
			type: "query",
		});
		expect(listRes.payload.entries.length).toBeGreaterThan(0);
		const firstEntry = listRes.payload.entries[0];
		expect(firstEntry).toBeDefined();
		const firstId = firstEntry?.id ?? "";
		expect(firstId.length).toBeGreaterThan(0);

		const res = await requestJson<{ ok: boolean; error?: string }>({
			baseUrl: server.baseUrl,
			procedure: "projects.createDevTestProject",
			type: "mutation",
			payload: { registryId: firstId },
		});
		expect(res.status).toBe(200);
		// Gate is closed in NODE_ENV=test — returns ok:false with an error message
		expect(res.payload.ok).toBe(false);
		expect(typeof res.payload.error).toBe("string");
		expect((res.payload.error ?? "").length).toBeGreaterThan(0);
	});

	it("projects.createDevTestProject with an unknown registryId also returns ok:false", async () => {
		const res = await requestJson<{ ok: boolean; error?: string }>({
			baseUrl: server.baseUrl,
			procedure: "projects.createDevTestProject",
			type: "mutation",
			payload: { registryId: "does-not-exist-xyz" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(false);
		expect(typeof res.payload.error).toBe("string");
	});
});
