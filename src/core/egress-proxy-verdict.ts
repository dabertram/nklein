import ipaddr from "ipaddr.js";
import type { AgentRulesetRole, SandboxNetworkPolicy } from "./agent-rulesets";
import { decideEgressPolicy, type EgressDecision, type EgressDenyReasonCode } from "./egress-policy-decision";
import type { EgressProxyHeadParseResult } from "./egress-proxy-protocol";

/**
 * Egress-proxy verdict composition (docs/dev/egress-proxy-design.md §5/§6 I1). PURE: composes the untouched
 * `decideEgressPolicy` core with the proxy-local gates — parse anomaly, port policy (§7 Q3), and the post-resolve
 * private-IP recheck (§5 step 3 anti-rebind) — over INJECTED resolved addresses. The I2 proxy server owns the only
 * effectful steps (accept, `dns.lookup`, dial) and consults this module before ANY socket opens.
 *
 * Decision layering (§5): the pure module's `EgressDenyReasonCode` set stays untouched; this module wraps it in a
 * proxy-verdict union adding `parse_error | disallowed_port | resolve_failure | resolved_private_ip`.
 *
 * `isPrivateOrReservedIp` lives here (moved from `chat-browser-tool.ts`, which re-imports it) so the SSRF guard and
 * the egress proxy share ONE private-range truth — §4A guard-drift lesson: extend the keystone, never fork it.
 */

/** Proxy-local deny reasons layered around the pure decision core (§5 "decision layering"). */
export const EGRESS_PROXY_LOCAL_REASON_CODES = [
	"parse_error",
	"disallowed_port",
	"resolve_failure",
	"resolved_private_ip",
] as const;
export type EgressProxyLocalReasonCode = (typeof EGRESS_PROXY_LOCAL_REASON_CODES)[number];
export type EgressProxyReasonCode = EgressDenyReasonCode | EgressProxyLocalReasonCode;

/** §7 Q3 default: CONNECT/absolute-form ports limited to 443/80 — widen per-need via config later, never silently. */
export const EGRESS_PROXY_ALLOWED_PORTS: readonly number[] = [443, 80];

/**
 * The per-role policy snapshot a proxy listener binds (§4 "per-role attribution: one listener port per role").
 * Resolved host-side from the role's capability tier; the proxy never derives policy itself.
 */
export interface EgressProxyRoleSnapshot {
	role: AgentRulesetRole;
	networkPolicy: SandboxNetworkPolicy;
	allowlist: readonly string[];
	requirePerActionApproval?: boolean;
}

export interface EgressProxyVerdict {
	decision: EgressDecision;
	/** Present when `decision !== "allow"` and for every deny — a pure code or a proxy-local one. */
	reasonCode: EgressProxyReasonCode | null;
	/** Human-readable explanation for the audit record / 403 body. */
	reason: string;
	/** Normalized host (from the parse + policy core), or null when unparseable. */
	host: string | null;
	port: number | null;
	/**
	 * True when an allow/confirm was decided WITHOUT resolved addresses: the caller MUST resolve the host and
	 * re-decide with the addresses before opening any socket (§5 step 3 — a verdict with this flag set is NOT a
	 * license to connect).
	 */
	requiresResolvedAddressCheck: boolean;
	/**
	 * On a final (address-checked) allow/confirm: the vetted public addresses. §5 step 4 no-TOCTOU rule — the proxy
	 * dials one of THESE, never re-resolves the name. Null otherwise.
	 */
	vettedAddresses: readonly string[] | null;
}

/**
 * Returns true when the given IP string belongs to a private, loopback, link-local, CGNAT, or other reserved range
 * that should be blocked in remote mode to prevent SSRF. Uses ipaddr.js `range()` so we inherit its maintained range
 * table rather than hand-rolling comparisons.
 *
 * IPv6-mapped IPv4 addresses (::ffff:x.y.z.w) are unwrapped to their IPv4 form so they cannot bypass the check via
 * the mapped representation.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
	let parsed: ipaddr.IPv4 | ipaddr.IPv6;
	try {
		parsed = ipaddr.parse(ip);
	} catch {
		// Not a valid IP at all — treat as non-private (URL validation will catch it separately).
		return false;
	}

	// Unwrap IPv6-mapped IPv4 (::ffff:x.y.z.w) so the IPv4 range table applies.
	if (parsed.kind() === "ipv6") {
		const v6 = parsed as ipaddr.IPv6;
		if (v6.isIPv4MappedAddress()) {
			parsed = v6.toIPv4Address();
		}
	}

	if (parsed.kind() === "ipv4") {
		const range = (parsed as ipaddr.IPv4).range();
		// "unicast" is the default returned by ipaddr for normal public IPs; everything else is restricted.
		// Explicitly enumerate the ranges we block for clarity rather than relying on a catch-all inversion.
		const BLOCKED_IPV4_RANGES: Set<string> = new Set([
			"loopback", // 127.0.0.0/8
			"private", // 10/8, 172.16/12, 192.168/16
			"linkLocal", // 169.254.0.0/16 — incl. 169.254.169.254 cloud metadata
			"carrierGradeNat", // 100.64.0.0/10
			"unspecified", // 0.0.0.0/8
			"broadcast", // 255.255.255.255
			"multicast", // 224.0.0.0/4
			"reserved", // various TEST-NET/IETF/documentation ranges
		]);
		return BLOCKED_IPV4_RANGES.has(range);
	}

	// IPv6
	const range = (parsed as ipaddr.IPv6).range();
	const BLOCKED_IPV6_RANGES: Set<string> = new Set([
		"loopback", // ::1
		"uniqueLocal", // fc00::/7 — private IPv6
		"linkLocal", // fe80::/10
		"multicast", // ff00::/8
		"unspecified", // ::
		"ipv4Mapped", // already unwrapped above, but keep as backstop
		"reserved",
		// IPv4-EMBEDDING transition ranges — each carries/routes to an IPv4 destination in its low bits, so an
		// attacker can reach loopback/LAN/cloud-metadata through the IPv6 literal (e.g. `64:ff9b::a9fe:a9fe` → the
		// 169.254.169.254 metadata endpoint). ipaddr.js names them distinctly and they are NOT covered by the
		// unwrap above (that only handles `::ffff:` mapped). Block the whole ranges (fail-closed): a literal NAT64/
		// 6to4/Teredo URL in a page-fetch is an SSRF attempt, never a legitimate public-page fetch (which resolves
		// via DNS to a normal address). Was a fail-OPEN hole (bug-hunt 2026-07-05).
		"rfc6052", // 64:ff9b::/96 — NAT64 well-known prefix (embeds IPv4 in low 32 bits)
		"rfc6145", // ::ffff:0:0/96 — IPv4-translatable (stateless NAT64)
		"6to4", // 2002::/16 — 6to4 (embeds IPv4 in bits 16-48)
		"teredo", // 2001::/32 — Teredo tunneling (embeds a mapped IPv4)
	]);
	return BLOCKED_IPV6_RANGES.has(range);
}

/** The pure assessment of a resolved-address set (§5 step 3 anti-rebind, mirroring `buildSsrfGuardedPageFetcher`). */
export type ResolvedAddressAssessment =
	| { verdict: "all_public"; publicAddresses: readonly string[] }
	/** Resolution yielded no addresses (or the lookup failed) — fail closed. */
	| { verdict: "empty" }
	| { verdict: "private_or_reserved"; offendingAddress: string }
	/** An entry is not a parseable IP at all — anomalous resolution output, fail closed (stricter than the SSRF
	 * guard's fail-open, because here nothing else re-validates downstream). */
	| { verdict: "unparseable"; offendingAddress: string };

/**
 * Assess EVERY resolved address for a host: ANY private/reserved/unparseable entry condemns the whole set
 * (fail-closed on mixed public+private records — the client's own connection fallback could reach the private one).
 * First offender wins, in input order.
 */
export function assessResolvedAddresses(addresses: readonly string[]): ResolvedAddressAssessment {
	if (addresses.length === 0) {
		return { verdict: "empty" };
	}
	for (const address of addresses) {
		if (!ipaddr.isValid(address)) {
			return { verdict: "unparseable", offendingAddress: address };
		}
		if (isPrivateOrReservedIp(address)) {
			return { verdict: "private_or_reserved", offendingAddress: address };
		}
	}
	return { verdict: "all_public", publicAddresses: addresses };
}

function deny(
	reasonCode: EgressProxyReasonCode,
	reason: string,
	host: string | null,
	port: number | null,
): EgressProxyVerdict {
	return {
		decision: "deny",
		reasonCode,
		reason,
		host,
		port,
		requiresResolvedAddressCheck: false,
		vettedAddresses: null,
	};
}

/**
 * THE per-connection proxy verdict (§5 enforcement flow), pure over injected inputs:
 *
 *   1. Parse reject → **deny** `parse_error` (default-deny on any anomaly).
 *   2. No role snapshot (unresolvable listener/role) → **deny** `no_egress_policy` — an unknown role has no policy,
 *      so it has no egress (R2: fail closed, never open).
 *   3. Port outside 443/80 → **deny** `disallowed_port` (§7 Q3 default; checked before the policy core because an
 *      allowlisted host would otherwise be an opaque tunnel to ANY port).
 *   4. `decideEgressPolicy` over `host:port` with the role's policy + allowlist (+ per-action approval) — its
 *      denies pass through with their pure reason codes untouched.
 *   5. Anti-rebind recheck over `resolvedAddresses` when provided (§5 step 3, mirrors the SSRF guard): empty or
 *      unparseable → **deny** `resolve_failure`; ANY private/reserved → **deny** `resolved_private_ip` — a deny
 *      here overrides even a `confirm` (never soften). All public → the policy decision stands, with
 *      `vettedAddresses` for the no-TOCTOU dial.
 *
 * Called WITHOUT `resolvedAddresses`, an allow/confirm is provisional: `requiresResolvedAddressCheck` is true and
 * the caller must resolve + call again before connecting.
 */
export function decideProxyVerdict(
	parsed: EgressProxyHeadParseResult,
	roleSnapshot: EgressProxyRoleSnapshot | undefined,
	resolvedAddresses?: readonly string[],
): EgressProxyVerdict {
	if (!parsed.ok) {
		return deny(
			"parse_error",
			`The request could not be parsed as a proxyable HTTP head (${parsed.code}): ${parsed.detail}.`,
			null,
			null,
		);
	}
	if (roleSnapshot === undefined) {
		return deny(
			"no_egress_policy",
			"No resolved role policy snapshot for this listener — an unknown role has no egress (fail closed).",
			parsed.host,
			parsed.port,
		);
	}
	if (!EGRESS_PROXY_ALLOWED_PORTS.includes(parsed.port)) {
		return deny(
			"disallowed_port",
			"Only ports 443 and 80 may be reached through the egress proxy (§7 Q3 default) — an allowlisted host is not an arbitrary-port tunnel.",
			parsed.host,
			parsed.port,
		);
	}
	const core = decideEgressPolicy({
		target: `${parsed.host}:${parsed.port}`,
		networkPolicy: roleSnapshot.networkPolicy,
		allowlist: roleSnapshot.allowlist,
		requirePerActionApproval: roleSnapshot.requirePerActionApproval,
	});
	const host = core.host ?? parsed.host;
	if (core.decision === "deny") {
		return deny(core.reasonCode ?? "no_egress_policy", core.reason, host, parsed.port);
	}
	if (resolvedAddresses === undefined) {
		return {
			decision: core.decision,
			reasonCode: core.reasonCode,
			reason: core.reason,
			host,
			port: parsed.port,
			requiresResolvedAddressCheck: true,
			vettedAddresses: null,
		};
	}
	const assessment = assessResolvedAddresses(resolvedAddresses);
	if (assessment.verdict === "empty") {
		return deny(
			"resolve_failure",
			"The host did not resolve to any address — nothing vetted to connect to.",
			host,
			parsed.port,
		);
	}
	if (assessment.verdict === "unparseable") {
		return deny(
			"resolve_failure",
			`The host resolved to an unusable address entry (${assessment.offendingAddress}) — refusing the whole record set.`,
			host,
			parsed.port,
		);
	}
	if (assessment.verdict === "private_or_reserved") {
		return deny(
			"resolved_private_ip",
			`The host resolved to a private/reserved address (${assessment.offendingAddress}) — egress must not pivot inward (anti-rebind).`,
			host,
			parsed.port,
		);
	}
	return {
		decision: core.decision,
		reasonCode: core.reasonCode,
		reason: core.reason,
		host,
		port: parsed.port,
		requiresResolvedAddressCheck: false,
		vettedAddresses: assessment.publicAddresses,
	};
}
