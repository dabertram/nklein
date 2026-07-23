// Builds the view model for the native NKlein chat panel.
// Keep panel-specific UI state here so the panel component can stay mostly
// declarative and shared across detail and sidebar surfaces.
import { useCallback, useRef, useState } from "react";

import type { NKleinChatActionResult } from "@/hooks/use-nklein-chat-runtime-actions";
import { type NKleinChatMessage, useNKleinChatSession } from "@/hooks/use-nklein-chat-session";
import type {
	RuntimeNKleinReasoningEffort,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import { hasReviewGitActionChanges } from "@/utils/review-git-actions";

interface UseNKleinChatPanelControllerInput {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
	taskColumnId?: string;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: {
			mode?: RuntimeTaskSessionMode;
			images?: RuntimeTaskImage[];
			providerId?: string;
			modelId?: string;
			reasoningEffort?: RuntimeNKleinReasoningEffort | null;
		},
	) => Promise<NKleinChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<NKleinChatMessage[] | null>;
	incomingMessages?: NKleinChatMessage[] | null;
	incomingMessage?: NKleinChatMessage | null;
	onCommit?: () => void;
	onOpenPr?: () => void;
	onMoveToTrash?: () => void;
	onCancelAutomaticAction?: () => void;
	cancelAutomaticActionLabel?: string | null;
	showMoveToTrash?: boolean;
}

interface UseNKleinChatPanelControllerResult {
	draft: string;
	setDraft: (draft: string) => void;
	messages: NKleinChatMessage[];
	error: string | null;
	isSending: boolean;
	isCanceling: boolean;
	canSend: boolean;
	canCancel: boolean;
	showReviewActions: boolean;
	showAgentProgressIndicator: boolean;
	showActionFooter: boolean;
	showCancelAutomaticAction: boolean;
	handleSendText: (text: string, mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
	handleSendDraft: (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
	handleCancelTurn: () => void;
}

export function useNKleinChatPanelController({
	taskId,
	summary,
	taskColumnId = "in_progress",
	onSendMessage,
	onCancelTurn,
	onLoadMessages,
	incomingMessages = null,
	incomingMessage = null,
	onCommit,
	onOpenPr,
	onMoveToTrash,
	onCancelAutomaticAction,
	cancelAutomaticActionLabel,
	showMoveToTrash = false,
}: UseNKleinChatPanelControllerInput): UseNKleinChatPanelControllerResult {
	const [draft, setDraftState] = useState("");
	// P16.5b: MEASURE the operator's typing span (first keystroke → send). Wall-clock from the first keystroke,
	// so an abandoned-and-resumed draft inflates the span rather than hiding cost — the metric core reports
	// measured seconds as a FLOOR and ranks outliers visibly, so honesty beats a cap here.
	const draftStartedAtRef = useRef<number | null>(null);
	const setDraft = useCallback((next: string) => {
		if (next.trim().length === 0) {
			draftStartedAtRef.current = null;
		} else if (draftStartedAtRef.current === null) {
			draftStartedAtRef.current = Date.now();
		}
		setDraftState(next);
	}, []);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(taskId);
	const { messages, isSending, isCanceling, error, sendMessage, cancelTurn } = useNKleinChatSession({
		taskId,
		onSendMessage,
		onCancelTurn,
		onLoadMessages,
		incomingMessages,
		incomingMessage,
	});
	const canSend = Boolean(onSendMessage) && !isSending && !isCanceling;
	const canCancel = Boolean(onCancelTurn) && summary?.state === "running" && !isCanceling;
	const showReviewActions =
		taskColumnId === "review" &&
		hasReviewGitActionChanges({
			changedFiles: reviewWorkspaceSnapshot?.changedFiles,
			summary,
		}) &&
		Boolean(onCommit) &&
		Boolean(onOpenPr);
	const showAgentProgressIndicator = summary?.state === "running";
	const showActionFooter = showMoveToTrash && Boolean(onMoveToTrash);
	const showCancelAutomaticAction = Boolean(cancelAutomaticActionLabel && onCancelAutomaticAction);

	const handleSendText = useCallback(
		async (text: string, mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]): Promise<boolean> => {
			return sendMessage(
				text,
				mode || images?.length
					? {
							...(mode ? { mode } : {}),
							...(images?.length ? { images } : {}),
						}
					: undefined,
			);
		},
		[sendMessage],
	);

	const handleSendDraft = useCallback(
		async (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]): Promise<boolean> => {
			const startedAt = draftStartedAtRef.current;
			const interventionHumanSeconds =
				startedAt === null ? undefined : Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10);
			const sent = await sendMessage(draft, {
				...(mode ? { mode } : {}),
				...(images?.length ? { images } : {}),
				...(interventionHumanSeconds !== undefined ? { interventionHumanSeconds } : {}),
			});
			if (sent) {
				setDraft("");
			}
			return sent;
		},
		[draft, sendMessage, setDraft],
	);

	const handleCancelTurn = useCallback(() => {
		void cancelTurn();
	}, [cancelTurn]);

	return {
		draft,
		setDraft,
		messages,
		error,
		isSending,
		isCanceling,
		canSend,
		canCancel,
		showReviewActions,
		showAgentProgressIndicator,
		showActionFooter,
		showCancelAutomaticAction,
		handleSendText,
		handleSendDraft,
		handleCancelTurn,
	};
}
