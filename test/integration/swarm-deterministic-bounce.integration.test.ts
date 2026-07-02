/**
 * W2.1 v3 (run20 live findings, 2026-07-02) — the BOUNCE → RE-WORK → APPROVE round-trip, deterministically.
 *
 * Pins the re-drive seam the fleet exposed live: `finalizeSandboxReview` disposes the worker's sandbox workspace
 * after capturing the result branch, and a review bounce re-drives the SAME session — before the fix, its tools
 * operated on a DELETED cwd (every read/write ENOENT'd), the worker flailed and the card parked. This scenario only
 * reaches `completed` if the re-driven worker can actually WRITE in a restored workspace:
 *
 *   1. decompose → one card (gamma),
 *   2. worker writes file #1 → capture → review REQUESTS CHANGES ("add gamma2"),
 *   3. the bounce re-drives the worker — the restored workspace must accept write #2,
 *   4. second capture → review APPROVES → fresh acceptance passes → merge → completed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BackendUnderTest } from "../contract/helpers/index.js";
import { initGitRepository, requestJson, startTsBackend } from "../contract/helpers/index.js";
import { type MockLlmServer, startMockLlm } from "../contract/helpers/mock-llm";

const TEST_TIMEOUT_MS = 300_000;

interface BoardStateResponse {
	board?: { columns?: Array<{ id?: string; cards?: Array<{ id?: string }> }> };
}

function lanesById(state: BoardStateResponse): Map<string, string> {
	const lanes = new Map<string, string>();
	for (const column of state.board?.columns ?? []) {
		for (const card of column.cards ?? []) {
			if (card.id && column.id) {
				lanes.set(card.id, column.id);
			}
		}
	}
	return lanes;
}

describe.sequential("deterministic swarm harness — bounce → re-work → approve (W2.1 v3)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";
	let passed = false;
	const serverLogLines: string[] = [];

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-bounce-model" });
		cwd = mkdtempSync(join(tmpdir(), "nklein-detbounce-cwd-"));
		homeDir = mkdtempSync(join(tmpdir(), "nklein-detbounce-home-"));
		initGitRepository(cwd);
		server = await startTsBackend({
			cwd,
			homeDir,
			extraEnv: { NODE_ENV: "development" },
			onLog: (chunk) => {
				for (const line of chunk.split("\n")) {
					if (
						/decompos|error|warn|fail|sandbox|session|start|queue|review|delivery|acceptance|restore|redrive/i.test(
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
			console.error(`[detbounce] FAILURE — home preserved at ${homeDir}, cwd at ${cwd}`);
			console.error(`[detbounce] server log tail:\n${serverLogLines.slice(-60).join("\n")}`);
		}
	});

	it(
		"a bounced worker re-works in a RESTORED workspace and the second round approves to completed",
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

			let decomposed = false;
			let reviewCalls = 0;
			let wroteFirst = false;
			let wroteSecond = false;
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				if (!decomposed && tools.includes("decompose_project")) {
					decomposed = true;
					return {
						toolCalls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "det-bounce",
									title: "Deterministic bounce scenario",
									spec: "Two tiny additive changes, delivered across a review bounce.",
									plan: "One card, two rounds.",
									summary: "One card.",
									// Dependency-free: the ::acceptance clone has no node_modules; the GATE is the pin.
									defaultAcceptanceCommand: 'node -e "process.exit(0)"',
									tasks: [{ id: "gamma", title: "Card gamma", prompt: "Do gamma." }],
								},
							},
						],
					};
				}
				// One verdict per review session: after a successful submission the session transcript carries the
				// tool result ("Review submitted…") — serving another call would trip the identical-call guard and
				// let a later flip-flopped verdict win (the first version of this test approved without a bounce).
				if (tools.includes("submit_review") && !messages.includes("Review submitted")) {
					reviewCalls += 1;
					if (reviewCalls === 1) {
						return {
							toolCalls: [
								{
									name: "submit_review",
									arguments: {
										verdict: "request_changes",
										summary: "First pass is close but incomplete.",
										feedback: "Also add notes/gamma2.md with a short summary.",
									},
								},
							],
						};
					}
					return {
						toolCalls: [
							{
								name: "submit_review",
								arguments: {
									verdict: "approve",
									summary: "Both notes are present; the change matches the task.",
								},
							},
						],
					};
				}
				// The RE-DRIVE turn carries the reviewer feedback — this write only works if the disposed
				// workspace was restored before the turn (the run20 fix this scenario exists to pin).
				if (!wroteSecond && tools.includes("write_file") && messages.includes("gamma2")) {
					wroteSecond = true;
					return {
						toolCalls: [
							{
								name: "write_file",
								arguments: { path: "notes/gamma2.md", content: "# gamma2\n\nRe-work after the bounce.\n" },
							},
						],
					};
				}
				if (!wroteFirst && tools.includes("write_file") && messages.includes("Do gamma")) {
					wroteFirst = true;
					return {
						toolCalls: [
							{
								name: "write_file",
								arguments: { path: "notes/gamma.md", content: "# gamma\n\nFirst delivery.\n" },
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

			const deadline = Date.now() + TEST_TIMEOUT_MS - 30_000;
			let lanes = new Map<string, string>();
			let gammaId = "";
			while (Date.now() < deadline) {
				const stateRes = await requestJson<BoardStateResponse>({
					baseUrl: server.baseUrl,
					procedure: "workspace.getState",
					type: "query",
					workspaceId,
				});
				lanes = lanesById(stateRes.payload);
				gammaId = [...lanes.keys()].find((id) => id.includes("gamma")) ?? "";
				if (gammaId && lanes.get(gammaId) === "completed" && lanes.get(seed.id) === "completed") {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 3_000));
			}

			// THE ROUND-TRIP INVARIANT: the bounced card came back through a second review and completed —
			// which requires the re-driven worker to have WRITTEN in a restored workspace (round 2's approval
			// is only reachable after write #2 landed and was re-captured).
			const detail = `lanes: ${JSON.stringify([...lanes.entries()])} | reviews=${reviewCalls} wrote1=${wroteFirst} wrote2=${wroteSecond}`;
			expect(gammaId, detail).not.toBe("");
			expect(lanes.get(seed.id), detail).toBe("completed");
			expect(lanes.get(gammaId), detail).toBe("completed");
			expect(reviewCalls, detail).toBeGreaterThanOrEqual(2);
			expect(wroteSecond, detail).toBe(true);
			passed = true;
		},
		TEST_TIMEOUT_MS,
	);
});
