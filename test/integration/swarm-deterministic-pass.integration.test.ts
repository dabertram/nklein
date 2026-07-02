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

describe.sequential("deterministic swarm harness — the PASS path (W2.1 v2)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-pass-model" });
		cwd = mkdtempSync(join(tmpdir(), "nklein-detpass-cwd-"));
		homeDir = mkdtempSync(join(tmpdir(), "nklein-detpass-home-"));
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir, extraEnv: { NODE_ENV: "development" } });
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		await server?.stop().catch(() => null);
		await mock?.close().catch(() => null);
		rmSync(cwd, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
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
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				if (tools.includes("decompose_project")) {
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
									defaultAcceptanceCommand: "npm test",
									tasks: [{ id: "gamma", title: "Card gamma", prompt: "Do gamma." }],
								},
							},
						],
					};
				}
				if (tools.includes("submit_review")) {
					return {
						toolCalls: [
							{
								name: "submit_review",
								arguments: {
									verdict: "approve",
									summary: "The additive change is correct and matches the task.",
									feedback: null,
									insight: null,
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

			// THE PASS INVARIANT: the delivering card auto-completed through the FULL evidence chain — real review
			// sign-off + fresh acceptance pass + merge (run17's live PASS, now deterministic).
			expect(
				gammaId,
				`lanes: ${JSON.stringify([...lanes.entries()])} (mock requests: ${mock.requests.length})`,
			).not.toBe("");
			expect(lanes.get(seed.id)).toBe("completed");
			expect(lanes.get(gammaId)).toBe("completed");
		},
		TEST_TIMEOUT_MS,
	);
});
