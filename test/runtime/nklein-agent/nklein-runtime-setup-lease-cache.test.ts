import { describe, expect, it, vi } from "vitest";
import { createRuntimeSetupLeaseCache } from "../../../src/nklein-agent/nklein-runtime-setup-lease-cache";
import type { NKleinRuntimeSetupLease } from "../../../src/nklein-agent/nklein-watcher-registry";

const lease = (setup: unknown, release = vi.fn(() => Promise.resolve())): NKleinRuntimeSetupLease =>
	({ setup, release }) as unknown as NKleinRuntimeSetupLease;

describe("createRuntimeSetupLeaseCache (§5.U extraction)", () => {
	it("acquires once per workspace and shares the lease across concurrent callers (de-dup)", async () => {
		const acquire = vi.fn((wp: string) => Promise.resolve(lease({ id: wp })));
		const cache = createRuntimeSetupLeaseCache({ acquire });

		const [a, b] = await Promise.all([cache.ensure("  /repo  "), cache.ensure("/repo")]);
		expect(a).toEqual({ id: "/repo" }); // returns lease.setup, workspace trimmed
		expect(b).toEqual({ id: "/repo" });
		expect(acquire).toHaveBeenCalledTimes(1); // shared lease
		expect(acquire).toHaveBeenCalledWith("/repo");
	});

	it("acquires separately for distinct workspaces", async () => {
		const acquire = vi.fn((wp: string) => Promise.resolve(lease({ id: wp })));
		const cache = createRuntimeSetupLeaseCache({ acquire });
		await cache.ensure("/a");
		await cache.ensure("/b");
		expect(acquire).toHaveBeenCalledTimes(2);
	});

	it("releases every held lease on disposeAll and tolerates a release failure", async () => {
		const releaseA = vi.fn(() => Promise.resolve());
		const releaseB = vi.fn(() => Promise.reject(new Error("boom")));
		const acquire = (wp: string) => Promise.resolve(lease({ id: wp }, wp === "/a" ? releaseA : releaseB));
		const cache = createRuntimeSetupLeaseCache({ acquire });
		await cache.ensure("/a");
		await cache.ensure("/b");

		await expect(cache.disposeAll()).resolves.toBeUndefined(); // failure swallowed
		expect(releaseA).toHaveBeenCalledTimes(1);
		expect(releaseB).toHaveBeenCalledTimes(1);
	});
});
