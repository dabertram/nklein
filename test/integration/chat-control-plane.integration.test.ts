/**
 * F2.30 (b) — chat-as-control-plane UI/UX e2e (David directive 2026-09-02: "add ui ux tests that use the chat ..
 * use ai mock for this .. make sure the user can control everything of nklein directly from chat").
 *
 * A REAL spawned backend + the mock LLM as the chat's local model: a plain chat message makes the (mocked) model
 * call `nklein_control`, and the test asserts the REAL effect — the board actually changes — plus the UX half:
 * the tool result flows back into the model's context and the final assistant reply lands in the transcript.
 * This pins the whole chain: chat tRPC → agent-tool resolver (can-act scope) → nklein_control registry →
 * runtime executors → workspace state.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BackendUnderTest } from "../contract/helpers/index.js";
import { initGitRepository, requestJson, startTsBackend } from "../contract/helpers/index.js";
import { type MockLlmServer, startMockLlm } from "../contract/helpers/mock-llm";

const TEST_TIMEOUT_MS = 120_000;

describe.sequential("chat control plane (F2.30 e2e)", () => {
	let mock: MockLlmServer;
	let server: BackendUnderTest | null = null;
	let cwd = "";
	let homeDir = "";
	let workspaceId = "";
	let seedTaskId = "";
	let passed = false;

	beforeAll(async () => {
		mock = await startMockLlm({ modelId: "mock-chat-control" });
		cwd = realpathSync(mkdtempSync(join(tmpdir(), "nklein-chatctl-cwd-")));
		homeDir = realpathSync(mkdtempSync(join(tmpdir(), "nklein-chatctl-home-")));
		initGitRepository(cwd);
		server = await startTsBackend({ cwd, homeDir, extraEnv: { NODE_ENV: "development" } });

		// The chat resolves its endpoint from the SELECTED local provider (contract Suite 5C recipe): a custom
		// provider pointing at the mock has no live-only "model loaded" validation.
		await requestJson({
			baseUrl: server.baseUrl,
			procedure: "runtime.addNKleinProvider",
			type: "mutation",
			payload: {
				providerId: "mock-local",
				name: "Mock Local",
				baseUrl: `${mock.baseUrl}/v1`,
				models: [mock.modelId],
				defaultModelId: mock.modelId,
			},
		});

		// An ACTIVE project with a seeded card — the control target.
		const createRes = await requestJson<{
			ok: boolean;
			project: { id: string } | null;
			task: { id: string } | null;
		}>({
			baseUrl: server.baseUrl,
			procedure: "projects.createDevTestProject",
			type: "mutation",
			payload: { preset: "mid_task" },
		});
		expect(createRes.payload.ok).toBe(true);
		workspaceId = createRes.payload.project?.id ?? "";
		seedTaskId = createRes.payload.task?.id ?? "";
		expect(workspaceId).toBeTruthy();
		expect(seedTaskId).toBeTruthy();
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		await server?.stop().catch(() => null);
		await mock?.close().catch(() => null);
		if (passed) {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		} else {
			console.error(`[chat-control] FAILURE — home preserved at ${homeDir}, cwd at ${cwd}`);
		}
	});

	async function createCanActSession(title: string): Promise<string> {
		if (!server) {
			throw new Error("backend missing");
		}
		const created = await requestJson<{ session: { id: string } | null }>({
			baseUrl: server.baseUrl,
			procedure: "chat.createSession",
			type: "mutation",
			payload: { title, scope: "all_projects" },
		});
		const sessionId = created.payload.session?.id ?? "";
		expect(sessionId).toBeTruthy();
		return sessionId;
	}

	async function boardLaneOf(taskId: string): Promise<string | null> {
		if (!server) {
			throw new Error("backend missing");
		}
		const state = await requestJson<{
			board?: { columns?: Array<{ id: string; cards: Array<{ id: string }> }> };
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId,
		});
		for (const column of state.payload.board?.columns ?? []) {
			if (column.cards.some((card) => card.id === taskId)) {
				return column.id;
			}
		}
		return null;
	}

	it(
		"a chat message moves a real card to trash through nklein_control (and the reply lands in the transcript)",
		async () => {
			if (!server) {
				throw new Error("backend missing");
			}
			const sessionId = await createCanActSession("control: move to trash");
			expect(await boardLaneOf(seedTaskId)).not.toBe("trash");

			let controlOffered = false;
			let toolResultSeen = "";
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				// The FINAL-answer re-call runs tools-DISABLED (hybrid streaming), so this branch must gate on the
				// tool-result content alone: `Tool result (<callId>):\n<content>` arrives as a system message.
				if (messages.includes(`Moved [${seedTaskId}]`)) {
					toolResultSeen = "yes";
					return { content: `Done — I moved ${seedTaskId} to the trash lane for you.` };
				}
				if (tools.includes("nklein_control") && messages.includes("please trash the seed card")) {
					controlOffered = true;
					return {
						toolCalls: [
							{
								name: "nklein_control",
								arguments: { action: "move_card", params: { taskId: seedTaskId, column: "trash" } },
							},
						],
					};
				}
				return undefined;
			});
			mock.setDefault({ content: "ok" });

			const sent = await requestJson<{ assistantMessage: { content: string } | null }>({
				baseUrl: server.baseUrl,
				procedure: "chat.sendMessage",
				type: "mutation",
				payload: { sessionId, message: `please trash the seed card ${seedTaskId}` },
			});
			expect(sent.status).toBe(200);
			expect(controlOffered, "the agent loop must offer nklein_control to a can-act chat scope").toBe(true);
			expect(toolResultSeen, "the move_card tool result must flow back into the model's context").toBe("yes");

			// The REAL effect: the card sits in the trash lane on the actual board.
			expect(await boardLaneOf(seedTaskId)).toBe("trash");

			// UX half: the final assistant reply is persisted in the transcript.
			const transcript = await requestJson<{ messages: Array<{ role: string; content: string }> }>({
				baseUrl: server.baseUrl,
				procedure: "chat.getTranscript",
				type: "query",
				payload: { sessionId },
			});
			const contents = transcript.payload.messages.map((message) => message.content).join("\n");
			expect(contents.toLowerCase()).toContain("moved");
			expect(contents).toContain("trash");
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"a status question routes through runtime_status and the reply reflects the live board",
		async () => {
			if (!server) {
				throw new Error("backend missing");
			}
			const sessionId = await createCanActSession("control: status");
			mock.setRouter((request) => {
				const tools = JSON.stringify(request.tools ?? "");
				const messages = JSON.stringify(request.messages ?? "");
				// Final-answer re-call is tools-disabled — gate on the tool-result content, not the tool list.
				if (messages.includes("Board lanes:")) {
					return { content: "Here is your board status — the seed card is in trash." };
				}
				if (tools.includes("nklein_control") && messages.includes("what is on the board")) {
					return { toolCalls: [{ name: "nklein_control", arguments: { action: "runtime_status" } }] };
				}
				return undefined;
			});
			mock.setDefault({ content: "ok" });

			const sent = await requestJson({
				baseUrl: server.baseUrl,
				procedure: "chat.sendMessage",
				type: "mutation",
				payload: { sessionId, message: "what is on the board right now?" },
			});
			expect(sent.status).toBe(200);

			const transcript = await requestJson<{ messages: Array<{ role: string; content: string }> }>({
				baseUrl: server.baseUrl,
				procedure: "chat.getTranscript",
				type: "query",
				payload: { sessionId },
			});
			const contents = transcript.payload.messages.map((message) => message.content).join("\n");
			expect(contents).toContain("board status");
			passed = true;
		},
		TEST_TIMEOUT_MS,
	);
});
