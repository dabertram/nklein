import { describe, expect, it } from "vitest";
import { handleEgressConfirmControlRequest } from "../../../src/core/egress-confirm-control";
import { createEgressConfirmQueue } from "../../../src/core/egress-confirm-queue";
import {
	createEgressTaskGrantRegistry,
	MAX_EGRESS_TASK_GRANT_TTL_MS,
	normalizeGrantHost,
} from "../../../src/core/egress-task-grants";
import { createEgressTaskIdentityRegistry } from "../../../src/core/egress-task-identity";
import { parseEgressAllowlist } from "../../../src/nklein-agent/egress-proxy-role-snapshot";

describe("egress task grants (pure registry)", () => {
	it("issues a lowercase, dot-required host grant bounded by the max TTL", () => {
		const registry = createEgressTaskGrantRegistry();
		const grant = registry.issue(
			{ taskId: "t1", host: "Developer.MOZILLA.org.", ttlMs: 10 * MAX_EGRESS_TASK_GRANT_TTL_MS },
			1_000,
		);
		expect(grant).toEqual({
			taskId: "t1",
			host: "developer.mozilla.org",
			expiresAt: 1_000 + MAX_EGRESS_TASK_GRANT_TTL_MS,
			purpose: "lookup",
		});
		expect(registry.hostsFor("t1", 2_000)).toEqual(["developer.mozilla.org"]);
		expect(registry.hostsFor("other", 2_000)).toEqual([]);
	});

	it("refuses IP literals, single labels, empty ids and non-positive TTLs", () => {
		const registry = createEgressTaskGrantRegistry();
		expect(registry.issue({ taskId: "t1", host: "10.0.0.1", ttlMs: 1_000 }, 0)).toBeNull();
		expect(registry.issue({ taskId: "t1", host: "localhost", ttlMs: 1_000 }, 0)).toBeNull();
		expect(registry.issue({ taskId: "", host: "a.org", ttlMs: 1_000 }, 0)).toBeNull();
		expect(registry.issue({ taskId: "t1", host: "a.org", ttlMs: 0 }, 0)).toBeNull();
		expect(normalizeGrantHost("bad host.org")).toBeNull();
	});

	it("expires, revokes and prunes", () => {
		const registry = createEgressTaskGrantRegistry();
		registry.issue({ taskId: "t1", host: "a.org", ttlMs: 100 }, 0);
		registry.issue({ taskId: "t1", host: "b.org", ttlMs: 1_000 }, 0);
		expect(registry.hostsFor("t1", 500)).toEqual(["b.org"]);
		registry.prune(2_000);
		expect(registry.hostsFor("t1", 2_000)).toEqual([]);
		registry.issue({ taskId: "t2", host: "c.org", ttlMs: 1_000 }, 0);
		registry.revoke("t2");
		expect(registry.hostsFor("t2", 0)).toEqual([]);
	});
});

describe("control channel: POST /task-grants/issue", () => {
	const queue = createEgressConfirmQueue();

	it("applies a grant for a credentialed task and reports the normalized host + expiry", () => {
		const identities = createEgressTaskIdentityRegistry();
		identities.issue("t1", "x".repeat(40));
		const grants = createEgressTaskGrantRegistry();
		const response = handleEgressConfirmControlRequest(
			{ method: "POST", path: "/task-grants/issue", body: { taskId: "t1", host: "Docs.Python.org", ttlMs: 5_000 } },
			queue,
			1_000,
			identities,
			grants,
		);
		expect(response).toEqual({
			status: 200,
			body: { outcome: "applied", host: "docs.python.org", expiresAt: 6_000 },
		});
		expect(grants.hostsFor("t1", 2_000)).toEqual(["docs.python.org"]);
	});

	it("refuses a grant for a task without a credential, a bad body, and a proxy without a grant registry", () => {
		const identities = createEgressTaskIdentityRegistry();
		const grants = createEgressTaskGrantRegistry();
		expect(
			handleEgressConfirmControlRequest(
				{ method: "POST", path: "/task-grants/issue", body: { taskId: "ghost", host: "a.org", ttlMs: 10 } },
				queue,
				0,
				identities,
				grants,
			).status,
		).toBe(409);
		expect(
			handleEgressConfirmControlRequest(
				{ method: "POST", path: "/task-grants/issue", body: { taskId: "t1" } },
				queue,
				0,
				identities,
				grants,
			).status,
		).toBe(400);
		expect(
			handleEgressConfirmControlRequest(
				{ method: "POST", path: "/task-grants/issue", body: { taskId: "t1", host: "a.org", ttlMs: 10 } },
				queue,
				0,
				identities,
				undefined,
			).status,
		).toBe(400);
		identities.issue("t1", "y".repeat(40));
		expect(
			handleEgressConfirmControlRequest(
				{ method: "POST", path: "/task-grants/issue", body: { taskId: "t1", host: "127.0.0.1", ttlMs: 10 } },
				queue,
				0,
				identities,
				grants,
			).status,
		).toBe(400);
	});
});

describe("the lookup ecosystem pack", () => {
	it("expands to the search host only", () => {
		expect(parseEgressAllowlist("registry.npmjs.org,ecosystem:lookup")).toEqual([
			"registry.npmjs.org",
			"html.duckduckgo.com",
		]);
	});
});
