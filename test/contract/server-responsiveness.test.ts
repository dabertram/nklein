/**
 * Suite 13 — server responsiveness / smoothness
 *
 * A coarse PERFORMANCE REGRESSION oracle through the HTTP/WS seam.
 * Goal: catch a 10× slowdown introduced by a refactor/port, NOT microbenchmark.
 *
 * Design choices:
 *   - Every bound is GENEROUS (several × the observed steady-state value).
 *   - Warm-up calls discard first-call cold-path costs (module init, file-system
 *     indexing, JIT) before measuring.
 *   - All four measurements share one server instance to avoid paying the startup
 *     cost inside each it() body — the startup measurement IS the beforeAll timing.
 *   - MODEL-FREE: no NKlein task sessions, no LM Studio.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RuntimeStateStreamSnapshotMessage } from "../../src/core/api-contract";
import type { BackendUnderTest } from "./helpers";
import { connectRuntimeStream, type createBoard, initGitRepository, requestJson, startTsBackend } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Register cwd as a project (confirmSelfProject: true) and return workspace ID. */
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

/** Build a board with N cards in backlog (unique ids to avoid revision collisions). */
function createLargeBoard(cardCount: number): ReturnType<typeof createBoard> {
	const now = Date.now();
	const cards = Array.from({ length: cardCount }, (_, i) => ({
		id: `perf-card-${i}`,
		title: `Perf Task ${i}`,
		prompt: `Perf Task ${i}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: now + i,
		updatedAt: now + i,
	}));
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

/** Run a tRPC query N times sequentially; return all durations in ms. */
async function measureSequentialMs(fn: () => Promise<unknown>, n: number): Promise<number[]> {
	const durations: number[] = [];
	for (let i = 0; i < n; i++) {
		const t0 = performance.now();
		await fn();
		durations.push(performance.now() - t0);
	}
	return durations;
}

function percentile(sortedAsc: number[], p: number): number {
	const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
	return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))] ?? 0;
}

// ---------------------------------------------------------------------------
// Suite setup — one shared server
// ---------------------------------------------------------------------------

describe.sequential("Suite 13 — server responsiveness", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;
	/** Wall-clock ms from startTsBackend() call to resolve (measured in beforeAll). */
	let startupMs: number;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-perf-cwd-");
		homeDir = makeTempDir("kanban-perf-home-");
		mkdirSync(cwd, { recursive: true });
		initGitRepository(cwd);

		// Measurement 1: startup time (time the awaited startTsBackend call itself)
		const t0 = performance.now();
		server = await startTsBackend({ cwd, homeDir });
		startupMs = performance.now() - t0;

		// Seed the workspace with a mid-size board (~40 cards) for measurement 3.
		workspaceId = await addSelfProject(server.baseUrl, cwd);

		const initialState = await requestJson<{ revision: number; sessions: Record<string, unknown> }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});

		await requestJson({
			baseUrl: server.baseUrl,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {
				board: createLargeBoard(40),
				sessions: initialState.payload.sessions,
				expectedRevision: initialState.payload.revision,
			},
		});
	}, 45_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	// -------------------------------------------------------------------------
	// Measurement 1: server startup
	// -------------------------------------------------------------------------

	it("server startup completes within a generous ceiling", () => {
		// Observed: ~3–5 s on a quiet dev machine.
		// Bound: 15 s — leaves >3× headroom for a busy CI runner.
		// The actual timing was captured in beforeAll; this test just asserts it.
		expect(startupMs).toBeGreaterThan(0);
		expect(startupMs).toBeLessThan(15_000);
		// Log for visibility in the test output.
		console.info(`[perf] server startup: ${startupMs.toFixed(0)} ms  (ceiling 15 000 ms)`);
	});

	// -------------------------------------------------------------------------
	// Measurement 2: projects.list warm latency
	// -------------------------------------------------------------------------

	it("projects.list warm P90 and max are under generous ceilings (N=10)", async () => {
		// Warm-up: one call to settle module caches, open file handles, etc.
		await requestJson({ baseUrl: server.baseUrl, procedure: "projects.list", type: "query" });

		const N = 10;
		const durations = await measureSequentialMs(
			() => requestJson({ baseUrl: server.baseUrl, procedure: "projects.list", type: "query" }),
			N,
		);
		const sorted = [...durations].sort((a, b) => a - b);
		const median = percentile(sorted, 50);
		const p90 = percentile(sorted, 90);
		const max = sorted[sorted.length - 1] ?? 0;

		console.info(
			`[perf] projects.list (N=${N}): ` +
				`median=${median.toFixed(1)} ms  p90=${p90.toFixed(1)} ms  max=${max.toFixed(1)} ms  ` +
				`(ceilings: p90<500 ms, max<1 000 ms)`,
		);

		// Observed: median ~3–8 ms, max ~20–30 ms on a quiet machine.
		// Bound: p90 < 500 ms, max < 1 000 ms — ~30–100× the observed value
		// to absorb OS scheduling noise and parallel CI load.
		expect(p90).toBeLessThan(500);
		expect(max).toBeLessThan(1_000);
	});

	// -------------------------------------------------------------------------
	// Measurement 3: workspace.getState warm latency on a seeded mid-size board
	// -------------------------------------------------------------------------

	it("workspace.getState warm P90 and max are under generous ceilings on a 40-card board (N=10)", async () => {
		// Warm-up call to settle any first-access I/O cost.
		await requestJson({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});

		const N = 10;
		const durations = await measureSequentialMs(
			() =>
				requestJson({
					baseUrl: server.baseUrl,
					procedure: "workspace.getState",
					type: "query",
					workspaceId,
				}),
			N,
		);
		const sorted = [...durations].sort((a, b) => a - b);
		const median = percentile(sorted, 50);
		const p90 = percentile(sorted, 90);
		const max = sorted[sorted.length - 1] ?? 0;

		console.info(
			`[perf] workspace.getState 40-card board (N=${N}): ` +
				`median=${median.toFixed(1)} ms  p90=${p90.toFixed(1)} ms  max=${max.toFixed(1)} ms  ` +
				`(ceilings: p90<500 ms, max<1 000 ms)`,
		);

		// Observed: median ~3–10 ms, max ~25–40 ms on a quiet machine.
		// Bound: p90 < 500 ms, max < 1 000 ms — consistent with projects.list.
		expect(p90).toBeLessThan(500);
		expect(max).toBeLessThan(1_000);
	});

	// -------------------------------------------------------------------------
	// Measurement 4: WS initial snapshot delivery
	// -------------------------------------------------------------------------

	it("WS initial snapshot message arrives within a generous timeout", async () => {
		const wsUrl = `ws://${new URL(server.baseUrl).host}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`;
		const t0 = performance.now();
		const stream = await connectRuntimeStream(wsUrl);
		try {
			// waitForMessage has its own internal 5 s timeout; we add an outer measurement
			// and assert against a more generous ceiling.
			const snapshot = await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
				8_000, // generous per-call limit
			);
			const elapsed = performance.now() - t0;

			console.info(`[perf] WS initial snapshot delivery: ${elapsed.toFixed(0)} ms  (ceiling 5 000 ms)`);

			// Observed: ~20–80 ms on a quiet machine (socket open + server push).
			// Bound: 5 000 ms — ~50–100× observed, absorbs busy CI scheduler latency.
			expect(elapsed).toBeLessThan(5_000);
			expect(snapshot.type).toBe("snapshot");
		} finally {
			await stream.close();
		}
	});
});
