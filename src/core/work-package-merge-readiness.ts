/**
 * Work-package MERGE-READINESS admission gate (todo.md §5.AK — parallel-dispatchable architecture + the work-package
 * discipline).
 *
 * WHAT: the pure fan-IN ADMISSION check. A subagent finishing a delegated package returns a §5.AK **Merge-Readiness
 * Pack** (`Changed files` · `Tests` command→result · `Invariants checked` · `Behavior changed` · `Integration risk` …).
 * Given the package's own contract bounds (its `writeScope` / `forbiddenScope`) and that returned pack, this module
 * decides — deterministically — whether the pack is ADMISSIBLE to enter the trunk-integration sequence at all: did the
 * work stay inside its declared write scope, keep out of its forbidden scope, run every gate GREEN, assert the
 * load-bearing invariants, and leave the human-gated protected tests untouched (or carry explicit approval)?
 *
 * WHY: this is the exact GAP between the three existing §5.AK cores. `work-package-dispatch.ts` gates the fan-OUT (may I
 * START these in parallel?). `work-package-integration-order.ts` gates the ORDER of the fan-IN (in what sequence do I
 * merge the finished branches?) — but it **assumes its inputs are already landable**; nothing validates that a returned
 * branch has EARNED the right to land. `work-package-conflict-resolution.ts` prescribes fixes for scope *contests
 * between* packages, not for a *single* returned pack's self-evidence. The §5.AK integrating seam is **"Merge-Readiness
 * Pack (what a subagent returns) ⇄ the result-branch + evidence bundle an !Klein agent returns"**, and the discipline is
 * that the sole trunk integrator (contributor seam) — mirrored, !Klein's trusted-runtime MergeBroker over its own
 * small-model workers (product seam) — must NOT integrate an under-evidenced or out-of-bounds branch. A small model
 * especially will happily report "done" while having written outside its lane, skipped a gate, or edited a protected
 * fixture to make a check pass; this gate catches exactly that BEFORE it reaches `planIntegrationOrder`.
 *
 * Relationship to siblings: reuses the §5.AK `WorkPackage` contract + `normalizeScopeGlob` from `work-package-dispatch.ts`
 * (so scope-containment uses the SAME normalization the fan-OUT classifier does) rather than re-deriving it; the two
 * cores agree on what "inside a scope" means by construction. This is the PURE CORE: no I/O, no git, no throwing on
 * malformed input — the runtime MergeBroker runs the actual gate commands and feeds their results in as a pack; this
 * module only judges the pack. Total: every helper returns a structured verdict.
 */

import { normalizeScopeGlob, type WorkPackage } from "./work-package-dispatch";

// ---------------------------------------------------------------------------
// Types — the Merge-Readiness Pack (the §5.AK artifact a finished subagent returns)
// ---------------------------------------------------------------------------

/** The outcome of one verification gate the worker ran (a §5.AK path→gate manifest entry it was required to satisfy). */
export interface GateResult {
	/** The gate's stable name (e.g. `"typecheck"`, `"biome"`, `"test:fast"`, `"test:contract"`). */
	readonly name: string;
	/** Its result. `pass` is the only admissible state; anything else blocks (`fail`) or is treated as not-yet-green. */
	readonly status: "pass" | "fail" | "skipped" | "error";
	/** Optional human-readable detail (command line, failure summary) — echoed into findings, never parsed for logic. */
	readonly detail?: string;
}

/**
 * The load-bearing invariants a §5.AK pack must assert it upheld (the prime directives that a merge may NEVER trade away
 * to pass — mirrored from `todo.md`'s "Invariants checked" pack field): strict local-only, strict Docker isolation, no
 * host-path leak into the agent's view, the ≥32k context floor, and the protected-test suite left untouched.
 */
export type MergeReadinessInvariant =
	| "local_only"
	| "docker_isolation"
	| "no_host_path_leak"
	| "min_context_floor"
	| "protected_untouched";

/** The full set of invariants a well-formed pack must assert, in the §5.AK order. */
export const REQUIRED_MERGE_READINESS_INVARIANTS: readonly MergeReadinessInvariant[] = [
	"local_only",
	"docker_isolation",
	"no_host_path_leak",
	"min_context_floor",
	"protected_untouched",
];

/**
 * The §5.AK Merge-Readiness Pack: the evidence bundle a finished subagent returns for the lead to integrate WITHOUT
 * re-deriving. Only the machine-checkable fields are modelled here (the prose fields — proposed todo bullet / CHANGELOG —
 * are for the human integrator, not this gate).
 */
export interface MergeReadinessPack {
	/** The id of the work package this pack reports on (must match the contract being checked against). */
	readonly packageId: string;
	/** Every repo-relative path the branch changed (added / modified / deleted). The §5.AK "Changed files" field. */
	readonly changedFiles: readonly string[];
	/** The gates the worker ran and their outcomes (the §5.AK "Tests: command → result" field). */
	readonly gateResults: readonly GateResult[];
	/** The invariants the worker asserts it upheld (the §5.AK "Invariants checked" field). */
	readonly assertedInvariants: readonly MergeReadinessInvariant[];
	/**
	 * Whether the worker carries EXPLICIT human approval to have touched the protected-test suite (prime directive #5).
	 * A protected-path change without this is a hard block; with it, the change is allowed but still surfaced. Optional;
	 * defaults to `false` (no approval).
	 */
	readonly protectedTestApprovalGranted?: boolean;
	/** The worker's own "behavior changed" classification (echoed only; does not affect admission). Optional. */
	readonly behaviorChanged?: "user" | "internal" | "none";
}

// ---------------------------------------------------------------------------
// Findings + verdict
// ---------------------------------------------------------------------------

/**
 * One reason a pack is not cleanly admissible. `blocking` findings force `block`; non-blocking findings only downgrade a
 * clean `admit` to `admit_with_warnings` (the integrator may still land, but should look).
 */
export interface MergeReadinessFinding {
	readonly kind:
		| "package_id_mismatch"
		| "out_of_scope_write"
		| "forbidden_write"
		| "protected_write_unapproved"
		| "protected_write_approved"
		| "gate_not_passed"
		| "missing_gate_results"
		| "invariant_not_asserted"
		| "no_changed_files";
	/** True ⇒ this finding blocks integration. False ⇒ it is a warning (admit with caveat). */
	readonly blocking: boolean;
	/** Human-readable explanation citing the concrete culprit (path / gate / invariant). */
	readonly message: string;
	/** The concrete subject of the finding (the offending path / gate name / invariant), when there is one. */
	readonly subject?: string;
}

/**
 * The admission verdict for a returned pack:
 * - `admit`               — every check passed; the branch may enter the integration sequence as-is.
 * - `admit_with_warnings` — no blocking violation, but at least one caveat (e.g. an approved protected change, a
 *   `skipped` gate, or a pack claiming completion with no changed files). The integrator may land it, eyes open.
 * - `block`               — at least one blocking violation (out-of-scope / forbidden / unapproved-protected write, a
 *   failed gate, no gate results at all, or a missing required invariant). Do NOT integrate until remediated.
 */
export type MergeReadinessVerdict = "admit" | "admit_with_warnings" | "block";

/** The full admission assessment for one returned pack. */
export interface MergeReadinessAssessment {
	readonly packageId: string;
	readonly verdict: MergeReadinessVerdict;
	/** All findings (blocking + warnings), in a stable order: blocking first, then by kind, then by subject. */
	readonly findings: readonly MergeReadinessFinding[];
	/** Convenience: the blocking findings only (empty ⇒ not blocked). */
	readonly blockingFindings: readonly MergeReadinessFinding[];
	/** The required invariants the pack failed to assert (empty ⇒ all asserted). Sorted in the §5.AK required order. */
	readonly missingInvariants: readonly MergeReadinessInvariant[];
}

// ---------------------------------------------------------------------------
// Path normalization + scope containment (shares dispatch's normalization so "inside a scope" means the same thing)
// ---------------------------------------------------------------------------

/** Repo-relative prefix of the human-gated protected-test suite (prime directive #5). Matched after normalization. */
const PROTECTED_TEST_PREFIX = "test/protected";
/** Additional exact protected files a change may not touch without approval (kept in sync with the write-guard). */
const PROTECTED_TEST_FILES: ReadonlySet<string> = new Set([
	"vitest.protected.config.ts",
	"test/protected/protected-tests.json",
]);

/**
 * Whether a changed-file path falls inside a scope glob, by directory-prefix containment on the shared normalization:
 * `a/b/c.ts` is inside `a`, inside `a/b`, and inside `a/b/c.ts` (exact), but `ab/c.ts` is NOT inside `a`. Both sides are
 * normalized via `normalizeScopeGlob` so containment agrees with the fan-OUT classifier. A trailing `/**` or `/*` on a
 * scope glob is treated as the directory it globs (so `src/core/**` contains `src/core/x.ts`).
 */
function isPathWithinScope(normalizedPath: string, scopeGlob: string): boolean {
	const normalizedScope = stripGlobTail(normalizeScopeGlob(scopeGlob));
	if (normalizedScope.length === 0) {
		return false;
	}
	return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

/** Strip a trailing glob segment (`/**`, `/*`) so a directory glob compares as its directory. Already normalized. */
function stripGlobTail(normalized: string): string {
	return normalized.replace(/\/\*\*?$/u, "").replace(/\/+$/u, "");
}

/** True when the changed path is inside ANY of the package's write-scope globs. */
function isWithinAnyScope(normalizedPath: string, scope: readonly string[]): boolean {
	for (const glob of scope) {
		if (isPathWithinScope(normalizedPath, glob)) {
			return true;
		}
	}
	return false;
}

/** True when the changed path is inside ANY forbidden glob. */
function isWithinAnyForbidden(normalizedPath: string, forbidden: readonly string[]): boolean {
	return isWithinAnyScope(normalizedPath, forbidden);
}

/** True when the (normalized) changed path is a human-gated protected-test path. */
function isProtectedTestPath(normalizedPath: string): boolean {
	return (
		normalizedPath === PROTECTED_TEST_PREFIX ||
		normalizedPath.startsWith(`${PROTECTED_TEST_PREFIX}/`) ||
		PROTECTED_TEST_FILES.has(normalizedPath)
	);
}

// ---------------------------------------------------------------------------
// The admission gate
// ---------------------------------------------------------------------------

/** Deterministic finding order: blocking first, then by kind, then by subject. */
const FINDING_KIND_ORDER: readonly MergeReadinessFinding["kind"][] = [
	"package_id_mismatch",
	"out_of_scope_write",
	"forbidden_write",
	"protected_write_unapproved",
	"gate_not_passed",
	"missing_gate_results",
	"invariant_not_asserted",
	"protected_write_approved",
	"no_changed_files",
];

function findingSortKey(finding: MergeReadinessFinding): [number, number, string] {
	const kindRank = FINDING_KIND_ORDER.indexOf(finding.kind);
	return [finding.blocking ? 0 : 1, kindRank < 0 ? FINDING_KIND_ORDER.length : kindRank, finding.subject ?? ""];
}

function compareFindings(a: MergeReadinessFinding, b: MergeReadinessFinding): number {
	const [ab, ak, as] = findingSortKey(a);
	const [bb, bk, bs] = findingSortKey(b);
	if (ab !== bb) {
		return ab - bb;
	}
	if (ak !== bk) {
		return ak - bk;
	}
	return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * Assess whether a returned Merge-Readiness Pack is admissible to enter the trunk-integration sequence for its work
 * package. Runs every §5.AK admission check and collects ALL findings (never short-circuits — the integrator sees every
 * problem at once), then derives the verdict from whether any finding blocks.
 *
 * Blocking checks (any one ⇒ `block`):
 *   1. `packageId` matches the contract (a pack reporting on the wrong package cannot be trusted for this one);
 *   2. every changed file falls inside the package's `writeScope` (no out-of-lane write);
 *   3. no changed file falls inside the package's `forbiddenScope` (the contract's hard "do not touch");
 *   4. no protected-test path (`test/protected/**`, `vitest.protected.config.ts`, `protected-tests.json`) is changed
 *      WITHOUT explicit `protectedTestApprovalGranted` (prime directive #5);
 *   5. every reported gate `status` is `pass` (a `fail`/`error` gate blocks);
 *   6. the pack reports at least one gate result (a claim of completion with zero evidence blocks);
 *   7. every required §5.AK invariant is asserted (a missing one blocks — a merge may not silently drop a directive).
 *
 * Warning checks (downgrade `admit` → `admit_with_warnings`, never block):
 *   - an APPROVED protected-test change (allowed, but always surfaced for the human integrator);
 *   - a `skipped` gate (present but not run — the integrator should know what was not covered);
 *   - a pack with an empty `changedFiles` list (a "done" with no diff is suspicious, but not itself a violation).
 *
 * Pure + total — never throws; a malformed pack (unknown invariant strings, odd paths) degrades to findings, not an
 * exception.
 */
export function assessMergeReadiness(pkg: WorkPackage, pack: MergeReadinessPack): MergeReadinessAssessment {
	const findings: MergeReadinessFinding[] = [];

	// Check 1 — the pack must report on THIS package.
	if (pack.packageId !== pkg.id) {
		findings.push({
			kind: "package_id_mismatch",
			blocking: true,
			message: `pack reports on "${pack.packageId}" but is being checked against contract "${pkg.id}"`,
			subject: pack.packageId,
		});
	}

	const forbidden = pkg.forbiddenScope ?? [];
	// Checks 2/3/4 — per changed file: forbidden > protected-unapproved > out-of-scope (report the most severe once).
	for (const rawPath of pack.changedFiles) {
		const normalizedPath = stripGlobTail(normalizeScopeGlob(rawPath));
		if (normalizedPath.length === 0) {
			continue;
		}

		if (isWithinAnyForbidden(normalizedPath, forbidden)) {
			findings.push({
				kind: "forbidden_write",
				blocking: true,
				message: `changed file "${normalizedPath}" is inside "${pkg.id}"'s forbidden scope`,
				subject: normalizedPath,
			});
			continue;
		}

		if (isProtectedTestPath(normalizedPath)) {
			if (pack.protectedTestApprovalGranted === true) {
				findings.push({
					kind: "protected_write_approved",
					blocking: false,
					message: `changed file "${normalizedPath}" is a protected-test path, allowed by explicit approval (prime directive #5)`,
					subject: normalizedPath,
				});
			} else {
				findings.push({
					kind: "protected_write_unapproved",
					blocking: true,
					message: `changed file "${normalizedPath}" is a human-gated protected-test path but no approval was granted (prime directive #5)`,
					subject: normalizedPath,
				});
			}
			// A protected path is also checked for scope below only if it isn't otherwise in scope — but protected paths
			// are Red files by definition, so treat the protected finding as terminal for this path.
			continue;
		}

		if (!isWithinAnyScope(normalizedPath, pkg.writeScope)) {
			findings.push({
				kind: "out_of_scope_write",
				blocking: true,
				message: `changed file "${normalizedPath}" is outside "${pkg.id}"'s declared write scope`,
				subject: normalizedPath,
			});
		}
	}

	// Warning — a "done" pack with no changed files at all.
	if (pack.changedFiles.length === 0) {
		findings.push({
			kind: "no_changed_files",
			blocking: false,
			message: `pack for "${pkg.id}" reports no changed files — a completion with no diff is suspicious`,
		});
	}

	// Checks 5/6 — gate results: at least one, and every one green (skipped is a warning).
	if (pack.gateResults.length === 0) {
		findings.push({
			kind: "missing_gate_results",
			blocking: true,
			message: `pack for "${pkg.id}" reports no verification gate results — nothing proves the branch is green`,
		});
	} else {
		for (const gate of pack.gateResults) {
			if (gate.status === "pass") {
				continue;
			}
			const blocking = gate.status !== "skipped";
			findings.push({
				kind: "gate_not_passed",
				blocking,
				message: `gate "${gate.name}" is ${gate.status}${gate.detail !== undefined ? ` (${gate.detail})` : ""}${
					blocking ? "" : " — not run, coverage gap"
				}`,
				subject: gate.name,
			});
		}
	}

	// Check 7 — every required invariant asserted.
	const asserted = new Set(pack.assertedInvariants);
	const missingInvariants = REQUIRED_MERGE_READINESS_INVARIANTS.filter((inv) => !asserted.has(inv));
	for (const inv of missingInvariants) {
		findings.push({
			kind: "invariant_not_asserted",
			blocking: true,
			message: `pack for "${pkg.id}" does not assert the required invariant "${inv}"`,
			subject: inv,
		});
	}

	findings.sort(compareFindings);
	const blockingFindings = findings.filter((f) => f.blocking);
	const verdict: MergeReadinessVerdict =
		blockingFindings.length > 0 ? "block" : findings.length > 0 ? "admit_with_warnings" : "admit";

	return { packageId: pkg.id, verdict, findings, blockingFindings, missingInvariants };
}

/**
 * Batch admission: assess a set of returned packs against their contracts and split them into the ids the integrator may
 * proceed with (`admissible` — verdict `admit` or `admit_with_warnings`) vs. the ids that must NOT be integrated yet
 * (`blocked`). A pack with no matching contract is reported as a blocked `unmatched` id (it cannot be admitted without a
 * contract to check its bounds against). The `assessments` carry the full per-pack detail, keyed to input order.
 *
 * This is the gate the trusted-runtime MergeBroker runs BEFORE handing the surviving set to
 * `work-package-integration-order.planIntegrationOrder` — only admissible packages should be ordered for merge.
 */
export function admitReadyPackages(
	packages: readonly WorkPackage[],
	packs: readonly MergeReadinessPack[],
): {
	readonly assessments: readonly MergeReadinessAssessment[];
	readonly admissible: readonly string[];
	readonly blocked: readonly string[];
	readonly unmatched: readonly string[];
} {
	const byId = new Map<string, WorkPackage>();
	for (const pkg of packages) {
		if (!byId.has(pkg.id)) {
			byId.set(pkg.id, pkg);
		}
	}

	const assessments: MergeReadinessAssessment[] = [];
	const admissible: string[] = [];
	const blocked: string[] = [];
	const unmatched: string[] = [];

	for (const pack of packs) {
		const contract = byId.get(pack.packageId);
		if (contract === undefined) {
			unmatched.push(pack.packageId);
			blocked.push(pack.packageId);
			continue;
		}
		const assessment = assessMergeReadiness(contract, pack);
		assessments.push(assessment);
		if (assessment.verdict === "block") {
			blocked.push(pack.packageId);
		} else {
			admissible.push(pack.packageId);
		}
	}

	return { assessments, admissible, blocked, unmatched };
}
