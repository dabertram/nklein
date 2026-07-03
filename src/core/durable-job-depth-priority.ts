/**
 * The COMPOSITION adapter that makes {@link module:core/durable-scheduler-ready-order#orderReadyJobs} depth-aware
 * (todo §5.AF). `orderReadyJobs` ranks ready jobs by IMMEDIATE fan-out (direct dependents) plus a caller-supplied
 * explicit `priority`; on its own it is blind to how DEEP the work behind a job runs. {@link analyzeDurableJobCriticalPath}
 * computes exactly that missing transitive signal — each remaining job's `downstreamDepth` (the longest chain of
 * remaining work it gates). This adapter folds that depth into the ready-order's `priority` channel so a job that heads
 * a long chain (the run's critical path) is leased ahead of a job with more, but shallower, dependents — the classic
 * "most-work-remaining-first" fix for the list-scheduling blind spot the ready-order doc calls out.
 *
 * Pure/total — a property of the injected graph + meta alone. It ORCHESTRATES the two existing cores by import and
 * edits neither: run `withCriticalPathPriority({ jobs, meta })` and pass the returned map straight back as
 * `orderReadyJobs`'s `meta`, and the ordering stays exactly one weighted place — depth simply rides the explicit-priority
 * weight the caller already tunes.
 */

import { analyzeDurableJobCriticalPath } from "./durable-job-critical-path";
import type { DurableJob } from "./durable-scheduler";
import type { ReadyJobSchedulingMeta } from "./durable-scheduler-ready-order";

export interface CriticalPathPriorityInput {
	/** The full durable job graph (the same set handed to `orderReadyJobs`). Depth is computed over remaining work only. */
	readonly jobs: readonly DurableJob[];
	/**
	 * Existing per-job scheduling metadata to fold the depth INTO. Any operator-supplied `priority` is SUMMED with the
	 * depth boost (an urgent flag and a deep chain compound), and `readySince` is preserved untouched. Absent ⇒ start neutral.
	 */
	readonly meta?: Readonly<Record<string, ReadyJobSchedulingMeta>>;
	/**
	 * Points of explicit `priority` added per job-hop of `downstreamDepth` (default 1 — one weighted place, so depth
	 * rides the ready-order's `explicitPriority` weight). Non-finite ⇒ 1.
	 */
	readonly depthWeight?: number;
}

/**
 * Produce the `orderReadyJobs` `meta` map with each job's critical-path `downstreamDepth` folded into its explicit
 * `priority` (pure). A remaining job's priority becomes `(operator priority ?? 0) + downstreamDepth × depthWeight`;
 * `readySince` and every other meta field is preserved. `succeeded` jobs (which gate nothing) and jobs absent from the
 * graph receive no depth boost. A job on / downstream of a dependency cycle reports depth 0 (its true depth is
 * undefined), so it earns no boost — matching the analysis's total-safe cycle stance. The returned map is minimal: a
 * remaining leaf (depth 0) with no existing meta is omitted, since a `priority: 0` entry is indistinguishable from absent.
 */
export function withCriticalPathPriority(input: CriticalPathPriorityInput): Record<string, ReadyJobSchedulingMeta> {
	const depthWeight = Number.isFinite(input.depthWeight) ? (input.depthWeight as number) : 1;
	const analysis = analyzeDurableJobCriticalPath(input.jobs);

	const depthBoost = new Map<string, number>();
	for (const info of analysis.jobs) {
		depthBoost.set(info.jobId, info.downstreamDepth * depthWeight);
	}

	const merged: Record<string, ReadyJobSchedulingMeta> = {};
	const jobIds = new Set<string>([...Object.keys(input.meta ?? {}), ...depthBoost.keys()]);
	for (const jobId of jobIds) {
		const existing = input.meta?.[jobId];
		const boost = depthBoost.get(jobId) ?? 0;
		if (existing === undefined && boost === 0) {
			continue; // no existing meta to preserve and no depth to add — a neutral entry adds nothing.
		}
		const basePriority =
			existing?.priority !== undefined && Number.isFinite(existing.priority) ? existing.priority : 0;
		merged[jobId] = { ...(existing ?? {}), priority: basePriority + boost };
	}
	return merged;
}
