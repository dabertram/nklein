/**
 * P0.3 — production-shaped zero-token self-healing through the real runtime.
 *
 * The first decomposition request accepts the HTTP connection but emits no response byte. The session therefore has
 * the exact production turn-start shape (`running`, token null, optimistic healthy heartbeat) while owning model
 * admission. The accelerated watchdog must interrupt it, release capacity, and let the normal terminal retry recover
 * the same card. The recovered run creates one worker whose first byte is merely slow (but below the bound), proving
 * that healthy slow-prefill work is not interrupted on the way to review/delivery.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BackendUnderTest } from "../contract/helpers/index.js";
import { initGitRepository, requestJson, startTsBackend } from "../contract/helpers/index.js";
import { type MockLlmServer, startMockLlm } from "../contract/helpers/mock-llm";
import { pollSwarmBoardUntil } from "../contract/helpers/swarm-poll";

const TEST_TIMEOUT_MS = 300_000;
const ZERO_TOKEN_WEDGE_MS = 5_000;

describe.sequential("zero-token session self-healing (P0.3)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";
	let passed = false;
	const serverLogLines: string[] = [];

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-zero-token-heal" });
		cwd = realpathSync(mkdtempSync(join(tmpdir(), "nklein-zero-token-cwd-")));
		homeDir = realpathSync(mkdtempSync(join(tmpdir(), "nklein-zero-token-home-")));
		initGitRepository(cwd);
		server = await startTsBackend({
			cwd,
			homeDir,
			extraEnv: {
				NODE_ENV: "development",
				NKLEIN_TEST_BOARD_LIVENESS_TICK_MS: "100",
				NKLEIN_TEST_ZERO_TOKEN_WEDGE_MS: String(ZERO_TOKEN_WEDGE_MS),
			},
			onLog: (chunk) => {
				for (const line of chunk.split("\n")) {
					if (/watchdog|zero-token|session|queue|retry|review|delivery|error|warn/i.test(line) && line.trim()) {
						serverLogLines.push(line.trim().slice(0, 400));
					}
				}
			},
		});
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		await server?.stop().catch(() => null);
		await mock?.close().catch(() => null);
		if (passed) {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		} else {
			console.error(`[zero-token-heal] FAILURE — home preserved at ${homeDir}, cwd at ${cwd}`);
			console.error(`[zero-token-heal] server log tail:\n${serverLogLines.slice(-80).join("\n")}`);
		}
	});

	it(
		"interrupts the production start zombie, releases capacity, retries the card, and preserves a slow first token",
		async () => {
			if (!server) {
				throw new Error("backend missing");
			}
			await requestJson({
				baseUrl: server.baseUrl,
				procedure: "runtime.saveNKleinProviderSettings",
				type: "mutation",
				payload: { providerId: "lmstudio", modelId: mock.modelId, baseUrl: `${mock.baseUrl}/v1` },
			});

			const createRes = await requestJson<{
				ok: boolean;
				project: { id: string } | null;
				task: {
					id: string;
					prompt: string;
					title?: string;
					startInPlanMode?: boolean;
					baseRef?: string;
					agentId?: string;
					nkleinSettings?: unknown;
				} | null;
			}>({
				baseUrl: server.baseUrl,
				procedure: "projects.createDevTestProject",
				type: "mutation",
				payload: { preset: "mid_task" },
			});
			expect(createRes.payload.ok).toBe(true);
			const workspaceId = createRes.payload.project?.id ?? "";
			const seed = createRes.payload.task;
			if (!seed) {
				throw new Error("no seed card");
			}

			let seedRequests = 0;
			let decomposed = false;
			let workerWriteRequested = false;
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				if (!decomposed && tools.includes("decompose_project") && messages.includes(seed.prompt.slice(0, 80))) {
					seedRequests += 1;
					const decomposition = {
						toolCalls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "zero-token-heal",
									title: "Zero-token recovery scenario",
									spec: "One tiny additive change after recovery.",
									plan: "One card.",
									summary: "One card.",
									defaultAcceptanceCommand: 'node -e "process.exit(0)"',
									tasks: [{ id: "gamma", title: "Recovered card gamma", prompt: "Do recovered gamma." }],
								},
							},
						],
					};
					if (seedRequests === 1) {
						// Effectively infinite for this test; the mock cancels the delay as soon as stopTaskSession closes
						// the request. No first byte means the SDK cannot synthesize token/heartbeat activity.
						return { ...decomposition, delayMs: TEST_TIMEOUT_MS };
					}
					decomposed = true;
					return decomposition;
				}
				if (tools.includes("submit_review") && !messages.includes("Review submitted")) {
					return {
						toolCalls: [
							{
								name: "submit_review",
								arguments: { verdict: "approve", summary: "Recovered gamma is correct." },
							},
						],
					};
				}
				if (messages.includes("Do recovered gamma") && !workerWriteRequested && tools.includes("write_file")) {
					workerWriteRequested = true;
					return {
						// Deliberately slower than several watchdog ticks, but comfortably inside the wedge lease.
						delayMs: Math.floor(ZERO_TOKEN_WEDGE_MS / 3),
						content: "Starting recovered gamma.",
						toolCalls: [
							{
								name: "write_file",
								arguments: {
									path: "notes/gamma.md",
									content: "# gamma\n\nRecovered after the zero-token watchdog fired.\n",
								},
							},
						],
					};
				}
				return undefined;
			});
			mock.setDefault({ content: "Done." });

			const startRes = await requestJson<{ ok?: boolean; error?: string }>({
				baseUrl: server.baseUrl,
				procedure: "runtime.startTaskSession",
				type: "mutation",
				workspaceId,
				payload: {
					taskId: seed.id,
					prompt: seed.prompt,
					taskTitle: seed.title,
					startInPlanMode: seed.startInPlanMode,
					baseRef: seed.baseRef ?? "HEAD",
					agentId: seed.agentId,
					nkleinSettings: seed.nkleinSettings,
				},
			});
			expect(startRes.payload.ok).toBe(true);
			await vi.waitFor(() => expect(seedRequests).toBe(1), { timeout: ZERO_TOKEN_WEDGE_MS / 2, interval: 20 });
			const hungState = await requestJson<{
				sessions?: Record<
					string,
					{
						state?: string;
						lastTokenAt?: number | null;
						lastHeartbeatAt?: number | null;
						heartbeatStatus?: string | null;
					}
				>;
			}>({
				baseUrl: server.baseUrl,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(hungState.payload.sessions?.[seed.id]).toMatchObject({
				state: "running",
				lastTokenAt: null,
				heartbeatStatus: "healthy",
			});
			expect(hungState.payload.sessions?.[seed.id]?.lastHeartbeatAt).toEqual(expect.any(Number));

			const poll = await pollSwarmBoardUntil({
				baseUrl: server.baseUrl,
				workspaceId,
				deadlineMs: Date.now() + TEST_TIMEOUT_MS - 30_000,
				pollIntervalMs: 250,
				deadPolls: 40,
				isTarget: (lanes) => {
					const gamma = [...lanes.keys()].find((id) => id.includes("gamma")) ?? "";
					return Boolean(gamma) && lanes.get(gamma) === "completed" && lanes.get(seed.id) === "completed";
				},
			});
			const gammaId = [...poll.lanes.keys()].find((id) => id.includes("gamma")) ?? "";
			const watchdogInterrupts = serverLogLines.filter((line) =>
				line.includes("interrupting zero-token wedged session"),
			);

			expect(poll.outcome, poll.detail).toBe("target");
			expect(seedRequests).toBeGreaterThanOrEqual(2);
			expect(workerWriteRequested).toBe(true);
			expect(watchdogInterrupts.some((line) => line.includes(seed.id))).toBe(true);
			expect(watchdogInterrupts.some((line) => gammaId && line.includes(gammaId))).toBe(false);
			passed = true;
		},
		TEST_TIMEOUT_MS,
	);
});
