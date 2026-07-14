import { useCallback, useMemo } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

/**
 * F2.15b — the active workspace's OWNING chat's F2.14 feedback flags (`feedbackMuted` / `feedbackQuiet`), for
 * gating ASK notifications by that chat's preferences. A lightweight app-level `chat.listSessions` query (chat
 * sessions aren't tied to a board, so `getRuntimeTrpcClient(null)` — the same client `use-chat-data` uses). Returns
 * `{ muted: false, quiet: false }` when there is no owning chat (the permissive default — notify).
 *
 * Staleness note: the query fetches once (not tied to the sidebar's own query instance), so a mute toggle in the
 * sidebar isn't reflected here until the next fetch — an acceptable transient for an infrequent preference.
 */
export function useOwningChatFeedbackFlags(activeWorkspaceId: string | null): { muted: boolean; quiet: boolean } {
	const client = useMemo(() => getRuntimeTrpcClient(null), []);
	const listSessions = useCallback(async () => (await client.chat.listSessions.query()).sessions, [client]);
	const sessionsQuery = useTrpcQuery({
		enabled: activeWorkspaceId !== null,
		queryFn: listSessions,
		retainDataOnError: true,
	});
	return useMemo(() => {
		if (!activeWorkspaceId) {
			return { muted: false, quiet: false };
		}
		const owning = (sessionsQuery.data ?? []).find((session) => session.ownedWorkspaceId === activeWorkspaceId);
		return { muted: owning?.feedbackMuted ?? false, quiet: owning?.feedbackQuiet ?? false };
	}, [sessionsQuery.data, activeWorkspaceId]);
}
