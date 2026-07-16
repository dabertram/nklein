/**
 * Skill / MCP pin-drift detection (Phase 7S / S7 supply-chain, rug-pull guard) — PURE decision core.
 *
 * TOFU (trust-on-first-use) + pin: when a skill bundle or MCP server is first approved, we record ("pin") the content
 * hash + version it had at approval. On every later resolution we compare the CURRENT hash/version against the pin. The
 * dangerous case S7 must catch is a **rug-pull**: the content changed but the version string did NOT — a silent swap of
 * an already-trusted artifact (an attacker republishes `v1.2.3` with a malicious body). A normal version bump that also
 * changes content is expected (an upgrade); an unchanged hash is safe; a never-seen artifact is TOFU (pin it, review
 * once), not drift. This core turns a (pinned, current) pair into that classification; hashing the artifact and reading/
 * writing the pin store are the effectful edges around it. Pure + total + deterministic.
 */

export type PinDriftKind =
	| "unpinned" // never seen before — trust-on-first-use; pin it (review once), not a drift
	| "unchanged" // same content hash as the pin — safe
	| "content-drift" // hash changed with the SAME version — the RUG-PULL signal (silent swap of a trusted version)
	| "version-bump" // version changed, content unchanged — a metadata-only bump
	| "version-and-content"; // version AND content changed — an ordinary upgrade (still worth a re-review)

/** The pinned state recorded at first approval (from the pin store). */
export interface PinnedArtifact {
	/** Stable artifact id (skill slug / MCP server id). */
	readonly id: string;
	/** Content hash captured at pin time. */
	readonly contentHash: string;
	/** Version string captured at pin time, or null when the artifact carries no version. */
	readonly version: string | null;
}

/** The artifact's current state, computed at resolution time. */
export interface CurrentArtifact {
	readonly contentHash: string;
	readonly version: string | null;
}

export interface PinDriftResult {
	readonly kind: PinDriftKind;
	/** True when the current state DIFFERS from the pin in a way that warrants operator attention (content-drift is the loud one). */
	readonly drifted: boolean;
	/** True specifically for the rug-pull signal: content changed while the version stayed the same. */
	readonly rugPull: boolean;
	/** One operator-facing sentence. */
	readonly reason: string;
}

function sameVersion(a: string | null, b: string | null): boolean {
	return (a ?? "").trim() === (b ?? "").trim();
}

/**
 * Classify the drift between a pin and the current artifact state. `unpinned` (pinned === null) is TOFU — pin it after a
 * one-time review, never treated as a drifted/attack signal. The rug-pull (`content-drift`: hash changed, version same)
 * is the one that flips both `drifted` and `rugPull` true; a version bump is expected and only `version-and-content` is
 * mildly worth re-review.
 */
export function detectPinDrift(pinned: PinnedArtifact | null, current: CurrentArtifact): PinDriftResult {
	if (pinned === null) {
		return {
			kind: "unpinned",
			drifted: false,
			rugPull: false,
			reason: "first sight of this artifact (trust-on-first-use); review once, then it is pinned.",
		};
	}
	const hashChanged = pinned.contentHash !== current.contentHash;
	const versionChanged = !sameVersion(pinned.version, current.version);

	if (!hashChanged) {
		return versionChanged
			? {
					kind: "version-bump",
					drifted: false,
					rugPull: false,
					reason: `version changed (${pinned.version ?? "none"} → ${current.version ?? "none"}) but content is identical — metadata-only.`,
				}
			: { kind: "unchanged", drifted: false, rugPull: false, reason: "content and version match the pin — safe." };
	}
	if (!versionChanged) {
		return {
			kind: "content-drift",
			drifted: true,
			rugPull: true,
			reason:
				`RUG-PULL: the content changed but the version (${current.version ?? "none"}) did NOT — a trusted version was ` +
				`silently swapped. Do not auto-apply; re-review and re-pin.`,
		};
	}
	return {
		kind: "version-and-content",
		drifted: true,
		rugPull: false,
		reason: `content changed with a new version (${pinned.version ?? "none"} → ${current.version ?? "none"}) — an upgrade; re-review before trusting.`,
	};
}
