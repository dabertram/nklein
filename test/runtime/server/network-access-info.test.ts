/**
 * Unit tests for the loopback-only /api/network-access resolver (§ desktop app #2 — LAN
 * serving). The passcode must be visible to same-machine callers (the desktop Settings
 * dialog) and NEVER to a network peer.
 */

import { describe, expect, it } from "vitest";
import { type NetworkAccessInfoFacts, resolveNetworkAccessInfo } from "../../../src/server/network-access-info";

function remoteFacts(overrides: Partial<NetworkAccessInfoFacts> = {}): NetworkAccessInfoFacts {
	return {
		remoteAddress: "127.0.0.1",
		isRemoteMode: true,
		passcodeEnabled: true,
		passcode: "Abcd2345",
		publicHost: "192.168.1.25",
		port: 3484,
		origin: "http://192.168.1.25:3484",
		...overrides,
	};
}

describe("resolveNetworkAccessInfo", () => {
	it("serves the full LAN-serving state — including the passcode — to a loopback caller", () => {
		expect(resolveNetworkAccessInfo(remoteFacts())).toEqual({
			kind: "ok",
			body: {
				lanServing: true,
				passcodeRequired: true,
				passcode: "Abcd2345",
				publicHost: "192.168.1.25",
				port: 3484,
				origin: "http://192.168.1.25:3484",
			},
		});
	});

	it("answers 404 to every non-loopback caller — even an authenticated one", () => {
		expect(resolveNetworkAccessInfo(remoteFacts({ remoteAddress: "192.168.1.50" }))).toEqual({ kind: "not-found" });
		expect(resolveNetworkAccessInfo(remoteFacts({ remoteAddress: undefined }))).toEqual({ kind: "not-found" });
	});

	it("accepts IPv6 and IPv4-mapped loopback peers", () => {
		expect(resolveNetworkAccessInfo(remoteFacts({ remoteAddress: "::1" })).kind).toBe("ok");
		expect(resolveNetworkAccessInfo(remoteFacts({ remoteAddress: "::ffff:127.0.0.1" })).kind).toBe("ok");
	});

	it("reports the inactive state on a loopback bind (lanServing false, no passcode)", () => {
		expect(
			resolveNetworkAccessInfo(
				remoteFacts({
					isRemoteMode: false,
					passcodeEnabled: true,
					passcode: null,
					publicHost: null,
					origin: "http://127.0.0.1:3484",
				}),
			),
		).toEqual({
			kind: "ok",
			body: {
				lanServing: false,
				passcodeRequired: false,
				passcode: null,
				publicHost: null,
				port: 3484,
				origin: "http://127.0.0.1:3484",
			},
		});
	});

	it("omits the passcode when enforcement is disabled even though LAN serving is live", () => {
		const resolved = resolveNetworkAccessInfo(remoteFacts({ passcodeEnabled: false }));
		expect(resolved).toEqual({
			kind: "ok",
			body: {
				lanServing: true,
				passcodeRequired: false,
				passcode: null,
				publicHost: "192.168.1.25",
				port: 3484,
				origin: "http://192.168.1.25:3484",
			},
		});
	});
});
