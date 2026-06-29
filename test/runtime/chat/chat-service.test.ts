import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatAgentModelResponse } from "../../../src/chat/chat-agent-loop";
import { createChatService } from "../../../src/chat/chat-service";
import { appendChatMessage } from "../../../src/chat/chat-transcript-store";

describe("createChatService", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-chat-service-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("creates, lists (newest-updated first), gets, updates, and deletes sessions", async () => {
		let clock = 1_000;
		const service = createChatService({ rootDir, now: () => (clock += 1_000) });

		const first = await service.createSession({ title: "First", goal: "ship it" });
		const second = await service.createSession({ title: "Second", scope: "all_projects", role: "reviewer" });

		expect(first.goal).toBe("ship it");
		expect(second.scope).toBe("all_projects");
		expect(second.role).toBe("reviewer");
		// The wire shape carries no schemaVersion.
		expect(first).not.toHaveProperty("schemaVersion");

		const listed = await service.listSessions();
		expect(listed.map((s) => s.title)).toEqual(["Second", "First"]);

		const updated = await service.updateSession({ id: first.id, title: "First (edited)", goal: null });
		expect(updated?.title).toBe("First (edited)");
		expect(updated?.goal).toBeNull();
		expect(updated?.updatedAt).toBeGreaterThan(first.updatedAt);

		// First is now the most-recently-updated → sorts to the top.
		const relisted = await service.listSessions();
		expect(relisted.map((s) => s.title)).toEqual(["First (edited)", "Second"]);

		expect(await service.getSession(second.id)).toMatchObject({ id: second.id, title: "Second" });
		expect(await service.deleteSession(second.id)).toBe(true);
		expect(await service.getSession(second.id)).toBeNull();
		expect(await service.deleteSession("missing")).toBe(false);
	});

	it("reads a session's transcript (mapped to the wire shape, newest-N when limited)", async () => {
		const service = createChatService({ rootDir });
		const session = await service.createSession({ title: "Chat" });
		const transcriptRoot = { rootDir: join(rootDir, "transcripts") };

		await appendChatMessage(session.id, { role: "user", content: "hello" }, transcriptRoot);
		await appendChatMessage(session.id, { role: "assistant", content: "hi there" }, transcriptRoot);

		const all = await service.readTranscript(session.id);
		expect(all.map((m) => ({ role: m.role, content: m.content }))).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]);
		expect(all[0]).not.toHaveProperty("schemaVersion");

		const lastOnly = await service.readTranscript(session.id, 1);
		expect(lastOnly).toHaveLength(1);
		expect(lastOnly[0]?.content).toBe("hi there");
	});

	it("returns an empty transcript for a session with no messages", async () => {
		const service = createChatService({ rootDir });
		const session = await service.createSession({ title: "Quiet" });
		expect(await service.readTranscript(session.id)).toEqual([]);
	});

	it("runs a turn via sendMessage, persisting both messages, and reflects the session goal in the prompt", async () => {
		const prompts: Array<{ role: string; content: string }[]> = [];
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({
				complete: async (prompt) => {
					prompts.push(prompt.map((m) => ({ role: m.role, content: m.content })));
					return "Use strict mode and tabs.";
				},
				summarize: async () => "",
			}),
		});
		const session = await service.createSession({ title: "Help", goal: "Help with TypeScript settings" });

		const result = await service.sendMessage({ sessionId: session.id, message: "What settings?" });
		expect(result?.userMessage.content).toBe("What settings?");
		expect(result?.assistantMessage.content).toBe("Use strict mode and tabs.");

		const transcript = await service.readTranscript(session.id);
		expect(transcript.map((m) => m.role)).toEqual(["user", "assistant"]);
		// The session goal is anchored into the model prompt.
		expect(prompts[0]?.some((m) => m.content.includes("Help with TypeScript settings"))).toBe(true);
	});

	it("routes through the tool-using agent loop when resolveAgentToolDeps is non-null (todo §5.M G3a)", async () => {
		const executed: string[] = [];
		let turn = 0;
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "The README documents the project.", toolCalls: [] },
		];
		const service = createChatService({
			rootDir,
			// summarize comes from the plain model deps even on the tool path.
			resolveModelDeps: async () => ({ complete: async () => "unused", summarize: async () => "" }),
			resolveAgentToolDeps: async () => ({
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => {
					executed.push(call.name);
					return { callId: call.id, content: "# Project" };
				},
				appendToolExchange: (messages, _response, results) => [
					...messages,
					...results.map((result) => ({ role: "system" as const, content: result.content })),
				],
			}),
		});
		const session = await service.createSession({ title: "Tooling", scope: "chat_only" });

		const result = await service.sendMessage({ sessionId: session.id, message: "what's in the readme?" });
		// The tool ran (proving the tool-using loop, not plain completion) and the final answer persisted.
		expect(executed).toEqual(["read_file"]);
		expect(result?.assistantMessage.content).toBe("The README documents the project.");
		const transcript = await service.readTranscript(session.id);
		expect(transcript.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	it("§5.AL gate: refuses a catalog-`reject` model on the tool-using path (modelId known)", async () => {
		const service = createChatService({
			rootDir,
			// A reasoning-only model id (TOOL_UNSUITABLE) supplied on the model deps + tools in play → reject.
			resolveModelDeps: async () => ({
				complete: async () => "unused",
				summarize: async () => "",
				modelId: "microsoft/phi-4-mini-reasoning",
			}),
			resolveAgentToolDeps: async () => ({
				model: async () => ({ text: "should not run", toolCalls: [] }),
				executeTool: async (call) => ({ callId: call.id, content: "" }),
				appendToolExchange: (messages) => [...messages],
			}),
		});
		const session = await service.createSession({ title: "Gate", scope: "chat_only" });
		await expect(service.sendMessage({ sessionId: session.id, message: "do a thing" })).rejects.toThrow(
			/not suitable for the tool-using chat agent/i,
		);
	});

	it("§5.AL gate: a per-project policyBase (resolveModelGatePolicyBase) relaxes the chat reject to a warn-and-proceed", async () => {
		let ran = false;
		const service = createChatService({
			rootDir,
			// Same reasoning-only (TOOL_UNSUITABLE) model that the default policy rejects above…
			resolveModelDeps: async () => ({
				complete: async () => "unused",
				summarize: async () => "",
				modelId: "microsoft/phi-4-mini-reasoning",
			}),
			// …but the active project's policy loosens unsuitable→warn, so the turn proceeds (chat ↔ task-start parity).
			resolveModelGatePolicyBase: async () => ({ onUnsuitable: "warn", onUnknown: "warn" }),
			resolveAgentToolDeps: async () => ({
				model: async () => {
					ran = true;
					return { text: "ok", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "" }),
				appendToolExchange: (messages) => [...messages],
			}),
		});
		const session = await service.createSession({ title: "GatePolicy", scope: "chat_only" });
		const result = await service.sendMessage({ sessionId: session.id, message: "do a thing" });
		expect(ran).toBe(true);
		expect(result?.assistantMessage.content).toBe("ok");
		// §5.AG: the warn caveat is surfaced on the result so the web-ui can show it (the turn still ran).
		expect(result?.capabilityNotice).toMatch(/capability (warn|reject)/i);
	});

	it("§5.AL gate: a tool-capable model on the tool path proceeds (no false reject)", async () => {
		let ran = false;
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({
				complete: async () => "unused",
				summarize: async () => "",
				modelId: "qwen/qwen3-8b",
			}),
			resolveAgentToolDeps: async () => ({
				model: async () => {
					ran = true;
					return { text: "done", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "" }),
				appendToolExchange: (messages) => [...messages],
			}),
		});
		const session = await service.createSession({ title: "GateOk", scope: "chat_only" });
		const result = await service.sendMessage({ sessionId: session.id, message: "hi" });
		expect(ran).toBe(true);
		expect(result?.assistantMessage.content).toBe("done");
	});

	it("runs an autonomous session to completion when the agent declares the goal done (todo §5.0.1)", async () => {
		const executed: string[] = [];
		let modelCall = 0;
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({ complete: async () => "unused", summarize: async () => "" }),
			// The merged tool set arrives in `extra` (the runtime-api resolver does this live). Build an executor that
			// runs those control tools so a declare_goal_complete call fires the run-ending signal.
			resolveAgentToolDeps: async (_session, extra) => {
				const tools = extra?.tools ?? [];
				return {
					model: async () => {
						modelCall += 1;
						return modelCall === 1
							? {
									text: "",
									toolCalls: [
										{ id: "c1", name: "declare_goal_complete", arguments: { summary: "Shipped it." } },
									],
								}
							: { text: "all done", toolCalls: [] };
					},
					executeTool: async (call) => {
						executed.push(call.name);
						const tool = tools.find((candidate) => candidate.name === call.name);
						return { callId: call.id, content: tool ? await tool.run(call.arguments) : "unknown tool" };
					},
					appendToolExchange: (messages, _response, results) => [
						...messages,
						...results.map((result) => ({ role: "system" as const, content: result.content })),
					],
				};
			},
		});
		const session = await service.createSession({ title: "Auto", scope: "chat_only", goal: "ship the thing" });

		const result = await service.runAutonomous({
			sessionId: session.id,
			goal: "ship the thing",
			budget: { maxTurns: 3, maxWallTimeMs: 1_000_000, maxNoProgressTurns: 3 },
		});
		// The control tool ran (proving the merged tool set reached the executor) and the driver stopped on completion.
		expect(executed).toContain("declare_goal_complete");
		expect(result?.stopReason).toBe("completed");
		expect(result?.finalText).toBe("Shipped it.");
		expect(result?.turns).toBe(1);
	});

	it("returns null from runAutonomous when the session does not exist", async () => {
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({ complete: async () => "x", summarize: async () => "" }),
		});
		const result = await service.runAutonomous({
			sessionId: "missing",
			goal: "x",
			budget: { maxTurns: 1, maxWallTimeMs: 1_000, maxNoProgressTurns: 1 },
		});
		expect(result).toBeNull();
	});

	it("falls back to plain completion when resolveAgentToolDeps returns null (no active workspace)", async () => {
		let plainCalls = 0;
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({
				complete: async () => {
					plainCalls += 1;
					return "plain reply";
				},
				summarize: async () => "",
			}),
			// Mirrors "no active workspace ⇒ null" so the session stays on runChatTurn.
			resolveAgentToolDeps: async () => null,
		});
		const session = await service.createSession({ title: "Plain" });

		const result = await service.sendMessage({ sessionId: session.id, message: "hi" });
		expect(result?.assistantMessage.content).toBe("plain reply");
		expect(plainCalls).toBe(1);
	});

	it("streams the final (no-tool) reply through onToken on the tool path (hybrid streaming, §5.M G3a)", async () => {
		const reply = "streamed reply in chunks";
		const allowToolsSeen: boolean[] = [];
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({ complete: async () => "unused", summarize: async () => "" }),
			resolveAgentToolDeps: async () => ({
				// No tools requested ⇒ the loop re-issues a streaming, tools-disabled final call (onToken present).
				model: async (_messages, allowTools, onToken) => {
					allowToolsSeen.push(allowTools);
					if (onToken) {
						// Emit several deltas so the hybrid stream produces >= 2 tokens, like the live SSE client.
						for (const delta of [reply.slice(0, 8), reply.slice(8, 16), reply.slice(16)]) {
							onToken(delta);
						}
						return { text: reply, toolCalls: [] };
					}
					return { text: reply, toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "" }),
				appendToolExchange: (messages) => [...messages],
			}),
		});
		const session = await service.createSession({ title: "Streaming", scope: "chat_only" });

		const tokens: string[] = [];
		const result = await service.sendMessage({ sessionId: session.id, message: "say something" }, (delta) =>
			tokens.push(delta),
		);
		// The no-tool answer still streams multiple deltas that reconstruct the reply.
		expect(tokens.length).toBeGreaterThanOrEqual(2);
		expect(tokens.join("")).toBe(reply);
		expect(result?.assistantMessage.content).toBe(reply);
		// The discovery turn offered tools (true); the streamed final turn disabled them (false).
		expect(allowToolsSeen).toEqual([true, false]);
	});

	it("returns null from sendMessage for an unknown session and throws when read-only", async () => {
		const withModel = createChatService({
			rootDir,
			resolveModelDeps: async () => ({ complete: async () => "x", summarize: async () => "" }),
		});
		expect(await withModel.sendMessage({ sessionId: "nope", message: "hi" })).toBeNull();

		const readOnly = createChatService({ rootDir });
		const session = await readOnly.createSession({ title: "RO" });
		await expect(readOnly.sendMessage({ sessionId: session.id, message: "hi" })).rejects.toThrow(/read-only/);
	});
});
