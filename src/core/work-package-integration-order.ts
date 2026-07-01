/**
 * Work-package MERGE / integration-order policy (todo.md §5.AK — parallel-dispatchable architecture + the work-package
 * discipline).
 *
 * WHAT: the pure FAN-IN counterpart to `work-package-dispatch.ts`'s fan-OUT planner. Given a set of *completed* work
 * packages ready to land on trunk, compute the safe SEQUENTIAL apply/merge order the sole trunk integrator should use,
 * plus — for each landing — which already-landed packages touched overlapping write scope (so it can be rebased /
 * re-verified against them), and which completed packages must be DEFERRED because a prerequisite is still in-flight.
 *
 * WHY: §5.AK's integrating seam is **"Lead-coder = sole trunk integrator ⇄ the trusted-runtime MergeBroker that applies
 * result branches"**, and the discipline is that fan-out is parallel but **integration is one-at-a-time** ("the lead
 * runs the union once at integration"). `work-package-dispatch.resolveDispatchWaves` answers *what can I START in
 * parallel* (dependency-first waves for kick-off). It does NOT answer the opposite, equally load-bearing question the
 * integrator faces after the work comes back: *in what ORDER do I merge these finished branches, and which of them will
 * collide on a shared path once an earlier one has landed?* This module is that policy — a deterministic total merge
 * order that (a) always lands a prerequisite before its dependent, (b) among otherwise-free packages lands them in a
 * stable order while surfacing the write-scope overlaps that mean "rebase this one before it lands", and (c) refuses to
 * land a completed package whose prerequisite is not itself in the completed set.
 *
 * Relationship to siblings: reuses the §5.AK `WorkPackage` contract + `classifyPackagePairConflict` (Green/Yellow/Red
 * write-scope overlap) from `work-package-dispatch.ts` rather than re-deriving them — a Yellow/Red pair between two
 * *landing* packages is exactly a rebase signal for whichever lands second. This is the PURE CORE: no I/O, no git, no
 * throwing on malformed input — the actual branch apply / MergeBroker consumes this order. Total: every helper returns a
 * structured result.
 */

import { classifyPackagePairConflict, type DispatchConflictClass, type WorkPackage } from "./work-package-dispatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One landing overlap the integrator must account for: a package about to land shares write scope with a package that
 * has ALREADY landed earlier in the sequence, so the later one should be rebased / re-verified against it before it goes
 * in. `conflictClass` is the §5.AK pair class (`yellow` = a shared coarse/barrel path → a light re-check at a known
 * insertion point; `red` = a shared specific file or a forbidden-scope write → a real rebase). `green` overlaps never
 * appear here.
 */
export interface IntegrationRebaseAgainst {
	/** The id of the already-landed package this landing overlaps. */
	readonly landedId: string;
	/** The §5.AK write-scope overlap class (`yellow` | `red`). */
	readonly conflictClass: Exclude<DispatchConflictClass, "green">;
	/** The overlapping specific write paths (the Red rebase signal). Sorted, deduped. */
	readonly sharedSpecificPaths: readonly string[];
	/** The overlapping coarse write paths (the Yellow insertion-point signal). Sorted, deduped. */
	readonly sharedCoarsePaths: readonly string[];
}

/** One package placed into the integration sequence, in the order the integrator should apply it. */
export interface IntegrationStep {
	/** The package id being landed at this position. */
	readonly packageId: string;
	/** 0-based position in the merge sequence. */
	readonly order: number;
	/**
	 * Overlaps with packages that land BEFORE this one (each already-landed package that shares a Yellow/Red write scope
	 * with this one). Empty ⇒ this package lands as a clean addition relative to everything already on trunk in this
	 * batch. Sorted by `landedId`.
	 */
	readonly rebaseAgainst: readonly IntegrationRebaseAgainst[];
}

/** Why a completed package could not be included in the integration sequence. */
export interface DeferredIntegration {
	/** The completed package that cannot land yet. */
	readonly packageId: string;
	/** Why it is held back. */
	readonly reason: "prerequisite_not_completed" | "unresolvable_order";
	/**
	 * The prerequisite ids that block it (the ones not present in the completed set, or — transitively — blocked
	 * themselves). Sorted, deduped. Empty for `unresolvable_order`.
	 */
	readonly blockedBy: readonly string[];
}

/** The full §5.AK merge/integration-order plan for a set of completed packages. */
export interface IntegrationOrderPlan {
	/**
	 * The ordered merge sequence the sole trunk integrator should apply (prerequisites before dependents; a stable order
	 * among otherwise-free packages). Each step carries the rebase-against overlaps for that landing.
	 */
	readonly sequence: readonly IntegrationStep[];
	/**
	 * Completed packages excluded from `sequence` because a prerequisite is not in the completed set (still in-flight),
	 * or is itself deferred. Sorted by `packageId`. These stay on their branches until their prerequisites land.
	 */
	readonly deferred: readonly DeferredIntegration[];
	/**
	 * Headline for the batch: `clean` = the whole sequence lands with no Yellow/Red overlaps (every branch is an
	 * independent addition); `rebases_needed` = at least one landing overlaps an earlier one; `partial` = something was
	 * deferred (whether or not the landable part is clean). `rebases_needed` + a deferral ⇒ `partial` (the deferral is the
	 * more actionable headline).
	 */
	readonly headline: "clean" | "rebases_needed" | "partial";
}

// ---------------------------------------------------------------------------
// Merge order
// ---------------------------------------------------------------------------

/**
 * Compute the integration sequence for the LANDABLE packages via a deterministic dependency-respecting order: land a
 * package only once every one of its (in-set, landable) prerequisites has already landed; among the packages that are
 * ready at a given point, land them in ascending id order for stability. This is a Kahn-style linearization that emits a
 * single total order (integration is sequential — one integrator), NOT parallel waves.
 *
 * `landable` is the subset of `byId` that is allowed to land (prerequisites all satisfiable); dependency edges to
 * non-landable ids are ignored here because those packages are reported as deferred instead.
 */
function linearizeLandable(landableIds: readonly string[], byId: ReadonlyMap<string, WorkPackage>): string[] {
	const landableSet = new Set(landableIds);
	// Remaining in-set, landable prerequisites per package.
	const remainingDeps = new Map<string, Set<string>>();
	for (const id of landableIds) {
		const pkg = byId.get(id);
		const deps = new Set<string>();
		for (const depId of pkg?.dependsOn ?? []) {
			if (depId !== id && landableSet.has(depId)) {
				deps.add(depId);
			}
		}
		remainingDeps.set(id, deps);
	}

	const order: string[] = [];
	const landed = new Set<string>();
	while (landed.size < landableIds.length) {
		// All not-yet-landed packages whose remaining prerequisites are all landed, in ascending id order.
		const ready = landableIds
			.filter((id) => !landed.has(id))
			.filter((id) => {
				for (const depId of remainingDeps.get(id) ?? new Set<string>()) {
					if (!landed.has(depId)) {
						return false;
					}
				}
				return true;
			})
			.sort();
		if (ready.length === 0) {
			break; // no progress — a cycle among landable ids (guarded by the caller); leave the rest out
		}
		for (const id of ready) {
			order.push(id);
			landed.add(id);
		}
	}
	return order;
}

/**
 * For a package landing at a given position, the overlaps with everything already landed before it. A Yellow/Red
 * write-scope pair (via `classifyPackagePairConflict`) means the later landing collides on shared paths and should be
 * rebased / re-verified against the earlier one. Green pairs are skipped. Sorted by the already-landed id.
 */
function rebaseOverlapsFor(
	landing: WorkPackage,
	alreadyLanded: readonly string[],
	byId: ReadonlyMap<string, WorkPackage>,
): IntegrationRebaseAgainst[] {
	const overlaps: IntegrationRebaseAgainst[] = [];
	for (const landedId of alreadyLanded) {
		const landed = byId.get(landedId);
		if (landed === undefined) {
			continue;
		}
		const pair = classifyPackagePairConflict(landing, landed);
		if (pair.conflictClass === "green") {
			continue;
		}
		overlaps.push({
			landedId,
			conflictClass: pair.conflictClass,
			sharedSpecificPaths: pair.sharedSpecificPaths,
			sharedCoarsePaths: pair.sharedCoarsePaths,
		});
	}
	overlaps.sort((a, b) => (a.landedId < b.landedId ? -1 : a.landedId > b.landedId ? 1 : 0));
	return overlaps;
}

/**
 * Partition completed packages into the set that can land now vs. the set that must be deferred because a prerequisite
 * is not in the completed set (still in-flight) or is itself deferred. A dependency on an id NOT present in `completedIds`
 * is unsatisfiable; the deferral then propagates transitively (a package depending on a deferred package is also
 * deferred). Unknown ids (deps referencing nothing in the batch) count as not-completed prerequisites.
 *
 * `completedIds` are assumed de-duplicated by the caller. Runs to a fixpoint so a chain A→B→(missing C) defers all of A
 * and B, each reporting the concrete blocker(s) closest to it.
 */
function partitionLandable(
	completedIds: readonly string[],
	byId: ReadonlyMap<string, WorkPackage>,
): { readonly landable: string[]; readonly deferred: DeferredIntegration[] } {
	const completedSet = new Set(completedIds);
	const deferredReason = new Map<string, Set<string>>();

	// Fixpoint: mark a package deferred if any prerequisite is not completed, or is itself already deferred.
	let changed = true;
	while (changed) {
		changed = false;
		for (const id of completedIds) {
			if (deferredReason.has(id)) {
				continue;
			}
			const pkg = byId.get(id);
			const blockers = new Set<string>();
			for (const depId of pkg?.dependsOn ?? []) {
				if (depId === id) {
					continue; // a self-dep is a well-formedness problem, not an integration blocker; ignore here
				}
				if (!completedSet.has(depId) || deferredReason.has(depId)) {
					blockers.add(depId);
				}
			}
			if (blockers.size > 0) {
				deferredReason.set(id, blockers);
				changed = true;
			}
		}
	}

	const landable: string[] = [];
	const deferred: DeferredIntegration[] = [];
	for (const id of completedIds) {
		const blockers = deferredReason.get(id);
		if (blockers === undefined) {
			landable.push(id);
		} else {
			deferred.push({
				packageId: id,
				reason: "prerequisite_not_completed",
				blockedBy: [...blockers].sort(),
			});
		}
	}
	deferred.sort((a, b) => (a.packageId < b.packageId ? -1 : a.packageId > b.packageId ? 1 : 0));
	return { landable, deferred };
}

/**
 * The full §5.AK merge/integration-order policy for a batch of COMPLETED work packages.
 *
 * Steps:
 *   1. Partition into landable vs. deferred — a completed package whose prerequisite is not itself completed (still
 *      in-flight) cannot land yet, and that deferral propagates transitively.
 *   2. Linearize the landable set into ONE total merge order (integration is sequential): a prerequisite always lands
 *      before its dependent; among free packages, ascending id for stability.
 *   3. Annotate each landing with its rebase-against overlaps — the already-landed packages it shares a Yellow/Red
 *      write scope with (so the integrator rebases / re-verifies it before applying).
 *   4. Any landable id left unplaced by an internal cycle is moved to `deferred` as `unresolvable_order` (defensive —
 *      the fan-out planner's `validateWorkPackages` catches cycles up front; this never throws).
 *
 * Pure + total; duplicate ids in the input are de-duplicated (first occurrence wins) so a malformed batch still yields a
 * usable order rather than an exception. Returns `{ sequence, deferred, headline }`.
 */
export function planIntegrationOrder(completedPackages: readonly WorkPackage[]): IntegrationOrderPlan {
	// De-dup by id (first wins) so the policy is total on a malformed batch.
	const byId = new Map<string, WorkPackage>();
	const completedIds: string[] = [];
	for (const pkg of completedPackages) {
		if (!byId.has(pkg.id)) {
			byId.set(pkg.id, pkg);
			completedIds.push(pkg.id);
		}
	}

	const { landable, deferred } = partitionLandable(completedIds, byId);
	const order = linearizeLandable(landable, byId);

	// Any landable id the linearizer could not place (an internal cycle among landable ids) → defensive deferral.
	const placed = new Set(order);
	const deferredAll: DeferredIntegration[] = [...deferred];
	for (const id of landable) {
		if (!placed.has(id)) {
			deferredAll.push({ packageId: id, reason: "unresolvable_order", blockedBy: [] });
		}
	}
	deferredAll.sort((a, b) => (a.packageId < b.packageId ? -1 : a.packageId > b.packageId ? 1 : 0));

	const sequence: IntegrationStep[] = [];
	const landedSoFar: string[] = [];
	let anyRebase = false;
	for (const [index, id] of order.entries()) {
		const pkg = byId.get(id);
		const rebaseAgainst = pkg === undefined ? [] : rebaseOverlapsFor(pkg, landedSoFar, byId);
		if (rebaseAgainst.length > 0) {
			anyRebase = true;
		}
		sequence.push({ packageId: id, order: index, rebaseAgainst });
		landedSoFar.push(id);
	}

	const headline: IntegrationOrderPlan["headline"] =
		deferredAll.length > 0 ? "partial" : anyRebase ? "rebases_needed" : "clean";

	return { sequence, deferred: deferredAll, headline };
}

/**
 * Just the ordered ids the integrator should merge, in sequence (the `sequence`'s `packageId`s). Convenience for callers
 * that only need the order and will look up overlaps separately.
 */
export function integrationMergeOrder(completedPackages: readonly WorkPackage[]): string[] {
	return planIntegrationOrder(completedPackages).sequence.map((step) => step.packageId);
}
