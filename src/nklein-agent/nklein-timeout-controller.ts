import type { TaskRunTimeoutSource } from "../state/task-run-summary-store";
import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";
import type { NKleinTaskSessionEntry } from "./nklein-session-state";
import {
	formatTaskTimeoutFailureMessage,
	formatTaskTimeoutLabel,
	formatTaskTimeoutMessage,
	formatTaskTimeoutReason,
} from "./nklein-task-timeout-diagnostics";
import type { NKleinTaskTimeoutKind } from "./nklein-task-timeout-handles";
import { TaskTimeoutScheduler } from "./nklein-task-timeout-scheduler";

/**
 * §5.U — the timeout scheduling + firing concern extracted from `InMemoryNKleinTaskSessionService` as a bounded
 * collaborator. It OWNS all timeout state (the `TaskTimeoutScheduler` + per-task timeout settings) and, when a
 * stream/tool/conversation inactivity timeout fires, aborts the session and surfaces a diagnosable failure. Everything
 * else it needs (is-a-tool-active, task entry, the cross-concern run teardown, session abort/restart-check, the pending
 * timeout store, observation + failure emission) is supplied via {@link TimeoutControllerDeps}. The service keeps the
 * thin `clearTaskTimeout(s)` wrappers (they coordinate other concerns) and delegates the timeout part here.
 */
export interface NKleinTaskTimeoutSettings {
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	streamTimeoutSource: TaskRunTimeoutSource;
	toolTimeoutSource: TaskRunTimeoutSource;
	conversationTimeoutSource: TaskRunTimeoutSource;
}

export interface TimeoutControllerDeps {
	isToolActive(taskId: string): boolean;
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null | undefined;
	/** The FULL task-run teardown (clear-all timeouts + tool-active flag + residency stop) — cross-concern, owned by the service. */
	clearTaskRunTeardown(taskId: string): void;
	abortTaskSession(taskId: string): Promise<void>;
	recordTimeout(taskId: string, reason: string, source: TaskRunTimeoutSource): void;
	canRestartTaskSession(taskId: string): boolean;
	recordObservation(event: SelfObservationEventInput & { taskId: string }): void;
	emitTaskFailure(taskId: string, entry: NKleinTaskSessionEntry, context: "start" | "send", error: unknown): void;
}

export interface TimeoutController {
	setSettings(taskId: string, settings: NKleinTaskTimeoutSettings): void;
	deleteSettings(taskId: string): void;
	clearSettings(): void;
	scheduleStreamTimeout(taskId: string): void;
	scheduleConversationTimeout(taskId: string): void;
	scheduleToolTimeout(taskId: string): void;
	clearKind(taskId: string, kind: NKleinTaskTimeoutKind): void;
	clearAll(taskId: string): void;
	taskIds(): IterableIterator<string>;
}

export function createTimeoutController(deps: TimeoutControllerDeps): TimeoutController {
	const scheduler = new TaskTimeoutScheduler();
	const settingsByTaskId = new Map<string, NKleinTaskTimeoutSettings>();

	async function handleTaskTimeout(taskId: string, kind: NKleinTaskTimeoutKind, timeoutMs: number): Promise<void> {
		scheduler.clearKind(taskId, kind);
		const entry = deps.getTaskEntry(taskId);
		if (entry?.summary.state !== "running") {
			return;
		}
		deps.clearTaskRunTeardown(taskId);
		await deps.abortTaskSession(taskId).catch(() => undefined);
		const timeoutLabel = formatTaskTimeoutLabel(kind);
		const timeoutSettings = settingsByTaskId.get(taskId);
		const timeoutSource =
			kind === "stream"
				? timeoutSettings?.streamTimeoutSource
				: kind === "tool"
					? timeoutSettings?.toolTimeoutSource
					: timeoutSettings?.conversationTimeoutSource;
		deps.recordTimeout(taskId, formatTaskTimeoutReason(timeoutLabel, timeoutMs), timeoutSource ?? null);
		// follow-up-6 §3.5: a stream/tool inactivity timeout should leave a structured note on the card —
		// what the model was last doing, the last tool, whether any work was captured, and whether resuming is
		// safe — so a review caused by a stall is diagnosable instead of just "timeout after N seconds".
		const lastActivity = entry.summary.latestHookActivity?.activityText ?? null;
		const lastTool = entry.summary.latestHookActivity?.toolName ?? null;
		const changesCaptured = Boolean(entry.summary.latestTurnCheckpoint);
		const restartSafe = deps.canRestartTaskSession(taskId);
		deps.recordObservation({
			signal: "budget_wall",
			severity: "warning",
			message: formatTaskTimeoutMessage(timeoutLabel, timeoutMs),
			taskId,
			workspacePath: entry.summary.workspacePath ?? null,
			metadata: {
				category: "stream_inactivity_timeout",
				timeoutKind: kind,
				timeoutMs,
				lastActivity,
				lastTool,
				lastOutputAt: entry.summary.lastOutputAt ?? null,
				lastTokenAt: entry.summary.lastTokenAt ?? null,
				changesCaptured,
				restartSafe,
			},
		});
		deps.emitTaskFailure(
			taskId,
			entry,
			"send",
			new Error(
				formatTaskTimeoutFailureMessage(timeoutLabel, timeoutMs, {
					lastActivity,
					lastTool,
					changesCaptured,
					restartSafe,
				}),
			),
		);
	}

	function scheduleTaskTimeout(taskId: string, kind: NKleinTaskTimeoutKind, timeoutMs: number | null): void {
		scheduler.schedule(taskId, kind, timeoutMs, (firedTimeoutMs) => {
			void handleTaskTimeout(taskId, kind, firedTimeoutMs);
		});
	}

	return {
		setSettings(taskId, settings) {
			settingsByTaskId.set(taskId, settings);
		},
		deleteSettings(taskId) {
			settingsByTaskId.delete(taskId);
		},
		clearSettings() {
			settingsByTaskId.clear();
		},
		scheduleStreamTimeout(taskId) {
			const settings = settingsByTaskId.get(taskId);
			if (!settings || deps.isToolActive(taskId)) {
				return;
			}
			scheduleTaskTimeout(taskId, "stream", settings.streamTimeoutMs);
		},
		scheduleConversationTimeout(taskId) {
			const settings = settingsByTaskId.get(taskId);
			if (!settings) {
				return;
			}
			scheduleTaskTimeout(taskId, "conversation", settings.conversationTimeoutMs);
		},
		scheduleToolTimeout(taskId) {
			scheduleTaskTimeout(taskId, "tool", settingsByTaskId.get(taskId)?.toolTimeoutMs ?? null);
		},
		clearKind(taskId, kind) {
			scheduler.clearKind(taskId, kind);
		},
		clearAll(taskId) {
			scheduler.clearAll(taskId);
		},
		taskIds() {
			return scheduler.taskIds();
		},
	};
}
