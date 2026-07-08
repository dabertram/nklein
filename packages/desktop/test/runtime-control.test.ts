import { describe, expect, it, vi } from "vitest";
import {
	DESKTOP_TRAY_PAUSE_REASON,
	WORKSPACE_ID_HEADER,
	countInProgressCards,
	createDesktopRuntimeControlClient,
	isSwarmStopPaused,
	resolveTrayWorkspaceId,
	type RuntimeControlFetch,
} from "../src/runtime-control.js";

function trpcJson(json: unknown, status = 200) {
	return {
		status,
		json: async () => ({ result: { data: { json } } }),
	};
}

function workspaceState(inProgressCards: number): unknown {
	return {
		board: {
			columns: [
				{ id: "backlog", cards: [{ id: "b" }] },
				{
					id: "in_progress",
					cards: Array.from({ length: inProgressCards }, (_, index) => ({ id: `run-${index}` })),
				},
				{ id: "review", cards: [] },
			],
		},
	};
}

describe("countInProgressCards", () => {
	it("counts cards in the in_progress column and treats malformed state as idle", () => {
		expect(countInProgressCards(workspaceState(3))).toBe(3);
		expect(countInProgressCards({ board: { columns: [{ id: "backlog", cards: [{}] }] } })).toBe(0);
		expect(countInProgressCards(null)).toBe(0);
	});
});

describe("isSwarmStopPaused", () => {
	it("reads the workspace swarm-stop signal", () => {
		expect(isSwarmStopPaused({ ok: true, signal: { stopped: true, reason: "pause", createdAt: 1 } })).toBe(true);
		expect(isSwarmStopPaused({ ok: true, signal: null })).toBe(false);
		expect(isSwarmStopPaused({ ok: true, signal: { stopped: false } })).toBe(false);
	});
});

describe("resolveTrayWorkspaceId", () => {
	it("prefers the registry project id", () => {
		expect(
			resolveTrayWorkspaceId({
				entryProjectId: "project-from-entry",
				currentUrl: "http://127.0.0.1:3484/project-from-route",
				runtimeUrl: "http://127.0.0.1:3484",
			}),
		).toBe("project-from-entry");
	});

	it("falls back to the focused runtime URL path and decodes project ids", () => {
		expect(
			resolveTrayWorkspaceId({
				entryProjectId: null,
				currentUrl: "http://127.0.0.1:3484/%2FUsers%2Fdavid%2FMy%20Project?task=1",
				runtimeUrl: "http://127.0.0.1:3484",
			}),
		).toBe("/Users/david/My Project");
	});

	it("returns null for root, malformed, or foreign-origin URLs", () => {
		expect(
			resolveTrayWorkspaceId({
				entryProjectId: null,
				currentUrl: "http://127.0.0.1:3484/",
				runtimeUrl: "http://127.0.0.1:3484",
			}),
		).toBeNull();
		expect(
			resolveTrayWorkspaceId({
				entryProjectId: null,
				currentUrl: "file:///tmp/disconnected.html",
				runtimeUrl: "http://127.0.0.1:3484",
			}),
		).toBeNull();
		expect(
			resolveTrayWorkspaceId({
				entryProjectId: null,
				currentUrl: "http://localhost:9999/project",
				runtimeUrl: "http://127.0.0.1:3484",
			}),
		).toBeNull();
	});
});

describe("createDesktopRuntimeControlClient", () => {
	it("reads tray state through existing workspace/runtime tRPC procedures", async () => {
		const fetchImpl = vi.fn<RuntimeControlFetch>(async (url, init) => {
			const procedure = new URL(url).pathname.split("/").at(-1);
			expect(init.headers[WORKSPACE_ID_HEADER]).toBe("ws-1");
			if (procedure === "runtime.getSwarmStop") {
				return trpcJson({ ok: true, signal: { stopped: true, reason: "pause", createdAt: 1 } });
			}
			if (procedure === "workspace.getState") {
				return trpcJson(workspaceState(2));
			}
			throw new Error(`unexpected procedure ${procedure}`);
		});

		const client = createDesktopRuntimeControlClient({
			baseUrl: "http://127.0.0.1:3484/ignored",
			fetch: fetchImpl,
		});

		await expect(client.getTrayState("ws-1")).resolves.toEqual({
			paused: true,
			activitySummary: "2 cards running",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
			"/api/trpc/runtime.getSwarmStop",
			"/api/trpc/workspace.getState",
		]);
	});

	it("requests a swarm stop when toggling from running", async () => {
		const fetchImpl = vi.fn<RuntimeControlFetch>(async (url, init) => {
			const procedure = new URL(url).pathname.split("/").at(-1);
			if (procedure === "runtime.getSwarmStop") {
				return trpcJson({ ok: true, signal: null });
			}
			if (procedure === "runtime.requestSwarmStop") {
				expect(init.method).toBe("POST");
				expect(JSON.parse(init.body ?? "{}")).toEqual({ reason: DESKTOP_TRAY_PAUSE_REASON });
				return trpcJson({ ok: true, signal: { stopped: true, reason: DESKTOP_TRAY_PAUSE_REASON, createdAt: 1 } });
			}
			if (procedure === "workspace.getState") {
				return trpcJson(workspaceState(1));
			}
			throw new Error(`unexpected procedure ${procedure}`);
		});

		const client = createDesktopRuntimeControlClient({
			baseUrl: "http://127.0.0.1:3484",
			fetch: fetchImpl,
		});

		await expect(client.togglePause("ws-1")).resolves.toEqual({
			paused: true,
			activitySummary: "1 card running",
		});
		expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
			"/api/trpc/runtime.getSwarmStop",
			"/api/trpc/runtime.requestSwarmStop",
			"/api/trpc/workspace.getState",
		]);
	});

	it("clears swarm stop when toggling from paused", async () => {
		const fetchImpl = vi.fn<RuntimeControlFetch>(async (url, init) => {
			const procedure = new URL(url).pathname.split("/").at(-1);
			if (procedure === "runtime.getSwarmStop") {
				return trpcJson({ ok: true, signal: { stopped: true, reason: "pause", createdAt: 1 } });
			}
			if (procedure === "runtime.clearSwarmStop") {
				expect(init.method).toBe("POST");
				expect(init.body).toBeUndefined();
				return trpcJson({ ok: true, signal: null });
			}
			if (procedure === "workspace.getState") {
				return trpcJson(workspaceState(0));
			}
			throw new Error(`unexpected procedure ${procedure}`);
		});

		const client = createDesktopRuntimeControlClient({
			baseUrl: "http://127.0.0.1:3484",
			fetch: fetchImpl,
		});

		await expect(client.togglePause("ws-1")).resolves.toEqual({
			paused: false,
			activitySummary: "Idle",
		});
		expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
			"/api/trpc/runtime.getSwarmStop",
			"/api/trpc/runtime.clearSwarmStop",
			"/api/trpc/workspace.getState",
		]);
	});

	it("surfaces tRPC error envelopes", async () => {
		const fetchImpl = vi.fn<RuntimeControlFetch>(async () => ({
			status: 400,
			json: async () => ({ error: { message: "Missing workspace scope" } }),
		}));
		const client = createDesktopRuntimeControlClient({
			baseUrl: "http://127.0.0.1:3484",
			fetch: fetchImpl,
		});

		await expect(client.getTrayState("ws-1")).rejects.toThrow("Missing workspace scope");
	});
});
