import {
	AgentSideConnection,
	ClientSideConnection,
	type SessionNotification,
	type Stream,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { acpPromptText, NKleinAcpAgent, type NKleinAcpPorts } from "../../../src/acp/nklein-acp-agent";

/**
 * P17.2 — protocol-level proof over an IN-PROCESS duplex (the SDK's own client talks to our agent, no stdio,
 * no runtime): initialize negotiates v1 with client fs/terminal never requested, session/new binds cwd via the
 * port, session/prompt streams session/update notifications and resolves with the port's stop reason, and
 * session/cancel aborts the in-flight turn while the prompt still RESOLVES (stopReason "cancelled").
 */
function duplexPair(): { agentStream: Stream; clientStream: Stream } {
	const clientToAgent = new TransformStream<unknown, unknown>();
	const agentToClient = new TransformStream<unknown, unknown>();
	return {
		agentStream: { writable: agentToClient.writable, readable: clientToAgent.readable } as unknown as Stream,
		clientStream: { writable: clientToAgent.writable, readable: agentToClient.readable } as unknown as Stream,
	};
}

function connect(ports: NKleinAcpPorts) {
	const { agentStream, clientStream } = duplexPair();
	const updates: SessionNotification[] = [];
	new AgentSideConnection((connection) => new NKleinAcpAgent(ports, connection, "0.0.1-test"), agentStream);
	const client = new ClientSideConnection(
		() => ({
			requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			sessionUpdate: async (params: SessionNotification) => {
				updates.push(params);
			},
		}),
		clientStream,
	);
	return { client, updates };
}

const basePorts = (overrides: Partial<NKleinAcpPorts> = {}): NKleinAcpPorts => ({
	ensureWorkspace: async () => "ws-acp",
	runPrompt: async () => "end_turn",
	randomUuid: () => "11111111-2222-3333-4444-555555555555",
	...overrides,
});

describe("NKleinAcpAgent over the SDK duplex", () => {
	it("initialize negotiates v1 and never requests client fs/terminal capabilities", async () => {
		const { client } = connect(basePorts());
		const response = await client.initialize({ protocolVersion: 1, clientCapabilities: {} });
		expect(response.protocolVersion).toBe(1);
		expect(response.agentInfo?.name).toBe("nklein");
		expect(response.agentCapabilities?.loadSession).toBe(false);
	});

	it("session/new binds the editor cwd through the workspace port", async () => {
		const seen: string[] = [];
		const { client } = connect(
			basePorts({
				ensureWorkspace: async (cwd) => {
					seen.push(cwd);
					return "ws-bound";
				},
			}),
		);
		await client.initialize({ protocolVersion: 1, clientCapabilities: {} });
		const session = await client.newSession({ cwd: "/repo/checkout", mcpServers: [] });
		expect(session.sessionId).toMatch(/^acp-/);
		expect(seen).toEqual(["/repo/checkout"]);
	});

	it("session/prompt streams updates and resolves with the port's stop reason", async () => {
		const { client, updates } = connect(
			basePorts({
				runPrompt: async ({ promptText, emitUpdate }) => {
					await emitUpdate({
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: `working on: ${promptText}` },
					});
					await emitUpdate({
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "done" },
					});
					return "end_turn";
				},
			}),
		);
		await client.initialize({ protocolVersion: 1, clientCapabilities: {} });
		const { sessionId } = await client.newSession({ cwd: "/repo", mcpServers: [] });
		const response = await client.prompt({
			sessionId,
			prompt: [{ type: "text", text: "add a README badge" }],
		});
		expect(response.stopReason).toBe("end_turn");
		expect(updates).toHaveLength(2);
		expect(updates[0]?.sessionId).toBe(sessionId);
		expect(JSON.stringify(updates[0]?.update)).toContain("add a README badge");
	});

	it("session/cancel aborts the in-flight turn and the prompt still RESOLVES with cancelled", async () => {
		const { client } = connect(
			basePorts({
				runPrompt: ({ signal }) =>
					new Promise((settle) => {
						signal.addEventListener("abort", () => settle("cancelled"), { once: true });
					}),
			}),
		);
		await client.initialize({ protocolVersion: 1, clientCapabilities: {} });
		const { sessionId } = await client.newSession({ cwd: "/repo", mcpServers: [] });
		const pending = client.prompt({ sessionId, prompt: [{ type: "text", text: "long job" }] });
		await new Promise((tick) => setTimeout(tick, 50));
		await client.cancel({ sessionId });
		const response = await pending;
		expect(response.stopReason).toBe("cancelled");
	});
});

describe("acpPromptText", () => {
	it("flattens text, resource links and embedded resources; names non-text block types", () => {
		expect(
			acpPromptText([
				{ type: "text", text: "fix the bug" },
				{ type: "resource_link", uri: "file:///a.ts", name: "a.ts" },
				{ type: "resource", resource: { uri: "file:///b.md", text: "inline body", mimeType: "text/markdown" } },
				{ type: "image", data: "…", mimeType: "image/png" },
			]),
		).toBe("fix the bug\n[resource: file:///a.ts]\ninline body\n[image]");
	});
});
