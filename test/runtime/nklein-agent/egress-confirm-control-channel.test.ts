import { afterEach, describe, expect, it } from "vitest";
import { createEgressConfirmQueue } from "../../../src/core/egress-confirm-queue";
import { createEgressTaskIdentityRegistry } from "../../../src/core/egress-task-identity";
import {
	issueEgressTaskIdentity,
	listPendingEgressConfirms,
	resolvePendingEgressConfirm,
	revokeEgressTaskIdentity,
} from "../../../src/nklein-agent/egress-confirm-control-client";
import {
	createEgressConfirmControlServer,
	type EgressConfirmControlServer,
} from "../../../src/nklein-agent/egress-confirm-control-server";

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const servers: EgressConfirmControlServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startChannel(now = 1_000) {
	const queue = createEgressConfirmQueue();
	const taskIdentities = createEgressTaskIdentityRegistry();
	const server = createEgressConfirmControlServer({
		queue,
		taskIdentities,
		token: TOKEN,
		host: "127.0.0.1",
		port: 0,
		now: () => now,
	});
	servers.push(server);
	await server.start();
	return { queue, taskIdentities, endpoint: { baseUrl: `http://127.0.0.1:${server.boundPort()}`, token: TOKEN } };
}

describe("egress confirm authenticated control channel", () => {
	it("lists pending attempts and applies an exactly-bound one-shot approval", async () => {
		const { queue, endpoint } = await startChannel();
		queue.enqueue({ attemptId: "a1", host: "api.example.com", port: 443, role: "worker" }, 1_000, 5_000);

		expect(await listPendingEgressConfirms(endpoint)).toEqual([
			{
				attemptId: "a1",
				host: "api.example.com",
				port: 443,
				role: "worker",
				requestedAt: 1_000,
				expiresAt: 6_000,
			},
		]);
		expect(
			await resolvePendingEgressConfirm(endpoint, {
				attemptId: "a1",
				host: "api.example.com",
				port: 443,
				role: "worker",
				approve: true,
			}),
		).toBe("applied");
		expect(queue.take("a1", 1_000)).toBe("approved");
	});

	it("rejects a missing bearer token and never mutates the queued decision", async () => {
		const { queue, endpoint } = await startChannel();
		queue.enqueue({ attemptId: "a1", host: "api.example.com", port: 443, role: "worker" }, 1_000, 5_000);
		const response = await fetch(`${endpoint.baseUrl}/egress-confirms/resolve`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				attemptId: "a1",
				host: "api.example.com",
				port: 443,
				role: "worker",
				approve: true,
			}),
		});
		expect(response.status).toBe(401);
		expect(queue.status("a1", 1_000)).toBe("pending");
	});

	it("keeps a mismatched target pending and refuses non-loopback client endpoints", async () => {
		const { queue, endpoint } = await startChannel();
		queue.enqueue({ attemptId: "a1", host: "api.example.com", port: 443, role: "worker" }, 1_000, 5_000);
		expect(
			await resolvePendingEgressConfirm(endpoint, {
				attemptId: "a1",
				host: "evil.example",
				port: 443,
				role: "worker",
				approve: true,
			}),
		).toBe("mismatch");
		expect(queue.status("a1", 1_000)).toBe("pending");
		await expect(listPendingEgressConfirms({ baseUrl: "http://example.com:3131", token: TOKEN })).rejects.toThrow(
			/host loopback/,
		);
		await expect(listPendingEgressConfirms({ baseUrl: "http://localhost:3131", token: TOKEN })).rejects.toThrow(
			/host loopback/,
		);
	});

	it("issues and revokes a task identity without exposing registry contents", async () => {
		const { taskIdentities, endpoint } = await startChannel();
		const token = "b".repeat(64);
		await issueEgressTaskIdentity(endpoint, { taskId: "task-9", token });
		expect(taskIdentities.validate("task-9", token)).toBe(true);
		await revokeEgressTaskIdentity(endpoint, "task-9");
		expect(taskIdentities.validate("task-9", token)).toBe(false);
	});
});
