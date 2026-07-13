/**
 * §5.AR skill-import safety — MODE C decision core (the "ship FIRST — the safe one" user-controlled flow).
 *
 * This is the PURE keystone that turns the epic's independently-built screening cores into ONE user-facing import
 * decision. It COMPOSES, by type only, the verdicts the other cores already produce:
 *   - trust      — {@link classifySkillSourceTrust} (item B): is the ORIGIN curated-trusted or untrusted?
 *   - prescreen  — {@link prescreenSkillInjection} (item E): does the SKILL.md body carry injection / egress markers?
 *   - bundled    — {@link validateSkillBundledFileManifest} (item A): do the bundled files carry traversal / exec risk?
 *   - a TOFU pin — the content hash the user reviewed + approved on a PRIOR import of this same skill identity.
 *
 * …and decides (a) whether the import is allowed at all, (b) how much FRICTION the user sees, and (c) whether an
 * explicit re-confirmation is required. Two properties make Mode C "the safe one":
 *
 *   1. TRUST-GRADUATED FRICTION (item B's owed wiring): a trusted+clean skill gets a light `confirm`; anything
 *      untrusted, or carrying a review-level finding, gets the full `full-review` wall; a reject-level finding is
 *      `blocked` outright — a trusted origin NEVER launders a `data_exfiltration` payload.
 *   2. TOFU HASH-PINNING (anti-rug-pull): the exact approved content hash is pinned. An UNCHANGED hash re-imports with
 *      no friction (`auto` — no re-nagging on identical bytes); a CHANGED hash on a previously-pinned skill forces a
 *      full re-screen + re-confirm REGARDLESS of trust (a trusted repo can still push a malicious update). "No silent
 *      updates" per Invariant-style tool-pinning.
 *
 * This module DECIDES-FOR-CONTAINMENT: an `allow` is a decision to SHOW the user a lighter opt-in, NOT a trust
 * assertion — the §5.AP.C explicit opt-in, the §5.L least-privilege grant, and the Docker sandbox still gate every
 * downstream execution. It NEVER fetches, hashes, reads disk, or executes: the content hash is INJECTED (hashing is a
 * trivial effectful seam the caller owns — {@link buildSkillContentPreimage} defines the canonical pre-image so the
 * security-critical "what goes into the hash, in what order" logic stays pure + tested). Pure + total: defensive on
 * malformed input, deterministic, never throws, never mutates its inputs.
 */

import type { BundledManifestResult } from "./skill-bundled-file-manifest.js";
import type { SkillScreenResult } from "./skill-injection-prescreen.js";
import type { SkillSourceClassification } from "./skill-source-trust.js";

/** The three-way import outcome. `allow` = may proceed to opt-in; `review` = must pass full human review; `reject` = barred. */
export type SkillImportDecision = "allow" | "review" | "reject";

/**
 * How much friction the user sees, from least to most:
 *   - `auto`        — already-pinned identical content; re-import silently (no re-confirm).
 *   - `confirm`     — trusted + clean + first-time; a light one-click opt-in.
 *   - `full-review` — untrusted, or carries a review-level finding, or content changed since a prior pin; show the
 *                     SKILL.md source + bundled-file manifest + scan flags + the "UNTRUSTED community content" banner.
 *   - `blocked`     — a reject-level finding; cannot be imported at all (no opt-in offered).
 */
export type SkillImportFriction = "auto" | "confirm" | "full-review" | "blocked";

/** TOFU state of the content hash being imported vs the prior pin for this skill identity. */
export type SkillImportPinState = "new" | "unchanged" | "changed";

/** Machine-stable reason codes explaining the decision (sorted worst-first in the result). */
export type SkillImportReasonCode =
	| "hard_reject_prescreen"
	| "hard_reject_bundled"
	| "hash_changed"
	| "untrusted_source"
	| "prescreen_review"
	| "bundled_review"
	| "first_import"
	| "trusted_source_clean"
	| "pin_unchanged";

/**
 * A Trust-On-First-Use pin recorded when the user reviewed + approved a specific version of a skill. Keyed by the
 * caller on a stable skill identity (origin + skill name); this core does NOT re-derive the identity — it only compares
 * the pinned hash against the current one.
 */
export interface SkillImportPin {
	/** The stable skill identity the caller keyed this pin on (origin + skill name). Opaque here; carried for provenance. */
	skillId: string;
	/** The content hash reviewed + approved at pin time — the TOFU baseline. */
	contentHash: string;
	/** ISO-8601 timestamp the pin was recorded. Provenance only; does not affect the decision. */
	pinnedAt: string;
}

/**
 * The injected verdicts + pin state the decision is computed from. Only the `verdict` fields are consumed (the full
 * finding lists live on the caller's results and are surfaced to the reviewer separately), so this accepts the minimal
 * `Pick`s — a caller can hand the whole result object.
 */
export interface SkillImportDecisionInput {
	/** Origin trust classification (item B). */
	trust: Pick<SkillSourceClassification, "trust" | "origin">;
	/** Body pre-screen verdict (item E). */
	prescreen: Pick<SkillScreenResult, "verdict">;
	/** Bundled-file manifest verdict (item A). OMITTED for a skill with no bundle (a bare SKILL.md) — treated as `safe`. */
	bundled?: Pick<BundledManifestResult, "verdict"> | null;
	/** The content hash of the skill being imported NOW. Injected — hashing is an effectful seam owned by the caller. */
	contentHash: string;
	/** The prior TOFU pin for this skill identity, if any. Absent/null ⇒ first-time import (TOFU). */
	priorPin?: SkillImportPin | null;
}

/** The discriminated decision: outcome + friction + TOFU state + reasons (worst-first) + a one-line operator summary. */
export interface SkillImportDecisionResult {
	decision: SkillImportDecision;
	friction: SkillImportFriction;
	pinState: SkillImportPinState;
	/** True when the user must explicitly (re-)confirm: first import, or a content change on a previously-pinned skill. */
	requiresReconfirm: boolean;
	/** The reason codes that drove the decision, worst-first + de-duplicated. */
	reasons: SkillImportReasonCode[];
	/** A one-line human summary, e.g. `review: untrusted source, content changed since pin (2 reason(s))`. */
	reason: string;
}

/** Friction ordering, most-severe first — used to pick the worst friction when several rules apply. */
const FRICTION_SEVERITY: Record<SkillImportFriction, number> = {
	blocked: 3,
	"full-review": 2,
	confirm: 1,
	auto: 0,
};

/** Reason-code severity for worst-first sorting (higher = surfaced first). */
const REASON_SEVERITY: Record<SkillImportReasonCode, number> = {
	hard_reject_prescreen: 100,
	hard_reject_bundled: 90,
	hash_changed: 80,
	untrusted_source: 70,
	prescreen_review: 60,
	bundled_review: 50,
	first_import: 30,
	trusted_source_clean: 20,
	pin_unchanged: 10,
};

const REASON_TEXT: Record<SkillImportReasonCode, string> = {
	hard_reject_prescreen: "body pre-screen rejected the skill",
	hard_reject_bundled: "bundled-file scan rejected the skill",
	hash_changed: "content changed since the pinned version",
	untrusted_source: "untrusted / discovery-only source",
	prescreen_review: "body pre-screen flagged content for review",
	bundled_review: "bundled-file scan flagged content for review",
	first_import: "first-time import (no prior pin)",
	trusted_source_clean: "trusted source, scans clean",
	pin_unchanged: "identical to the already-approved pinned version",
};

/** Sort worst-first, de-dupe, preserving determinism. */
function normalizeReasons(reasons: SkillImportReasonCode[]): SkillImportReasonCode[] {
	const seen = new Set<SkillImportReasonCode>();
	const deduped: SkillImportReasonCode[] = [];
	for (const r of reasons) {
		if (!seen.has(r)) {
			seen.add(r);
			deduped.push(r);
		}
	}
	return deduped.sort((a, b) => REASON_SEVERITY[b] - REASON_SEVERITY[a]);
}

/** Normalise a possibly-malformed injected verdict to one of the three known values (defaults to the safest-to-flag). */
function safeVerdict(verdict: unknown): "safe" | "review" | "reject" {
	return verdict === "safe" || verdict === "review" || verdict === "reject" ? verdict : "review";
}

/**
 * Decide how to import a skill under Mode C. Pure + total: never throws, never mutates inputs, deterministic. A
 * malformed verdict degrades to `review` (fail-toward-friction, never toward `allow`).
 */
export function decideSkillImport(input: SkillImportDecisionInput): SkillImportDecisionResult {
	const prescreenVerdict = safeVerdict(input.prescreen?.verdict);
	// A missing/null bundle means "no bundled files" — a bare SKILL.md — which is `safe` for this axis.
	const bundledVerdict = input.bundled == null ? "safe" : safeVerdict(input.bundled.verdict);
	const trust = input.trust?.trust === "trusted" ? "trusted" : "untrusted";

	const pinState = computePinState(input.priorPin, input.contentHash);

	// ---- 1. Hard reject dominates everything (even a trusted origin, even an unchanged pin). -----------------------
	// A reject-level finding is a known-bad marker; TOFU never grandfathers it and trust never launders it.
	const rejectReasons: SkillImportReasonCode[] = [];
	if (prescreenVerdict === "reject") rejectReasons.push("hard_reject_prescreen");
	if (bundledVerdict === "reject") rejectReasons.push("hard_reject_bundled");
	if (rejectReasons.length > 0) {
		return finalize("reject", "blocked", pinState, false, rejectReasons);
	}

	// ---- 2. Unchanged pin: the user already reviewed + approved THESE exact bytes. Re-import silently. -------------
	// TOFU: identical content is trusted until it changes, regardless of origin trust (the user made the call once).
	if (pinState === "unchanged") {
		return finalize("allow", "auto", pinState, false, ["pin_unchanged"]);
	}

	// Collect the review-level signals that raise friction (used by both the changed-pin and new-import paths).
	const reviewReasons: SkillImportReasonCode[] = [];
	if (trust === "untrusted") reviewReasons.push("untrusted_source");
	if (prescreenVerdict === "review") reviewReasons.push("prescreen_review");
	if (bundledVerdict === "review") reviewReasons.push("bundled_review");

	// ---- 3. Changed pin (anti-rug-pull): approved content mutated ⇒ full re-screen + re-confirm, trust or not. -----
	if (pinState === "changed") {
		return finalize("review", "full-review", pinState, true, ["hash_changed", ...reviewReasons]);
	}

	// ---- 4. First-time import (TOFU). Trust-graduated friction, but ALWAYS an explicit opt-in — never `auto`. ------
	if (reviewReasons.length > 0) {
		// Untrusted, or a review-level finding ⇒ the full-review wall.
		return finalize("review", "full-review", pinState, true, ["first_import", ...reviewReasons]);
	}
	// Trusted + both scans clean ⇒ lighter friction: a one-click confirm (still explicit — Mode C never auto-imports new).
	return finalize("allow", "confirm", pinState, true, ["first_import", "trusted_source_clean"]);
}

function computePinState(pin: SkillImportPin | null | undefined, contentHash: string): SkillImportPinState {
	if (pin == null || typeof pin.contentHash !== "string" || pin.contentHash.length === 0) return "new";
	return pin.contentHash === contentHash ? "unchanged" : "changed";
}

function finalize(
	decision: SkillImportDecision,
	friction: SkillImportFriction,
	pinState: SkillImportPinState,
	requiresReconfirm: boolean,
	reasons: SkillImportReasonCode[],
): SkillImportDecisionResult {
	const normalized = normalizeReasons(reasons);
	const summary = normalized.map((r) => REASON_TEXT[r]).join("; ");
	return {
		decision,
		friction,
		pinState,
		requiresReconfirm,
		reasons: normalized,
		reason: `${decision}/${friction}: ${summary || "no findings"}`,
	};
}

// ---------------------------------------------------------------------------
// Convenience predicates + pin construction
// ---------------------------------------------------------------------------

/** True when the import is barred outright (a reject-level finding). */
export function isSkillImportBlocked(result: SkillImportDecisionResult): boolean {
	return result.decision === "reject";
}

/** True when the user must be shown the full untrusted-review surface before any opt-in. */
export function skillImportNeedsFullReview(result: SkillImportDecisionResult): boolean {
	return result.friction === "full-review";
}

/** Pick the more-severe of two frictions (for a caller merging this decision with another gate). */
export function worstSkillImportFriction(a: SkillImportFriction, b: SkillImportFriction): SkillImportFriction {
	return FRICTION_SEVERITY[a] >= FRICTION_SEVERITY[b] ? a : b;
}

/**
 * Build the CANONICAL pre-image string that a caller hashes to produce {@link SkillImportDecisionInput.contentHash}.
 * Centralising the ordering here is the security-critical part: miss a field (or leave bundled paths unsorted) and a
 * rug-pull could mutate content without changing the hash. The caller runs a stable hash (e.g. sha256) over the
 * returned string; keeping the crypto OUT of this pure core keeps the "what is covered, in what order" logic tested in
 * isolation. Bundled paths are sorted so filesystem/listing order can't perturb the hash. Fields are length-prefixed
 * and NUL-delimited so no concatenation ambiguity (a body ending in a path separator can't masquerade as a boundary).
 */
export function buildSkillContentPreimage(parts: {
	/** The canonical manifest string (e.g. the parsed front-matter re-serialised in a fixed key order). */
	manifestCanonical: string;
	/** The raw SKILL.md markdown body. */
	body: string;
	/** The bundled-file paths (sorted here defensively; content is covered by the caller's per-file hashing if desired). */
	bundledPaths?: readonly string[];
}): string {
	const manifest = typeof parts.manifestCanonical === "string" ? parts.manifestCanonical : "";
	const body = typeof parts.body === "string" ? parts.body : "";
	const paths = Array.isArray(parts.bundledPaths)
		? [...parts.bundledPaths].filter((p): p is string => typeof p === "string").sort()
		: [];
	// `field\u0000field\u0000…` with an explicit byte length per field so no field's content can forge a delimiter.
	const fields = [
		`manifest:${manifest.length}:${manifest}`,
		`body:${body.length}:${body}`,
		`bundled:${paths.length}`,
		...paths,
	];
	return fields.join("\u0000");
}

/** Construct a TOFU pin from an approved import. `pinnedAt` is injected (no clock in a pure core). */
export function recordSkillImportPin(skillId: string, contentHash: string, pinnedAt: string): SkillImportPin {
	return { skillId, contentHash, pinnedAt };
}
