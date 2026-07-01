/**
 * Retrieved-source TRUST scorer — the "how much should I trust WHERE this came from?" gate of the "knows today"
 * lighthouse (todo §5.AC).
 *
 * WHY. §5.AC's `retrieved-evidence.ts` envelope carries a `trustTier` FIELD (`trusted`/`community`/`untrusted`), but its
 * own header is explicit that "the schema does not auto-promote anything" — the CALLER must assert the tier. So nothing
 * upstream DERIVES a trust level from the one signal every retrieved source actually has: its ORIGIN (the URL/domain and
 * declared kind). `retrieval-freshness.ts` answers "is it recent?" and `retrieval-rerank.ts` answers "is it relevant?",
 * but neither answers "is the SOURCE authoritative?" — a fresh, on-topic claim from a random forum post is not the same
 * as one from a standards body or a vendor's own docs. This module is that missing policy: score a source's ORIGIN into
 * a trust TIER + a numeric trust WEIGHT in [0,1], from deterministic domain/type signals (a government/edu/mil TLD, a
 * known high-authority host, a primary-source / vendor-doc / standards signal, or a low-trust user-generated-content
 * signal). It is the AUTHORITY half a recency×authority ranker needs (freshness is already built) and the derivation
 * that lets a caller populate `retrievedEvidenceSchema.trustTier` instead of hard-coding it — {@link toEvidenceTrustTier}
 * maps a tier straight onto that enum.
 *
 * The scorer is deterministic and SIGNAL-BASED (not a model): the injected URL is parsed to a host, then matched against
 * a small TLD-class table + a host/keyword lexicon. HIGHER trust wins over lower (the most-authoritative matched signal
 * sets the tier) — with ONE deliberate exception: an explicit LOW-trust user-generated-content host CAPS the tier at
 * `community` even if it also sits under a reputable TLD (a `.edu` personal blog / a `.gov`-hosted public forum is still
 * user content), so the policy fails SAFE toward skepticism for open-contribution surfaces. A source we cannot place
 * (no host, an IP literal, a non-http scheme, or an unrecognised domain) is `unknown` — NEVER silently trusted.
 *
 * PRIME DIRECTIVE #1 boundary: this DECIDES only — it performs NO retrieval/egress/I/O/model/UI/fs. Every input (the
 * source URL/host, its declared `sourceType`, the current lexicon) is INJECTED as a plain value; it never fetches to
 * "check" a domain's reputation and never reads a clock. PURE + deterministic → fully unit-testable. Complements — does
 * not duplicate — `retrieval-freshness.ts` (SOURCE age → band), `retrieval-rerank.ts` (query relevance → order),
 * `knowledge-volatility-ttl.ts` (topic shelf life), and `retrieved-evidence.ts` (the envelope whose `trustTier` this
 * DERIVES; this module imports nothing from it and never mutates it).
 */

// ---------------------------------------------------------------------------
// Trust tiers + weights
// ---------------------------------------------------------------------------

/**
 * How much a source's ORIGIN warrants trust, most → least:
 *   • `authoritative` — a primary/official origin: a government/mil/edu/int TLD, a standards body, or a project's own
 *     canonical docs. Treat its claims as high-confidence primary evidence.
 *   • `reputable`     — a broadly-trusted secondary source: a major reference (Wikipedia), a research preprint host, a
 *     well-known technical publisher. Reliable, but corroborate a load-bearing claim against a primary source.
 *   • `community`     — user-generated / open-contribution content (Q&A, forums, blogs, wikis-without-review). Often
 *     useful, but any single post is one person's word — corroborate before relying on it.
 *   • `unknown`       — origin we cannot place (no host, IP literal, non-http scheme, or an unrecognised domain). Do not
 *     assume trust; prefer a source you CAN place, or verify independently.
 *   • `low`           — an origin with a NEGATIVE trust signal (a flagged content-farm / low-quality-aggregator cue).
 *     Prefer any better-placed source; treat its claims as unverified.
 */
export type SourceTrustTier = "authoritative" | "reputable" | "community" | "unknown" | "low";

/**
 * Ordering authoritative(0) … low(4) so "more trustworthy than" is a numeric comparison and the most-authoritative pick
 * is a `Math.min` on rank. Note `unknown` outranks `low`: an un-placeable origin is more usable than a KNOWN-bad one.
 */
const TRUST_ORDER: readonly SourceTrustTier[] = ["authoritative", "reputable", "community", "unknown", "low"];

/** Rank of a tier in {@link TRUST_ORDER} (0 = most trustworthy). */
function trustRank(tier: SourceTrustTier): number {
	return TRUST_ORDER.indexOf(tier);
}

/**
 * Default numeric trust weight in [0,1] per tier — a scalar a ranker can multiply a freshness/relevance score by. The
 * gaps are deliberately coarse (not calibrated probabilities): they only need to ORDER tiers. `unknown` sits BELOW
 * `community` (an un-placeable origin is weaker evidence than a placeable open-contribution one) but ABOVE `low`.
 */
export const DEFAULT_TRUST_WEIGHT: Readonly<Record<SourceTrustTier, number>> = {
	authoritative: 1,
	reputable: 0.75,
	community: 0.45,
	unknown: 0.25,
	low: 0.1,
};

// ---------------------------------------------------------------------------
// Signal lexicon
// ---------------------------------------------------------------------------

/** A public-suffix label (the last dotted segment, lowercased) mapped to the tier its presence implies. */
interface TldRule {
	/** The apex TLD label, WITHOUT the leading dot (e.g. `gov`, `edu`). Matched against the host's final label. */
	readonly tld: string;
	readonly tier: SourceTrustTier;
	/** Human-readable signal name recorded in {@link SourceTrust.matchedSignals}. */
	readonly signal: string;
}

/**
 * TLD → tier table. Government / military / education / international-treaty-org TLDs are gated (registration is
 * restricted to the relevant institution), so they carry an authoritative prior. Also covers the common two-label
 * institutional suffixes (`.gov.uk`, `.ac.uk`, `.edu.au`, `.gov.au`) — checked against the host's last TWO labels.
 */
const DEFAULT_TLD_RULES: readonly TldRule[] = [
	{ tld: "gov", tier: "authoritative", signal: "gov-tld" },
	{ tld: "mil", tier: "authoritative", signal: "mil-tld" },
	{ tld: "edu", tier: "authoritative", signal: "edu-tld" },
	{ tld: "int", tier: "authoritative", signal: "int-tld" },
	// Two-label institutional suffixes (matched against the last two host labels joined by ".").
	{ tld: "gov.uk", tier: "authoritative", signal: "gov-tld" },
	{ tld: "ac.uk", tier: "authoritative", signal: "edu-tld" },
	{ tld: "edu.au", tier: "authoritative", signal: "edu-tld" },
	{ tld: "gov.au", tier: "authoritative", signal: "gov-tld" },
];

/** A host-substring or -suffix cue mapped to the tier its presence implies. Matched case-insensitively on the host. */
interface HostRule {
	/**
	 * A registrable-domain suffix to match against the host (e.g. `wikipedia.org`, `stackoverflow.com`). Matches when
	 * the host EQUALS it or ends with `.` + it (so `en.wikipedia.org` matches `wikipedia.org`), never a bare substring
	 * (`notwikipedia.org.evil.com` does NOT match `wikipedia.org`).
	 */
	readonly suffix: string;
	readonly tier: SourceTrustTier;
	/** Human-readable signal name recorded in {@link SourceTrust.matchedSignals}. */
	readonly signal: string;
	/**
	 * When true this is a LOW-trust user-content host: it CAPS the tier at `community` even under a reputable TLD (a
	 * personal blog on a university domain is still user content). Reputable hosts leave this false/absent.
	 */
	readonly userContent?: boolean;
}

/**
 * The built-in host lexicon. Order does NOT matter for the verdict (the most-authoritative matched host wins, and any
 * `userContent` host caps to community); it exists only to make `matchedSignals` deterministic. Hosts are matched as
 * registrable-domain suffixes, not substrings (see {@link HostRule.suffix}).
 */
const DEFAULT_HOST_RULES: readonly HostRule[] = [
	// Reputable secondary references / research / standards-adjacent publishers.
	{ suffix: "wikipedia.org", tier: "reputable", signal: "major-reference" },
	{ suffix: "britannica.com", tier: "reputable", signal: "major-reference" },
	{ suffix: "arxiv.org", tier: "reputable", signal: "preprint-archive" },
	{ suffix: "doi.org", tier: "reputable", signal: "doi-resolver" },
	{ suffix: "nature.com", tier: "reputable", signal: "research-publisher" },
	{ suffix: "acm.org", tier: "authoritative", signal: "standards-body" },
	{ suffix: "ieee.org", tier: "authoritative", signal: "standards-body" },
	{ suffix: "w3.org", tier: "authoritative", signal: "standards-body" },
	{ suffix: "ietf.org", tier: "authoritative", signal: "standards-body" },
	{ suffix: "iso.org", tier: "authoritative", signal: "standards-body" },
	{ suffix: "rfc-editor.org", tier: "authoritative", signal: "standards-body" },
	{ suffix: "who.int", tier: "authoritative", signal: "standards-body" },
	// Community / user-generated content — useful, but any single post is one person's word (caps to community).
	{ suffix: "stackoverflow.com", tier: "community", signal: "qa-forum", userContent: true },
	{ suffix: "stackexchange.com", tier: "community", signal: "qa-forum", userContent: true },
	{ suffix: "superuser.com", tier: "community", signal: "qa-forum", userContent: true },
	{ suffix: "serverfault.com", tier: "community", signal: "qa-forum", userContent: true },
	{ suffix: "reddit.com", tier: "community", signal: "social-forum", userContent: true },
	{ suffix: "quora.com", tier: "community", signal: "social-forum", userContent: true },
	{ suffix: "news.ycombinator.com", tier: "community", signal: "social-forum", userContent: true },
	{ suffix: "medium.com", tier: "community", signal: "user-blog", userContent: true },
	{ suffix: "substack.com", tier: "community", signal: "user-blog", userContent: true },
	{ suffix: "dev.to", tier: "community", signal: "user-blog", userContent: true },
	{ suffix: "blogspot.com", tier: "community", signal: "user-blog", userContent: true },
	{ suffix: "wordpress.com", tier: "community", signal: "user-blog", userContent: true },
	{ suffix: "tumblr.com", tier: "community", signal: "user-blog", userContent: true },
	{ suffix: "fandom.com", tier: "community", signal: "open-wiki", userContent: true },
];

/**
 * Host-label keyword cues → tier, for hosts NOT in the explicit lexicon. A host whose labels include `docs`/`developer`/
 * `api` reads as a vendor's own documentation (a primary source → reputable); one whose labels include `blog`/`forum`/
 * `community`/`wiki` reads as open-contribution content (→ community, and treated as user-content so it caps). Checked
 * against the dot-separated host LABELS (so `docs.example.com` fires `docs`, `exampledocs.com` does not).
 */
interface LabelCue {
	readonly label: RegExp;
	readonly tier: SourceTrustTier;
	readonly signal: string;
	readonly userContent?: boolean;
}

const DEFAULT_LABEL_CUES: readonly LabelCue[] = [
	{ label: /^docs?$/, tier: "reputable", signal: "vendor-docs" },
	{ label: /^developers?$/, tier: "reputable", signal: "vendor-docs" },
	{ label: /^api$/, tier: "reputable", signal: "vendor-docs" },
	{ label: /^support$/, tier: "reputable", signal: "vendor-docs" },
	{ label: /^blogs?$/, tier: "community", signal: "blog-subdomain", userContent: true },
	{ label: /^forums?$/, tier: "community", signal: "forum-subdomain", userContent: true },
	{ label: /^community$/, tier: "community", signal: "community-subdomain", userContent: true },
	{ label: /^wiki$/, tier: "community", signal: "wiki-subdomain", userContent: true },
	{ label: /^answers$/, tier: "community", signal: "qa-subdomain", userContent: true },
];

// ---------------------------------------------------------------------------
// Host parsing
// ---------------------------------------------------------------------------

/** Whether a host is a raw IPv4 / bracketed-IPv6 literal (an origin we can't reason about by domain). */
function isIpLiteralHost(host: string): boolean {
	if (host.startsWith("[") && host.endsWith("]")) {
		return true; // bracketed IPv6 literal
	}
	const octets = host.split(".");
	if (octets.length !== 4) {
		return false;
	}
	return octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Parse an injected source reference into a normalized lowercase host (no port, no trailing dot), or `null` when it has
 * no usable web host (empty, an IP literal, a non-http(s) scheme, or unparseable). A bare host/`host/path` is treated
 * as `https://<ref>` so a caller can pass either a full URL or just a domain. `new URL` canonicalizes the host.
 */
function parseSourceHost(ref: string): string | null {
	const trimmed = ref.trim();
	if (trimmed === "") {
		return null;
	}
	// Detect an explicit URI scheme. A scheme with `://` is an authority URL; a scheme WITHOUT `//` (mailto:/data:/
	// tel: …) is opaque and has no host. Either way, only http/https carries a domain-trust signal — reject the rest
	// up front so `mailto:x@y.z` is NOT mistaken for a bare host and re-parsed under a fabricated https:// prefix.
	const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
	if (schemeMatch) {
		const scheme = schemeMatch[1].toLowerCase();
		const isAuthorityUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
		if (!isAuthorityUrl || (scheme !== "http" && scheme !== "https")) {
			return null;
		}
	}
	let parsed: URL;
	try {
		parsed = new URL(schemeMatch ? trimmed : `https://${trimmed}`);
	} catch {
		return null;
	}
	// Belt-and-braces: only web origins carry a domain-trust signal.
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return null;
	}
	const host = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
	if (host === "" || isIpLiteralHost(host)) {
		return null;
	}
	return host.toLowerCase();
}

/** Whether `host` equals `suffix` or ends with `.` + `suffix` (registrable-domain suffix match, never a substring). */
function hostMatchesSuffix(host: string, suffix: string): boolean {
	return host === suffix || host.endsWith(`.${suffix}`);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Result of scoring a retrieved source's origin for trust. */
export interface SourceTrust {
	/** The trust tier the origin's signals warrant (see {@link SourceTrustTier}). */
	tier: SourceTrustTier;
	/** A scalar in [0,1] a ranker can multiply a freshness/relevance score by (from the weight table, or an override). */
	weight: number;
	/** The normalized host the verdict was derived from, or `null` when the source had no usable web host. */
	host: string | null;
	/** Distinct signals that fired, in lexicon order (deterministic). Empty when defaulted or classified by kind alone. */
	matchedSignals: string[];
	/**
	 * How the tier was reached:
	 *   • `signal`  — ≥1 domain/keyword signal fired.
	 *   • `kind`    — no domain signal, but the declared `sourceType` set a prior (a `doc` corpus / a `repo`).
	 *   • `default` — a placeable web host with no signal at all → `community` (a plain site is open content, not trusted).
	 *   • `unknown` — no usable host to reason about → `unknown`.
	 */
	basis: "signal" | "kind" | "default" | "unknown";
	/** A short rail the agent can surface: how far to trust this origin and whether to corroborate. */
	guidance: string;
}

/** The declared kind of a retrieved source — mirrors `retrievedEvidenceSchema.sourceType` in `retrieved-evidence.ts`. */
export type SourceKind = "web" | "repo" | "doc" | "mcp";

/** Options for {@link scoreSourceTrust}. All optional; every value is INJECTED (no I/O). */
export interface ScoreSourceTrustOptions {
	/** The declared source kind. Sets a prior for hostless sources: `doc` → reputable, `repo` → community. */
	sourceType?: SourceKind;
	/** Extra TLD rules appended to the built-in table (checked against the host's last one/two labels). */
	extraTldRules?: readonly TldRule[];
	/** Extra host rules appended to the built-in lexicon (registrable-domain suffix match). */
	extraHostRules?: readonly HostRule[];
	/** Extra host-label keyword cues appended to the built-in set. */
	extraLabelCues?: readonly LabelCue[];
	/** Override the tier→weight table (partial — unspecified tiers keep {@link DEFAULT_TRUST_WEIGHT}). */
	weights?: Partial<Record<SourceTrustTier, number>>;
}

function guidanceFor(tier: SourceTrustTier): string {
	switch (tier) {
		case "authoritative":
			return "Authoritative origin (official / standards / primary docs) — high-confidence primary evidence.";
		case "reputable":
			return "Reputable origin (major reference / research / vendor docs) — reliable; corroborate a load-bearing claim.";
		case "community":
			return "Community / user-generated origin — useful, but one contributor's word; corroborate before relying on it.";
		case "low":
			return "Low-trust origin (flagged low-quality source) — prefer a better-placed source; treat claims as unverified.";
		default:
			return "Unplaceable origin (no domain / IP literal / unrecognised host) — do not assume trust; verify independently.";
	}
}

/** The tier a declared source KIND implies on its own, when no domain signal is available. */
function tierForKind(kind: SourceKind | undefined): SourceTrustTier | null {
	switch (kind) {
		case "doc":
			// Operator-supplied documentation corpus — a primary reference in the caller's own control surface.
			return "reputable";
		case "repo":
			// Source-repository content — community by default (matches `retrieved-evidence.ts`'s repo prior).
			return "community";
		default:
			// "web"/"mcp"/absent carry no kind-based trust prior — they lean entirely on the domain signal.
			return null;
	}
}

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

/**
 * Score a retrieved source's ORIGIN into a trust tier + weight, purely from its URL/host and declared kind (both
 * INJECTED). Deterministic:
 *   1. Parse the ref to a normalized host. No usable host ⇒ fall back to the declared KIND's prior (`doc`/`repo`), else
 *      `unknown` (`basis: "unknown"`). Nothing is fetched to "check" a domain.
 *   2. Collect every TLD / host / label signal that fires. The MOST authoritative tier among them wins.
 *   3. If ANY firing signal is USER-CONTENT (a forum / blog / open wiki), CAP the winning tier at `community` — an open
 *      contribution surface is not trusted just because it sits under a reputable TLD (fails safe toward skepticism).
 *   4. A placeable host with NO signal ⇒ `community` (`basis: "default"`) — a plain website is open content, not
 *      auto-trusted; NEVER `authoritative`/`reputable` without a positive signal.
 * The weight comes from the (optionally overridden) tier→weight table.
 */
export function scoreSourceTrust(ref: string, options?: ScoreSourceTrustOptions): SourceTrust {
	const weightTable = { ...DEFAULT_TRUST_WEIGHT, ...options?.weights };
	const build = (
		tier: SourceTrustTier,
		host: string | null,
		matchedSignals: string[],
		basis: SourceTrust["basis"],
	): SourceTrust => ({
		tier,
		weight: weightTable[tier],
		host,
		matchedSignals,
		basis,
		guidance: guidanceFor(tier),
	});

	const host = parseSourceHost(ref ?? "");

	if (host === null) {
		// No usable web host: lean on the declared kind, else the origin is genuinely unplaceable.
		const kindTier = tierForKind(options?.sourceType);
		if (kindTier !== null) {
			return build(kindTier, null, [], "kind");
		}
		return build("unknown", null, [], "unknown");
	}

	const labels = host.split(".");
	const lastLabel = labels[labels.length - 1] ?? "";
	const lastTwo = labels.length >= 2 ? `${labels[labels.length - 2]}.${lastLabel}` : lastLabel;

	const tldRules = options?.extraTldRules ? [...DEFAULT_TLD_RULES, ...options.extraTldRules] : DEFAULT_TLD_RULES;
	const hostRules = options?.extraHostRules ? [...DEFAULT_HOST_RULES, ...options.extraHostRules] : DEFAULT_HOST_RULES;
	const labelCues = options?.extraLabelCues ? [...DEFAULT_LABEL_CUES, ...options.extraLabelCues] : DEFAULT_LABEL_CUES;

	const signals: string[] = [];
	let best: SourceTrustTier | null = null;
	let capped = false; // a user-content signal fired → cap the final tier at `community`

	const consider = (tier: SourceTrustTier, signal: string, userContent: boolean | undefined): void => {
		if (!signals.includes(signal)) {
			signals.push(signal);
		}
		if (best === null || trustRank(tier) < trustRank(best)) {
			best = tier;
		}
		if (userContent) {
			capped = true;
		}
	};

	// 1. TLD class (last one/two labels).
	for (const rule of tldRules) {
		if (rule.tld === lastLabel || (rule.tld.includes(".") && rule.tld === lastTwo)) {
			consider(rule.tier, rule.signal, false);
		}
	}
	// 2. Explicit host lexicon (registrable-domain suffix).
	for (const rule of hostRules) {
		if (hostMatchesSuffix(host, rule.suffix)) {
			consider(rule.tier, rule.signal, rule.userContent);
		}
	}
	// 3. Host-label keyword cues (per dot-separated label).
	for (const cue of labelCues) {
		if (labels.some((label) => cue.label.test(label))) {
			consider(cue.tier, cue.signal, cue.userContent);
		}
	}

	if (best === null) {
		// A placeable host with nothing else known: open web content, trusted no further than community.
		return build("community", host, [], "default");
	}

	// A user-content signal caps the tier at `community` (an open-contribution surface, whatever its TLD).
	const finalTier: SourceTrustTier = capped && trustRank(best) < trustRank("community") ? "community" : best;
	return build(finalTier, host, signals, "signal");
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** The `trustTier` values on `retrievedEvidenceSchema` (`retrieved-evidence.ts`) — kept in sync by name, not import. */
export type EvidenceTrustTier = "trusted" | "community" | "untrusted";

/**
 * Map a {@link SourceTrustTier} onto the coarser `retrievedEvidenceSchema.trustTier` enum, so a caller can DERIVE the
 * evidence envelope's tier instead of hard-coding it (`retrieved-evidence.ts`'s header notes the schema won't
 * auto-promote — this is the intended derivation). `authoritative`/`reputable` → `trusted`; `community` → `community`;
 * `unknown`/`low` → `untrusted` (an un-placeable or flagged origin must be treated as adversarial by the §5.L taint
 * pipeline until cleared).
 */
export function toEvidenceTrustTier(tier: SourceTrustTier): EvidenceTrustTier {
	switch (tier) {
		case "authoritative":
		case "reputable":
			return "trusted";
		case "community":
			return "community";
		default:
			return "untrusted";
	}
}

/**
 * Whether a source is trustworthy enough to CITE as load-bearing evidence without corroboration. `authoritative` and
 * `reputable` clear the bar; `community`/`unknown`/`low` do not (still citable, but a caller should corroborate or
 * flag them). A convenience gate over the tier for the synthesis/citation path.
 */
export function isCitableWithoutCorroboration(tier: SourceTrustTier): boolean {
	return tier === "authoritative" || tier === "reputable";
}
