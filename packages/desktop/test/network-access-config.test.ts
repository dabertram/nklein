import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
	detectPrimaryLanIpv4,
	isPrivateLanIpv4,
	LOOPBACK_HOST,
	resolveDesktopBindPlan,
	resolveDesktopStartupBind,
	WILDCARD_HOST,
} from "../src/network-access-config";

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4",
		mac: "00:00:00:00:00:00",
		internal,
		cidr: `${address}/24`,
	};
}

describe("resolveDesktopBindPlan", () => {
	it("binds loopback (safe default) when network access is OFF", () => {
		expect(resolveDesktopBindPlan({ enabled: false, lanIpv4: "192.168.1.5" })).toEqual({
			host: LOOPBACK_HOST,
			publicHost: null,
		});
	});

	it("binds wildcard and advertises the LAN IP when ON with a detected address", () => {
		expect(resolveDesktopBindPlan({ enabled: true, lanIpv4: "192.168.1.5" })).toEqual({
			host: WILDCARD_HOST,
			publicHost: "192.168.1.5",
		});
	});

	it("still binds wildcard (no advertisable URL) when ON but no LAN IP was detected", () => {
		expect(resolveDesktopBindPlan({ enabled: true, lanIpv4: null })).toEqual({
			host: WILDCARD_HOST,
			publicHost: null,
		});
	});
});

describe("isPrivateLanIpv4", () => {
	it("accepts the RFC-1918 private ranges", () => {
		expect(isPrivateLanIpv4("192.168.0.1")).toBe(true);
		expect(isPrivateLanIpv4("10.0.0.7")).toBe(true);
		expect(isPrivateLanIpv4("172.16.0.1")).toBe(true);
		expect(isPrivateLanIpv4("172.31.255.254")).toBe(true);
	});

	it("rejects public, CGNAT-adjacent, link-local, and out-of-172-range addresses", () => {
		expect(isPrivateLanIpv4("8.8.8.8")).toBe(false);
		expect(isPrivateLanIpv4("172.15.0.1")).toBe(false);
		expect(isPrivateLanIpv4("172.32.0.1")).toBe(false);
		expect(isPrivateLanIpv4("169.254.1.1")).toBe(false);
	});
});

describe("detectPrimaryLanIpv4", () => {
	it("returns null when there is no non-internal private IPv4", () => {
		expect(
			detectPrimaryLanIpv4({
				lo0: [ipv4("127.0.0.1", true)],
				en0: [ipv4("8.8.4.4")], // public
			}),
		).toBeNull();
	});

	it("prefers 192.168 over 10 over 172.16-31", () => {
		expect(
			detectPrimaryLanIpv4({
				en0: [ipv4("172.16.5.5")],
				en1: [ipv4("10.1.2.3")],
				en2: [ipv4("192.168.1.50")],
			}),
		).toBe("192.168.1.50");
		expect(
			detectPrimaryLanIpv4({
				en0: [ipv4("172.20.5.5")],
				en1: [ipv4("10.1.2.3")],
			}),
		).toBe("10.1.2.3");
	});

	it("skips loopback, internal, link-local, and IPv6 addresses", () => {
		expect(
			detectPrimaryLanIpv4({
				lo0: [ipv4("127.0.0.1", true)],
				en0: [
					{
						address: "fe80::1",
						netmask: "ffff:ffff:ffff:ffff::",
						family: "IPv6",
						mac: "00:00:00:00:00:00",
						internal: false,
						cidr: "fe80::1/64",
						scopeid: 1,
					},
					ipv4("169.254.10.10"), // link-local IPv4 (not private)
					ipv4("192.168.7.7"),
				],
			}),
		).toBe("192.168.7.7");
	});

	it("tolerates the legacy numeric `family` (4) some Node runtimes report", () => {
		const legacy = { ...ipv4("10.0.0.9"), family: 4 } as unknown as NetworkInterfaceInfo;
		expect(detectPrimaryLanIpv4({ en0: [legacy] })).toBe("10.0.0.9");
	});
});

describe("resolveDesktopStartupBind", () => {
	it("returns loopback and never enumerates interfaces when the opt-in is off", () => {
		let enumerated = false;
		const plan = resolveDesktopStartupBind({
			loadEnabled: () => false,
			networkInterfaces: () => {
				enumerated = true;
				return {};
			},
		});
		expect(plan).toEqual({ host: LOOPBACK_HOST, publicHost: null });
		expect(enumerated).toBe(false);
	});

	it("binds wildcard and advertises the detected LAN IP when the opt-in is on", () => {
		const plan = resolveDesktopStartupBind({
			loadEnabled: () => true,
			networkInterfaces: () => ({ en0: [ipv4("192.168.1.42")] }),
		});
		expect(plan).toEqual({ host: WILDCARD_HOST, publicHost: "192.168.1.42" });
	});
});
