/**
 * Unit tests for the WebSocket upgrade passcode gate in runtime-server.ts.
 *
 * The gate must reject unauthenticated upgrade requests to /api/runtime/ws
 * with HTTP 401 when remote mode + passcode are active, and allow them through
 * when the session cookie is valid or when the gate is not active.
 *
 * The upgrade handler delegates to evaluateRemoteRequestAuth (the shared gate
 * decision), so these tests exercise the REAL decision function — no server
 * boot needed, and no mirrored logic that could drift.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	disablePasscode,
	generatePasscode,
	isPasscodeEnabled,
	issueSession,
	LEGACY_SESSION_COOKIE_NAME,
	SESSION_COOKIE_NAME,
	validateSession,
} from "../../../src/security/passcode-manager";
import { evaluateRemoteRequestAuth } from "../../../src/security/remote-request-auth";

// A LAN peer address — the loopback bypass must NOT fire for these tests.
const LAN_PEER = "192.168.1.50";

// Run the same decision the upgrade handler makes (401 on !authenticated).
function runUpgradeGuard(input: {
	isRemoteMode: boolean;
	cookieHeader: string | undefined;
	remoteAddress?: string;
}): "allowed" | "rejected" {
	const passcodeActive = input.isRemoteMode && isPasscodeEnabled();
	if (!passcodeActive) {
		return "allowed";
	}
	const { authenticated } = evaluateRemoteRequestAuth({
		passcodeActive,
		remoteAddress: input.remoteAddress ?? LAN_PEER,
		cookieHeader: input.cookieHeader,
		authorizationHeader: undefined,
	});
	return authenticated ? "allowed" : "rejected";
}

describe("WebSocket upgrade passcode gate (/api/runtime/ws)", () => {
	// Reset passcode state after each test so tests do not bleed into each other.
	afterEach(() => {
		// Re-enable the passcode with a fresh value so the module state is clean.
		// (disablePasscode sets passcodeEnabled = false; generatePasscode resets it.)
		generatePasscode();
	});

	it("rejects upgrade when remote mode is active, passcode is enabled, and no cookie is sent", () => {
		generatePasscode(); // ensure passcode is active
		expect(isPasscodeEnabled()).toBe(true);

		const result = runUpgradeGuard({ isRemoteMode: true, cookieHeader: undefined });
		expect(result).toBe("rejected");
	});

	it("rejects upgrade when remote mode is active and the session token is invalid", () => {
		generatePasscode();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `${SESSION_COOKIE_NAME}=not-a-real-token`,
		});
		expect(result).toBe("rejected");
	});

	it("rejects upgrade when remote mode is active and the cookie contains a garbage value", () => {
		generatePasscode();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `some_other_cookie=abc; ${SESSION_COOKIE_NAME}=`,
		});
		expect(result).toBe("rejected");
	});

	it("allows upgrade when remote mode is active and the session token is valid", () => {
		generatePasscode();
		const token = issueSession();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `${SESSION_COOKIE_NAME}=${token}`,
		});
		expect(result).toBe("allowed");
	});

	it("allows upgrade when remote mode is active and the session cookie is mixed with other cookies", () => {
		generatePasscode();
		const token = issueSession();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `other=value; ${SESSION_COOKIE_NAME}=${token}; another=x`,
		});
		expect(result).toBe("allowed");
	});

	it("allows upgrade when NOT in remote mode even without a valid session cookie", () => {
		generatePasscode();

		// isRemoteMode = false → gate is skipped entirely
		const result = runUpgradeGuard({ isRemoteMode: false, cookieHeader: undefined });
		expect(result).toBe("allowed");
	});

	it("rejects upgrade when cookie contains a token that was never issued by this server", () => {
		generatePasscode();
		// This 64-char hex string resembles a session token but was never issued by issueSession().
		const neverIssuedToken = "a".repeat(64);
		expect(validateSession(neverIssuedToken)).toBe(false);

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `${SESSION_COOKIE_NAME}=${neverIssuedToken}`,
		});
		expect(result).toBe("rejected");
	});

	it("allows upgrade when passcode is disabled (--no-passcode flag) even in remote mode", () => {
		disablePasscode();
		expect(isPasscodeEnabled()).toBe(false);

		const result = runUpgradeGuard({ isRemoteMode: true, cookieHeader: undefined });
		expect(result).toBe("allowed");
	});

	it("accepts the legacy cookie name during the rename transition", () => {
		generatePasscode();
		const token = issueSession();

		const result = runUpgradeGuard({
			isRemoteMode: true,
			cookieHeader: `${LEGACY_SESSION_COOKIE_NAME}=${token}`,
		});
		expect(result).toBe("allowed");
	});

	it("allows a loopback peer without any session cookie (§ desktop app #2 — same-machine trust)", () => {
		generatePasscode();
		for (const loopback of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
			const result = runUpgradeGuard({
				isRemoteMode: true,
				cookieHeader: undefined,
				remoteAddress: loopback,
			});
			expect(result).toBe("allowed");
		}
	});
});
