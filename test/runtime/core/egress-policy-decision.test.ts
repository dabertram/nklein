import { describe, expect, it } from "vitest";
import type { SandboxNetworkPolicy } from "../../../src/core/agent-rulesets";
import {
	decideEgressPolicy,
	type EgressDecision,
	type EgressDenyReasonCode,
	type EgressPolicyRequest,
} from "../../../src/core/egress-policy-decision";

/** Tiny helper: decide an egress request from a partial (defaults `networkPolicy: "full"`). */
function decide(target: string, overrides: Partial<Omit<EgressPolicyRequest, "target">> = {}) {
	return decideEgressPolicy({ target, networkPolicy: "full", ...overrides });
}

describe("decideEgressPolicy — network policy gate (§5.L egress broker)", () => {
	it("denies all egress under the `none` policy, before any target parsing", () => {
		const d = decideEgressPolicy({ target: "https://example.com", networkPolicy: "none" });
		expect(d.decision).toBe<EgressDecision>("deny");
		expect(d.reasonCode).toBe<EgressDenyReasonCode>("no_egress_policy");
		expect(d.host).toBeNull();
	});

	it("denies even a well-formed public host under `none` (policy is checked first)", () => {
		// A garbage target under `none` still reports the policy reason — parsing never runs.
		expect(decideEgressPolicy({ target: "not a url", networkPolicy: "none" }).reasonCode).toBe("no_egress_policy");
	});

	it("allows any public named host under `full`", () => {
		const d = decide("https://api.example.com/some/path?q=1");
		expect(d.decision).toBe("allow");
		expect(d.reasonCode).toBeNull();
		expect(d.host).toBe("api.example.com");
	});
});

describe("decideEgressPolicy — target parsing", () => {
	it("rejects an unparseable target", () => {
		const d = decide("not a url");
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("unparseable_target");
		expect(d.host).toBeNull();
	});

	it("rejects a blank / whitespace-only target", () => {
		expect(decide("   ").reasonCode).toBe("unparseable_target");
		expect(decide("").reasonCode).toBe("unparseable_target");
	});

	it("rejects non-http(s) schemes (ftp / file / data)", () => {
		for (const target of ["ftp://x.com", "file:///etc/passwd", "data:text/plain,hi"]) {
			const d = decide(target);
			expect(d.decision).toBe("deny");
			expect(d.reasonCode).toBe("unsupported_scheme");
		}
	});

	it("accepts a bare host (no scheme) as https", () => {
		const d = decide("api.example.com");
		expect(d.decision).toBe("allow");
		expect(d.host).toBe("api.example.com");
	});

	it("accepts a bare host:port WITHOUT misreading the port as a scheme", () => {
		// Regression: `example.com:8443` must NOT parse as scheme `example.com:` with an empty host.
		const d = decide("example.com:8443");
		expect(d.decision).toBe("allow");
		expect(d.host).toBe("example.com");
	});

	it("accepts a `//host` shorthand as https", () => {
		expect(decide("//api.example.com").host).toBe("api.example.com");
	});

	it("normalizes host case + a trailing FQDN-root dot", () => {
		expect(decide("https://API.Example.COM.").host).toBe("api.example.com");
	});

	it("preserves the http/https path/query but decides on the host only", () => {
		expect(decide("http://example.com/a/b?c=d#e").decision).toBe("allow");
	});
});

describe("decideEgressPolicy — IP-literal targets are denied by default (prime-directive #1)", () => {
	it("denies a PUBLIC IPv4 literal as `ip_literal` (bypasses DNS/allowlist)", () => {
		const d = decide("https://8.8.8.8");
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("ip_literal");
		expect(d.host).toBe("8.8.8.8");
	});

	it("denies a public IPv4 literal even under an allowlist policy", () => {
		const d = decide("https://8.8.8.8", { networkPolicy: "allowlist", allowlist: ["8.8.8.8"] });
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("ip_literal");
	});

	it("denies loopback / private / link-local IPv4 as `private_or_lan_host`", () => {
		const privates = [
			"http://127.0.0.1",
			"http://127.5.5.5",
			"http://10.1.2.3",
			"http://172.16.0.1",
			"http://172.31.255.255",
			"http://192.168.1.5:8080",
			"http://169.254.10.10",
			"http://100.64.0.1",
			"http://0.0.0.0",
		];
		for (const target of privates) {
			const d = decide(target);
			expect(d.decision, target).toBe("deny");
			expect(d.reasonCode, target).toBe("private_or_lan_host");
		}
	});

	it("still treats a PUBLIC host in the 172.x space (outside 172.16/12) as public", () => {
		// 172.15.x and 172.32.x are public → they are IP literals, so denied as `ip_literal`, not `private_or_lan_host`.
		expect(decide("http://172.15.0.1").reasonCode).toBe("ip_literal");
		expect(decide("http://172.32.0.1").reasonCode).toBe("ip_literal");
	});

	it("canonicalizes obfuscated IPv4 forms and still denies loopback", () => {
		// `0x7f.0.0.1` → 127.0.0.1 via URL canonicalization.
		const d = decide("http://0x7f.0.0.1");
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("private_or_lan_host");
		expect(d.host).toBe("127.0.0.1");
	});

	it("denies IPv6 loopback / unspecified / link-local / unique-local literals", () => {
		for (const target of [
			"http://[::1]/",
			"http://[::]/",
			"http://[fe80::1]",
			"http://[fc00::1]",
			"http://[fd12::9]",
		]) {
			const d = decide(target);
			expect(d.decision, target).toBe("deny");
			expect(d.reasonCode, target).toBe("private_or_lan_host");
		}
	});

	it("denies an IPv4-mapped IPv6 loopback literal", () => {
		// `::ffff:127.0.0.1` is canonicalized by URL to `::ffff:7f00:1`; the decider reconstructs the embedded quad.
		const d = decide("http://[::ffff:127.0.0.1]");
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("private_or_lan_host");
	});

	it("denies a PUBLIC IPv6 literal as `ip_literal`", () => {
		const d = decide("http://[2001:4860:4860::8888]");
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("ip_literal");
	});
});

describe("decideEgressPolicy — local NAMES resolve inward and are denied", () => {
	it("denies localhost and *.localhost", () => {
		expect(decide("http://localhost").reasonCode).toBe("private_or_lan_host");
		expect(decide("http://foo.localhost").reasonCode).toBe("private_or_lan_host");
	});

	it("denies mDNS / intranet suffixes (.local / .internal / .lan / .home.arpa)", () => {
		for (const target of [
			"http://printer.local",
			"http://sub.corp.internal",
			"http://nas.lan",
			"http://router.home.arpa",
		]) {
			expect(decide(target).reasonCode, target).toBe("private_or_lan_host");
		}
	});

	it("does NOT treat a public host merely CONTAINING a local token as local", () => {
		// `internal.example.com` ends in `.com`, not `.internal` — it is public.
		expect(decide("https://internal.example.com").decision).toBe("allow");
		expect(decide("https://mylocal.io").decision).toBe("allow");
	});
});

describe("decideEgressPolicy — allowlist policy (default-deny)", () => {
	const cfg = (allowlist: readonly string[]): Partial<EgressPolicyRequest> => ({
		networkPolicy: "allowlist" as SandboxNetworkPolicy,
		allowlist,
	});

	it("allows an exact apex match", () => {
		const d = decide("https://example.com", cfg(["example.com"]));
		expect(d.decision).toBe("allow");
		expect(d.host).toBe("example.com");
	});

	it("allows a subdomain of an allowlisted apex (bare or dot-prefixed entry)", () => {
		expect(decide("https://api.example.com", cfg(["example.com"])).decision).toBe("allow");
		expect(decide("https://deep.api.example.com", cfg([".example.com"])).decision).toBe("allow");
	});

	it("allows an entry spelled as an FQDN with a trailing root dot (regression: entry-side dot must be stripped too)", () => {
		// The target host is canonicalized with its trailing dot stripped, so a `example.com.` ENTRY must strip it too —
		// else it matched nothing (neither the apex nor any dot-stripped subdomain).
		expect(decide("https://example.com", cfg(["example.com."])).decision).toBe("allow");
		expect(decide("https://api.example.com", cfg(["example.com."])).decision).toBe("allow");
	});

	it("denies a host NOT on the allowlist", () => {
		const d = decide("https://evil.com", cfg(["example.com"]));
		expect(d.decision).toBe("deny");
		expect(d.reasonCode).toBe("not_on_allowlist");
		expect(d.host).toBe("evil.com");
	});

	it("rejects a suffix look-alike (notexample.com is NOT a subdomain of example.com)", () => {
		expect(decide("https://notexample.com", cfg(["example.com"])).reasonCode).toBe("not_on_allowlist");
	});

	it("rejects a domain-append trick (example.com.evil.com)", () => {
		expect(decide("https://example.com.evil.com", cfg(["example.com"])).reasonCode).toBe("not_on_allowlist");
	});

	it("denies everything when the allowlist is empty or absent", () => {
		expect(decide("https://example.com", cfg([])).reasonCode).toBe("not_on_allowlist");
		expect(decideEgressPolicy({ target: "https://example.com", networkPolicy: "allowlist" }).reasonCode).toBe(
			"not_on_allowlist",
		);
	});

	it("ignores blank allowlist entries (a blank entry admits nothing)", () => {
		expect(decide("https://example.com", cfg(["", "   "])).reasonCode).toBe("not_on_allowlist");
	});

	it("matches allowlist entries case-insensitively and trims them", () => {
		expect(decide("https://API.example.com", cfg([" Example.COM "])).decision).toBe("allow");
	});

	it("matches a target with a trailing FQDN dot against the allowlist", () => {
		expect(decide("https://example.com.", cfg(["example.com"])).decision).toBe("allow");
	});

	it("still denies an inward host under an allowlist that lists it as a name", () => {
		// A misconfigured allowlist naming `localhost` must never override the inward-pivot deny.
		expect(decide("http://localhost", cfg(["localhost"])).reasonCode).toBe("private_or_lan_host");
	});
});

describe("decideEgressPolicy — per-action approval gate", () => {
	it("turns a permitted public host into `confirm` when approval is required", () => {
		const d = decide("https://example.com", { requirePerActionApproval: true });
		expect(d.decision).toBe<EgressDecision>("confirm");
		expect(d.reasonCode).toBeNull();
		expect(d.host).toBe("example.com");
	});

	it("turns an allowlisted host into `confirm` when approval is required", () => {
		const d = decide("https://api.example.com", {
			networkPolicy: "allowlist",
			allowlist: ["example.com"],
			requirePerActionApproval: true,
		});
		expect(d.decision).toBe("confirm");
	});

	it("NEVER softens a hard deny to confirm", () => {
		// A private host + approval-required must stay a deny (fail-closed).
		const priv = decide("http://127.0.0.1", { requirePerActionApproval: true });
		expect(priv.decision).toBe("deny");
		expect(priv.reasonCode).toBe("private_or_lan_host");

		// An off-allowlist host + approval-required stays a deny.
		const off = decide("https://evil.com", {
			networkPolicy: "allowlist",
			allowlist: ["example.com"],
			requirePerActionApproval: true,
		});
		expect(off.decision).toBe("deny");
		expect(off.reasonCode).toBe("not_on_allowlist");
	});

	it("has no effect when approval is not required (default flows to allow)", () => {
		expect(decide("https://example.com", { requirePerActionApproval: false }).decision).toBe("allow");
	});
});

describe("decideEgressPolicy — determinism + shape", () => {
	it("is a pure function of its inputs (same request → identical decision)", () => {
		const req: EgressPolicyRequest = {
			target: "https://api.example.com/x",
			networkPolicy: "allowlist",
			allowlist: ["example.com"],
		};
		expect(decideEgressPolicy(req)).toEqual(decideEgressPolicy(req));
	});

	it("always reports a reasonCode for a non-allow decision and null for allow", () => {
		const allow = decide("https://example.com");
		expect(allow.decision).toBe("allow");
		expect(allow.reasonCode).toBeNull();

		const deny = decide("http://127.0.0.1");
		expect(deny.decision).toBe("deny");
		expect(deny.reasonCode).not.toBeNull();

		const confirm = decide("https://example.com", { requirePerActionApproval: true });
		expect(confirm.decision).toBe("confirm");
		expect(confirm.reasonCode).toBeNull();
	});

	it("never leaks a host path into the reason string (safe for the audit log / prompt)", () => {
		const d = decide("https://example.com/secret/path?token=abc");
		expect(d.reason).not.toContain("secret");
		expect(d.reason).not.toContain("token");
	});
});
