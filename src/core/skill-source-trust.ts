/**
 * §5.AR skill-import safety — TRUSTED-SOURCE classification (item B). A PURE, TOTAL, FAIL-SAFE gate: given a skill's
 * source URL, decide whether it comes from a curated TRUSTED origin (less friction) or must go through the full
 * untrusted review (Mode C: show the SKILL.md source + bundled-file manifest + deterministic-scan flags + an explicit
 * "UNTRUSTED community content" banner + a hash-pinned per-skill opt-in). Anything unrecognized — a malformed URL, an
 * unknown host, a discovery-only index — resolves to UNTRUSTED, never trusted by default.
 *
 * The trusted set is deliberately SMALL and posture-based, not popularity-based (todo §5.AR.B): the official Anthropic
 * skills repo, agentskills.io, and the one community registry with real posture (CI static-analysis + Snyk +
 * content-hashing + immutable lockfiles + no binaries). The large 2M indexes (SkillsMP, LobeHub, Skills.sh, hoodini,
 * wshobson) are DISCOVERY-ONLY — they resolve to untrusted here, so a skill *found* through them still gets the full
 * review. This module NEVER fetches or executes anything; it only classifies an origin string.
 */

export type SkillSourceTrust = "trusted" | "untrusted";

export interface SkillSourceClassification {
	trust: SkillSourceTrust;
	/** The normalized origin used for the decision (host, or `host/owner/repo` for code hosts) — for display/provenance. */
	origin: string;
	/** A short operator-facing reason for the verdict. */
	reason: string;
}

/** github.com owner/repo pairs whose skills are trusted (compared case-insensitively). */
const TRUSTED_GITHUB_REPOS: ReadonlyArray<readonly [owner: string, repo: string]> = [
	["anthropics", "skills"],
	["tech-leads-club", "agent-skills"],
];

/** Bare hosts (any path) whose skills are trusted. */
const TRUSTED_HOSTS: readonly string[] = ["agentskills.io"];

/**
 * Classify a skill source URL as trusted or untrusted. Total + fail-safe: unparseable / non-web / unrecognized ⇒
 * untrusted. github.com (and its raw host) are decided by the exact owner/repo, so a fork or a look-alike repo is NOT
 * trusted just because it lives on github.
 */
export function classifySkillSourceTrust(sourceUrl: string): SkillSourceClassification {
	let url: URL;
	try {
		url = new URL(sourceUrl);
	} catch {
		return { trust: "untrusted", origin: sourceUrl.trim() || "(empty)", reason: "unparseable source URL" };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { trust: "untrusted", origin: url.href, reason: `non-web protocol "${url.protocol}"` };
	}
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	if (host === "github.com" || host === "raw.githubusercontent.com") {
		const segments = url.pathname.split("/").filter(Boolean);
		const owner = (segments[0] ?? "").toLowerCase();
		const repo = (segments[1] ?? "").toLowerCase().replace(/\.git$/, "");
		const origin = `github.com/${owner}/${repo}`;
		const trusted = TRUSTED_GITHUB_REPOS.some(([o, r]) => o === owner && r === repo);
		return trusted
			? { trust: "trusted", origin, reason: "curated trusted skills repository" }
			: { trust: "untrusted", origin, reason: "unrecognized code-host repository" };
	}
	if (TRUSTED_HOSTS.includes(host)) {
		return { trust: "trusted", origin: host, reason: "curated trusted skills registry" };
	}
	return { trust: "untrusted", origin: host, reason: "unrecognized / discovery-only source" };
}

/** Convenience boolean for the common gate — everything not explicitly trusted goes through the full untrusted review. */
export function isTrustedSkillSource(sourceUrl: string): boolean {
	return classifySkillSourceTrust(sourceUrl).trust === "trusted";
}
