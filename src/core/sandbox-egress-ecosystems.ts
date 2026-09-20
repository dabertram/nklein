/**
 * P1.SANDBOXPACKS (b) — ecosystem egress packs for the sandbox allowlist. PURE core.
 *
 * David 2026-09-14: "the sandbox shall be ready for python .. and it shall be possible to extend the sandbox
 * as-needed in general .. for reasonable ecosystems". The `medium` capability tier reaches the network only through
 * the allowlisted egress proxy, and the allowlist was a hand-written host list (`registry.npmjs.org`). Extending the
 * sandbox to another ecosystem meant knowing that ecosystem's registry hosts by heart — and getting one wrong fails
 * closed with a 403 that looks like a broken toolchain.
 *
 * An `ecosystem:<name>` entry in `sandboxEgressAllowlist` expands to that ecosystem's registry hosts. The packs are
 * the CANONICAL public registries only (no mirrors, no CDNs beyond the registry's own), so a pack never widens
 * egress past what installing packages from that ecosystem needs. An unknown pack name is left as a plain entry —
 * the existing fail-safe-narrow rule: a typo grants nobody anything, it stays an unreachable host.
 */

export const SANDBOX_EGRESS_ECOSYSTEM_PACKS: Readonly<Record<string, readonly string[]>> = {
	/** npm / pnpm / yarn / bun installs. */
	npm: ["registry.npmjs.org"],
	/** pip / uv installs (index + wheel/sdist file host). */
	python: ["pypi.org", "files.pythonhosted.org"],
	/**
	 * `uv python install` — Astral's python-build-standalone releases are served from GitHub release assets.
	 * Separate from `python` so a rig that bakes its interpreters into the image never opens GitHub.
	 */
	"python-toolchain": ["github.com", "objects.githubusercontent.com"],
	/** cargo installs (sparse index + crate files). */
	rust: ["crates.io", "index.crates.io", "static.crates.io"],
	/** go module proxy + checksum database. */
	go: ["proxy.golang.org", "sum.golang.org", "storage.googleapis.com"],
	/** Maven Central + the Gradle plugin portal and distribution host. */
	java: ["repo.maven.apache.org", "repo1.maven.org", "plugins.gradle.org", "services.gradle.org"],
	/** RubyGems. */
	ruby: ["rubygems.org", "index.rubygems.org"],
	/**
	 * The `lookup` fact-check tool's SEARCH leg (NKLEIN_LOOKUP): DuckDuckGo's server-rendered HTML endpoint — no API
	 * key, no JavaScript. Result PAGES are never pre-listed: each fetch rides a per-task time-bounded grant issued by
	 * the trusted runtime through the proxy's control channel (`egress-task-grants.ts`).
	 */
	lookup: ["html.duckduckgo.com"],
};

export const ECOSYSTEM_ENTRY_PREFIX = "ecosystem:";

/** The pack names an operator may write, in a stable order (for settings hints and docs). */
export function listSandboxEgressEcosystems(): string[] {
	return Object.keys(SANDBOX_EGRESS_ECOSYSTEM_PACKS);
}

/**
 * Expand `ecosystem:<name>` entries (optionally role-scoped: `worker:ecosystem:python`) into their hosts, keeping
 * every other entry byte-identical and in place. Pure; unknown pack names pass through unchanged.
 */
export function expandSandboxEgressEcosystems(entries: readonly string[]): string[] {
	const expanded: string[] = [];
	for (const entry of entries) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const at = trimmed.indexOf(ECOSYSTEM_ENTRY_PREFIX);
		if (at < 0) {
			expanded.push(trimmed);
			continue;
		}
		const scope = trimmed.slice(0, at); // "" or "<role>:"
		const name = trimmed
			.slice(at + ECOSYSTEM_ENTRY_PREFIX.length)
			.trim()
			.toLowerCase();
		const hosts = SANDBOX_EGRESS_ECOSYSTEM_PACKS[name];
		if (!hosts || (scope.length > 0 && !scope.endsWith(":"))) {
			expanded.push(trimmed);
			continue;
		}
		for (const host of hosts) expanded.push(`${scope}${host}`);
	}
	return expanded;
}
