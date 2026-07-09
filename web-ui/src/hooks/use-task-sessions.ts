// Frontend facade for task-scoped runtime actions.
// It owns how the board and detail view start, stop, resize, and route task
// sessions across native NKlein and PTY-backed agents.
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { selectNewestTaskSessionSummary } from "@/hooks/home-sidebar-agent-panel-session-summary";
import { type NKleinChatActionResult, useNKleinChatRuntimeActions } from "@/hooks/use-nklein-chat-runtime-actions";
import { estimateTaskSessionGeometry } from "@/runtime/task-session-geometry";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeProtectedTestApprovalPayload,
	RuntimeTaskChatMessage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeWorktreeDeleteResponse,
} from "@/runtime/types";
import { trackTaskResumedFromTrash } from "@/telemetry/events";
import { getTerminalController } from "@/terminal/terminal-controller-registry";
import { getTerminalGeometry } from "@/terminal/terminal-geometry-registry";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type { BoardCard } from "@/types";

interface UseTaskSessionsInput {
	currentProjectId: string | null;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
}

interface SendTaskSessionInputResult {
	ok: boolean;
	message?: string;
}

interface StartTaskSessionResult {
	ok: boolean;
	message?: string;
	errorCode?:
		| "needs_decomposition"
		| "routing_escalation"
		| "cloud_provider_disabled"
		| "endpoint_busy"
		| "swarm_stopped"
		| "concurrency_limit"
		| "agent_sandbox_unavailable"
		| "model_not_loaded";
	modelNotLoaded?: {
		requestedModelId: string;
		loadedModelIds: string[];
	};
	retryAfterMs?: number | null;
	/** §5.AB "why this model for this task" — the operator-readable selection explanation, when the backend provided one. */
	selectionReason?: string;
}

interface StartTaskSessionOptions {
	resumeFromTrash?: boolean;
	mode?: RuntimeTaskSessionMode;
	promptOverride?: string;
	startInPlanMode?: boolean;
	queueOnEndpointBusy?: boolean;
}

export interface UseTaskSessionsResult {
	upsertSession: (summary: RuntimeTaskSessionSummary) => void;
	startTaskSession: (task: BoardCard, options?: StartTaskSessionOptions) => Promise<StartTaskSessionResult>;
	stopTaskSession: (taskId: string) => Promise<void>;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<SendTaskSessionInputResult>;
	sendTaskChatMessage: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<NKleinChatActionResult>;
	abortTaskChatTurn: (taskId: string) => Promise<NKleinChatActionResult>;
	cancelTaskChatTurn: (taskId: string) => Promise<NKleinChatActionResult>;
	grantProtectedTestApproval: (
		taskId: string,
		approval: RuntimeProtectedTestApprovalPayload,
	) => Promise<NKleinChatActionResult>;
	fetchTaskChatMessages: (taskId: string) => Promise<RuntimeTaskChatMessage[] | null>;
	cleanupTaskWorkspace: (
		taskId: string,
		options?: { preserveChanges?: boolean },
	) => Promise<RuntimeWorktreeDeleteResponse | null>;
}

export function useTaskSessions({ currentProjectId, setSessions }: UseTaskSessionsInput): UseTaskSessionsResult {
	/*
		This merge needs to stay monotonic.

		We chased a nasty terminal bug where Home and Detail panes would appear to
		clear themselves right after starting a task or shell command. The actual
		sequence was:

		1. A new live session started and the terminal correctly saw a new startedAt.
		2. usePersistentTerminalSession reset the xterm instance for the new session.
		3. A stale summary from an older interrupted session was replayed back into
		   React state from workspace hydration or the persistent terminal cache.
		4. That older summary overwrote the newer running one.
		5. The UI then bounced between old and new session identities, causing extra
		   cleanup, remount, and reset cycles that looked like the terminal output
		   had vanished.

		Because of that, every task/session summary write here must prefer the
		newest summary and ignore older ones. If this ever becomes a plain
		last-write-wins assignment again, the "terminal randomly clears out"
		regression is very likely to come back.
	*/
	const upsertSession = useCallback(
		(summary: RuntimeTaskSessionSummary) => {
			setSessions((current) => {
				const previousSummary = current[summary.taskId] ?? null;
				const newestSummary = selectNewestTaskSessionSummary(previousSummary, summary);
				if (newestSummary !== summary) {
					return current;
				}
				return {
					...current,
					[summary.taskId]: newestSummary,
				};
			});
		},
		[setSessions],
	);
	const {
		sendTaskChatMessage,
		loadTaskChatMessages: fetchTaskChatMessages,
		abortTaskChatTurn,
		cancelTaskChatTurn,
		grantProtectedTestApproval,
	} = useNKleinChatRuntimeActions({
		currentProjectId,
		onSessionSummary: upsertSession,
	});

	const startTaskSession = useCallback(
		async (task: BoardCard, options?: StartTaskSessionOptions): Promise<StartTaskSessionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const kickoffPrompt = options?.resumeFromTrash ? "" : (options?.promptOverride ?? task.prompt).trim();
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const geometry =
					getTerminalGeometry(task.id) ?? estimateTaskSessionGeometry(window.innerWidth, window.innerHeight);
				const payload = await trpcClient.runtime.startTaskSession.mutate({
					taskId: task.id,
					prompt: kickoffPrompt,
					taskTitle: task.title,
					images: options?.resumeFromTrash ? undefined : task.images,
					filesLikelyTouched: options?.resumeFromTrash ? undefined : task.filesLikelyTouched,
					startInPlanMode: options?.resumeFromTrash
						? undefined
						: (options?.startInPlanMode ?? task.startInPlanMode),
					mode: options?.mode,
					resumeFromTrash: options?.resumeFromTrash,
					baseRef: task.baseRef,
					cols: geometry.cols,
					rows: geometry.rows,
					agentId: task.agentId,
					nkleinSettings: task.nkleinSettings,
					queueOnEndpointBusy: options?.queueOnEndpointBusy,
				});
				if (!payload.ok || !payload.summary) {
					return {
						ok: false,
						message: payload.error ?? "Task session start failed.",
						errorCode: payload.errorCode,
						modelNotLoaded: payload.modelNotLoaded,
						retryAfterMs: payload.retryAfterMs,
						selectionReason: payload.selectionReason,
					};
				}
				upsertSession(payload.summary);
				if (options?.resumeFromTrash) {
					trackTaskResumedFromTrash();
				}
				return { ok: true, selectionReason: payload.selectionReason };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, message };
			}
		},
		[currentProjectId, upsertSession],
	);

	const stopTaskSession = useCallback(
		async (taskId: string): Promise<void> => {
			if (!currentProjectId) {
				return;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				await trpcClient.runtime.stopTaskSession.mutate({ taskId });
			} catch {
				// Ignore stop errors during cleanup.
			}
		},
		[currentProjectId],
	);

	const sendTaskSessionInput = useCallback(
		async (taskId: string, text: string, options?: SendTerminalInputOptions): Promise<SendTaskSessionInputResult> => {
			const appendNewline = options?.appendNewline ?? true;
			const controller = options?.preferTerminal === false ? null : getTerminalController(taskId);
			if (controller) {
				const sent =
					options?.mode === "paste"
						? !appendNewline && controller.paste(text)
						: controller.input(appendNewline ? `${text}\n` : text);
				if (sent) {
					return { ok: true };
				}
			}
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.runtime.sendTaskSessionInput.mutate({
					taskId,
					text,
					appendNewline,
				});
				if (!payload.ok) {
					const errorMessage = payload.error || "Task session input failed.";
					return { ok: false, message: errorMessage };
				}
				if (payload.summary) {
					upsertSession(payload.summary);
				}
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, message };
			}
		},
		[currentProjectId, upsertSession],
	);

	const cleanupTaskWorkspace = useCallback(
		async (
			taskId: string,
			options: { preserveChanges?: boolean } = {},
		): Promise<RuntimeWorktreeDeleteResponse | null> => {
			if (!currentProjectId) {
				return null;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.deleteWorktree.mutate({
					taskId,
					...(Object.hasOwn(options, "preserveChanges") ? { preserveChanges: options.preserveChanges } : {}),
				});
				if (!payload.ok) {
					const message = payload.error ?? "Could not clean up task workspace.";
					console.error(`[cleanupTaskWorkspace] ${message}`);
					return null;
				}
				return payload;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[cleanupTaskWorkspace] ${message}`);
				return null;
			}
		},
		[currentProjectId],
	);

	return {
		upsertSession,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		sendTaskChatMessage,
		abortTaskChatTurn,
		cancelTaskChatTurn,
		grantProtectedTestApproval,
		fetchTaskChatMessages,
		cleanupTaskWorkspace,
	};
}
