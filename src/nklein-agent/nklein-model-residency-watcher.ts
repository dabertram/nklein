import { isTruthyEnv } from "../core/env-flag";
import { probeModelResidency, type ResidencyHeartbeatHandle, startResidencyHeartbeat } from "../core/lmstudio-liveness";
import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";
import type { NKleinTaskSessionEntry } from "./nklein-session-state";

/**
 * §5.U — the model-residency watch concern extracted from `InMemoryNKleinTaskSessionService` as a bounded collaborator
 * (the first responsibility-split, behavior-preserving). It owns the per-task heartbeat handles and the begin/stop/
 * on-lost lifecycle; everything it needs from the service (launch config, task entry, timeout clearing, session abort,
 * observation + failure emission) is supplied via {@link ModelResidencyWatcherDeps}, so the concern is self-contained.
 * Gated by `NKLEIN_RESIDENCY_HEARTBEAT`; when a model stops being resident in LM Studio (crashed/unloaded) mid-run it
 * aborts and fails the task fast rather than hanging.
 */
export interface ModelResidencyWatcherDeps {
	getLaunchConfig(taskId: string): { baseUrl?: string | null; modelId?: string | null } | undefined;
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null | undefined;
	clearTaskTimeouts(taskId: string): void;
	abortTaskSession(taskId: string): Promise<void>;
	recordObservation(event: SelfObservationEventInput & { taskId: string }): void;
	emitTaskFailure(taskId: string, entry: NKleinTaskSessionEntry, context: "start" | "send", error: unknown): void;
}

export interface ModelResidencyWatcher {
	begin(taskId: string): void;
	stop(taskId: string): void;
}

export function createModelResidencyWatcher(deps: ModelResidencyWatcherDeps): ModelResidencyWatcher {
	const heartbeatByTaskId = new Map<string, ResidencyHeartbeatHandle>();

	function stop(taskId: string): void {
		const handle = heartbeatByTaskId.get(taskId);
		if (handle) {
			handle.stop();
			heartbeatByTaskId.delete(taskId);
		}
	}

	async function handleLost(taskId: string): Promise<void> {
		stop(taskId);
		const entry = deps.getTaskEntry(taskId);
		if (entry?.summary.state !== "running") {
			return;
		}
		deps.clearTaskTimeouts(taskId);
		await deps.abortTaskSession(taskId).catch(() => undefined);
		deps.recordObservation({
			signal: "model_stalled",
			severity: "warning",
			message: "Model is no longer resident in LM Studio (crashed or unloaded) — aborted to fail fast.",
			taskId,
			workspacePath: entry.summary.workspacePath ?? null,
			metadata: { category: "model_lost_residency" },
			// §5.AL runtime-verdict precision (approved follow-up, 2026-07-05): stamp a per-run id (mirroring the ledger's
			// `${taskId}:${startedAt}` attempt identity) so assessRuntimeModelVerdict can DEDUP this stall to its run
			// instead of falling back to a raw capped event count when multiple stalls land on the same run.
			...(entry.summary.startedAt ? { runId: `${taskId}:${entry.summary.startedAt}` } : {}),
		});
		deps.emitTaskFailure(
			taskId,
			entry,
			"send",
			new Error("Model is no longer resident in LM Studio (crashed or unloaded)."),
		);
	}

	function begin(taskId: string): void {
		if (!isTruthyEnv(process.env.NKLEIN_RESIDENCY_HEARTBEAT) || heartbeatByTaskId.has(taskId)) {
			return;
		}
		const launchConfig = deps.getLaunchConfig(taskId);
		const baseUrl = launchConfig?.baseUrl?.trim();
		const modelId = launchConfig?.modelId?.trim();
		if (!baseUrl || !modelId) {
			return; // nothing to observe
		}
		const handle = startResidencyHeartbeat({
			probe: () => probeModelResidency(baseUrl, modelId),
			policy: { absentConfirmations: 3 },
			intervalMs: 15_000,
			shouldContinue: () => deps.getTaskEntry(taskId)?.summary.state === "running",
			onModelLost: () => {
				void handleLost(taskId);
			},
		});
		heartbeatByTaskId.set(taskId, handle);
	}

	return { begin, stop };
}
