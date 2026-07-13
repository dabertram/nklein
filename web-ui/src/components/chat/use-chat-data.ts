import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeChatAutonomousRunStatus,
	RuntimeChatClarifyCandidate,
	RuntimeChatCreateSessionRequest,
	RuntimeChatFocusChainResponse,
	RuntimeChatFocusChainStep,
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

/** W3.2 stall watchdog: with no SSE event for this long, detach so a dropped socket can't wedge the composer.
 *  Generous — local models can legitimately think for minutes between tool events. */
const STALL_TIMEOUT_MS = 180_000;

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
	/** User steering updates accepted while the active turn is still running. */
	pendingSteerTexts: string[];
	/** The assistant reply as it streams in (token by token); null when not streaming. */
	streamingText: string | null;
	/** W3.1: names of the tools the agent is running RIGHT NOW (live activity chips while the turn streams). */
	activeToolNames: string[];
	/** W3.2: detach from the in-flight turn — frees the composer; the reply arrives via the transcript poll. */
	stopTurn: () => void;
	/** §5.BB: the agent's live plan checklist for the selected session (null = none drafted). */
	focusChain: RuntimeChatFocusChainResponse["chain"];
	/** F1.6: operator edit of the plan checklist (guarded server-side); resolves to a rejection reason or null on success. */
	updateFocusChain: (steps: RuntimeChatFocusChainStep[]) => Promise<string | null>;
	/** W3.4: the last turn overflowed its context window (older messages were summarized). */
	contextTruncated: boolean;
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
	steerTurn: (message: string) => Promise<boolean>;
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
	const [pendingSteerTexts, setPendingSteerTexts] = useState<string[]>([]);
	const [streamingText, setStreamingText] = useState<string | null>(null);
	const [activeToolNames, setActiveToolNames] = useState<string[]>([]);
	const [contextTruncated, setContextTruncated] = useState(false);
	// W3.2: detaches the active streamMessage subscription (Stop button / stall watchdog); null when idle.
	const stopTurnRef = useRef<(() => void) | null>(null);
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

	// §5.BB focus-chain surface: the agent's live plan checklist, refreshed on the same cadence as the transcript.
	const focusChainQueryFn = useCallback(async () => {
		if (!selectedSessionId) {
			return null;
		}
		return (await client.chat.getFocusChain.query({ sessionId: selectedSessionId })).chain;
	}, [client, selectedSessionId]);
	const focusChainQuery = useTrpcQuery({
		enabled: enabled && selectedSessionId !== null,
		queryFn: focusChainQueryFn,
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
	const refetchFocusChainRef = useRef(focusChainQuery.refetch);
	refetchFocusChainRef.current = focusChainQuery.refetch;
	useEffect(() => {
		if (!enabled || selectedSessionId === null) {
			return;
		}
		const interval = setInterval(() => {
			if (!sendingRef.current) {
				void refetchTranscriptRef.current();
				void refetchFocusChainRef.current();
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
			setPendingSteerTexts([]);
			setStreamingText("");
			setCapabilityNotice(null);
			setClarifyCandidates(null);
			// Stream the reply token-by-token over the SSE subscription; resolve when the terminal `done` arrives.
			// W3.2: `stopTurnRef` detaches the stream (Stop button); the stall watchdog auto-detaches when NO event
			// arrives for STALL_TIMEOUT_MS (a dropped socket previously wedged the composer forever). Detaching frees
			// the composer — the server turn finishes on its own and the transcript poll picks the reply up.
			await new Promise<void>((resolve) => {
				let settled = false;
				let stallTimer: ReturnType<typeof setTimeout> | null = null;
				const subscription = client.chat.streamMessage.subscribe(
					{ sessionId: selectedSessionId, message: trimmed },
					{
						onData: (event) => {
							armStallWatchdog();
							if (event.type === "token") {
								setStreamingText((current) => (current ?? "") + event.delta);
							} else if (event.type === "tool") {
								// W3.1 live activity: track which tools are running for the composer's chips.
								setActiveToolNames((current) => {
									if (event.phase === "start") {
										return [...current, event.toolName];
									}
									const next = [...current];
									const index = next.indexOf(event.toolName);
									if (index >= 0) {
										next.splice(index, 1);
									}
									return next;
								});
							} else if (event.type === "done") {
								// §5.AL/§5.AG: surface a model-capability caveat (the model is flagged warn/unknown but ran).
								setCapabilityNotice(event.capabilityNotice ?? null);
								// §5.AU item 9: an ambiguous target came back with candidates for the composer's picker.
								setClarifyCandidates(event.clarifyCandidates ?? null);
								// W3.4 truncation indicator: this turn rolled older messages into a summary.
								setContextTruncated(event.contextTruncated ?? false);
							}
						},
						onError: (caught: unknown) => {
							setError(caught instanceof Error ? caught.message : String(caught));
							finish();
						},
						onComplete: () => finish(),
					},
				);
				const finish = (): void => {
					if (settled) {
						return;
					}
					settled = true;
					if (stallTimer) {
						clearTimeout(stallTimer);
					}
					stopTurnRef.current = null;
					resolve();
				};
				const detach = (notice: string | null): void => {
					if (settled) {
						return;
					}
					if (notice) {
						setError(notice);
					}
					subscription.unsubscribe();
					finish();
				};
				const armStallWatchdog = (): void => {
					if (stallTimer) {
						clearTimeout(stallTimer);
					}
					stallTimer = setTimeout(
						() =>
							detach(
								"The stream went quiet — detached. The agent may still be finishing; the reply will appear here when it does.",
							),
						STALL_TIMEOUT_MS,
					);
				};
				stopTurnRef.current = () => detach(null);
				armStallWatchdog();
			});
			// The turn is persisted; refresh the transcript + list (+ the plan strip), then drop the placeholders.
			await transcriptQuery.refetch();
			await sessionsQuery.refetch();
			void focusChainQuery.refetch();
			setPendingUserText(null);
			setPendingSteerTexts([]);
			setStreamingText(null);
			setActiveToolNames([]);
			setSending(false);
		},
		[client, selectedSessionId, transcriptQuery, sessionsQuery, focusChainQuery],
	);

	/** W3.2: detach from the in-flight turn (frees the composer; the server finishes + the poll fetches the reply). */
	const stopTurn = useCallback(() => {
		stopTurnRef.current?.();
	}, []);

	const steerTurn = useCallback(
		async (message: string): Promise<boolean> => {
			const trimmed = message.trim();
			if (!trimmed || !selectedSessionId) {
				return false;
			}
			setError(null);
			try {
				const result = await client.chat.steerTurn.mutate({
					sessionId: selectedSessionId,
					message: trimmed,
					delivery: "steer",
				});
				if (!result.ok) {
					setError(result.error ?? "The active turn is not accepting steering.");
					return false;
				}
				setPendingSteerTexts((current) => [...current, result.message?.content ?? trimmed]);
				return true;
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				return false;
			}
		},
		[client, selectedSessionId],
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

	// F1.6 operator plan edit: the server applies the SAME normalize + regression guard as the agent tool, so a UI
	// edit can never corrupt the chain; a guard rejection comes back as the reason string for the strip to surface.
	const updateFocusChain = useCallback(
		async (steps: RuntimeChatFocusChainStep[]): Promise<string | null> => {
			if (!selectedSessionId) {
				return "No chat session is selected.";
			}
			try {
				const response = await client.chat.updateFocusChain.mutate({ sessionId: selectedSessionId, steps });
				await focusChainQuery.refetch();
				return response.ok ? null : (response.rejected ?? "The focus-chain update was rejected.");
			} catch (caught) {
				return caught instanceof Error ? caught.message : String(caught);
			}
		},
		[client, focusChainQuery, selectedSessionId],
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
		pendingSteerTexts,
		streamingText,
		activeToolNames,
		stopTurn,
		focusChain: focusChainQuery.data ?? null,
		updateFocusChain,
		contextTruncated,
		capabilityNotice,
		clarifyCandidates,
		dismissClarify: () => setClarifyCandidates(null),
		error,
		createSession,
		updateSession,
		deleteSession,
		sendMessage,
		steerTurn,
		refetchSessions: sessionsQuery.refetch,
		autonomousStatus,
		startAutonomousRun,
	};
}
