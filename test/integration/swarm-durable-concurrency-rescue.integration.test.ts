/**
 * C3 (§5.AF) regression — the durable scheduler must RESCUE a card it leased that then hit the board's
 * `concurrency_limit`. Live-found 2026-07-04 on a real-model mid_task run that STALLED: the durable controller frees a
 * job's lease at `awaiting_review` (the agent is done — review/merge are downstream, per durable-run-reaction) and
 * immediately leases the next ready card. But the board's start gate counts `awaiting_review` cards as active
 * (task-concurrency-gate.isActiveProjectTaskSession), so the just-leased card is deferred with `concurrency_limit`.
 * The two legacy rescue sweeps that would restart it re-drove autoStartTaskIds WITHOUT the durable-guard bypass, so
 * under a durable run they no-op'd — the controller treated the held lease as "running" and only re-dispatched on the
 * 5-minute reclaim, long after any board makes progress. The fix (startRescueCandidates) retries the deferred set with
 * the guard bypassed.
 *
 * The reproduction is deterministic at **maxConcurrentTasks = 1**: with a single slot, EVERY card handoff hits the
 * defer (the previous card is `awaiting_review` — holding the slot — at the exact instant the controller leases the
 * next). Two independent cards therefore force one concurrency-defer that only the fix rescues. Without the fix the
 * second card strands in `planning` until the lease reclaim (far past this test's deadline) and the poll fails; with
 * the fix the 7s deferred-retry timer + terminal-completion sweep start it within seconds of the first card merging.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BackendUnderTest } from "../contract/helpers/index.js";
import { initGitRepository, requestJson, startTsBackend } from "../contract/helpers/index.js";
import { type MockLlmServer, startMockLlm } from "../contract/helpers/mock-llm";
import { pollSwarmBoardUntil } from "../contract/helpers/swarm-poll";

const TEST_TIMEOUT_MS = 240_000;

describe.sequential("durable scheduler concurrency-defer rescue (C3 §5.AF)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";

	let passed = false;
	const serverLogLines: string[] = [];

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-durable-model" });
		cwd = realpathSync(mkdtempSync(join(tmpdir(), "nklein-durresc-cwd-")));
		homeDir = realpathSync(mkdtempSync(join(tmpdir(), "nklein-durresc-home-")));
		initGitRepository(cwd);
		server = await startTsBackend({
			cwd,
			homeDir,
			// The durable scheduler owns starts under this flag — the exact regime the stall lived in.
			extraEnv: { NODE_ENV: "development", NKLEIN_DURABLE_SCHEDULER: "1" },
			onLog: (chunk) => {
				for (const line of chunk.split("\n")) {
					if (
						/decompos|error|warn|fail|concurrency|defer|lease|reclaim|durable|session|review|delivery|cascade/i.test(
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
			// Preserve the evidence on failure — the log tail names the seam (a deferred card never rescued).
			console.error(`[durresc] FAILURE — home preserved at ${homeDir}, cwd at ${cwd}`);
			console.error(`[durresc] server log tail:\n${serverLogLines.slice(-60).join("\n")}`);
		}
	});

	it(
		"a card the controller leased then concurrency-deferred is rescued (not stranded until reclaim)",
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
			// ONE slot: forces the concurrency-defer on the alpha→beta handoff (alpha is awaiting_review — counted
			// active — when the controller leases beta), which is the exact condition the fix must recover from.
			await requestJson({
				baseUrl: server.baseUrl,
				procedure: "runtime.saveConfig",
				type: "mutation",
				payload: { maxConcurrentTasks: 1 },
			});

			const wroteForTask = new Set<string>();
			let decomposed = false;
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				// Decompose exactly once (worker sessions also carry the decompose tool).
				if (!decomposed && tools.includes("decompose_project")) {
					decomposed = true;
					return {
						toolCalls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "dur-resc",
									title: "Durable concurrency-defer rescue",
									spec: "Two tiny independent additive changes.",
									plan: "Two independent cards.",
									summary: "Two independent cards.",
									// Dependency-free acceptance: the fresh ::acceptance sandbox clone has no node_modules,
									// so a real `npm test` could never pass there — this pins the scheduler, not the suite.
									defaultAcceptanceCommand: 'node -e "process.exit(0)"',
									// Two INDEPENDENT cards (no dependsOn) — both become ready at once, but cap=1 admits one
									// at a time, so the second is leased-then-deferred at the first's awaiting_review handoff.
									tasks: [
										{ id: "alpha", title: "Card alpha", prompt: "Do alpha." },
										{ id: "beta", title: "Card beta", prompt: "Do beta." },
									],
								},
							},
						],
					};
				}
				// One verdict per review session.
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
				// Per-card single write so each delivers a result branch and reaches awaiting_review.
				for (const card of ["alpha", "beta"] as const) {
					if (messages.includes(`Do ${card}`) && !wroteForTask.has(card) && tools.includes("write_file")) {
						wroteForTask.add(card);
						return {
							toolCalls: [
								{
									name: "write_file",
									arguments: {
										path: `notes/${card}.md`,
										content: `# ${card}\n\nDelivered by the mock worker.\n`,
									},
								},
							],
						};
					}
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

			// The rescue must land WELL under the 5-min lease reclaim: without the fix beta strands past this deadline.
			const poll = await pollSwarmBoardUntil({
				baseUrl: server.baseUrl,
				workspaceId,
				deadlineMs: Date.now() + TEST_TIMEOUT_MS - 40_000,
				failOnParked: true,
				isTarget: (lanes) => {
					const alpha = [...lanes.keys()].find((id) => id.includes("alpha")) ?? "";
					const beta = [...lanes.keys()].find((id) => id.includes("beta")) ?? "";
					return (
						Boolean(alpha) && Boolean(beta) && lanes.get(alpha) === "completed" && lanes.get(beta) === "completed"
					);
				},
			});
			const lanes = poll.lanes;
			const alphaId = [...lanes.keys()].find((id) => id.includes("alpha")) ?? "";
			const betaId = [...lanes.keys()].find((id) => id.includes("beta")) ?? "";

			// BOTH cards completed — the concurrency-deferred second card was rescued, not stranded.
			expect(alphaId, `${poll.outcome}: ${poll.detail} (mock requests: ${mock.requests.length})`).not.toBe("");
			expect(betaId, `${poll.outcome}: ${poll.detail}`).not.toBe("");
			expect(lanes.get(alphaId), `${poll.outcome}: ${poll.detail}`).toBe("completed");
			expect(lanes.get(betaId), `${poll.outcome}: ${poll.detail}`).toBe("completed");
			passed = true;
		},
		TEST_TIMEOUT_MS,
	);
});
