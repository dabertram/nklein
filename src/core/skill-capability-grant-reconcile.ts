/**
 * Skill capability-GRANT reconciler (todo §5.AP.D — "an activated skill runs under the SAME §5.L per-role capability
 * ruleset … least-privilege `allowed-tools`") — PURE, deterministic decision core.
 *
 * WHAT: given a parsed community skill's DECLARED `allowed-tools` (the {@link ParsedSkillManifest.allowedTools} produced
 * by `skill-md-parse.ts`, imported BY TYPE — never modified) and the host's §5.L per-role ALLOWED tool set (both
 * INJECTED as plain values), compute the EFFECTIVE least-privilege GRANT the skill may actually use. Returns a
 * discriminated `{ granted, denied, effectiveTools, posture, reason }`: `granted` = declared ∩ allowed (the tools the
 * skill both asked for AND the host permits), `denied` = declared − allowed (asked for but NOT permitted — the
 * over-reach the containment must strip), and `effectiveTools` = the exact, de-duplicated, sorted allowlist to hand a
 * sandboxed run. It NEVER executes a tool, reads the filesystem, or reaches the network — it decides a grant, nothing
 * more.
 *
 * WHY (§5.AP is "containment, not detection"; #1 local-only, fail-closed): the injection pre-screen
 * (`skill-injection-prescreen.ts`) already FLAGS capability over-reach as a risk finding, and `capability-escalation.ts`
 * compares two full {@link ToolCapabilityManifest}s — but neither PRODUCES the artifact §5.AP.D needs to actually run a
 * skill: the concrete least-privilege allowlist (intersection) plus the explicit denied list (what was stripped and
 * why). This module is that reconciliation. The rule is intersection, never union: a skill can only ever be granted the
 * INTERSECTION of what it declared and what the host role permits — declaring a tool the host forbids grants nothing
 * (it lands in `denied`), and the host permitting a tool the skill never asked for grants nothing either (least
 * privilege: a skill gets only what it needs AND is allowed). The `undeclared` vs explicit-`[]` distinction that
 * `skill-md-parse.ts` deliberately preserves is honoured here as two DIFFERENT postures (see {@link GrantPosture}): a
 * skill that declares no `allowed-tools` at all is treated as requesting NOTHING (deny-all — the safe default for
 * untrusted community content), NOT as "trust me with everything".
 *
 * SCOPE (deliberate): reconciles TWO STRING LISTS into a grant. It does NOT scan the body for injection markers (that is
 * `skill-injection-prescreen.ts`), does NOT compare capability manifests axis-by-axis (that is
 * `capability-escalation.ts`), does NOT decide the execution mode (`tool-capability-manifest.ts`'s
 * `decideManifestChatAccess`), and does NOT decide trust/opt-in/pinning (§5.AP.B/C). It composes
 * `ParsedSkillManifest.allowedTools` by IMPORT (type-only) and never edits it. Kept pure + data-driven to mirror
 * `capability-escalation.ts` / `skill-injection-prescreen.ts` / `taint-labels.ts`, so the least-privilege grant lives in
 * one unit-testable place. A `granted`/`effectiveTools` result is the tools to ALLOW; it is NOT a trust assertion about
 * the skill — the injection pre-screen + §5.AP.C opt-in + the Docker sandbox still gate everything else.
 */

import type { ParsedSkillManifest } from "./skill-md-parse";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * The overall posture of a reconciled grant, so a UI / audit record / §5.L broker can branch without re-deriving:
 *   • `undeclared`   — the skill declared NO `allowed-tools` field at all (`allowedTools === undefined`). Treated as
 *     requesting nothing → deny-all. The safe default for untrusted community content: an activated skill that never
 *     asked for a tool gets none. DISTINCT from `empty_declaration` (an explicit `[]`), per `skill-md-parse.ts`.
 *   • `empty_declaration` — the skill EXPLICITLY declared `allowed-tools: []`. Also grants nothing, but the intent was
 *     stated ("I need no tools") rather than omitted — surfaced separately because the two mean different things to a
 *     reviewer / the §5.L gate (an omission may be a mistake; an explicit `[]` is a self-declared no-tool skill).
 *   • `fully_granted` — every tool the skill declared is in the host's allowed set (`denied` is empty and it declared at
 *     least one tool). The skill's request is entirely within the role's ceiling.
 *   • `partially_granted` — some declared tools were granted and some were denied (both `granted` and `denied`
 *     non-empty). The skill runs, but with the over-reaching tools STRIPPED.
 *   • `fully_denied` — the skill declared tools but NONE are in the host's allowed set (`granted` is empty, `denied` is
 *     not). Nothing it asked for is permitted; the effective allowlist is empty.
 */
export type GrantPosture = "undeclared" | "empty_declaration" | "fully_granted" | "partially_granted" | "fully_denied";

/** A single tool the skill DECLARED but the host does NOT permit — the over-reach the containment strips, with a reason. */
export interface DeniedTool {
	/** The declared tool name (trimmed/de-duplicated exactly as `skill-md-parse.ts` normalised it). */
	tool: string;
	/** Why it was denied — a machine-stable {@link DeniedReason} plus a human-readable line for the audit trail. */
	reason: DeniedReason;
	detail: string;
}

/**
 * Machine-stable reasons a declared tool was denied (a UI / quarantine record can branch on these without string-
 * matching `detail`). Today there is one substantive reason — the tool is not in the host's allowed set — kept as a
 * named code so future host-policy denials (e.g. a globally-forbidden tool) can be distinguished from a plain role miss.
 */
export type DeniedReason =
	/** The declared tool is not present in the host's §5.L per-role allowed set (the over-reach case). */
	"not_in_allowed_set";

/** The reconciled least-privilege grant for an activated skill under the host's §5.L role ceiling. */
export interface SkillCapabilityGrant {
	/**
	 * The declared tools the host PERMITS — the intersection of the skill's `allowed-tools` and the host's allowed set,
	 * de-duplicated and sorted. This is the "asked-for AND allowed" set; it is a subset of {@link effectiveTools} (equal
	 * to it, in fact — see {@link effectiveTools}).
	 */
	granted: string[];
	/** Every declared tool the host does NOT permit, each with its reason — the over-reach the containment must strip. */
	denied: DeniedTool[];
	/**
	 * The exact, de-duplicated, sorted allowlist to hand a sandboxed run — the tools the skill may actually use. By the
	 * intersection rule this equals {@link granted}; it is surfaced under an execution-oriented name so a caller wiring
	 * the grant into a sandbox reads the field for its role, not by inference. Empty for every deny-all posture.
	 */
	effectiveTools: string[];
	/** The overall {@link GrantPosture} — a single discriminator for a UI / §5.L broker / audit branch. */
	posture: GrantPosture;
	/** One-line human-readable summary for logs / the §5.L capability-broker surface. */
	reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise an INJECTED allowed-set into a de-duplicated `Set` of trimmed, non-empty tool names. Defensive by design:
 * the host allowed set is a plain value that may arrive with blanks / duplicates / non-string junk (e.g. from a config
 * file), so anything that is not a non-empty string is dropped rather than trusted. Declared tool names from
 * `skill-md-parse.ts` are already trimmed/de-duped, but they are trimmed here too so a match is whitespace-insensitive
 * on both sides (a declared `"editor "` and an allowed `"editor"` reconcile as the same tool).
 */
function normaliseNameSet(names: readonly unknown[] | undefined): Set<string> {
	const out = new Set<string>();
	if (!Array.isArray(names)) {
		return out;
	}
	for (const raw of names) {
		if (typeof raw !== "string") {
			continue;
		}
		const trimmed = raw.trim();
		if (trimmed.length > 0) {
			out.add(trimmed);
		}
	}
	return out;
}

/** Sort a set of names into a stable, de-duplicated array (localeCompare-free — pure code-point order, deterministic). */
function sortedUnique(names: Iterable<string>): string[] {
	return Array.from(new Set(names)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile a parsed skill's DECLARED `allowed-tools` against the host's §5.L per-role ALLOWED tool set into the
 * effective least-privilege {@link SkillCapabilityGrant}.
 *
 * Rule (intersection, never union): the skill may use ONLY the tools it declared AND the host permits. A declared tool
 * absent from `allowedSet` is DENIED (over-reach → stripped, recorded in {@link SkillCapabilityGrant.denied}); a host-
 * permitted tool the skill never declared is IGNORED (least privilege — a skill gets only what it asked for). A skill
 * that declared NO `allowed-tools` field is `undeclared` → deny-all (the safe default); an explicit `allowed-tools: []`
 * is `empty_declaration` → also deny-all but with stated intent. Both distinctions come straight from
 * `skill-md-parse.ts`, which preserves undeclared-vs-`[]`.
 *
 * Inputs are INJECTED plain values — the {@link ParsedSkillManifest} (only its `allowedTools`/`name` are read; the
 * object is never mutated) and the host allowed set as a `readonly string[]`. The allowed set is normalised defensively
 * (blank / non-string entries dropped, whitespace trimmed, duplicates collapsed) so a mis-typed config cannot silently
 * widen a grant.
 *
 * Pure + total: no I/O, no ambient state, no throw; identical inputs always yield an identical grant. `granted`,
 * `effectiveTools`, and each `denied[].tool` are de-duplicated and sorted for a stable, comparable result.
 */
export function reconcileSkillCapabilityGrant(
	manifest: ParsedSkillManifest,
	allowedSet: readonly string[],
): SkillCapabilityGrant {
	const skillName =
		typeof manifest.name === "string" && manifest.name.trim().length > 0 ? manifest.name.trim() : "skill";
	const allowed = normaliseNameSet(allowedSet);

	// UNDECLARED: the skill never declared `allowed-tools` → it requested nothing → deny-all (the safe default).
	if (manifest.allowedTools === undefined) {
		return {
			granted: [],
			denied: [],
			effectiveTools: [],
			posture: "undeclared",
			reason: `deny-all: '${skillName}' declared no allowed-tools; an activated skill that requests nothing is granted nothing.`,
		};
	}

	const declared = normaliseNameSet(manifest.allowedTools);

	// EXPLICIT EMPTY: the skill stated `allowed-tools: []` → also deny-all, but the intent was declared, not omitted.
	if (declared.size === 0) {
		return {
			granted: [],
			denied: [],
			effectiveTools: [],
			posture: "empty_declaration",
			reason: `deny-all: '${skillName}' explicitly declared an empty allowed-tools list (a self-declared no-tool skill).`,
		};
	}

	// INTERSECTION: partition the declared tools into granted (in the host set) and denied (over-reach).
	const grantedSet = new Set<string>();
	const denied: DeniedTool[] = [];
	for (const tool of declared) {
		if (allowed.has(tool)) {
			grantedSet.add(tool);
		} else {
			denied.push({
				tool,
				reason: "not_in_allowed_set",
				detail: `Declared tool '${tool}' is not in the host's allowed set; stripped from the effective grant.`,
			});
		}
	}

	const granted = sortedUnique(grantedSet);
	denied.sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
	const effectiveTools = granted; // intersection ⇒ effective allowlist == granted, by construction.

	let posture: GrantPosture;
	let reason: string;
	if (denied.length === 0) {
		posture = "fully_granted";
		reason = `fully granted: all ${granted.length} declared tool(s) of '${skillName}' are within the host's allowed set.`;
	} else if (granted.length === 0) {
		posture = "fully_denied";
		reason = `fully denied: none of the ${denied.length} declared tool(s) of '${skillName}' are in the host's allowed set; the effective grant is empty.`;
	} else {
		posture = "partially_granted";
		reason = `partially granted: ${granted.length} of ${declared.size} declared tool(s) of '${skillName}' granted, ${denied.length} stripped as over-reach.`;
	}

	return { granted, denied, effectiveTools, posture, reason };
}

/**
 * Convenience predicate: true iff reconciling the skill against the host set strips at least one declared tool as
 * over-reach (i.e. `denied` is non-empty). Useful for a quick "did the containment have to narrow this skill?" check
 * without inspecting the full grant. An `undeclared` / `empty_declaration` skill declared nothing to strip → `false`.
 */
export function skillGrantHasOverreach(manifest: ParsedSkillManifest, allowedSet: readonly string[]): boolean {
	return reconcileSkillCapabilityGrant(manifest, allowedSet).denied.length > 0;
}
