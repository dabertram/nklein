/**
 * W2.1 v2 (audit 2026-07-02) — the deterministic PASS path: scripted workers that actually DELIVER. Complements the
 * v1 hold-path suite (swarm-deterministic.integration.test.ts) so both sides of the fail-closed gate are pinned:
 * v1 = a no-op worker is re-driven then HELD; v2 = a delivering worker flows decompose → write → capture → review
 * approval → fresh acceptance pass → MERGE → completed, i.e. run17's live PASS reproduced deterministically.
 *
 * Uses the mock's CONTENT-AWARE router (not FIFO): concurrent sessions (workers, reviewers, knowledge turns)
 * interleave nondeterministically, so replies are routed by what each request carries — the decompose tool, the
 * submit_review tool, or a worker prompt that hasn't written yet.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BackendUnderTest } from "../contract/helpers/index.js";
import { initGitRepository, requestJson, startTsBackend } from "../contract/helpers/index.js";
import { type MockLlmServer, startMockLlm } from "../contract/helpers/mock-llm";
import { pollSwarmBoardUntil } from "../contract/helpers/swarm-poll";

const TEST_TIMEOUT_MS = 300_000;

describe.sequential("deterministic swarm harness — the PASS path (W2.1 v2)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";

	let passed = false;
	const serverLogLines: string[] = [];

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-pass-model" });
		cwd = realpathSync(mkdtempSync(join(tmpdir(), "nklein-detpass-cwd-")));
		homeDir = realpathSync(mkdtempSync(join(tmpdir(), "nklein-detpass-home-")));
		initGitRepository(cwd);
		server = await startTsBackend({
			cwd,
			homeDir,
			extraEnv: { NODE_ENV: "development" },
			onLog: (chunk) => {
				for (const line of chunk.split("\n")) {
					if (
						/decompos|error|warn|fail|sandbox|session|start|queue|review|delivery|acceptance|suitab|cascade|defer/i.test(
							line,
						) &&
						line.trim()
					) {
						serverLogLines.push(line.trim().slice(0, 240));
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
			// Preserve the evidence on failure — the server log tail names the seam that stalled.
			console.error(`[detpass] FAILURE — home preserved at ${homeDir}, cwd at ${cwd}`);
			console.error(`[detpass] server log tail:\n${serverLogLines.slice(-60).join("\n")}`);
		}
	});

	it(
		"a delivering worker flows write → capture → review approval → acceptance → completed (run17's PASS, deterministically)",
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
			// ONE worker card keeps the scenario tight; `npm test` passes on the untouched fixture, so a harmless
			// new file keeps acceptance green at the delivery seam.
			const wroteForTask = new Set<string>();
			let decomposed = false;
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				// Serve the decomposition exactly ONCE: worker sessions also carry the decompose tool, so an
				// unconditional match turned the WORKER into a decomposer looping idempotent re-applies forever
				// (holding the endpoint slot — the exact interleave that exposed the drain's lost-wakeup bug).
				if (!decomposed && tools.includes("decompose_project")) {
					decomposed = true;
					return {
						toolCalls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "det-pass",
									title: "Deterministic PASS scenario",
									spec: "One tiny additive change.",
									plan: "One card.",
									summary: "One card.",
									// Dependency-free on purpose: the fresh ::acceptance sandbox clone has no
									// node_modules, so `npm test` can never pass there — the gate itself is what
									// this scenario pins, not the fixture's test suite.
									defaultAcceptanceCommand: 'node -e "process.exit(0)"',
									tasks: [{ id: "gamma", title: "Card gamma", prompt: "Do gamma." }],
								},
							},
						],
					};
				}
				// One verdict per review session (see the bounce scenario): a repeated approve call would ride the
				// identical-call guard instead of ending the turn cleanly.
				if (tools.includes("submit_review") && !messages.includes("Review submitted")) {
					return {
						toolCalls: [
							{
								name: "submit_review",
								arguments: {
									verdict: "approve",
									summary: "The additive change is correct and matches the task.",
								},
							},
						],
					};
				}
				if (messages.includes("Do gamma") && !wroteForTask.has("gamma") && tools.includes("write_file")) {
					wroteForTask.add("gamma");
					return {
						toolCalls: [
							{
								name: "write_file",
								arguments: { path: "notes/gamma.md", content: "# gamma\n\nDelivered by the mock worker.\n" },
							},
						],
					};
				}
				return undefined; // → the "Done." default ends the turn
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
			if (!seed) {
				throw new Error("no seed card");
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

			// Early-exit poller: instant on success; a parked card or a dead swarm fails in seconds, not minutes.
			const poll = await pollSwarmBoardUntil({
				baseUrl: server.baseUrl,
				workspaceId,
				deadlineMs: Date.now() + TEST_TIMEOUT_MS - 30_000,
				failOnParked: true,
				isTarget: (lanes) => {
					const gamma = [...lanes.keys()].find((id) => id.includes("gamma")) ?? "";
					return Boolean(gamma) && lanes.get(gamma) === "completed" && lanes.get(seed.id) === "completed";
				},
			});
			const lanes = poll.lanes;
			const gammaId = [...lanes.keys()].find((id) => id.includes("gamma")) ?? "";

			// THE PASS INVARIANT: the delivering card auto-completed through the FULL evidence chain — real review
			// sign-off + fresh acceptance pass + merge (run17's live PASS, now deterministic).
			expect(gammaId, `${poll.outcome}: ${poll.detail} (mock requests: ${mock.requests.length})`).not.toBe("");
			expect(lanes.get(seed.id), `${poll.outcome}: ${poll.detail}`).toBe("completed");
			expect(lanes.get(gammaId), `${poll.outcome}: ${poll.detail}`).toBe("completed");
			passed = true;
		},
		TEST_TIMEOUT_MS,
	);
});
