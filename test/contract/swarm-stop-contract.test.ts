import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { initGitRepository, requestJson, startTsBackend } from "./helpers";

/**
 * Suite 21 — swarm-stop control surface (runtime.getSwarmStop / requestSwarmStop / clearSwarmStop).
 *
 * The stop is a deterministic workspace-level flag (independent of an active swarm), so the
 * request → get → clear lifecycle is fully seam-testable over real HTTP without a live model.
 */

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

type SwarmStopResponse = {
	ok: boolean;
	signal: { stopped: true; reason: string; createdAt: number } | null;
	error?: string;
};

describe.sequential("Suite 21 — swarm-stop control (request → get → clear)", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-swarm-stop-cwd-");
		homeDir = makeTempDir("kanban-swarm-stop-home-");
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	async function getSwarmStop(): Promise<SwarmStopResponse> {
		const res = await requestJson<SwarmStopResponse>({
			baseUrl: server.baseUrl,
			procedure: "runtime.getSwarmStop",
			type: "query",
			workspaceId,
		});
		expect(res.status).toBe(200);
		return res.payload;
	}

	it("getSwarmStop on a fresh workspace reports not-stopped (signal null)", async () => {
		const payload = await getSwarmStop();
		expect(payload.ok).toBe(true);
		expect(payload.signal).toBeNull();
	});

	it("requestSwarmStop sets the stop signal with the given reason", async () => {
		const res = await requestJson<SwarmStopResponse>({
			baseUrl: server.baseUrl,
			procedure: "runtime.requestSwarmStop",
			type: "mutation",
			workspaceId,
			payload: { reason: "contract-test halt" },
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.signal?.stopped).toBe(true);
		expect(res.payload.signal?.reason).toBe("contract-test halt");
		expect(typeof res.payload.signal?.createdAt).toBe("number");
	});

	it("getSwarmStop reflects the requested stop (persisted)", async () => {
		const payload = await getSwarmStop();
		expect(payload.signal?.stopped).toBe(true);
		expect(payload.signal?.reason).toBe("contract-test halt");
	});

	it("clearSwarmStop clears the signal and getSwarmStop confirms it", async () => {
		const res = await requestJson<SwarmStopResponse>({
			baseUrl: server.baseUrl,
			procedure: "runtime.clearSwarmStop",
			type: "mutation",
			workspaceId,
			payload: {},
		});
		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.signal).toBeNull();
		expect((await getSwarmStop()).signal).toBeNull();
	});
});
