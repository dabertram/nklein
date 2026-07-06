import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkRateLimit,
	clearRateLimit,
	recordFailedAttempt,
	revokeAndRegeneratePasscode,
} from "../../../src/security/passcode-manager";

// §5.V — the passcode auth rate-limiter is security-critical: 5 attempts, then a 30s lockout. Characterizing the
// attempt-countdown, the lockout trigger, the auto-unlock after expiry, and the clear/revoke resets. Each test uses a
// unique IP so the module-global rate-limit map doesn't leak across tests.
const MAX = 5;

describe("checkRateLimit / recordFailedAttempt (§5.V coverage)", () => {
	it("starts a fresh IP fully allowed with the max attempts remaining", () => {
		expect(checkRateLimit("ip-fresh")).toEqual({ allowed: true, lockedUntilMs: null, attemptsRemaining: MAX });
	});

	it("counts failed attempts down toward the cap", () => {
		const ip = "ip-countdown";
		recordFailedAttempt(ip);
		expect(checkRateLimit(ip).attemptsRemaining).toBe(MAX - 1);
		recordFailedAttempt(ip);
		expect(checkRateLimit(ip).attemptsRemaining).toBe(MAX - 2);
	});

	it("locks out after the max failed attempts", () => {
		const ip = "ip-lockout";
		for (let i = 0; i < MAX; i += 1) {
			recordFailedAttempt(ip);
		}
		const result = checkRateLimit(ip);
		expect(result.allowed).toBe(false);
		expect(result.attemptsRemaining).toBe(0);
		expect(result.lockedUntilMs).toBeGreaterThan(Date.now());
	});
});

describe("clearRateLimit (§5.V coverage)", () => {
	it("resets a locked IP back to fully allowed", () => {
		const ip = "ip-clear";
		for (let i = 0; i < MAX; i += 1) {
			recordFailedAttempt(ip);
		}
		expect(checkRateLimit(ip).allowed).toBe(false);
		clearRateLimit(ip);
		expect(checkRateLimit(ip)).toEqual({ allowed: true, lockedUntilMs: null, attemptsRemaining: MAX });
	});
});

describe("auto-unlock after the lockout window (§5.V coverage)", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("clears the lockout once the current time passes lockedUntil", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-06T00:00:00Z"));
		const ip = "ip-expire";
		for (let i = 0; i < MAX; i += 1) {
			recordFailedAttempt(ip);
		}
		expect(checkRateLimit(ip).allowed).toBe(false);
		vi.advanceTimersByTime(30 * 1000 + 1); // past the 30s lockout
		expect(checkRateLimit(ip)).toEqual({ allowed: true, lockedUntilMs: null, attemptsRemaining: MAX });
	});
});

describe("revokeAndRegeneratePasscode (§5.V coverage)", () => {
	it("returns a fresh non-empty passcode and clears existing rate-limit lockouts", () => {
		const ip = "ip-revoke";
		for (let i = 0; i < MAX; i += 1) {
			recordFailedAttempt(ip);
		}
		expect(checkRateLimit(ip).allowed).toBe(false);
		const passcode = revokeAndRegeneratePasscode();
		expect(typeof passcode).toBe("string");
		expect(passcode.length).toBeGreaterThan(0);
		expect(checkRateLimit(ip).allowed).toBe(true); // lockout cleared
	});
});
