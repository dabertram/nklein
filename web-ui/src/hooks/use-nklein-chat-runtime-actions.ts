// Shared TRPC action hook for every native NKlein chat surface.
// Detail view and home sidebar both use this to send messages, cancel turns,
// and load history through one runtime contract.
import { useCallback } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeNKleinReasoningEffort,
	RuntimeProtectedTestApprovalPayload,
	RuntimeTaskChatMessage,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";

export interface NKleinChatActionResult {
	ok: boolean;
	message?: string;
	chatMessage?: RuntimeTaskChatMessage | null;
}

export interface SendNKleinChatMessageOptions {
	mode?: RuntimeTaskSessionMode;
	images?: RuntimeTaskImage[];
	providerId?: string;
	modelId?: string;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
}

interface UseNKleinChatRuntimeActionsInput {
	currentProjectId: string | null;
	onSessionSummary?: (summary: RuntimeTaskSessionSummary) => void;
}

interface UseNKleinChatRuntimeActionsResult {
	sendTaskChatMessage: (
		taskId: string,
		text: string,
		options?: SendNKleinChatMessageOptions,
	) => Promise<NKleinChatActionResult>;
	loadTaskChatMessages: (taskId: string) => Promise<RuntimeTaskChatMessage[] | null>;
	abortTaskChatTurn: (taskId: string) => Promise<NKleinChatActionResult>;
	cancelTaskChatTurn: (taskId: string) => Promise<NKleinChatActionResult>;
	grantProtectedTestApproval: (
		taskId: string,
		approval: RuntimeProtectedTestApprovalPayload,
	) => Promise<NKleinChatActionResult>;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useNKleinChatRuntimeActions({
	currentProjectId,
	onSessionSummary,
}: UseNKleinChatRuntimeActionsInput): UseNKleinChatRuntimeActionsResult {
	const sendTaskChatMessage = useCallback(
		async (taskId: string, text: string, options?: SendNKleinChatMessageOptions): Promise<NKleinChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const providerId = options?.providerId?.trim() || undefined;
				const modelId = options?.modelId?.trim() || undefined;
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.sendTaskChatMessage.mutate({
					taskId,
					text,
					...(options?.images && options.images.length > 0 ? { images: options.images } : {}),
					...(options?.mode ? { mode: options.mode } : {}),
					...(providerId ? { providerId } : {}),
					...(modelId ? { modelId } : {}),
					...(options && "reasoningEffort" in options ? { reasoningEffort: options.reasoningEffort ?? null } : {}),
				});
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Task chat message failed." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return {
					ok: true,
					chatMessage: payload.message ?? null,
				};
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	const loadTaskChatMessages = useCallback(
		async (taskId: string): Promise<RuntimeTaskChatMessage[] | null> => {
			if (!currentProjectId) {
				return null;
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.getTaskChatMessages.query({ taskId });
				return payload.ok ? payload.messages : null;
			} catch {
				return null;
			}
		},
		[currentProjectId],
	);

	const abortTaskChatTurn = useCallback(
		async (taskId: string): Promise<NKleinChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.abortTaskChatTurn.mutate({ taskId });
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Could not abort chat turn." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return { ok: true };
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	const cancelTaskChatTurn = useCallback(
		async (taskId: string): Promise<NKleinChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.cancelTaskChatTurn.mutate({ taskId });
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Could not cancel chat turn." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return { ok: true };
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	const grantProtectedTestApproval = useCallback(
		async (taskId: string, approval: RuntimeProtectedTestApprovalPayload): Promise<NKleinChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.grantProtectedTestApproval.mutate({
					taskId,
					approval,
				});
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Could not approve protected-test edit." };
				}
				return { ok: true };
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId],
	);

	return {
		sendTaskChatMessage,
		loadTaskChatMessages,
		abortTaskChatTurn,
		cancelTaskChatTurn,
		grantProtectedTestApproval,
	};
}
