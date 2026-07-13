/**
 * W2.1 (audit 2026-07-02) — the DETERMINISTIC swarm harness, v1: drive the REAL runtime (startTsBackend + Docker
 * sandboxes) against a SCRIPTED mock LLM (zero model latency, zero fleet dependency) and pin the cascade + gate
 * invariants that until now were only verifiable through ~30-minute live fleet runs (runs 9–18).
 *
 * The v1 scenario pins the overnight reliability wave end-to-end:
 *   1. the seed decomposes via ONE scripted `decompose_project` tool call (2 worker cards),
 *   2. the cascade auto-starts the roots (deferred-retry / ready-sweep paths included),
 *   3. every worker turn replies "Done." with NO tool calls ⇒ EMPTY patches,
 *   4. → the W4.2a re-drive fires once per card, then the W0.1 fail-closed gate HOLDS the no-op cards in Review —
 *      they must NEVER auto-complete (the pre-overnight behavior this suite exists to prevent regressing).
 *
 * Requires Docker (like the other integration suites); skipped implicitly by running only in test/integration.
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

describe.sequential("deterministic swarm harness (W2.1)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-swarm-model" });
		cwd = realpathSync(mkdtempSync(join(tmpdir(), "nklein-detswarm-cwd-")));
		homeDir = realpathSync(mkdtempSync(join(tmpdir(), "nklein-detswarm-home-")));
		initGitRepository(cwd);
		const serverLogLines: string[] = [];
		server = await startTsBackend({
			cwd,
			homeDir,
			extraEnv: { NODE_ENV: "development" },
			onLog: (chunk) => {
				for (const line of chunk.split("\n")) {
					if (/decompos|error|warn|fail|sandbox|session/i.test(line) && line.trim()) {
						serverLogLines.push(line.trim().slice(0, 220));
					}
				}
			},
		});
		(globalThis as { __detSwarmLog?: string[] }).__detSwarmLog = serverLogLines;
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		await server?.stop().catch(() => null);
		await mock?.close().catch(() => null);
		rmSync(cwd, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
	});

	it(
		"decompose applies, the cascade starts, and no-op workers are re-driven once then HELD (never completed)",
		async () => {
			if (!server) {
				throw new Error("backend missing");
			}
			// Provider = the mock (its /api/v0/models reports the model loaded with a ≥32k window).
			await requestJson({
				baseUrl: server.baseUrl,
				procedure: "runtime.saveNKleinProviderSettings",
				type: "mutation",
				payload: { providerId: "lmstudio", modelId: mock.modelId, baseUrl: `${mock.baseUrl}/v1` },
			});
			// Script: the SEED's first turn emits the whole decomposition; every later turn (workers, any review
			// turns) gets the no-op default — the exact empty-patch shape run12 hit live.
			mock.enqueue({
				toolCalls: [
					{
						name: "decompose_project",
						arguments: {
							slug: "det-swarm",
							title: "Deterministic swarm scenario",
							spec: "Two tiny independent changes.",
							plan: "Two cards, no dependencies.",
							summary: "Two cards.",
							defaultAcceptanceCommand: "npm test",
							tasks: [
								{ id: "alpha", title: "Card alpha", prompt: "Do alpha." },
								{ id: "beta", title: "Card beta", prompt: "Do beta." },
							],
						},
					},
				],
			});
			mock.setDefault({ content: "Done." });

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
			expect(seed).not.toBeNull();
			if (!seed) {
				return;
			}

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

			// Early-exit poller: settles the moment the HOLD shape is reached; a dead swarm fails in seconds.
			// (failOnParked stays OFF here — the held-in-review end state is adjacent to parking, and the HOLD
			// assertion itself distinguishes them.)
			const poll = await pollSwarmBoardUntil({
				baseUrl: server.baseUrl,
				workspaceId,
				deadlineMs: Date.now() + TEST_TIMEOUT_MS - 30_000,
				isTarget: (lanes) => {
					const alpha = [...lanes.keys()].find((id) => id.includes("alpha")) ?? "";
					const beta = [...lanes.keys()].find((id) => id.includes("beta")) ?? "";
					return (
						lanes.get(seed.id) === "completed" &&
						alpha !== "" &&
						beta !== "" &&
						lanes.get(alpha) === "review" &&
						lanes.get(beta) === "review"
					);
				},
			});
			const lanes = poll.lanes;
			const alphaId = [...lanes.keys()].find((id) => id.includes("alpha")) ?? "";
			const betaId = [...lanes.keys()].find((id) => id.includes("beta")) ?? "";

			// The decomposition applied: both generated cards exist.
			const debugLog = ((globalThis as { __detSwarmLog?: string[] }).__detSwarmLog ?? []).slice(-25).join("\n");
			expect(
				alphaId,
				`${poll.outcome}: ${poll.detail}\nmock requests: ${mock.requests.length}\nserver log tail:\n${debugLog}`,
			).not.toBe("");
			expect(betaId).not.toBe("");
			// The seed completed via the decomposition-apply path.
			expect(lanes.get(seed.id)).toBe("completed");
			// THE INVARIANT (W0.1 + W4.2a): a no-op worker is re-driven, then HELD in review — never completed.
			expect(lanes.get(alphaId)).toBe("review");
			expect(lanes.get(betaId)).toBe("review");
			// And the mock actually served multi-turn traffic (decompose + worker turns + re-drives). The board can
			// reach the HOLD shape while a re-drive turn is still completing against the mock, so WAIT for the
			// traffic instead of sampling it (raced ~1 in 3 runs: 3 requests observed at the instant of HOLD).
			await vi.waitFor(() => expect(mock.requests.length).toBeGreaterThanOrEqual(4), { timeout: 20_000 });
		},
		TEST_TIMEOUT_MS,
	);
});
