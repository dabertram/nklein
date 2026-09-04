import { describe, expect, it } from "vitest";
import { buildNKleinControlRegistry, type NKleinControlDeps } from "../../../src/chat/chat-control-interface";
import { buildNKleinControlMcpServer, createHttpNKleinControlDeps } from "../../../src/mcp/nklein-control-mcp";

function fakeDeps(): NKleinControlDeps {
	return {
		loadBoard: async () => ({ columns: [{ id: "backlog", title: "Backlog", cards: [] }] }) as never,
		moveCard: async () => ({ title: "T" }),
		startCard: async () => ({ ok: true }),
		stopCard: async () => true,
		pauseCard: async () => true,
		resumeCard: async () => true,
		listSessions: async () => [],
		setMaxConcurrentTasks: async () => true,
		requestRedecompose: async () => ({ filed: [], skipped: [] }),
	};
}

describe("nklein-control MCP server (F2.30 c)", () => {
	it("registers exactly one MCP tool per registry action (drift-proof by construction)", async () => {
		const server = buildNKleinControlMcpServer(fakeDeps());
		// The SDK's McpServer keeps registered tools internally; use the server's declared registry to compare.
		const registered = Object.keys(
			(server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
		).sort();
		expect(registered).toEqual(
			buildNKleinControlRegistry()
				.map((action) => action.name)
				.sort(),
		);
	});

	it("refuses a non-loopback base URL (local-only invariant)", () => {
		expect(() => createHttpNKleinControlDeps({ baseUrl: "http://example.com:3000", workspaceId: "ws" })).toThrow(
			/loopback/i,
		);
		expect(() => createHttpNKleinControlDeps({ baseUrl: "http://127.0.0.1:3502", workspaceId: "ws" })).not.toThrow();
	});

	it("http deps: stopCard posts the tRPC procedure and reads ok", async () => {
		const calls: Array<{ url: string; body: string }> = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), body: String(init?.body ?? "") });
			return new Response(JSON.stringify({ result: { data: { ok: true } } }), { status: 200 });
		}) as typeof fetch;
		const deps = createHttpNKleinControlDeps({ baseUrl: "http://127.0.0.1:3502", workspaceId: "ws", fetchImpl });
		expect(await deps.stopCard("card-1")).toBe(true);
		expect(calls[0]?.url).toContain("/api/trpc/runtime.stopTaskSession?workspaceId=ws");
		expect(calls[0]?.body).toContain('"card-1"');
	});
});
