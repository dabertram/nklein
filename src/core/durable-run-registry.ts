/**
 * Per-workspace registry of active durable runs + the summary→controller dispatch (todo §5.AF, the C3 live-wiring
 * lifecycle layer). The runtime-server holds ONE of these: it `register`s a {@link DurableRunController} when a
 * decompose applies (one run per workspace), routes each `onSummary` event through {@link reactToTaskSummary}, and
 * `dispose`s the run when it completes. This layer owns the lifecycle + the dispatch policy (which controller method
 * for which task state, via {@link mapTaskSessionStateToDurableRunReaction}) so the only thing left for the live wiring
 * is to construct the controller's ports + subscribe — keeping the behavior-changing surface in runtime-server minimal.
 *
 * Pure over the injected controllers (their effects are their own ports), so the lifecycle + dispatch are unit-testable
 * with a real controller + fake ports, no live runtime.
 */

import type { DurableRunController } from "./durable-run-controller";
import { mapTaskSessionStateToDurableRunReaction } from "./durable-run-reaction";
import type { RuntimeTaskSessionState } from "./task-session-api-contract";

export class DurableRunRegistry {
	private readonly runs = new Map<string, DurableRunController>();

	/** Register the controller for `workspaceId`'s active run (replaces any prior run for that workspace). */
	register(workspaceId: string, controller: DurableRunController): void {
		this.runs.set(workspaceId, controller);
	}

	/** The active run's controller for `workspaceId`, or null when none is running. */
	get(workspaceId: string): DurableRunController | null {
		return this.runs.get(workspaceId) ?? null;
	}

	has(workspaceId: string): boolean {
		return this.runs.has(workspaceId);
	}

	/** Drop the workspace's run (call when it completes or is cancelled). */
	dispose(workspaceId: string): void {
		this.runs.delete(workspaceId);
	}

	/** All workspace ids with an active run (for an operator overview / shutdown sweep). */
	activeWorkspaceIds(): string[] {
		return [...this.runs.keys()];
	}

	/**
	 * Drive a workspace's durable run from a task-session summary change: map the state to a controller reaction and
	 * apply it (report completion — succeeded/failed, transient classified by the controller — then `tick`; or heartbeat
	 * the lease). A no-op when the workspace has no active run or the state isn't actionable. Auto-`dispose`s the run
	 * once it is complete so the registry doesn't leak finished runs.
	 */
	async reactToTaskSummary(
		workspaceId: string,
		taskId: string,
		state: RuntimeTaskSessionState,
		errorText?: string | null,
	): Promise<void> {
		const controller = this.runs.get(workspaceId);
		if (!controller) {
			return;
		}
		const reaction = mapTaskSessionStateToDurableRunReaction(state, errorText);
		if (reaction.type === "report") {
			await controller.reportCompletion(taskId, reaction.outcome, reaction.error);
			await controller.tick();
			if (controller.isComplete()) {
				this.runs.delete(workspaceId);
			}
		} else if (reaction.type === "heartbeat") {
			controller.heartbeat(taskId);
		}
	}

	/**
	 * G6.8a v15b: the runtime's bounded dead-card recovery sanctioned fresh attempts for these cards — revive their
	 * FAILED jobs (see `DurableRunController.reopenForRedispatch`) and tick once so revived jobs lease immediately.
	 * Returns the task ids that actually revived, so the caller can name what was (and was not) rescued.
	 */
	async redispatchCandidates(workspaceId: string, taskIds: readonly string[]): Promise<string[]> {
		const controller = this.runs.get(workspaceId);
		if (!controller) {
			return [];
		}
		const revived: string[] = [];
		for (const taskId of taskIds) {
			if (await controller.reopenForRedispatch(taskId)) {
				revived.push(taskId);
			}
		}
		if (revived.length > 0) {
			await controller.tick();
		}
		return revived;
	}

	/**
	 * F1.18: the DELIVERY completed (review approved + acceptance passed + merged/completed) — the job's real
	 * success. This is the ONLY path that releases dependents; `awaiting_review` merely heartbeats (see
	 * `mapTaskSessionStateToDurableRunReaction`).
	 */
	async reportDelivered(workspaceId: string, taskId: string): Promise<void> {
		const controller = this.runs.get(workspaceId);
		if (!controller) {
			return;
		}
		await controller.reportCompletion(taskId, "succeeded", null);
		await controller.tick();
		if (controller.isComplete()) {
			this.runs.delete(workspaceId);
		}
	}

	/**
	 * A review-level PARK is the card handed to the operator — the job must settle as `failed` (the controller's
	 * own parked-for-operator vocabulary) and release its lease. Live-found missing (N3 family 4, 2026-08-04):
	 * the park QUIESCES the session to idle, which maps to reaction `none`, so no summary ever reported the
	 * outcome and the lease sat orphaned past teardown (`no_orphans_after_teardown: 1 lease left behind`).
	 * The park reason rides the error text so the run summary names WHY the card needs attention.
	 */
	async reportParked(workspaceId: string, taskId: string, reason: string | null): Promise<void> {
		const controller = this.runs.get(workspaceId);
		if (!controller) {
			return;
		}
		await controller.reportCompletion(taskId, "failed", reason);
		await controller.tick();
	}
}
