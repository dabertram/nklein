/**
 * The durable scheduler's CRITICAL-PATH / longest-remaining-chain analysis — pure core (todo §5.AF; the C3 durable
 * long-run scheduler).
 *
 * WHAT: given a durable run's job graph (`DurableJob[]` with `dependsOn` edges + per-job terminal state), this core
 * computes, for every not-yet-`succeeded` job, the **downstream depth** — the length of the longest chain of REMAINING
 * (not-yet-succeeded) work that cannot start until this job completes — and identifies the run's **critical path**: the
 * single longest such chain, whose length is a lower bound on how many more sequential job-completions the run needs
 * (its remaining "makespan" in job-hops). It answers "which ready job, if delayed, delays the WHOLE run the most?" and
 * "how many sequential steps of work are still ahead?".
 *
 * WHY: {@link module:core/durable-scheduler-ready-order#orderReadyJobs} ranks ready jobs by IMMEDIATE fan-out — how many
 * jobs *directly* list this one in `dependsOn`. That is a good cheap signal, but it is blind to depth: a job with a
 * single direct dependent that itself heads a ten-deep chain looks "cheap" and gets shed behind a job with three
 * shallow leaf dependents, even though the deep-chain prerequisite is the one truly gating the run's completion time.
 * The classic list-scheduling fix is "most-work-remaining-first": prioritise the jobs on the critical path. This core
 * supplies that transitive signal (the per-job downstream depth), which a caller can feed into `orderReadyJobs` as the
 * explicit `priority` (so the ordering policy stays one weighted place) and/or surface as the run's remaining-depth ETA
 * for the §5.AG "what's the run doing / how far to go" view.
 *
 * The metric is defined over REMAINING work only: an already-`succeeded` job contributes 0 to every chain (it no longer
 * gates anything), and a `failed` job is treated like any other blocker for depth purposes (its dependents can never
 * run, but that is the scheduler's fail/reclaim decision — this core only measures graph depth, it does not decide
 * leases, eligibility, or failure). "Depth" is counted in job-hops: a leaf of the remaining graph (nothing not-yet-done
 * depends on it) has downstream depth 0; a job whose deepest remaining dependent chain is N hops long has depth N.
 *
 * Cycles: a real durable graph should be acyclic ({@link module:core/durable-scheduler#buildDurableJobGraph} leaves a
 * cyclic component `blocked`, surfaced, never looped), but this core must be TOTAL on any input. Jobs on / downstream of
 * a dependency cycle are reported with `onCycle: true` and a depth of 0 (their true depth is undefined — a cycle has no
 * finite longest path); they are surfaced, never looped, exactly the codebase's established stance on a malformed graph.
 * Unknown / dangling `dependsOn` ids (an edge to a job not in the set) are ignored — like the scheduler's own
 * dependency handling, an absent prerequisite simply does not gate.
 *
 * Pure + deterministic (no fs / network / model / db / clock / randomness): the analysis is a property of the injected
 * graph alone, so a ledger replay reproduces the same depths and the same critical path. Ties in the critical-path
 * reconstruction break by `jobId` ascending for a stable, replay-safe path. This module MEASURES the graph; it does not
 * order (that is `durable-scheduler-ready-order`), admit (that is `durable-scheduler-backpressure`), or decide any
 * lease / reclaim / fail (that is `durable-scheduler`). It composes {@link module:core/durable-scheduler}'s `DurableJob`
 * by import and edits nothing.
 */

import type { DurableJob, DurableJobState } from "./durable-scheduler";

/** A job that is finished for depth purposes — `succeeded` no longer gates anything (contributes 0 to every chain). */
function isSucceeded(state: DurableJobState): boolean {
	return state === "succeeded";
}

/** Per-job critical-path analysis for one not-yet-`succeeded` job. */
export interface JobCriticalityInfo {
	readonly jobId: string;
	/**
	 * Longest chain of REMAINING (not-yet-succeeded) work that cannot start until this job completes, counted in
	 * job-hops: a remaining leaf (nothing not-yet-done depends on it) is 0; a job heading an N-hop remaining chain is N.
	 * A job on / downstream of a dependency cycle reports 0 (its true depth is undefined) with `onCycle: true`.
	 */
	readonly downstreamDepth: number;
	/**
	 * The number of remaining (not-yet-succeeded) jobs directly depending on this job — the IMMEDIATE fan-out, exposed
	 * alongside the transitive depth so a caller can see both signals (this matches `orderReadyJobs`'s fan-out input).
	 */
	readonly directDependents: number;
	/** True when this job sits on or downstream of a dependency cycle (its depth is undefined ⇒ reported as 0). */
	readonly onCycle: boolean;
	/** True when this job is on the run's reported critical path (the single longest remaining chain). */
	readonly onCriticalPath: boolean;
}

export interface DurableJobCriticalPathResult {
	/**
	 * Per-job criticality for every NOT-yet-`succeeded` job, sorted by descending `downstreamDepth`, then descending
	 * `directDependents`, then `jobId` ascending — so the most run-delaying prerequisites come first (a deterministic,
	 * replay-stable order). Already-`succeeded` jobs are omitted (they gate nothing).
	 */
	readonly jobs: readonly JobCriticalityInfo[];
	/**
	 * The run's critical path: the single longest chain of remaining jobs, from the deepest prerequisite down to a
	 * remaining leaf (each job depends — directly — on the NEXT id in the list). Empty when there is no remaining work.
	 * Ties (several equally-long chains) resolve by `jobId` ascending at each hop, for a stable path.
	 */
	readonly criticalPath: readonly string[];
	/**
	 * The run's remaining depth in job-hops — the length of `criticalPath` measured in EDGES (0 when ≤1 remaining job).
	 * A lower bound on how many more sequential job-completions the run needs; the makespan floor for the §5.AG ETA.
	 */
	readonly remainingDepth: number;
	/** True when any not-yet-`succeeded` job is on / downstream of a dependency cycle (depth for those is undefined). */
	readonly hasCycle: boolean;
	readonly counts: {
		/** Not-yet-`succeeded` jobs analysed (the size of `jobs`). */
		readonly remaining: number;
		/** Jobs on the reported critical path (the size of `criticalPath`). */
		readonly onCriticalPath: number;
		/** Jobs on / downstream of a cycle (depth undefined). */
		readonly onCycle: number;
	};
	/** Human-readable one-liner for the scheduler "how far to go / what's gating the run" surface (§5.AG). */
	readonly summary: string;
}

/** Longest downstream chain plus the next hop that realises it (for path reconstruction). `null` next ⇒ a leaf. */
interface DepthEntry {
	readonly depth: number;
	readonly next: string | null;
}

/**
 * Analyse a durable job graph's critical path (pure). For every not-yet-`succeeded` job it computes the longest chain of
 * REMAINING work it gates (`downstreamDepth`), and it reconstructs the run's single longest such chain (`criticalPath`)
 * whose edge-count (`remainingDepth`) is the makespan floor — the minimum number of further sequential job-completions
 * the run needs.
 *
 * Semantics:
 *  - Depth counts REMAINING work only: a `succeeded` job contributes 0 (it gates nothing) and is omitted from `jobs`.
 *  - Depth is in job-hops: a remaining leaf is 0; a job heading an N-hop remaining chain is N.
 *  - A dependency cycle has no finite longest path: jobs on / downstream of one report depth 0 with `onCycle: true`
 *    (surfaced via `hasCycle`), never looped — matching `buildDurableJobGraph`'s "cycles left blocked, surfaced" stance.
 *  - Unknown / dangling `dependsOn` ids (an edge to a job not in the set) are ignored (an absent prerequisite does not
 *    gate) — matching the scheduler's own dependency handling. A duplicate `jobId` uses the LAST occurrence's state /
 *    edges for that job, and self-edges are ignored.
 *
 * Deterministic: the result is a property of the injected graph alone (no clock / randomness), and every ordering /
 * tie-break falls back to `jobId` ascending, so a ledger replay reproduces the same depths and the same path.
 */
export function analyzeDurableJobCriticalPath(jobs: readonly DurableJob[]): DurableJobCriticalPathResult {
	// Index by id (last write wins on a duplicate) and record which ids are already-succeeded (gate nothing).
	const byId = new Map<string, DurableJob>();
	for (const job of jobs) {
		byId.set(job.jobId, job);
	}

	// Build the REMAINING dependency edges: for a not-yet-succeeded job, keep only the deps that (a) exist in the set and
	// (b) are themselves not-yet-succeeded (a done prerequisite no longer gates), ignoring self-edges. `dependents` is the
	// reverse map (prerequisite id → remaining jobs that directly depend on it) — the immediate fan-out.
	const remainingIds: string[] = [];
	const remainingDeps = new Map<string, string[]>();
	const dependents = new Map<string, string[]>();
	for (const [jobId, job] of byId) {
		if (isSucceeded(job.state)) {
			continue;
		}
		remainingIds.push(jobId);
		const deps: string[] = [];
		const seen = new Set<string>();
		for (const depId of job.dependsOn) {
			if (depId === jobId || seen.has(depId)) {
				continue; // ignore self-edges + duplicate edges
			}
			const dep = byId.get(depId);
			if (dep === undefined || isSucceeded(dep.state)) {
				continue; // dangling or already-done prerequisite ⇒ does not gate remaining work
			}
			seen.add(depId);
			deps.push(depId);
		}
		remainingDeps.set(jobId, deps);
	}
	for (const jobId of remainingIds) {
		for (const depId of remainingDeps.get(jobId) ?? []) {
			const list = dependents.get(depId);
			if (list === undefined) {
				dependents.set(depId, [jobId]);
			} else {
				list.push(jobId);
			}
		}
	}

	// Longest-downstream-chain per remaining job via memoised DFS over the `dependents` (reverse) edges. `visiting`
	// detects a cycle: any job reached while already on the current DFS stack is part of / downstream of a cycle and its
	// depth is undefined — recorded as 0 + flagged, and the flag propagates up so callers up the chain are cycle-tainted
	// too (their longest path runs through an undefined region). Iterating a remaining leaf's dependents realises depth.
	const memo = new Map<string, DepthEntry>();
	const cyclic = new Set<string>();
	const visiting = new Set<string>();

	function depthOf(jobId: string): DepthEntry {
		const cached = memo.get(jobId);
		if (cached !== undefined) {
			return cached;
		}
		if (visiting.has(jobId)) {
			// Back-edge: this job is on a cycle. Depth undefined ⇒ 0; flag it (do NOT memoise yet — the in-progress frame
			// below finalises + memoises once its recursion unwinds).
			cyclic.add(jobId);
			return { depth: 0, next: null };
		}
		visiting.add(jobId);

		let bestDepth = 0;
		let bestNext: string | null = null;
		let tainted = false;
		// Deterministic: consider dependents in `jobId` order so the reconstructed path + ties are replay-stable.
		const deps = (dependents.get(jobId) ?? []).slice().sort((left, right) => left.localeCompare(right));
		for (const dependentId of deps) {
			const child = depthOf(dependentId);
			if (cyclic.has(dependentId)) {
				tainted = true; // a cycle downstream ⇒ this job's longest path is undefined too
			}
			const candidate = child.depth + 1;
			if (candidate > bestDepth) {
				bestDepth = candidate;
				bestNext = dependentId;
			}
		}

		visiting.delete(jobId);
		if (tainted || cyclic.has(jobId)) {
			cyclic.add(jobId);
			const entry: DepthEntry = { depth: 0, next: null };
			memo.set(jobId, entry);
			return entry;
		}
		const entry: DepthEntry = { depth: bestDepth, next: bestNext };
		memo.set(jobId, entry);
		return entry;
	}

	for (const jobId of remainingIds) {
		depthOf(jobId);
	}

	// Reconstruct the run's critical path: start at the acyclic remaining job with the greatest depth (ties → jobId
	// ascending), then follow `next` to the leaf. A cyclic job is never a start (its depth is undefined / 0).
	let head: string | null = null;
	let headDepth = -1;
	const headCandidates = remainingIds.slice().sort((left, right) => left.localeCompare(right));
	for (const jobId of headCandidates) {
		if (cyclic.has(jobId)) {
			continue;
		}
		const entry = memo.get(jobId);
		const depth = entry?.depth ?? 0;
		if (depth > headDepth) {
			headDepth = depth;
			head = jobId;
		}
	}
	const criticalPath: string[] = [];
	const onPath = new Set<string>();
	let cursor = head;
	while (cursor !== null && !onPath.has(cursor)) {
		criticalPath.push(cursor);
		onPath.add(cursor);
		cursor = memo.get(cursor)?.next ?? null;
	}

	const infos: JobCriticalityInfo[] = remainingIds.map((jobId) => ({
		jobId,
		downstreamDepth: memo.get(jobId)?.depth ?? 0,
		directDependents: (dependents.get(jobId) ?? []).length,
		onCycle: cyclic.has(jobId),
		onCriticalPath: onPath.has(jobId),
	}));
	infos.sort(compareByCriticality);

	const counts = {
		remaining: remainingIds.length,
		onCriticalPath: criticalPath.length,
		onCycle: cyclic.size,
	};
	const remainingDepthEdges = criticalPath.length > 0 ? criticalPath.length - 1 : 0;

	return {
		jobs: infos,
		criticalPath,
		remainingDepth: remainingDepthEdges,
		hasCycle: cyclic.size > 0,
		counts,
		summary: formatSummary(counts, remainingDepthEdges, criticalPath),
	};
}

/**
 * Deepest first (greatest `downstreamDepth`), then most direct dependents (widest immediate fan-out), then `jobId`
 * ascending — a total order so the result is deterministic + replay-stable. The most run-delaying prerequisites lead.
 */
function compareByCriticality(left: JobCriticalityInfo, right: JobCriticalityInfo): number {
	if (left.downstreamDepth !== right.downstreamDepth) {
		return right.downstreamDepth - left.downstreamDepth;
	}
	if (left.directDependents !== right.directDependents) {
		return right.directDependents - left.directDependents;
	}
	return left.jobId.localeCompare(right.jobId);
}

function formatSummary(
	counts: DurableJobCriticalPathResult["counts"],
	remainingDepth: number,
	criticalPath: readonly string[],
): string {
	if (counts.remaining === 0) {
		return "No remaining work — the run's critical path is empty.";
	}
	const cycleNote = counts.onCycle > 0 ? ` (${counts.onCycle} job(s) on a dependency cycle — depth undefined)` : "";
	const pathHead = criticalPath.length > 0 ? ` starting at ${criticalPath[0]}` : "";
	return (
		`${counts.remaining} job(s) remaining; critical path is ${remainingDepth} hop(s) deep` +
		`${pathHead}${cycleNote}.`
	);
}
