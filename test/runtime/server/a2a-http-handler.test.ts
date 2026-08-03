import { describe, expect, it } from "vitest";
import {
	A2A_RPC_PATH,
	type A2aHttpDeps,
	type A2aWorkspaceEntry,
	handleA2aHttpRequest,
} from "../../../src/server/a2a-http-handler";

/**
 * P17.8 — the A2A wire handler, every path driven through fake deps. The properties that matter: the JSON-RPC
 * contract is honest (parse/envelope/params/unknown-method errors carry the pinned codes), a created seed is
 * audited exactly once, idempotent re-sends are NOT re-audited, and known-but-unimplemented spec methods are
 * -32004, never -32601 (a client must be able to distinguish "this agent doesn't do that" from a typo).
 */

const WS: A2aWorkspaceEntry = { workspaceId: "ws-1", repoPath: "/tmp/ws-1" };

function deps(overrides: Partial<A2aHttpDeps> = {}): A2aHttpDeps & {
	seeded: { taskId: string; title: string; prompt: string }[];
	audits: { taskId: string; sourceMessageId: string }[];
} {
	const seeded: { taskId: string; title: string; prompt: string }[] = [];
	const audits: { taskId: string; sourceMessageId: string }[] = [];
	return {
		listWorkspaces: async () => [WS],
		readBoardRecord: async (_entry, taskId) =>
			seeded.some((card) => card.taskId === taskId) ? { columnId: "ready", title: "t" } : null,
		seedCard: async (_entry, seed) => {
			if (seeded.some((card) => card.taskId === seed.taskId)) {
				return "existing";
			}
			seeded.push(seed);
			return "created";
		},
		audit: async ({ taskId, sourceMessageId }) => {
			audits.push({ taskId, sourceMessageId });
		},
		nowIso: () => "2026-08-03T01:00:00.000Z",
		randomUuid: () => "fixed-uuid",
		productVersion: "0.0.1",
		rpcUrl: `http://127.0.0.1:3484${A2A_RPC_PATH}`,
		seeded,
		audits,
		...overrides,
	};
}

function rpc(method: string, params: unknown, id: string | number = 1): string {
	return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

const SEND_PARAMS = {
	message: {
		messageId: "m-1",
		role: "ROLE_USER",
		parts: [{ text: "Fix the flaky date test\nIt fails on TZ boundaries." }],
	},
};

async function post(d: A2aHttpDeps, body: string) {
	return await handleA2aHttpRequest(
		{ method: "POST", pathname: A2A_RPC_PATH, bodyText: body, workspaceIdParam: null },
		d,
	);
}

describe("handleA2aHttpRequest — routing", () => {
	it("serves the agent card on GET at the well-known path", async () => {
		const result = await handleA2aHttpRequest(
			{ method: "GET", pathname: "/.well-known/agent-card.json", bodyText: "", workspaceIdParam: null },
			deps(),
		);
		expect(result?.status).toBe(200);
		expect((result?.body as { name: string }).name).toBe("!Klein");
	});

	it("returns null for non-A2A paths so the caller falls through", async () => {
		expect(
			await handleA2aHttpRequest(
				{ method: "GET", pathname: "/api/other", bodyText: "", workspaceIdParam: null },
				deps(),
			),
		).toBeNull();
	});

	it("rejects non-POST on the RPC path with 405", async () => {
		const result = await handleA2aHttpRequest(
			{ method: "GET", pathname: A2A_RPC_PATH, bodyText: "", workspaceIdParam: null },
			deps(),
		);
		expect(result?.status).toBe(405);
	});
});

describe("handleA2aHttpRequest — JSON-RPC contract", () => {
	it("maps malformed JSON to -32700 with a null id", async () => {
		const result = await post(deps(), "{nope");
		const body = result?.body as { id: unknown; error: { code: number } };
		expect(body.error.code).toBe(-32700);
		expect(body.id).toBeNull();
	});

	it("maps a missing method/jsonrpc field to -32600, echoing the id", async () => {
		const result = await post(deps(), JSON.stringify({ jsonrpc: "2.0", id: 7 }));
		const body = result?.body as { id: unknown; error: { code: number } };
		expect(body.error.code).toBe(-32600);
		expect(body.id).toBe(7);
	});

	it("maps an unknown method to -32601 but a known-unimplemented one to -32004", async () => {
		const unknown = (await post(deps(), rpc("TotallyMadeUp", {})))?.body as { error: { code: number } };
		expect(unknown.error.code).toBe(-32601);
		const cancel = (await post(deps(), rpc("CancelTask", { id: "t" })))?.body as { error: { code: number } };
		expect(cancel.error.code).toBe(-32004);
	});

	it("maps an unknown workspaceId to -32602", async () => {
		const result = await handleA2aHttpRequest(
			{ method: "POST", pathname: A2A_RPC_PATH, bodyText: rpc("GetTask", { id: "t" }), workspaceIdParam: "nope" },
			deps(),
		);
		expect((result?.body as { error: { code: number } }).error.code).toBe(-32602);
	});
});

describe("handleA2aHttpRequest — SendMessage", () => {
	it("seeds a card, audits ONCE, and returns a SUBMITTED-family task view", async () => {
		const d = deps();
		const result = await post(d, rpc("SendMessage", SEND_PARAMS));
		const body = result?.body as { result: { task: { id: string; status: { state: string } } } };
		expect(d.seeded).toHaveLength(1);
		expect(d.seeded[0]?.title).toBe("Fix the flaky date test");
		expect(d.audits).toEqual([{ taskId: "a2a-fixed-uuid", sourceMessageId: "m-1" }]);
		expect(body.result.task.id).toBe("a2a-fixed-uuid");
		expect(body.result.task.status.state).toBe("TASK_STATE_SUBMITTED");
	});

	it("treats an inbound taskId as idempotency: second send seeds nothing and audits nothing", async () => {
		const d = deps();
		const withTask = {
			message: { ...SEND_PARAMS.message, taskId: "a2a-repeat" },
		};
		await post(d, rpc("SendMessage", withTask));
		await post(d, rpc("SendMessage", withTask, 2));
		expect(d.seeded).toHaveLength(1);
		expect(d.audits).toHaveLength(1);
	});

	it("refuses non-text parts with -32005 (contentTypeNotSupported), seeding nothing", async () => {
		const d = deps();
		const result = await post(
			d,
			rpc("SendMessage", { message: { messageId: "m", role: "ROLE_USER", parts: [{ raw: "aGk=" }] } }),
		);
		expect((result?.body as { error: { code: number } }).error.code).toBe(-32005);
		expect(d.seeded).toHaveLength(0);
	});

	it("rejects schema-invalid params with -32602", async () => {
		const result = await post(deps(), rpc("SendMessage", { message: { role: "ROLE_USER", parts: [] } }));
		expect((result?.body as { error: { code: number } }).error.code).toBe(-32602);
	});
});

describe("handleA2aHttpRequest — GetTask", () => {
	it("returns -32001 for a task the board does not know", async () => {
		const result = await post(deps(), rpc("GetTask", { id: "missing" }));
		expect((result?.body as { error: { code: number } }).error.code).toBe(-32001);
	});

	it("projects a known card's lane onto the TaskState enum", async () => {
		const d = deps();
		await post(d, rpc("SendMessage", SEND_PARAMS));
		const result = await post(d, rpc("GetTask", { id: "a2a-fixed-uuid" }, 3));
		const body = result?.body as { result: { id: string; status: { state: string; timestamp: string } } };
		expect(body.result.id).toBe("a2a-fixed-uuid");
		expect(body.result.status.state).toBe("TASK_STATE_SUBMITTED");
		expect(body.result.status.timestamp).toBe("2026-08-03T01:00:00.000Z");
	});
});

describe("handleA2aHttpRequest — status note surfacing (N23 residue)", () => {
	it("carries the actionable note as the task status message on GetTask", async () => {
		const d = deps({
			readStatusNote: async () => "No native !Klein provider is configured. Open Settings, choose a provider.",
		});
		await post(d, rpc("SendMessage", SEND_PARAMS));
		const result = await post(d, rpc("GetTask", { id: "a2a-fixed-uuid" }, 5));
		const body = result?.body as { result: { status: { message?: { parts: { text?: string }[] } } } };
		expect(body.result.status.message?.parts[0]?.text).toMatch(/No native !Klein provider/u);
	});

	it("omits the status message when the note reader is absent or errors", async () => {
		const erroring = deps({
			readStatusNote: async () => {
				throw new Error("telemetry unavailable");
			},
		});
		await post(erroring, rpc("SendMessage", SEND_PARAMS));
		const result = await post(erroring, rpc("GetTask", { id: "a2a-fixed-uuid" }, 6));
		const body = result?.body as { result: { status: { message?: unknown } } };
		expect(body.result.status.message).toBeUndefined();
	});
});
