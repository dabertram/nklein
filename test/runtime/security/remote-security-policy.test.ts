import { describe, expect, it } from "vitest";
import {
	buildTlsHardeningHeaders,
	type RemoteSecurityPolicyInput,
	resolveRemoteSecurityPolicy,
} from "../../../src/security/remote-security-policy";

function input(overrides: Partial<RemoteSecurityPolicyInput> = {}): RemoteSecurityPolicyInput {
	return {
		isRemote: false,
		hasTls: false,
		insecureRemoteHttp: false,
		noPasscode: false,
		disableRemoteAuth: false,
		...overrides,
	};
}

describe("resolveRemoteSecurityPolicy", () => {
	describe("loopback / local binds keep their existing behaviour", () => {
		it("loopback HTTP starts with no warnings (passcode kept)", () => {
			const decision = resolveRemoteSecurityPolicy(input({ isRemote: false, hasTls: false }));
			expect(decision).toEqual({ kind: "ok", disablePasscode: false, warnings: [] });
		});

		it("loopback HTTP with --no-passcode disables the passcode, no extra friction", () => {
			const decision = resolveRemoteSecurityPolicy(input({ isRemote: false, noPasscode: true }));
			expect(decision).toEqual({ kind: "ok", disablePasscode: true, warnings: [] });
		});

		it("does not require --dangerously-disable-remote-auth on loopback", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({ isRemote: false, noPasscode: true, disableRemoteAuth: false }),
			);
			expect(decision.kind).toBe("ok");
		});
	});

	describe("non-loopback HTTP requires HTTPS or an explicit opt-out", () => {
		it("REFUSES a non-loopback HTTP bind without --insecure-remote-http", () => {
			const decision = resolveRemoteSecurityPolicy(input({ isRemote: true, hasTls: false }));
			expect(decision.kind).toBe("refuse");
			if (decision.kind !== "refuse") throw new Error("expected refusal");
			expect(decision.reason).toBe("remote-http-without-optout");
			expect(decision.message).toContain("--cert");
			expect(decision.message).toContain("--insecure-remote-http");
		});

		it("starts a non-loopback HTTP bind WITH --insecure-remote-http and warns prominently", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({ isRemote: true, hasTls: false, insecureRemoteHttp: true }),
			);
			expect(decision.kind).toBe("ok");
			if (decision.kind !== "ok") throw new Error("expected ok");
			expect(decision.disablePasscode).toBe(false);
			expect(decision.warnings).toHaveLength(1);
			expect(decision.warnings[0]).toContain("INSECURE REMOTE HTTP");
		});

		it("starts a non-loopback HTTPS bind with no insecure-http warning", () => {
			const decision = resolveRemoteSecurityPolicy(input({ isRemote: true, hasTls: true }));
			expect(decision).toEqual({ kind: "ok", disablePasscode: false, warnings: [] });
		});

		it("does not require the opt-out flag when TLS is configured", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({ isRemote: true, hasTls: true, insecureRemoteHttp: false }),
			);
			expect(decision.kind).toBe("ok");
		});
	});

	describe("disabling auth on a non-loopback bind requires the dangerous flag", () => {
		it("REFUSES --no-passcode on a non-loopback HTTPS bind without --dangerously-disable-remote-auth", () => {
			const decision = resolveRemoteSecurityPolicy(input({ isRemote: true, hasTls: true, noPasscode: true }));
			expect(decision.kind).toBe("refuse");
			if (decision.kind !== "refuse") throw new Error("expected refusal");
			expect(decision.reason).toBe("remote-disable-auth-without-flag");
			expect(decision.message).toContain("--dangerously-disable-remote-auth");
		});

		it("REFUSES --no-passcode on a non-loopback HTTP+opt-out bind without the dangerous flag", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({ isRemote: true, hasTls: false, insecureRemoteHttp: true, noPasscode: true }),
			);
			expect(decision.kind).toBe("refuse");
			if (decision.kind !== "refuse") throw new Error("expected refusal");
			expect(decision.reason).toBe("remote-disable-auth-without-flag");
		});

		it("disables auth on a non-loopback HTTPS bind with BOTH --no-passcode and --dangerously-disable-remote-auth", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({ isRemote: true, hasTls: true, noPasscode: true, disableRemoteAuth: true }),
			);
			expect(decision.kind).toBe("ok");
			if (decision.kind !== "ok") throw new Error("expected ok");
			expect(decision.disablePasscode).toBe(true);
			expect(decision.warnings.some((w) => w.includes("REMOTE AUTHENTICATION DISABLED"))).toBe(true);
		});

		it("disables auth on a non-loopback HTTP bind with all three flags, warning about both http and auth", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({
					isRemote: true,
					hasTls: false,
					insecureRemoteHttp: true,
					noPasscode: true,
					disableRemoteAuth: true,
				}),
			);
			expect(decision.kind).toBe("ok");
			if (decision.kind !== "ok") throw new Error("expected ok");
			expect(decision.disablePasscode).toBe(true);
			expect(decision.warnings.some((w) => w.includes("INSECURE REMOTE HTTP"))).toBe(true);
			expect(decision.warnings.some((w) => w.includes("REMOTE AUTHENTICATION DISABLED"))).toBe(true);
		});

		it("does NOT disable auth when the dangerous flag is present but --no-passcode is not", () => {
			const decision = resolveRemoteSecurityPolicy(
				input({ isRemote: true, hasTls: true, noPasscode: false, disableRemoteAuth: true }),
			);
			expect(decision.kind).toBe("ok");
			if (decision.kind !== "ok") throw new Error("expected ok");
			expect(decision.disablePasscode).toBe(false);
			expect(decision.warnings).toHaveLength(0);
		});
	});

	describe("the refusal is checked transport-first", () => {
		it("REFUSES on the HTTP-without-opt-out reason even when --no-passcode is also set", () => {
			// Both violations are present; the transport refusal is the more fundamental one.
			const decision = resolveRemoteSecurityPolicy(input({ isRemote: true, hasTls: false, noPasscode: true }));
			expect(decision.kind).toBe("refuse");
			if (decision.kind !== "refuse") throw new Error("expected refusal");
			expect(decision.reason).toBe("remote-http-without-optout");
		});
	});
});

describe("buildTlsHardeningHeaders", () => {
	it("returns no headers when TLS is off (HSTS over plain HTTP would be ignored / wrong)", () => {
		expect(buildTlsHardeningHeaders(false)).toEqual({});
	});

	it("returns a strong HSTS header when TLS is on", () => {
		const headers = buildTlsHardeningHeaders(true);
		expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
	});
});
