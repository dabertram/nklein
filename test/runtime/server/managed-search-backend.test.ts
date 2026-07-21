import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDockerManagedSearchBackend,
	ManagedSearchBackendController,
	type ManagedSearchDockerRunner,
	withConfiguredSearchBackend,
} from "../../../src/server/managed-search-backend";

const tempPaths: string[] = [];

afterEach(async () => {
	await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ManagedSearchBackendController", () => {
	it("single-flights startup, holds active leases, and stops after idle TTL", async () => {
		let releaseStart!: () => void;
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const adapter = { start: vi.fn(() => startGate), stop: vi.fn(async () => undefined) };
		let idleCallback: (() => void) | null = null;
		const controller = new ManagedSearchBackendController(adapter, {
			idleTtlMs: 1_000,
			schedule: (callback) => {
				idleCallback = callback;
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			cancelSchedule: () => {
				idleCallback = null;
			},
		});
		const first = controller.use(async () => "first");
		const second = controller.use(async () => "second");
		expect(adapter.start).toHaveBeenCalledTimes(1);
		releaseStart();
		expect(await Promise.all([first, second])).toEqual(["first", "second"]);
		expect(controller.status()).toMatchObject({ state: "running", activeSearches: 0 });
		expect(idleCallback).not.toBeNull();
		(idleCallback as unknown as () => void)();
		await vi.waitFor(() => expect(adapter.stop).toHaveBeenCalledTimes(1));
		expect(controller.status().state).toBe("stopped");
	});

	it("does not stop a busy backend and records startup failures", async () => {
		let releaseSearch!: () => void;
		const searchGate = new Promise<void>((resolve) => {
			releaseSearch = resolve;
		});
		const adapter = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
		const controller = new ManagedSearchBackendController(adapter);
		const active = controller.use(async () => await searchGate);
		await vi.waitFor(() => expect(controller.status().activeSearches).toBe(1));
		await expect(controller.stop()).rejects.toThrow(/busy/i);
		releaseSearch();
		await active;
		await controller.stop();

		const failing = new ManagedSearchBackendController({
			start: async () => {
				throw new Error("docker unavailable");
			},
			stop: async () => undefined,
		});
		await expect(failing.start()).rejects.toThrow("docker unavailable");
		expect(failing.status()).toMatchObject({ state: "error", lastError: "docker unavailable" });
	});

	it("serializes a restart requested while the idle stop is in flight", async () => {
		let releaseStop!: () => void;
		const stopGate = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		const adapter = { start: vi.fn(async () => undefined), stop: vi.fn(() => stopGate) };
		const controller = new ManagedSearchBackendController(adapter);
		await controller.start();
		const stopping = controller.stop();
		const restarted = controller.start();
		expect(controller.status().state).toBe("stopping");
		releaseStop();
		await Promise.all([stopping, restarted]);
		expect(adapter.stop).toHaveBeenCalledTimes(1);
		expect(adapter.start).toHaveBeenCalledTimes(2);
		expect(controller.status().state).toBe("running");
	});
});

describe("withConfiguredSearchBackend", () => {
	it("routes none, user-supplied, and managed-local modes without implicit fallback", async () => {
		const adapter = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
		const controller = new ManagedSearchBackendController(adapter);
		await expect(
			withConfiguredSearchBackend({ providerMode: "none" }, controller, async (url) => url),
		).rejects.toThrow(/no retrieval search provider/i);
		expect(
			await withConfiguredSearchBackend(
				{ providerMode: "searxng_url", searchBackendUrl: " http://search:8080 " },
				controller,
				async (url) => url,
			),
		).toBe("http://search:8080");
		expect(adapter.start).not.toHaveBeenCalled();
		expect(await withConfiguredSearchBackend({ providerMode: "managed_local" }, controller, async (url) => url)).toBe(
			"http://127.0.0.1:18888",
		);
		expect(adapter.start).toHaveBeenCalledTimes(1);
		await controller.close();
	});
});

describe("createDockerManagedSearchBackend", () => {
	it("does no Docker work until start and creates only the labeled loopback-bound container", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-managed-search-test-"));
		tempPaths.push(root);
		const calls: string[][] = [];
		const runner: ManagedSearchDockerRunner = vi.fn(async (args) => {
			calls.push([...args]);
			if (args[0] === "inspect") return { exitCode: 1, stdout: "", stderr: "not found" };
			return { exitCode: 0, stdout: "ok", stderr: "" };
		});
		const fetchImpl = vi.fn(async () => new Response("ready", { status: 200 }));
		const adapter = createDockerManagedSearchBackend(runner, {
			settingsPath: join(root, "settings.yml"),
			fetchImpl,
		});
		expect(calls).toEqual([]);
		await adapter.start();
		const run = calls.find((args) => args[0] === "run");
		expect(run).toEqual(
			expect.arrayContaining([
				"--name",
				"nklein-search-backend",
				"--label",
				"nklein.kind=managed-search",
				"--restart",
				"no",
				"--publish",
				"127.0.0.1:18888:8080",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
			]),
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			"http://127.0.0.1:18888/",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("refuses to adopt or remove a same-name container without the ownership label", async () => {
		const runner: ManagedSearchDockerRunner = vi.fn(async (args) => ({
			exitCode: 0,
			stdout: args.includes(".State.Running}}") ? "something-else true" : "something-else",
			stderr: "",
		}));
		const adapter = createDockerManagedSearchBackend(runner, { fetchImpl: vi.fn() });
		await expect(adapter.start()).rejects.toThrow(/occupied by an unmanaged container/i);
		await expect(adapter.stop()).rejects.toThrow(/refusing to remove unmanaged/i);
	});
});
