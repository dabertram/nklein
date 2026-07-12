import { describe, expect, it } from "vitest";
import { parseAbsoluteFormRequestLine, parseConnectRequestLine } from "../../../src/core/egress-proxy-protocol";
import {
	assessResolvedAddresses,
	decideProxyVerdict,
	EGRESS_PROXY_ALLOWED_PORTS,
	type EgressProxyRoleSnapshot,
	isPrivateOrReservedIp,
} from "../../../src/core/egress-proxy-verdict";

const connect = (authority: string) => parseConnectRequestLine(`CONNECT ${authority} HTTP/1.1`);

const snap = (overrides: Partial<EgressProxyRoleSnapshot> = {}): EgressProxyRoleSnapshot => ({
	role: "worker",
	networkPolicy: "allowlist",
	allowlist: ["example.com"],
	...overrides,
});

describe("decideProxyVerdict — parse anomalies deny as parse_error (§5 step 1)", () => {
	it("maps ANY protocol reject to a parse_error deny carrying the protocol code", () => {
		const v = decideProxyVerdict(connect("example.com"), snap()); // missing port
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("parse_error");
		expect(v.reason).toContain("missing_port");
		expect(v.host).toBeNull();
		expect(v.port).toBeNull();
		expect(v.requiresResolvedAddressCheck).toBe(false);
		expect(v.vettedAddresses).toBeNull();
	});

	it("denies parse_error even under the most permissive snapshot (no policy can rescue garbage)", () => {
		const v = decideProxyVerdict(parseConnectRequestLine("garbage"), snap({ networkPolicy: "full" }));
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("parse_error");
	});
});

describe("decideProxyVerdict — unknown role / missing snapshot fails closed (R2)", () => {
	it("denies with no_egress_policy when no role snapshot resolves", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), undefined);
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("no_egress_policy");
		expect(v.host).toBe("api.example.com");
		expect(v.port).toBe(443);
	});
});

describe("decideProxyVerdict — port policy (§7 Q3 default: 443/80 only)", () => {
	it("exposes exactly 443 and 80 as the allowed ports", () => {
		expect([...EGRESS_PROXY_ALLOWED_PORTS].sort()).toEqual([443, 80].sort());
	});

	it("denies disallowed ports even for an allowlisted host", () => {
		for (const authority of ["example.com:8443", "example.com:22", "example.com:3306", "example.com:8080"]) {
			const v = decideProxyVerdict(connect(authority), snap());
			expect(v.decision, authority).toBe("deny");
			expect(v.reasonCode, authority).toBe("disallowed_port");
		}
	});

	it("denies disallowed ports even under the full policy (structural gate, not a policy one)", () => {
		const v = decideProxyVerdict(connect("anything.io:9000"), snap({ networkPolicy: "full", allowlist: [] }));
		expect(v.reasonCode).toBe("disallowed_port");
		expect(v.port).toBe(9000);
	});

	it("passes 443 (CONNECT) and 80 (absolute-form plain HTTP) through to the policy core", () => {
		expect(decideProxyVerdict(connect("api.example.com:443"), snap()).decision).toBe("allow");
		const httpGet = parseAbsoluteFormRequestLine("GET http://api.example.com/x HTTP/1.1");
		expect(decideProxyVerdict(httpGet, snap()).decision).toBe("allow");
	});
});

describe("decideProxyVerdict — decideEgressPolicy composition (pure codes untouched)", () => {
	it("allows an allowlisted host and its subdomains (provisional until addresses are checked)", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap());
		expect(v.decision).toBe("allow");
		expect(v.reasonCode).toBeNull();
		expect(v.host).toBe("api.example.com");
		expect(v.port).toBe(443);
		expect(v.requiresResolvedAddressCheck).toBe(true);
		expect(v.vettedAddresses).toBeNull();
	});

	it("denies a host not on the allowlist (default-deny)", () => {
		const v = decideProxyVerdict(connect("evil.com:443"), snap());
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("not_on_allowlist");
		expect(v.host).toBe("evil.com");
	});

	it("denies EVERYTHING under an empty allowlist", () => {
		const v = decideProxyVerdict(connect("example.com:443"), snap({ allowlist: [] }));
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("not_on_allowlist");
	});

	it("denies all egress under the none policy", () => {
		const v = decideProxyVerdict(connect("example.com:443"), snap({ networkPolicy: "none" }));
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("no_egress_policy");
	});

	it("denies IP literals (they bypass DNS + allowlist), with precise private/LAN reasons", () => {
		expect(decideProxyVerdict(connect("8.8.8.8:443"), snap({ networkPolicy: "full" })).reasonCode).toBe("ip_literal");
		expect(decideProxyVerdict(connect("10.0.0.1:443"), snap({ networkPolicy: "full" })).reasonCode).toBe(
			"private_or_lan_host",
		);
		expect(decideProxyVerdict(connect("[::1]:443"), snap({ networkPolicy: "full" })).reasonCode).toBe(
			"private_or_lan_host",
		);
		expect(decideProxyVerdict(connect("[2001:db8::1]:443"), snap({ networkPolicy: "full" })).reasonCode).toBe(
			"ip_literal",
		);
	});

	it("denies local NAMES under every policy (localhost / mDNS / intranet suffixes)", () => {
		for (const authority of ["localhost:443", "foo.localhost:443", "printer.local:443", "nas.lan:443"]) {
			const v = decideProxyVerdict(connect(authority), snap({ networkPolicy: "full" }));
			expect(v.decision, authority).toBe("deny");
			expect(v.reasonCode, authority).toBe("private_or_lan_host");
		}
	});

	it("normalizes the target host on the way through (case + FQDN root dot)", () => {
		const v = decideProxyVerdict(connect("API.Example.COM.:443"), snap());
		expect(v.decision).toBe("allow");
		expect(v.host).toBe("api.example.com");
	});

	it("allows any public named host under the full policy", () => {
		const v = decideProxyVerdict(connect("anything.io:443"), snap({ networkPolicy: "full", allowlist: [] }));
		expect(v.decision).toBe("allow");
	});
});

describe("decideProxyVerdict — per-action approval (confirm) layering", () => {
	it("turns a permitted host into confirm when the role requires approval", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap({ requirePerActionApproval: true }));
		expect(v.decision).toBe("confirm");
		expect(v.reasonCode).toBeNull();
		expect(v.requiresResolvedAddressCheck).toBe(true);
	});

	it("NEVER softens a deny to confirm (off-allowlist and disallowed-port stay denies)", () => {
		expect(decideProxyVerdict(connect("evil.com:443"), snap({ requirePerActionApproval: true })).decision).toBe(
			"deny",
		);
		expect(decideProxyVerdict(connect("example.com:9999"), snap({ requirePerActionApproval: true })).decision).toBe(
			"deny",
		);
	});
});

describe("decideProxyVerdict — anti-rebind recheck over injected resolved addresses (§5 step 3)", () => {
	it("finalizes an allow when every resolved address is public, exposing the vetted set", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap(), ["93.184.216.34", "2606:2800:220:1::1"]);
		expect(v.decision).toBe("allow");
		expect(v.requiresResolvedAddressCheck).toBe(false);
		expect(v.vettedAddresses).toEqual(["93.184.216.34", "2606:2800:220:1::1"]);
	});

	it("denies resolved_private_ip when ANY address is private/reserved (mixed-record fail-close)", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap(), ["93.184.216.34", "10.0.0.5"]);
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("resolved_private_ip");
		expect(v.reason).toContain("10.0.0.5");
		expect(v.vettedAddresses).toBeNull();
	});

	it("denies the rebind classics: loopback, link-local metadata, mapped-IPv4, NAT64", () => {
		for (const address of ["127.0.0.1", "169.254.169.254", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe"]) {
			const v = decideProxyVerdict(connect("api.example.com:443"), snap(), [address]);
			expect(v.reasonCode, address).toBe("resolved_private_ip");
		}
	});

	it("denies resolve_failure on an empty resolution", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap(), []);
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("resolve_failure");
	});

	it("denies resolve_failure on unparseable address entries (stricter than the SSRF guard's fail-open)", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap(), ["not-an-ip"]);
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("resolve_failure");
	});

	it("hardens a confirm into a deny when resolution lands private (recheck outranks approval)", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap({ requirePerActionApproval: true }), [
			"192.168.1.9",
		]);
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("resolved_private_ip");
	});

	it("finalizes a confirm with vetted addresses when resolution is public", () => {
		const v = decideProxyVerdict(connect("api.example.com:443"), snap({ requirePerActionApproval: true }), [
			"1.1.1.1",
		]);
		expect(v.decision).toBe("confirm");
		expect(v.requiresResolvedAddressCheck).toBe(false);
		expect(v.vettedAddresses).toEqual(["1.1.1.1"]);
	});

	it("cannot rescue a policy deny with clean addresses", () => {
		const v = decideProxyVerdict(connect("evil.com:443"), snap(), ["93.184.216.34"]);
		expect(v.decision).toBe("deny");
		expect(v.reasonCode).toBe("not_on_allowlist");
	});
});

describe("assessResolvedAddresses (pure anti-rebind core, reused private-range truth)", () => {
	it("returns all_public with the address list preserved", () => {
		expect(assessResolvedAddresses(["8.8.8.8", "2001:4860:4860::8888"])).toEqual({
			verdict: "all_public",
			publicAddresses: ["8.8.8.8", "2001:4860:4860::8888"],
		});
	});

	it("returns empty for an empty set", () => {
		expect(assessResolvedAddresses([])).toEqual({ verdict: "empty" });
	});

	it("flags the FIRST offender in input order", () => {
		expect(assessResolvedAddresses(["1.1.1.1", "garbage", "127.0.0.1"])).toEqual({
			verdict: "unparseable",
			offendingAddress: "garbage",
		});
		expect(assessResolvedAddresses(["1.1.1.1", "127.0.0.1", "garbage"])).toEqual({
			verdict: "private_or_reserved",
			offendingAddress: "127.0.0.1",
		});
	});

	it("blocks private, loopback, link-local, CGNAT, unique-local, and multicast ranges", () => {
		for (const address of [
			"10.1.2.3",
			"172.16.0.1",
			"192.168.0.1",
			"169.254.0.1",
			"100.64.0.1",
			"fc00::1",
			"ff02::1",
		]) {
			expect(assessResolvedAddresses([address]).verdict, address).toBe("private_or_reserved");
		}
	});
});

describe("isPrivateOrReservedIp lives in the verdict core (moved from the chat SSRF guard)", () => {
	it("keeps the SSRF guard's exact semantics (spot checks incl. the NAT64/6to4/Teredo fail-close)", () => {
		expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("::ffff:10.0.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("64:ff9b::a9fe:a9fe")).toBe(true);
		expect(isPrivateOrReservedIp("2002:7f00:1::1")).toBe(true);
		expect(isPrivateOrReservedIp("2001:0:abcd::1")).toBe(true);
		expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
		expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
		// Fail-open on non-IP input is the CHAT guard's documented contract; the proxy path closes it via
		// assessResolvedAddresses' unparseable verdict instead.
		expect(isPrivateOrReservedIp("not-an-ip")).toBe(false);
	});
});

describe("decideProxyVerdict — determinism", () => {
	it("is a pure function of its inputs", () => {
		const parsed = connect("api.example.com:443");
		const s = snap();
		expect(decideProxyVerdict(parsed, s, ["1.1.1.1"])).toEqual(decideProxyVerdict(parsed, s, ["1.1.1.1"]));
	});
});
