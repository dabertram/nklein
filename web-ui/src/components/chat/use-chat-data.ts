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
			try {
				await client.chat.sendMessage.mutate({ sessionId: selectedSessionId, message: trimmed });
				await transcriptQuery.refetch();
				// The session's updatedAt advanced; refresh the list so ordering stays correct.
				await sessionsQuery.refetch();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				setSending(false);
			}
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
		error,
		createSession,
		updateSession,
		deleteSession,
		sendMessage,
		refetchSessions: sessionsQuery.refetch,
	};
}
