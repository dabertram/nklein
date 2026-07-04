/**
 * Work-package conflict-RESOLUTION suggester (todo.md §5.AK — parallel-dispatchable architecture + the work-package
 * discipline).
 *
 * WHAT: given a non-green `PackagePairConflict` (a Yellow/Red pair surfaced by `work-package-dispatch`), produce an
 * ordered set of concrete, deterministic *remediation options* — serialize the pair to one owner, carve the shared
 * write target so the scopes become disjoint (split), narrow an over-broad directory glob (rescope), assign a
 * lead-pre-assigned insertion point on a shared coarse/barrel path, or drop a write that lands inside the other
 * package's forbidden scope — each with the §5.AK rationale for *why* it applies and a `recommended` primary strategy.
 *
 * WHY: `work-package-dispatch` answers *which pairs conflict, and how badly* (Green/Yellow/Red), and
 * `work-package-integration-order` answers *in what order do the finished branches merge*. Neither answers the question
 * the lead-coder (contributor seam) — and, mirrored, !Klein steering its own small-model workers (product seam) — asks
 * the instant a Red/Yellow pair appears: **"so what do I DO about it?"** A raw conflict verdict is a diagnosis without a
 * prescription; a small model especially cannot improvise the fix from the bare class. This module is that prescription
 * — the §5.AK "module-ownership map" resolutions turned into machine-suggested actions, keyed off the exact overlap
 * signal (shared *specific* path → serialize/split/rescope; shared *coarse* path → assign an insertion point;
 * write-into-forbidden → drop the forbidden write) so the fan-out can be made parallel-safe by construction rather than
 * abandoned or blindly serialized.
 *
 * Relationship to siblings: reuses the §5.AK `WorkPackage` contract + `classifyPackagePairConflict` /
 * `detectWorkPackageConflicts` / `PackagePairConflict` from `work-package-dispatch.ts` rather than re-deriving the
 * overlap classification — the suggester consumes exactly what the detector emits. This is the PURE CORE: no I/O, no
 * throwing on malformed input, deterministic ordering. The runtime dispatcher / decompose-card path consumes the
 * suggestions to auto-repair or present a fix; wiring that is owed separately.
 */

import {
	classifyPackagePairConflict,
	type DispatchConflictClass,
	detectWorkPackageConflicts,
	isCoarseScopePath,
	normalizeScopeGlob,
	type PackagePairConflict,
	type WorkPackage,
} from "./work-package-dispatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A remediation strategy for a non-green work-package pair, mapped from the §5.AK module-ownership map:
 * - `serialize`               — run the two packages one owner at a time (the always-available Red fallback; the §5.AK
 *   "RED — serial write, ONE owner at a time" rule). Correct for any conflict but the least parallel.
 * - `split_scope`             — carve the shared *specific* write target so it belongs to exactly one package and remove
 *   it from the other's scope; once disjoint the pair is Green and can fan out in parallel.
 * - `rescope_over_broad`      — one package declares an over-broad directory glob that only *contains* the real conflict
 *   point; narrow it to the files it actually writes so the overlap disappears (a scoping bug, not a genuine contest).
 * - `assign_insertion_point`  — the overlap is only on a low-signal coarse/barrel/manifest path; the §5.AK "YELLOW —
 *   parallel only with lead-pre-assigned insertion points" rule: the lead assigns each package a distinct region/line
 *   of the shared file so the two edits compose without a blind collision.
 * - `drop_forbidden_write`    — a package's write target falls inside the other's declared forbidden scope; the writer
 *   must drop / relocate that write (the forbidden boundary is the owner's hard "do not touch"), or the two must be
 *   serialized under the owner.
 */
export type ConflictResolutionStrategy =
	| "serialize"
	| "split_scope"
	| "rescope_over_broad"
	| "assign_insertion_point"
	| "drop_forbidden_write";

/** One suggested remediation: the strategy, the concrete paths it acts on, and the §5.AK rationale for *why*. */
export interface ResolutionOption {
	readonly strategy: ConflictResolutionStrategy;
	/** Why this strategy applies to this pair — human-readable, cites the concrete overlap signal. */
	readonly rationale: string;
	/**
	 * The specific paths (already-normalized comparison keys) this option acts on: the shared specific/coarse write
	 * targets, or the write-into-forbidden target paths. Sorted, deduped; may be empty for `serialize` (which needs no
	 * path — it applies to the whole pair).
	 */
	readonly paths: readonly string[];
	/**
	 * For `rescope_over_broad` only: the id of the package whose over-broad glob should be narrowed (the one that
	 * declared a directory scope merely *containing* the conflict point). `null` otherwise.
	 */
	readonly narrowPackageId: string | null;
}

/** The full set of suggested resolutions for one non-green pair, with a recommended primary strategy. */
export interface ConflictResolution {
	readonly left: string;
	readonly right: string;
	/** Echoed from the input conflict (`yellow` | `red`); a `green` pair yields no resolution (see below). */
	readonly conflictClass: Exclude<DispatchConflictClass, "green">;
	/**
	 * The resolution options, ordered best-first: the most surgical parallel-preserving fix leads, `serialize` (the safe
	 * catch-all) is present for any Red and comes last among the Red options. At least one option is always present for a
	 * non-green pair.
	 */
	readonly options: readonly ResolutionOption[];
	/** The recommended primary strategy (the first option's strategy — the most parallel-preserving applicable fix). */
	readonly recommended: ConflictResolutionStrategy;
}

// ---------------------------------------------------------------------------
// Over-broad scope detection (for the rescope suggestion)
// ---------------------------------------------------------------------------

/**
 * Whether `scope` overlaps `sharedPath` only via a *directory-prefix* glob that strictly contains it — i.e. the scope
 * lists a parent directory (`src/core`) rather than the file itself (`src/core/x.ts`). Such a scope is "over-broad" for
 * this conflict: narrowing it to the files actually written would dissolve the overlap. Returns the offending broad
 * globs (sorted, deduped). An exact file-level match is NOT over-broad (both packages genuinely target the same file).
 */
function overBroadGlobsContaining(scope: readonly string[], sharedPath: string): string[] {
	const broad = new Set<string>();
	for (const glob of scope) {
		const normalized = normalizeScopeGlob(glob);
		if (normalized.length === 0) {
			continue;
		}
		// A strict directory-prefix containment (parent dir), never an exact match (that's a genuine same-file contest).
		if (normalized !== sharedPath && sharedPath.startsWith(`${normalized}/`)) {
			broad.add(normalized);
		}
	}
	return [...broad].sort();
}

/** Sort + dedupe a list of paths into a stable comparison-key array. */
function sortedUnique(paths: readonly string[]): string[] {
	return [...new Set(paths)].sort();
}

// ---------------------------------------------------------------------------
// Per-pair resolution
// ---------------------------------------------------------------------------

/**
 * Suggest remediations for one non-green pair conflict. `left`/`right` are OPTIONAL: when both `WorkPackage`s are
 * provided, a `rescope_over_broad` option is offered whenever one side's overlap is only a containing directory glob (a
 * scoping bug); without the packages, that finer suggestion is skipped and the class-driven options
 * (serialize/split/insertion-point/forbidden) still apply. Returns `null` for a Green conflict (nothing to resolve).
 *
 * Ordering (best/most-parallel-preserving first):
 *   RED (shared specific path):   rescope_over_broad? → split_scope → serialize
 *   RED (write-into-forbidden):   drop_forbidden_write → serialize
 *   RED (both signals):           the specific-path options, then drop_forbidden_write, then serialize
 *   YELLOW (shared coarse path):  assign_insertion_point   (no serialize — Yellow is already parallel-safe with the point)
 */
export function suggestPairConflictResolution(
	conflict: PackagePairConflict,
	left?: WorkPackage,
	right?: WorkPackage,
): ConflictResolution | null {
	if (conflict.conflictClass === "green") {
		return null;
	}

	const options: ResolutionOption[] = [];

	if (conflict.conflictClass === "red") {
		const specific = conflict.sharedSpecificPaths;

		// A shared *specific* write target: try the surgical fixes before falling back to serialize.
		if (specific.length > 0) {
			// rescope_over_broad — offered per side only when the packages are provided AND that side's overlap is a
			// containing directory glob (not an exact file match). The most surgical fix: it's a scoping bug.
			for (const [pkg, otherId] of [
				[left, conflict.right],
				[right, conflict.left],
			] as const) {
				if (pkg === undefined) {
					continue;
				}
				const broadPaths: string[] = [];
				for (const shared of specific) {
					broadPaths.push(...overBroadGlobsContaining(pkg.writeScope, shared));
				}
				if (broadPaths.length > 0) {
					options.push({
						strategy: "rescope_over_broad",
						rationale:
							`${pkg.id} claims the broad glob(s) ${formatList(sortedUnique(broadPaths))} that only CONTAIN the ` +
							`shared file(s) ${formatList(specific)}; narrow ${pkg.id} to the files it actually writes so it no ` +
							`longer overlaps ${otherId} (the overlap is a scoping bug, not a genuine same-file contest).`,
						paths: sortedUnique(broadPaths),
						narrowPackageId: pkg.id,
					});
				}
			}

			// split_scope — always applicable for a shared specific path: give the file to one owner, remove it from the
			// other's scope, and the pair becomes Green.
			options.push({
				strategy: "split_scope",
				rationale:
					`${conflict.left} and ${conflict.right} both write the specific file(s) ${formatList(specific)}; assign ` +
					`each to exactly ONE owner and remove it from the other's write scope — the scopes become disjoint (Green) ` +
					`and the pair can fan out in parallel.`,
				paths: specific,
				narrowPackageId: null,
			});
		}

		// A write that lands inside the other's forbidden scope: the writer must drop / relocate it.
		if (conflict.forbiddenViolations.length > 0) {
			options.push({
				strategy: "drop_forbidden_write",
				rationale:
					`A write lands inside a declared forbidden scope: ${formatList(conflict.forbiddenViolations)}. The ` +
					`forbidden boundary is the owner's hard "do not touch" — the writing package must drop or relocate that ` +
					`write (or the pair must be serialized under the owner).`,
				paths: forbiddenTargetPaths(conflict.forbiddenViolations),
				narrowPackageId: null,
			});
		}

		// serialize — the always-available Red fallback; last among the Red options (least parallel).
		options.push({
			strategy: "serialize",
			rationale:
				`If the scopes cannot be made disjoint, run ${conflict.left} and ${conflict.right} one owner at a time ` +
				`(§5.AK "RED — serial write, ONE owner at a time"): the safe catch-all, at the cost of parallelism.`,
			paths: [],
			narrowPackageId: null,
		});
	} else {
		// YELLOW — overlap only on a low-signal coarse/barrel/manifest path. The §5.AK resolution is a lead-pre-assigned
		// insertion point, not serialization (Yellow is parallel-safe once the point is assigned).
		options.push({
			strategy: "assign_insertion_point",
			rationale:
				`${conflict.left} and ${conflict.right} overlap only on the coarse/barrel/manifest path(s) ` +
				`${formatList(conflict.sharedCoarsePaths)} (a manifest, lockfile, repo-root config, or barrel index). Per ` +
				`§5.AK "YELLOW — parallel only with lead-pre-assigned insertion points", assign each package a distinct ` +
				`region/line of the shared file so the two edits compose without a blind collision.`,
			paths: conflict.sharedCoarsePaths,
			narrowPackageId: null,
		});
	}

	const first = options[0];
	// Defensive: a non-green pair always produces at least one option above, but keep this total (never index-throw).
	if (first === undefined) {
		return null;
	}
	return {
		left: conflict.left,
		right: conflict.right,
		conflictClass: conflict.conflictClass,
		options,
		recommended: first.strategy,
	};
}

/**
 * Suggest resolutions for every non-green pair in a package set: runs `detectWorkPackageConflicts` (each unordered pair
 * once) and produces a `ConflictResolution` per conflict, in the detector's order. The packages are threaded through so
 * each resolution can offer the `rescope_over_broad` option where a scope is over-broad. Green (disjoint) pairs produce
 * nothing — the result lists only the pairs that need action.
 */
export function suggestConflictResolutions(packages: readonly WorkPackage[]): ConflictResolution[] {
	const byId = new Map<string, WorkPackage>();
	for (const pkg of packages) {
		if (!byId.has(pkg.id)) {
			byId.set(pkg.id, pkg);
		}
	}
	const resolutions: ConflictResolution[] = [];
	for (const conflict of detectWorkPackageConflicts(packages)) {
		const resolution = suggestPairConflictResolution(conflict, byId.get(conflict.left), byId.get(conflict.right));
		if (resolution !== null) {
			resolutions.push(resolution);
		}
	}
	return resolutions;
}

/**
 * Convenience: classify a pair AND (if non-green) suggest its resolution in one call — the "diagnose + prescribe" pair
 * for a caller holding two `WorkPackage`s directly. Returns `null` when the pair is Green (nothing to resolve).
 */
export function resolvePackagePairConflict(left: WorkPackage, right: WorkPackage): ConflictResolution | null {
	return suggestPairConflictResolution(classifyPackagePairConflict(left, right), left, right);
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure — stable strings for the rationale)
// ---------------------------------------------------------------------------

/** Join a path/label list into a stable, human-readable `"a", "b", "c"` fragment. */
function formatList(values: readonly string[]): string {
	return values.map((value) => `"${value}"`).join(", ");
}

/**
 * Extract the target write paths from `classifyPackagePairConflict`'s human-readable forbidden-violation strings, whose
 * shape is: `<pkg> writes "<writeGlob>" inside <other>'s forbidden "<forbiddenGlob>"`. Pulls the FIRST quoted segment
 * (the offending write target) from each. Sorted, deduped. Falls back to empty when the shape does not match (so a
 * change to the sibling's message format degrades gracefully rather than throwing).
 */
function forbiddenTargetPaths(violations: readonly string[]): string[] {
	const paths: string[] = [];
	for (const violation of violations) {
		// Anchor the capture to the message's fixed trailing delimiter (`" inside … forbidden "`) rather than a
		// negated-quote class — a write glob that itself contains a `"` would otherwise be truncated at the embedded
		// quote, so the structured `paths` array reported a broader/wrong target than the human-readable rationale.
		const match = violation.match(/writes "(.+)" inside .+ forbidden "/u);
		if (match?.[1] !== undefined) {
			paths.push(match[1]);
		}
	}
	return sortedUnique(paths);
}

/** Re-exported so a caller can gate a suggestion on the coarse/specific split without importing the dispatch module. */
export { isCoarseScopePath };
