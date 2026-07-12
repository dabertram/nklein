import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { LOOPBACK_HOST, WILDCARD_HOST } from "../src/network-access-config";
import { getNetworkAccessEnabled, setNetworkAccessEnabled } from "../src/network-access-ipc";

function ipv4(address: string): NetworkInterfaceInfo {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4",
		mac: "00:00:00:00:00:00",
		internal: false,
		cidr: `${address}/24`,
	};
}

function makeDeps(overrides: Partial<Parameters<typeof setNetworkAccessEnabled>[0]> = {}) {
	return {
		loadEnabled: vi.fn(() => false),
		saveEnabled: vi.fn(),
		networkInterfaces: vi.fn(() => ({ en0: [ipv4("192.168.1.42")] })),
		applyBindPlan: vi.fn(),
		...overrides,
	};
}

describe("getNetworkAccessEnabled", () => {
	it("returns the persisted opt-in", () => {
		expect(getNetworkAccessEnabled({ loadEnabled: () => true })).toBe(true);
		expect(getNetworkAccessEnabled({ loadEnabled: () => false })).toBe(false);
	});

	it("fails safe to false when the store read throws", () => {
		expect(
			getNetworkAccessEnabled({
				loadEnabled: () => {
					throw new Error("corrupt userData");
				},
			}),
		).toBe(false);
	});
});

describe("setNetworkAccessEnabled", () => {
	it("persists the opt-in and stages the wildcard bind plan when enabling", () => {
		const deps = makeDeps();
		const result = setNetworkAccessEnabled(deps, true);
		expect(result).toEqual({ ok: true, enabled: true });
		expect(deps.saveEnabled).toHaveBeenCalledWith(true);
		expect(deps.applyBindPlan).toHaveBeenCalledWith({
			host: WILDCARD_HOST,
			publicHost: "192.168.1.42",
			insecureRemoteHttp: true,
		});
	});

	it("persists the opt-out and stages the loopback plan without enumerating interfaces", () => {
		const deps = makeDeps();
		const result = setNetworkAccessEnabled(deps, false);
		expect(result).toEqual({ ok: true, enabled: false });
		expect(deps.saveEnabled).toHaveBeenCalledWith(false);
		expect(deps.networkInterfaces).not.toHaveBeenCalled();
		expect(deps.applyBindPlan).toHaveBeenCalledWith({
			host: LOOPBACK_HOST,
			publicHost: null,
			insecureRemoteHttp: false,
		});
	});

	it("treats anything but a literal true as disable (fail closed on malformed IPC payloads)", () => {
		for (const garbage of ["true", 1, {}, null, undefined]) {
			const deps = makeDeps();
			const result = setNetworkAccessEnabled(deps, garbage);
			expect(result).toEqual({ ok: true, enabled: false });
			expect(deps.saveEnabled).toHaveBeenCalledWith(false);
		}
	});

	it("still stages a wildcard plan (no advertised host) when no LAN IP is detectable", () => {
		const deps = makeDeps({ networkInterfaces: vi.fn(() => ({})) });
		const result = setNetworkAccessEnabled(deps, true);
		expect(result).toEqual({ ok: true, enabled: true });
		expect(deps.applyBindPlan).toHaveBeenCalledWith({
			host: WILDCARD_HOST,
			publicHost: null,
			insecureRemoteHttp: true,
		});
	});

	it("reports a persistence failure instead of throwing across the IPC boundary", () => {
		const deps = makeDeps({
			saveEnabled: vi.fn(() => {
				throw new Error("EACCES: read-only userData");
			}),
		});
		const result = setNetworkAccessEnabled(deps, true);
		expect(result.ok).toBe(false);
		expect(result.enabled).toBe(true);
		expect(result.error).toContain("EACCES");
		expect(deps.applyBindPlan).not.toHaveBeenCalled();
	});
});
