import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeChatAutonomousRunStatus,
	RuntimeChatClarifyCandidate,
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
	/** §5.AL/§5.AG: a model-capability caveat from the last turn (warn/unknown model that still ran); null when none. */
	capabilityNotice: string | null;
	/** §5.AU item 9: when the last message's target was ambiguous, the candidates for the composer's picker; null otherwise. */
	clarifyCandidates: RuntimeChatClarifyCandidate[] | null;
	/** Dismiss the clarify picker (e.g. after the user picks one or edits the draft). */
	dismissClarify: () => void;
	error: string | null;
	createSession: (input: RuntimeChatCreateSessionRequest) => Promise<RuntimeChatSession | null>;
	updateSession: (input: RuntimeChatUpdateSessionRequest) => Promise<void>;
	deleteSession: (id: string) => Promise<void>;
	sendMessage: (message: string) => Promise<void>;
	refetchSessions: () => Promise<unknown>;
	/** The selected session's autonomous run (todo §5.0.1): null until one is started this mount. */
	autonomousStatus: RuntimeChatAutonomousRunStatus | null;
	/** Start an autonomous run toward `goal` on the selected session; polls status + refreshes the transcript until done. */
	startAutonomousRun: (goal: string) => Promise<void>;
}

export function useChatData(enabled: boolean): UseChatDataResult {
	const client = useMemo(() => getRuntimeTrpcClient(null), []);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [pendingUserText, setPendingUserText] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState<string | null>(null);
	const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null);
	const [clarifyCandidates, setClarifyCandidates] = useState<RuntimeChatClarifyCandidate[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [autonomousStatus, setAutonomousStatus] = useState<RuntimeChatAutonomousRunStatus | null>(null);
	// A cancellation token for the active status-poll loop; flipped when a new run starts or the hook unmounts.
	const autonomousPollRef = useRef<{ cancelled: boolean } | null>(null);
	useEffect(
		() => () => {
			if (autonomousPollRef.current) {
				autonomousPollRef.current.cancelled = true;
			}
		},
		[],
	);

	// `useTrpcQuery`'s fetch effect keys on the queryFn identity, so these MUST be memoized — a fresh inline function
	// every render re-fires the effect each render (a refetch loop; every other useTrpcQuery caller memoizes). The
	// transcript's queryFn depends on `selectedSessionId`, so it re-fetches when the selected session changes (intended).
	const listSessionsQueryFn = useCallback(async () => (await client.chat.listSessions.query()).sessions, [client]);
	const sessionsQuery = useTrpcQuery({
		enabled,
		queryFn: listSessionsQueryFn,
		retainDataOnError: true,
	});

	const transcriptQueryFn = useCallback(async () => {
		if (!selectedSessionId) {
			return [];
		}
		return (await client.chat.getTranscript.query({ sessionId: selectedSessionId })).messages;
	}, [client, selectedSessionId]);
	const transcriptQuery = useTrpcQuery({
		enabled: enabled && selectedSessionId !== null,
		queryFn: transcriptQueryFn,
		retainDataOnError: true,
	});

	// §5.AT/§5.AU: the board→chat feedback bridge appends messages SERVER-side (terminal card outcomes / ASKs to the
	// project's owning chat), so poll the selected transcript to surface pushed messages without a user turn. Only
	// while the sidebar is open (`enabled`) with a session selected, and paused during a streaming turn (the send path
	// refetches). Refs keep the interval stable (it re-arms only on enable/session change, not every render).
	const sendingRef = useRef(sending);
	sendingRef.current = sending;
	const refetchTranscriptRef = useRef(transcriptQuery.refetch);
	refetchTranscriptRef.current = transcriptQuery.refetch;
	useEffect(() => {
		if (!enabled || selectedSessionId === null) {
			return;
		}
		const interval = setInterval(() => {
			if (!sendingRef.current) {
				void refetchTranscriptRef.current();
			}
		}, 4000);
		return () => clearInterval(interval);
	}, [enabled, selectedSessionId]);

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
			setCapabilityNotice(null);
			setClarifyCandidates(null);
			// Stream the reply token-by-token over the SSE subscription; resolve when the terminal `done` arrives.
			await new Promise<void>((resolve) => {
				client.chat.streamMessage.subscribe(
					{ sessionId: selectedSessionId, message: trimmed },
					{
						onData: (event) => {
							if (event.type === "token") {
								setStreamingText((current) => (current ?? "") + event.delta);
							} else if (event.type === "done") {
								// §5.AL/§5.AG: surface a model-capability caveat (the model is flagged warn/unknown but ran).
								setCapabilityNotice(event.capabilityNotice ?? null);
								// §5.AU item 9: an ambiguous target came back with candidates for the composer's picker.
								setClarifyCandidates(event.clarifyCandidates ?? null);
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

	const startAutonomousRun = useCallback(
		async (goal: string) => {
			const trimmed = goal.trim();
			if (!trimmed || !selectedSessionId) {
				return;
			}
			setError(null);
			const sessionId = selectedSessionId;
			try {
				const response = await client.chat.startAutonomousRun.mutate({ sessionId, goal: trimmed });
				setAutonomousStatus(response.status);
				// (Re)start the status-poll loop: refresh the transcript as the agent works, until the run stops.
				if (autonomousPollRef.current) {
					autonomousPollRef.current.cancelled = true;
				}
				const token = { cancelled: false };
				autonomousPollRef.current = token;
				const poll = async (): Promise<void> => {
					await new Promise((resolve) => setTimeout(resolve, 2500));
					if (token.cancelled) {
						return;
					}
					try {
						const status = await client.chat.autonomousRunStatus.query({ sessionId });
						if (token.cancelled) {
							return;
						}
						setAutonomousStatus(status);
						await transcriptQuery.refetch();
						if (status.running) {
							void poll();
						}
					} catch {
						// Transient query error — keep polling (the background run is still going).
						if (!token.cancelled) {
							void poll();
						}
					}
				};
				if (response.status.running) {
					void poll();
				}
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		},
		[client, selectedSessionId, transcriptQuery],
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
		capabilityNotice,
		clarifyCandidates,
		dismissClarify: () => setClarifyCandidates(null),
		error,
		createSession,
		updateSession,
		deleteSession,
		sendMessage,
		refetchSessions: sessionsQuery.refetch,
		autonomousStatus,
		startAutonomousRun,
	};
}
