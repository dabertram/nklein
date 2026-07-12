/**
 * Unit tests for the shared remote-mode request-auth decision (§ desktop app #2 — LAN
 * serving). This is the single gate used by the HTTP handler, the runtime WS upgrade, and
 * the terminal WS upgrade, so the whole auth matrix — including the loopback trust rule —
 * is asserted here once.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	generateInternalToken,
	generatePasscode,
	INTERNAL_TOKEN_ENV,
	issueSession,
	SESSION_COOKIE_NAME,
} from "../../../src/security/passcode-manager";
import { evaluateRemoteRequestAuth, isLoopbackAddress } from "../../../src/security/remote-request-auth";

const LAN_PEER = "192.168.1.77";

afterEach(() => {
	generatePasscode(); // reset module passcode state between tests
	delete process.env[INTERNAL_TOKEN_ENV];
});

describe("isLoopbackAddress", () => {
	it("accepts IPv4 loopback (whole 127/8), IPv6 ::1, and the IPv4-mapped form", () => {
		expect(isLoopbackAddress("127.0.0.1")).toBe(true);
		expect(isLoopbackAddress("127.10.20.30")).toBe(true);
		expect(isLoopbackAddress("::1")).toBe(true);
		expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
	});

	it("rejects LAN, public, wildcard, and absent addresses", () => {
		expect(isLoopbackAddress("192.168.1.5")).toBe(false);
		expect(isLoopbackAddress("10.0.0.7")).toBe(false);
		expect(isLoopbackAddress("8.8.8.8")).toBe(false);
		expect(isLoopbackAddress("0.0.0.0")).toBe(false);
		expect(isLoopbackAddress("::ffff:192.168.1.5")).toBe(false);
		expect(isLoopbackAddress(undefined)).toBe(false);
		expect(isLoopbackAddress(null)).toBe(false);
		expect(isLoopbackAddress("")).toBe(false);
	});

	it("does not treat a 127-prefixed non-loopback octet as loopback", () => {
		expect(isLoopbackAddress("1270.0.0.1")).toBe(false);
		expect(isLoopbackAddress("12.7.0.1")).toBe(false);
	});
});

describe("evaluateRemoteRequestAuth", () => {
	it("allows everything when the gate is inactive", () => {
		expect(
			evaluateRemoteRequestAuth({
				passcodeActive: false,
				remoteAddress: LAN_PEER,
				cookieHeader: undefined,
				authorizationHeader: undefined,
			}),
		).toEqual({ authenticated: true, via: "gate-inactive" });
	});

	it("trusts loopback peers unconditionally (§ desktop app #2 — same-machine trust)", () => {
		generatePasscode();
		for (const loopback of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
			expect(
				evaluateRemoteRequestAuth({
					passcodeActive: true,
					remoteAddress: loopback,
					cookieHeader: undefined,
					authorizationHeader: undefined,
				}),
			).toEqual({ authenticated: true, via: "loopback" });
		}
	});

	it("authenticates a LAN peer with a valid session cookie", () => {
		generatePasscode();
		const session = issueSession();
		expect(
			evaluateRemoteRequestAuth({
				passcodeActive: true,
				remoteAddress: LAN_PEER,
				cookieHeader: `${SESSION_COOKIE_NAME}=${session}`,
				authorizationHeader: undefined,
			}),
		).toEqual({ authenticated: true, via: "session" });
	});

	it("authenticates a LAN peer with the internal bearer token", () => {
		generatePasscode();
		const token = generateInternalToken();
		expect(
			evaluateRemoteRequestAuth({
				passcodeActive: true,
				remoteAddress: LAN_PEER,
				cookieHeader: undefined,
				authorizationHeader: `Bearer ${token}`,
			}),
		).toEqual({ authenticated: true, via: "internal-token" });
	});

	it("rejects an unauthenticated LAN peer", () => {
		generatePasscode();
		expect(
			evaluateRemoteRequestAuth({
				passcodeActive: true,
				remoteAddress: LAN_PEER,
				cookieHeader: `${SESSION_COOKIE_NAME}=never-issued`,
				authorizationHeader: "Bearer wrong",
			}),
		).toEqual({ authenticated: false });
	});

	it("rejects when the peer address is unknown (fail closed, never fail open)", () => {
		generatePasscode();
		expect(
			evaluateRemoteRequestAuth({
				passcodeActive: true,
				remoteAddress: undefined,
				cookieHeader: undefined,
				authorizationHeader: undefined,
			}),
		).toEqual({ authenticated: false });
	});
});
