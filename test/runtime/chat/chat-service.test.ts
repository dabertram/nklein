import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatAgentModelResponse } from "../../../src/chat/chat-agent-loop";
import { createChatService } from "../../../src/chat/chat-service";
import { getChatSession } from "../../../src/chat/chat-session-store";
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

	it("bug-hunt #3 (2026-07-05): concurrent sendMessage calls on the SAME session don't interleave the transcript", async () => {
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let callIndex = 0;
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({
				complete: async () => {
					callIndex += 1;
					if (callIndex === 1) {
						await firstGate; // held open until we explicitly release it below
						return "first reply";
					}
					return "second reply";
				},
				summarize: async () => "",
			}),
		});
		const session = await service.createSession({ title: "Race" });

		const p1 = service.sendMessage({ sessionId: session.id, message: "one" });
		const p2 = service.sendMessage({ sessionId: session.id, message: "two" });
		// Give call 2's fast (unblocked) model reply a chance to race ahead before call 1 is released.
		await new Promise((resolve) => setTimeout(resolve, 10));
		releaseFirst();
		await Promise.all([p1, p2]);

		const transcript = await service.readTranscript(session.id);
		// Without serialization, call 2 (unblocked) would write its user+assistant pair WHILE call 1 sat blocked,
		// interleaving to [user:one, user:two, assistant:second, assistant:first]. Serialized per session, call 2
		// cannot even START until call 1's whole turn (including its blocked model call) finishes.
		expect(transcript.map((m) => `${m.role}:${m.content}`)).toEqual([
			"user:one",
			"assistant:first reply",
			"user:two",
			"assistant:second reply",
		]);
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

	it("§5.AU: resolves an @card handle — target note leads the turn, focus persists, targetLabel returns", async () => {
		const seen: string[][] = [];
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({ complete: async () => "unused", summarize: async () => "" }),
			resolveAgentToolDeps: async () => ({
				model: async (messages) => {
					seen.push(messages.map((m) => `${m.role}:${m.content}`));
					return { text: "Prioritized.", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "" }),
				appendToolExchange: (messages) => [...messages],
			}),
			resolveMessageTargetIndex: async () => ({
				cards: [{ id: "card-1", title: "Fix parser", streamId: "stream-alpha" }],
				streams: [{ id: "stream-alpha", title: "Alpha" }],
			}),
		});
		const session = await service.createSession({ title: "Targeting", scope: "chat_only" });

		// No focus + no handle = the goal default: no note in the prompt (byte-identical to before — §5.AQ), no label.
		const goalRouted = await service.sendMessage({ sessionId: session.id, message: "hello there" });
		expect(goalRouted?.targetLabel).toBeUndefined();
		expect((seen[0] ?? []).some((m) => m.includes("addresses") || m.includes("focused on"))).toBe(false);

		const result = await service.sendMessage({ sessionId: session.id, message: "@card:card-1 prioritize this" });
		expect(result?.targetLabel).toBe("card Fix parser");
		const firstTurn = seen[1] ?? [];
		expect(firstTurn[0]).toMatch(/^system:This message addresses board card "card Fix parser" \(id: card-1\)/);
		// The explicit handle persisted as the session's addressing focus (§5.AU rung 3 for later turns).
		const stored = await getChatSession(session.id, { rootDir: join(rootDir, "sessions") });
		expect(stored?.focus).toMatchObject({ kind: "card", id: "card-1" });

		// The NEXT message binds via the persisted focus (rung 3 — sticky "talking to X"): still labeled, but the
		// note softens to context ("currently focused on") instead of the explicit directive.
		const followUp = await service.sendMessage({ sessionId: session.id, message: "how is it going?" });
		expect(followUp?.targetLabel).toBe("card Fix parser");
		const secondTurn = seen[2] ?? [];
		expect(secondTurn[0]).toMatch(/^system:The conversation is currently focused on board card/);
		expect(secondTurn.some((m) => m.includes("This message addresses"))).toBe(false);

		// The wire session exposes the focus (drives the "talking to X" chip) and clearFocus drops it (the chip's ✕).
		expect((await service.getSession(session.id))?.focus).toMatchObject({ kind: "card", id: "card-1" });
		await service.updateSession({ id: session.id, clearFocus: true });
		expect((await service.getSession(session.id))?.focus).toBeNull();
		const backToGoal = await service.sendMessage({ sessionId: session.id, message: "carry on" });
		expect(backToGoal?.targetLabel).toBeUndefined();
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

	it("§5.AF: records a chat-flow ledger attempt after a tool-using turn (modelId + tool names + iteration flag)", async () => {
		const recorded: Array<{ modelId: string; toolNames: readonly string[]; hitIterationLimit: boolean }> = [];
		let turn = 0;
		const service = createChatService({
			rootDir,
			resolveModelDeps: async () => ({
				complete: async () => "x",
				summarize: async () => "",
				modelId: "qwen/qwen3-8b",
			}),
			recordChatAttempt: (input) =>
				recorded.push({
					modelId: input.modelId,
					toolNames: input.toolNames,
					hitIterationLimit: input.hitIterationLimit,
				}),
			resolveAgentToolDeps: async () => ({
				model: async (_messages, _allow) =>
					(turn++ === 0
						? { text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "x" } }] }
						: { text: "done", toolCalls: [] }) as never,
				executeTool: async (call) => ({ callId: call.id, content: "ok" }),
				appendToolExchange: (messages, _r, results) => [
					...messages,
					...results.map((r) => ({ role: "system" as const, content: r.content })),
				],
			}),
		});
		const session = await service.createSession({ title: "Ledger", scope: "chat_only" });
		await service.sendMessage({ sessionId: session.id, message: "read x" });
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.modelId).toBe("qwen/qwen3-8b");
		expect(recorded[0]?.toolNames).toEqual(["read_file"]);
		expect(recorded[0]?.hitIterationLimit).toBe(false);
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
