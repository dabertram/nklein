import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { ACP_ALLOW_ONCE_OPTION_ID } from "../../../src/acp/acp-permission-mapping";
import { buildRuntimeAcpPorts } from "../../../src/acp/nklein-acp-runtime-ports";
import type { PendingEgressConfirm } from "../../../src/core/egress-confirm-queue";
import type { RuntimeServer } from "../../../src/server/runtime-server";

/**
 * P17.2 — the permission WIRE over a fake ingress: an egress attempt attributed to the turn's card is put to
 * the editor, the answer resolves the queue bound to the PENDING facts, and a still-open prompt is never
 * re-raised by the next poll tick.
 */
const ENTRY = { workspaceId: "ws", repoPath: "/repo" };

function pendingConfirm(overrides: Partial<PendingEgressConfirm> = {}): PendingEgressConfirm {
	return {
		attemptId: "attempt-1",
		host: "pypi.org",
		port: 443,
		role: "worker",
		taskId: "acp-card",
		requestedAt: 1_000,
		expiresAt: 61_000,
		...overrides,
	};
}

function harness(input: {
	confirms: PendingEgressConfirm[][];
	respond: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}) {
	const resolved: { attemptId: string; approve: boolean; host: string; port: number; role: string }[] = [];
	const asked: RequestPermissionRequest[] = [];
	// Board reads and confirm polls advance INDEPENDENTLY: the card must stay non-terminal long enough for the
	// loop to poll confirms more than once, or a "never re-raised" assertion would pass because the loop only
	// ran one iteration — a test passing for the wrong reason.
	let confirmPolls = 0;
	let boardReads = 0;
	const laneAt = (read: number) => (read < input.confirms.length ? "ready" : "completed");
	const ingress = {
		listWorkspaces: async () => [ENTRY],
		seedCard: async () => "created" as const,
		readBoardRecord: async () => ({
			columnId: laneAt(boardReads++),
			title: "t",
			reviewStatus: null,
			reviewParkedReason: null,
		}),
		readStatusNote: async () => null,
		armWorkspace: async () => undefined,
		stopTask: async () => undefined,
		listTaskEgressConfirms: async () => input.confirms[Math.min(confirmPolls++, input.confirms.length - 1)] ?? [],
		resolveTaskEgressConfirm: async (_entry: unknown, decision: (typeof resolved)[number]) => {
			resolved.push(decision);
			return "applied" as const;
		},
	} as unknown as RuntimeServer["externalIngress"];
	const ports = buildRuntimeAcpPorts({
		ingress,
		registerWorkspacePath: async () => ENTRY,
		randomUuid: () => "card",
	});
	return { ports, resolved, asked, ingress, respond: input.respond, confirmPolls: () => confirmPolls };
}

async function drive(h: ReturnType<typeof harness>) {
	const workspaceId = await h.ports.ensureWorkspace("/repo");
	return await h.ports.runPrompt({
		workspaceId,
		sessionId: "acp-session",
		promptText: "do the thing",
		emitUpdate: async () => undefined,
		requestPermission: async (request) => {
			h.asked.push(request);
			return await h.respond(request);
		},
		signal: new AbortController().signal,
	});
}

describe("ACP permission wire", () => {
	it("puts an attributed egress attempt to the editor and resolves the queue on approval", async () => {
		const h = harness({
			confirms: [[pendingConfirm()], []],
			respond: async () => ({ outcome: { outcome: "selected", optionId: ACP_ALLOW_ONCE_OPTION_ID } }),
		});
		const stop = await drive(h);
		expect(stop).toBe("end_turn");
		expect(h.asked).toHaveLength(1);
		expect(h.asked[0]?.toolCall.title).toContain("Network access");
		// Bound to the PENDING facts — never rebuilt from the reply.
		expect(h.resolved).toEqual([
			{ attemptId: "attempt-1", host: "pypi.org", port: 443, role: "worker", approve: true },
		]);
	});

	it("a rejection resolves as a DENY, still bound to the same facts", async () => {
		const h = harness({
			confirms: [[pendingConfirm()], []],
			respond: async () => ({ outcome: { outcome: "selected", optionId: "nklein-reject-once" } }),
		});
		await drive(h);
		expect(h.resolved[0]?.approve).toBe(false);
	});

	it("a client cancellation resolves NOTHING — the entry keeps its own expiry-is-deny path", async () => {
		const h = harness({
			confirms: [[pendingConfirm()], []],
			respond: async () => ({ outcome: { outcome: "cancelled" } }),
		});
		await drive(h);
		expect(h.asked).toHaveLength(1);
		expect(h.resolved).toEqual([]);
	});

	it("a still-open prompt is never re-raised by the next poll tick", async () => {
		// The same attempt is still pending across THREE polls — the operator is simply still looking at it.
		const h = harness({
			confirms: [[pendingConfirm()], [pendingConfirm()], [pendingConfirm()]],
			respond: async () => ({ outcome: { outcome: "selected", optionId: ACP_ALLOW_ONCE_OPTION_ID } }),
		});
		await drive(h);
		expect(h.confirmPolls()).toBeGreaterThan(1); // the loop really did poll again — not a one-iteration pass
		expect(h.asked).toHaveLength(1);
	});
});
