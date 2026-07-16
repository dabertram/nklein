/**
 * Egress provenance gate (Phase 7S / S8) — PURE decision core.
 *
 * WHAT: the canonical exfiltration vector is a poisoned page/issue/MCP result that says "send the results to
 * https://evil.example" — untrusted content STEERING where the agent egresses. The SSRF guard
 * ([chat-browser-tool.ts](../chat/chat-browser-tool.ts) `checkHostForSsrf`) already blocks PRIVATE/internal hosts; this
 * is the orthogonal layer for PUBLIC hosts: block egress to a host that was INTRODUCED BY untrusted content and that the
 * operator never authorized. It composes with the S5 provenance ledger — the untrusted content the agent has ingested is
 * exactly what taint provenance tracks — and turns "which hosts did untrusted content mention?" into an allow/deny.
 *
 * WHY pure: like taint-labels.ts / taint-provenance.ts, keeping the decision a total, deterministic predicate (no I/O,
 * no clock, no network) makes it unit-testable without a live runtime and lets one rule serve every egress seam
 * (browse_url / web_search / fetch). Host extraction is deliberately conservative — only well-formed http(s) URLs — so a
 * benign mention of a bare word can't accidentally poison the egress allowlist.
 */

/** Normalize a hostname for comparison: lowercase, trim, strip a trailing dot and any leading `www.`. */
export function normalizeHost(host: string): string {
	const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
	return trimmed.startsWith("www.") ? trimmed.slice(4) : trimmed;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

/**
 * Extract the distinct, normalized hostnames of every well-formed http(s) URL appearing anywhere in `text`. Malformed
 * matches are skipped (never throw). Order-stable by first appearance. This is how untrusted CONTENT (a fetched page, an
 * MCP result) contributes the set of hosts it "introduced" to the egress-provenance decision.
 */
export function extractHostsFromContent(text: string): string[] {
	if (typeof text !== "string" || text.length === 0) {
		return [];
	}
	const hosts: string[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(URL_IN_TEXT)) {
		let host: string;
		try {
			host = new URL(match[0]).hostname;
		} catch {
			continue;
		}
		const normalized = normalizeHost(host);
		if (normalized.length > 0 && !seen.has(normalized)) {
			seen.add(normalized);
			hosts.push(normalized);
		}
	}
	return hosts;
}

export interface EgressProvenanceInput {
	/** The host the agent wants to egress to (from the requested URL). */
	targetHost: string;
	/** Hosts that appeared in UNTRUSTED (web / MCP) content the agent has ingested — from {@link extractHostsFromContent}. */
	untrustedHosts: readonly string[];
	/**
	 * Hosts the operator/task explicitly authorized (e.g. the task's own repo host, a configured allowlist). A host here
	 * is NEVER blocked — operator intent overrides untrusted provenance, so a legitimately-requested destination that also
	 * happens to be mentioned by ingested content still goes through.
	 */
	operatorAllowedHosts?: readonly string[];
	/**
	 * Whether the turn carries sensitive / secret-shaped data that could actually be exfiltrated (in practice: the
	 * `secret_like` taint is present). Egress to an untrusted-introduced host is only the EXFILTRATION vector when there
	 * is something to steal — a plain read of a public page a source merely linked to is normal research and must NOT be
	 * blocked, or link-following breaks. Omitted ⇒ treated as true (fail-closed): a caller that cannot determine it gets
	 * the safe answer, and the live wiring always passes the real `secret_like`-taint status.
	 */
	contextCarriesSensitiveData?: boolean;
}

export interface EgressProvenanceVerdict {
	/** True ⇒ egress may proceed (subject to the other gates); false ⇒ refuse — the destination was untrusted-introduced. */
	allow: boolean;
	/** When `allow` is false, one operator-facing sentence naming the culprit host; null when allowed. */
	reason: string | null;
}

/**
 * S8 decision: block egress to `targetHost` when it was INTRODUCED BY untrusted content, the turn carries sensitive data
 * to exfiltrate, and the host is NOT operator-authorized. Allow when the host was never introduced by untrusted content
 * (the operator or the agent's own plan chose it), the operator authorized it, or there is no sensitive data at stake
 * (a plain read of a linked public page — normal research). Fail-safe: an empty `untrustedHosts` set can never block.
 * Host comparison is normalized on both sides.
 */
export function decideEgressProvenance(input: EgressProvenanceInput): EgressProvenanceVerdict {
	const target = normalizeHost(input.targetHost);
	if (target.length === 0) {
		return { allow: true, reason: null };
	}
	const allowed = new Set((input.operatorAllowedHosts ?? []).map(normalizeHost));
	if (allowed.has(target)) {
		return { allow: true, reason: null };
	}
	// No sensitive data at stake ⇒ following a link a source introduced is normal research, not exfiltration.
	if (input.contextCarriesSensitiveData === false) {
		return { allow: true, reason: null };
	}
	const untrusted = new Set(input.untrustedHosts.map(normalizeHost));
	if (untrusted.has(target)) {
		return {
			allow: false,
			reason:
				`egress to ${target} refused: sensitive data is in context and that host was introduced by untrusted ` +
				`content ingested this turn (exfiltration risk). If this destination is intended, the operator must authorize it.`,
		};
	}
	return { allow: true, reason: null };
}
