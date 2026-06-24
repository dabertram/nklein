import { useCallback, useMemo, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeChatCreateSessionRequest,
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatUpdateSessionRequest,
} from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

/**
 * Data layer for the board-independent chat surface (todo §5.M). It talks to the non-workspace `chat` tRPC
 * sub-router (so `getRuntimeTrpcClient(null)` — chat sessions aren't tied to a board), keeping the session list,
 * the selected session's transcript, and the create/delete/send mutations in one hook the dialog drives. Mutations
 * refetch the affected query so the UI stays consistent without a cache layer (matching the app's `useTrpcQuery`).
 */

export interface UseChatDataResult {
	sessions: RuntimeChatSession[];
	sessionsLoading: boolean;
	selectedSessionId: string | null;
	selectSession: (id: string | null) => void;
	transcript: RuntimeChatMessage[];
	transcriptLoading: boolean;
	sending: boolean;
	/** The user message being sent, shown optimistically until the persisted transcript catches up. */
	pendingUserText: string | null;
	/** The assistant reply as it streams in (token by token); null when not streaming. */
	streamingText: string | null;
	error: string | null;
	createSession: (input: RuntimeChatCreateSessionRequest) => Promise<RuntimeChatSession | null>;
	updateSession: (input: RuntimeChatUpdateSessionRequest) => Promise<void>;
	deleteSession: (id: string) => Promise<void>;
	sendMessage: (message: string) => Promise<void>;
	refetchSessions: () => Promise<unknown>;
}

export function useChatData(enabled: boolean): UseChatDataResult {
	const client = useMemo(() => getRuntimeTrpcClient(null), []);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [pendingUserText, setPendingUserText] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const sessionsQuery = useTrpcQuery({
		enabled,
		queryFn: async () => (await client.chat.listSessions.query()).sessions,
		retainDataOnError: true,
	});

	const transcriptQuery = useTrpcQuery({
		enabled: enabled && selectedSessionId !== null,
		queryFn: async () => {
			if (!selectedSessionId) {
				return [];
			}
			return (await client.chat.getTranscript.query({ sessionId: selectedSessionId })).messages;
		},
		retainDataOnError: true,
	});

	const createSession = useCallback(
		async (input: RuntimeChatCreateSessionRequest) => {
			setError(null);
			try {
				const { session } = await client.chat.createSession.mutate(input);
				await sessionsQuery.refetch();
				if (session) {
					setSelectedSessionId(session.id);
				}
				return session;
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				return null;
			}
		},
		[client, sessionsQuery],
	);

	const updateSession = useCallback(
		async (input: RuntimeChatUpdateSessionRequest) => {
			setError(null);
			try {
				await client.chat.updateSession.mutate(input);
				await sessionsQuery.refetch();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		},
		[client, sessionsQuery],
	);

	const deleteSession = useCallback(
		async (id: string) => {
			setError(null);
			try {
				await client.chat.deleteSession.mutate({ id });
				if (selectedSessionId === id) {
					setSelectedSessionId(null);
				}
				await sessionsQuery.refetch();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		},
		[client, selectedSessionId, sessionsQuery],
	);

	const sendMessage = useCallback(
		async (message: string) => {
			const trimmed = message.trim();
			if (!trimmed || !selectedSessionId) {
				return;
			}
			setSending(true);
			setError(null);
			setPendingUserText(trimmed);
			setStreamingText("");
			// Stream the reply token-by-token over the SSE subscription; resolve when the terminal `done` arrives.
			await new Promise<void>((resolve) => {
				client.chat.streamMessage.subscribe(
					{ sessionId: selectedSessionId, message: trimmed },
					{
						onData: (event) => {
							if (event.type === "token") {
								setStreamingText((current) => (current ?? "") + event.delta);
							}
						},
						onError: (caught: unknown) => {
							setError(caught instanceof Error ? caught.message : String(caught));
							resolve();
						},
						onComplete: () => resolve(),
					},
				);
			});
			// The turn is persisted; refresh the transcript + list, then drop the optimistic placeholders.
			await transcriptQuery.refetch();
			await sessionsQuery.refetch();
			setPendingUserText(null);
			setStreamingText(null);
			setSending(false);
		},
		[client, selectedSessionId, transcriptQuery, sessionsQuery],
	);

	return {
		sessions: sessionsQuery.data ?? [],
		sessionsLoading: sessionsQuery.isLoading,
		selectedSessionId,
		selectSession: setSelectedSessionId,
		transcript: transcriptQuery.data ?? [],
		transcriptLoading: transcriptQuery.isLoading,
		sending,
		pendingUserText,
		streamingText,
		error,
		createSession,
		updateSession,
		deleteSession,
		sendMessage,
		refetchSessions: sessionsQuery.refetch,
	};
}
