/**
 * Contract test for the read-only WATCH MODE gate (user directive 2026-07-02: a browser on the harness's
 * live-board link must not be able to disturb an ongoing sweep — the motivating incident was an accidental
 * mid-run model-role change from the served UI).
 *
 * When the backend is spawned with NKLEIN_WATCH_MODE_MUTATION_TOKEN:
 *   - tRPC QUERIES stay open (watching is free),
 *   - tRPC MUTATIONS without the matching `x-nklein-mutation-token` header are rejected 403,
 *   - mutations WITH the token pass the gate (the harness's own orchestration calls).
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";

const WATCH_TOKEN = "watch-mode-contract-token";

describe.sequential("watch-mode read-only gate contract", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let previousEnvToken: string | undefined;

	beforeAll(async () => {
		cwd = mkdtempSync(join(tmpdir(), "kanban-contract-watch-cwd-"));
		homeDir = mkdtempSync(join(tmpdir(), "kanban-contract-watch-home-"));
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);
		// The helper attaches the token from THIS process's env; clear it around the raw-fetch cases below.
		previousEnvToken = process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN;
		delete process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN;
		server = await startTsBackend({
			cwd,
			homeDir,
			extraEnv: { NKLEIN_WATCH_MODE_MUTATION_TOKEN: WATCH_TOKEN },
		});
	}, 30_000);

	afterAll(async () => {
		if (previousEnvToken === undefined) {
			delete process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN;
		} else {
			process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN = previousEnvToken;
		}
		await server?.stop();
		rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
		rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	}, 30_000);

	it("keeps queries open for watchers", async () => {
		const res = await requestJson<{ projects?: unknown[] }>({
			baseUrl: server.baseUrl,
			procedure: "projects.listDevTestProjects",
			type: "query",
		});
		expect(res.status).toBe(200);
	});

	it("rejects a token-less mutation with 403 and a human-readable watch-mode message", async () => {
		const response = await fetch(`${server.baseUrl}/api/trpc/projects.createDevTestProject`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ preset: "complex_dag" }),
		});
		expect(response.status).toBe(403);
		const payload = (await response.json()) as { error?: { message?: string } };
		expect(payload.error?.message).toContain("WATCH MODE");
	});

	it("lets the harness's own mutations through with the token", async () => {
		process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN = WATCH_TOKEN;
		try {
			// NODE_ENV=test closes the dev-test create gate itself, so a 200 here proves the WATCH gate passed
			// (the request reached the procedure and was rejected by ITS OWN gate, not by a 403 watch rejection).
			const res = await requestJson<{ ok?: boolean; error?: string }>({
				baseUrl: server.baseUrl,
				procedure: "projects.createDevTestProject",
				type: "mutation",
				payload: { preset: "complex_dag" },
			});
			expect(res.status).not.toBe(403);
		} finally {
			delete process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN;
		}
	});
});
