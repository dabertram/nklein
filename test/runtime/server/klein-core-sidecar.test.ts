import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { KleinCorePyConfig, KleinCorePyHealth } from "../../../src/config/klein-core-config";
import { startKleinCorePySidecar } from "../../../src/server/klein-core-sidecar";

const ENABLED: KleinCorePyConfig = { enabled: true, sidecarUrl: "http://127.0.0.1:3585" };

/** Minimal stand-in for a spawned ChildProcess: tracks exit/kill and lets a test drive `error`/`exit` events. */
class FakeChild extends EventEmitter {
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	killed = false;
	kill(signal?: NodeJS.Signals): boolean {
		this.killed = true;
		this.signalCode = signal ?? "SIGINT";
		this.exitCode = 0;
		queueMicrotask(() => this.emit("exit", 0, signal ?? "SIGINT"));
		return true;
	}
}

const instantDelay = () => Promise.resolve();
const probeReachable = (reachable: boolean) =>
	vi.fn(
		async (input?: { config?: KleinCorePyConfig }): Promise<KleinCorePyHealth> => ({
			reachable,
			sidecarUrl: input?.config?.sidecarUrl ?? ENABLED.sidecarUrl,
		}),
	);

describe("startKleinCorePySidecar", () => {
	it("does nothing (returns null) when core-py is disabled — never spawns", async () => {
		const spawnImpl = vi.fn();
		const result = await startKleinCorePySidecar({
			config: { enabled: false, sidecarUrl: ENABLED.sidecarUrl },
			spawnImpl: spawnImpl as never,
			existsImpl: () => true,
		});
		expect(result).toBeNull();
		expect(spawnImpl).not.toHaveBeenCalled();
	});

	it("reuses an already-running sidecar (returns null, never spawns)", async () => {
		const spawnImpl = vi.fn();
		const result = await startKleinCorePySidecar({
			config: ENABLED,
			probeImpl: probeReachable(true),
			spawnImpl: spawnImpl as never,
			existsImpl: () => true,
		});
		expect(result).toBeNull();
		expect(spawnImpl).not.toHaveBeenCalled();
	});

	it("falls back (null) when core-py is not on disk — never spawns", async () => {
		const spawnImpl = vi.fn();
		const result = await startKleinCorePySidecar({
			config: ENABLED,
			probeImpl: probeReachable(false),
			spawnImpl: spawnImpl as never,
			existsImpl: () => false,
		});
		expect(result).toBeNull();
		expect(spawnImpl).not.toHaveBeenCalled();
	});

	it("spawns and returns a handle once the sidecar is healthy; stop() kills the child", async () => {
		const child = new FakeChild();
		const spawnImpl = vi.fn(() => child);
		// Pre-check probe → not reachable; the loop probe → reachable.
		let calls = 0;
		const probeImpl = vi.fn(async () => ({ reachable: ++calls > 1, sidecarUrl: ENABLED.sidecarUrl }));
		const handle = await startKleinCorePySidecar({
			config: ENABLED,
			probeImpl,
			spawnImpl: spawnImpl as never,
			delayImpl: instantDelay,
			existsImpl: () => true,
			corePyDir: "/repo/core-py",
		});
		expect(handle).not.toBeNull();
		expect(spawnImpl).toHaveBeenCalledOnce();
		const [cmd, args, opts] = spawnImpl.mock.calls[0] as unknown as [string, string[], { cwd: string }];
		expect(cmd).toBe("uv");
		expect(args).toEqual(["run", "python", "-m", "klein_core", "--port", "3585"]);
		expect(opts.cwd).toBe("/repo/core-py");

		await handle?.stop();
		expect(child.killed).toBe(true);
	});

	it("falls back (null) when the spawn errors (e.g. uv/python missing)", async () => {
		const child = new FakeChild();
		const spawnImpl = vi.fn(() => {
			queueMicrotask(() => child.emit("error", new Error("spawn uv ENOENT")));
			return child;
		});
		const warn = vi.fn();
		const result = await startKleinCorePySidecar({
			config: ENABLED,
			probeImpl: probeReachable(false),
			spawnImpl: spawnImpl as never,
			delayImpl: instantDelay,
			existsImpl: () => true,
			warn,
			healthTimeoutMs: 200,
		});
		expect(result).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
	});

	it("falls back (null) and kills the child when the sidecar never becomes healthy", async () => {
		const child = new FakeChild();
		const spawnImpl = vi.fn(() => child);
		const result = await startKleinCorePySidecar({
			config: ENABLED,
			probeImpl: probeReachable(false),
			spawnImpl: spawnImpl as never,
			delayImpl: instantDelay,
			existsImpl: () => true,
			healthTimeoutMs: 30,
		});
		expect(result).toBeNull();
		expect(child.killed).toBe(true);
	});
});
