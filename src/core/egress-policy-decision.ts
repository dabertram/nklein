/**
 * Egress / browser-access decision core (todo §5.L — "PROVENANCE/TAINT + a real EGRESS broker" → the **Egress broker**
 * leaf: "DNS/SNI/domain allowlist enforcement · deny IP-literals + LAN ranges by default · per-action egress approval").
 * PURE decision core.
 *
 * WHAT: given a single outbound request's TARGET (a URL, or a bare host) + the role's effective sandbox network policy
 * ({@link SandboxNetworkPolicy}, resolved from `agent-rulesets.ts`) + a domain allowlist, decide
 * `allow | deny | confirm` and say why. It is the deterministic heart the eventual real egress broker (DNS/SNI proxy,
 * per-action approval prompt) sits on: the proxy asks THIS function whether a host may be reached before opening a
 * socket, so the allow/deny rule is one unit-testable place instead of scattered through I/O.
 *
 * WHY / prime-directive #1 (local-only): "open" grants web/data egress, but egress must never become a pivot onto the
 * user's own machine or LAN. So beyond honoring the tier's network policy, this decider FAIL-CLOSES on the ways an
 * injected instruction would try to reach inward — IP-literal targets (they bypass DNS/allowlist entirely) and any
 * loopback / private / link-local / LAN host are DENIED by default, even under the most-open network policy. A public
 * host is then checked against the allowlist. Like `agent-rulesets.ts` / `taint-labels.ts` this is intentionally pure
 * (no DNS lookup, no socket, no SDK): it DECIDES only — it never performs the request. It composes `SandboxNetworkPolicy`
 * + {@link sandboxNetworkHasEgress} by import and does not modify them.
 *
 * SCOPE (deliberate): reasons over the TARGET + policy + allowlist only. It does NOT resolve DNS (a name→IP mapping is
 * the proxy's job at connect time — a decider that trusts a resolved IP would be racing a rebind), does NOT scan content
 * for injection (that is the taint scanner), and does NOT decide tool-level capability (that is the capability broker,
 * a sibling §5.L leaf). Honoring an allowlist entry does not by itself grant egress: the network policy gates first.
 */

import { type SandboxNetworkPolicy, sandboxNetworkHasEgress } from "./agent-rulesets";

/** The verdict for an outbound request. `confirm` = allowed only behind an explicit, logged per-action approval. */
export type EgressDecision = "allow" | "deny" | "confirm";

/** Why a host is disallowed / gated, so the audit log + user prompt can explain the refusal precisely. */
export type EgressDenyReasonCode =
	/** The role's network policy grants no outbound egress at all (`none`). */
	| "no_egress_policy"
	/** The target could not be parsed into an http/https host. */
	| "unparseable_target"
	/** The scheme is not http/https (e.g. `ftp:`, `file:`, `data:`). */
	| "unsupported_scheme"
	/** The host is a raw IP literal — it bypasses DNS/allowlist, so it is denied by default (prime-directive #1). */
	| "ip_literal"
	/** The host is loopback / private / link-local / LAN — reaching inward is denied by default (prime-directive #1). */
	| "private_or_lan_host"
	/** The public host is not on the allowlist (the `allowlist` policy is default-deny). */
	| "not_on_allowlist";

export interface EgressPolicyDecision {
	decision: EgressDecision;
	/** Present when `decision !== "allow"` (a `confirm` is a soft gate; a `deny` a hard one) — else `null`. */
	reasonCode: EgressDenyReasonCode | null;
	/** Human-readable explanation for the audit trail / approval prompt. */
	reason: string;
	/** The normalized (lowercased, punycode, userinfo-stripped) host that was evaluated, or `null` if unparseable. */
	host: string | null;
}

/** A request to reach an outbound target. Everything the decision needs is injected — no ambient config, no I/O. */
export interface EgressPolicyRequest {
	/**
	 * The outbound target. Either a full URL (`https://host/path`) or a bare host (`host` / `host:port`). A bare host
	 * is treated as `https://<host>` so the same host rules apply; a URL with a non-http(s) scheme is rejected.
	 */
	target: string;
	/** The role's effective sandbox network policy (resolved via `resolveEffectiveAgentRuleset(...).capabilities.network`). */
	networkPolicy: SandboxNetworkPolicy;
	/**
	 * The domain allowlist consulted when the policy is `allowlist`. Each entry is a host; a `.` prefix (or a bare
	 * apex) also matches subdomains (`example.com` and `.example.com` both admit `api.example.com`). Ignored when the
	 * policy is `full` (all public hosts allowed) or `none` (nothing allowed). Absent/empty ⇒ nothing is allowlisted.
	 */
	allowlist?: readonly string[];
	/**
	 * Whether a public, allowlisted, egress-permitted host should still require a per-action confirmation rather than
	 * flowing automatically. Models the "per-action egress approval" leaf: the caller (a role/session policy) opts into
	 * the friction. Default `false` (an already-permitted public host flows). NEVER downgrades a `deny`.
	 */
	requirePerActionApproval?: boolean;
}

/**
 * Whether a normalized hostname is a raw IPv4 / IPv6 literal. `new URL` already canonicalizes obfuscated IPv4 forms
 * (`0x7f.0.0.1` → `127.0.0.1`) and brackets IPv6 (`[::1]`), so by the time we see the host the shapes are regular.
 */
function isIpLiteral(host: string): boolean {
	if (host.startsWith("[") && host.endsWith("]")) {
		return true; // bracketed IPv6 literal, e.g. [::1] / [fe80::1]
	}
	// Dotted-quad IPv4: exactly four 0-255 octets. (URL parsing rejects >255, but validate defensively.)
	const octets = host.split(".");
	if (octets.length !== 4) {
		return false;
	}
	return octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** The four dotted octets of an IPv4 literal (caller guarantees {@link isIpLiteral} dotted-quad shape). */
function ipv4Octets(host: string): [number, number, number, number] {
	const [a, b, c, d] = host.split(".").map(Number);
	return [a, b, c, d];
}

/**
 * Whether an IPv4 literal is loopback / private / link-local / CGNAT / unspecified — i.e. NOT a routable public host.
 * Covers the ranges an inward pivot would use: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 (link-local),
 * 100.64/10 (CGNAT), and 0.0.0.0. Public IPv4 literals are still denied as `ip_literal` upstream; this exists so the
 * reason is the more precise `private_or_lan_host` when it applies.
 */
function isPrivateIpv4(host: string): boolean {
	const [a, b] = ipv4Octets(host);
	if (a === 127 || a === 10 || a === 0) {
		return true;
	}
	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}
	if (a === 192 && b === 168) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true;
	}
	if (a === 100 && b >= 64 && b <= 127) {
		return true;
	}
	return false;
}

/** Whether a bracketed IPv6 literal is loopback / unspecified / link-local / unique-local (fc00::/7). */
function isPrivateIpv6(host: string): boolean {
	const inner = host.slice(1, -1).toLowerCase(); // strip [ ]
	if (inner === "::1" || inner === "::") {
		return true; // loopback / unspecified
	}
	if (inner.startsWith("fe80")) {
		return true; // link-local
	}
	if (inner.startsWith("fc") || inner.startsWith("fd")) {
		return true; // unique-local (fc00::/7)
	}
	// IPv4-mapped IPv6. `new URL` canonicalizes the embedded IPv4 to hex, so `::ffff:127.0.0.1` arrives as
	// `::ffff:7f00:1`; reconstruct the dotted quad from the two trailing hextets and defer to the IPv4 check.
	const mappedHex = inner.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (mappedHex) {
		const hi = Number.parseInt(mappedHex[1], 16);
		const lo = Number.parseInt(mappedHex[2], 16);
		const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
		if (isPrivateIpv4(dotted)) {
			return true;
		}
	}
	// The rarer dotted form (some inputs keep `::ffff:127.0.0.1`) — defer to the embedded IPv4 check too.
	const mappedDotted = inner.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (mappedDotted && isPrivateIpv4(mappedDotted[1])) {
		return true;
	}
	return false;
}

/**
 * Whether a hostname is loopback / private / link-local / LAN and therefore inward-reaching. Handles both IP literals
 * and the well-known local NAMES (`localhost`, `*.local` mDNS, `*.internal`, `*.lan`, `*.home.arpa`) that resolve to a
 * LAN even without an IP literal — an allowlist of public domains must never be tricked into admitting `localhost`.
 */
function isPrivateOrLanHost(host: string): boolean {
	if (host.startsWith("[") && host.endsWith("]")) {
		return isPrivateIpv6(host);
	}
	if (isIpLiteral(host)) {
		return isPrivateIpv4(host);
	}
	if (host === "localhost" || host.endsWith(".localhost")) {
		return true;
	}
	return host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa");
}

/** Parse a target into its normalized http/https host, or a rejection reason. Bare hosts are treated as https. */
function parseTargetHost(target: string): { host: string } | { reject: EgressDenyReasonCode } {
	const trimmed = target.trim();
	if (trimmed === "") {
		return { reject: "unparseable_target" };
	}
	// Distinguish an explicit URL scheme from a bare `host:port`. A `scheme://…` is always a scheme. A `scheme:` with
	// NO `//` (e.g. `data:…`, `mailto:…`) is a scheme too — UNLESS what follows the colon is purely a port number, in
	// which case it is a bare `host:port` (`example.com:8443`, which URL would otherwise misparse as protocol
	// `example.com:` with an EMPTY host). A bare host — including `host:port` and the `//host` shorthand — is treated as
	// https so the host rules apply uniformly.
	const schemeOnly = /^([a-z][a-z0-9+.-]*):(?!\/\/)(.*)$/i.exec(trimmed);
	const isBareHostPort = schemeOnly !== null && /^\d+(\/.*)?$/.test(schemeOnly[2]);
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || (schemeOnly !== null && !isBareHostPort);
	const candidate = hasScheme ? trimmed : `https://${trimmed.replace(/^\/\//, "")}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return { reject: "unparseable_target" };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { reject: "unsupported_scheme" };
	}
	if (url.hostname === "") {
		return { reject: "unparseable_target" };
	}
	// A trailing FQDN-root dot (`example.com.`) is stripped so host/allowlist comparisons are canonical.
	const host = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
	return { host };
}

/**
 * Normalize an allowlist entry to a bare, lowercased apex host: drop surrounding whitespace, a leading `.`, AND a
 * trailing FQDN-root `.` — the target host is canonicalized with its trailing dot stripped (see `parseTargetHost`), so
 * an entry spelled as an FQDN (`example.com.`) must strip it too, else it would match nothing (neither the apex nor any
 * subdomain of a dot-stripped target).
 */
function normalizeAllowlistEntry(entry: string): string {
	return entry.trim().toLowerCase().replace(/^\./, "").replace(/\.$/, "");
}

/**
 * Whether a (normalized) public host is admitted by the allowlist. An entry matches its exact host AND any subdomain
 * of it (`example.com` admits `example.com` and `api.example.com`, but NOT `notexample.com` or `example.com.evil.com`).
 * Empty/blank entries never match.
 */
function hostMatchesAllowlist(host: string, allowlist: readonly string[]): boolean {
	return allowlist.some((raw) => {
		const apex = normalizeAllowlistEntry(raw);
		if (apex === "") {
			return false;
		}
		return host === apex || host.endsWith(`.${apex}`);
	});
}

/**
 * THE §5.L EGRESS RULE, as a pure decision. Precedence (fail-closed at every step):
 *
 *   1. Policy `none` → **deny** (`no_egress_policy`): the role has no egress; nothing reaches the network.
 *   2. Unparseable / non-http(s) target → **deny** (`unparseable_target` / `unsupported_scheme`).
 *   3. IP-literal host → **deny** (`ip_literal`): a literal bypasses DNS + the allowlist, so it is refused outright
 *      (even a *public* literal — force egress through named, allowlistable hosts). Prime-directive #1.
 *   4. Loopback / private / link-local / LAN host (by IP or by local name) → **deny** (`private_or_lan_host`):
 *      egress must never pivot inward, under ANY policy. Prime-directive #1.
 *   5. Otherwise the host is public and named:
 *        - policy `full`      → allow every public host;
 *        - policy `allowlist` → allow ONLY hosts on the allowlist (default-deny → `not_on_allowlist`).
 *      A permitted public host becomes **confirm** instead of **allow** when `requirePerActionApproval` is set (the
 *      per-action egress-approval leaf); a `deny` is never softened to `confirm`.
 *
 * `full` allowing every public host is by design: at `fully_open`/`more_open` the tier already granted open egress —
 * the value this decider adds there is the inward-pivot fail-closes (3+4), not a second allowlist. Use `allowlist`
 * (which `sandboxNetworkHasEgress` reports as no-egress at the Docker layer today, pending the proxy) when you want the
 * per-domain gate; this decider is exactly the enforcement that proxy will consult.
 */
export function decideEgressPolicy(request: EgressPolicyRequest): EgressPolicyDecision {
	// 1. No egress at all.
	if (request.networkPolicy === "none") {
		return {
			decision: "deny",
			reasonCode: "no_egress_policy",
			reason: "The role's network policy grants no outbound egress.",
			host: null,
		};
	}

	// 2. Parse the target.
	const parsed = parseTargetHost(request.target);
	if ("reject" in parsed) {
		return {
			decision: "deny",
			reasonCode: parsed.reject,
			reason:
				parsed.reject === "unsupported_scheme"
					? "Only http/https targets may be reached; this scheme is refused."
					: "The target could not be parsed into an http/https host.",
			host: null,
		};
	}
	const host = parsed.host;

	// 3. IP literals bypass DNS + the allowlist — refuse outright, and label a private one precisely.
	if (isIpLiteral(host)) {
		if (isPrivateOrLanHost(host)) {
			return {
				decision: "deny",
				reasonCode: "private_or_lan_host",
				reason: "Loopback/private/LAN IP literals are never reachable — egress must not pivot inward.",
				host,
			};
		}
		return {
			decision: "deny",
			reasonCode: "ip_literal",
			reason: "IP-literal targets bypass DNS and the allowlist and are denied by default; use a named host.",
			host,
		};
	}

	// 4. Local NAMES (localhost / *.local / *.internal / *.lan / *.home.arpa) resolve inward — deny by default.
	if (isPrivateOrLanHost(host)) {
		return {
			decision: "deny",
			reasonCode: "private_or_lan_host",
			reason: "Loopback/private/LAN hosts are never reachable — egress must not pivot inward.",
			host,
		};
	}

	// 5. A public, named host. Egress-granting policy decides; the allowlist is default-deny when it is the policy.
	if (request.networkPolicy === "allowlist") {
		const allowlist = request.allowlist ?? [];
		if (!hostMatchesAllowlist(host, allowlist)) {
			return {
				decision: "deny",
				reasonCode: "not_on_allowlist",
				reason: "The host is not on the egress allowlist (allowlist policy is default-deny).",
				host,
			};
		}
	} else if (!sandboxNetworkHasEgress(request.networkPolicy)) {
		// Defensive: any future non-egress policy value that reaches here is denied rather than silently allowed.
		return {
			decision: "deny",
			reasonCode: "no_egress_policy",
			reason: "The role's network policy does not grant outbound egress to public hosts.",
			host,
		};
	}

	// Permitted public host — apply the optional per-action approval gate.
	if (request.requirePerActionApproval === true) {
		return {
			decision: "confirm",
			reasonCode: null,
			reason: "Egress to this public host is permitted but requires an explicit, logged per-action approval.",
			host,
		};
	}
	return {
		decision: "allow",
		reasonCode: null,
		reason:
			request.networkPolicy === "allowlist"
				? "The host is on the egress allowlist."
				: "Egress to this public host is permitted by the role's network policy.",
		host,
	};
}
