import { KeyRound } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchChatSessionCapabilityGrants, revokeChatSessionCapabilityGrant } from "@/runtime/runtime-config-query";

/**
 * F2.2 — the standing capability grants a chat session holds. When the capability broker is on, approving a
 * confirm-tier host action (via {@link ./host-action-confirm-dialog}) records a least-scope grant with a bounded TTL,
 * so the SAME action re-runs without re-prompting. This panel is the operator's view of those standing approvals plus
 * the "undo" the confirm flow otherwise lacks: revoke one before its TTL elapses. Collapsible + lazily fetched,
 * mirroring the host-action audit panel. Empty is the normal state (broker off, or nothing approved yet).
 */

type Grant = Awaited<ReturnType<typeof fetchChatSessionCapabilityGrants>>[number];

function formatExpiry(expiresAt: number, now: number): string {
	const remainingMs = expiresAt - now;
	if (remainingMs <= 0) {
		return "expiring";
	}
	const minutes = Math.round(remainingMs / 60_000);
	return minutes <= 1 ? "expires in <1 min" : `expires in ${minutes} min`;
}

export function ChatCapabilityGrantsPanel({ sessionId }: { sessionId: string }): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [grants, setGrants] = useState<Grant[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [revoking, setRevoking] = useState<string | null>(null);

	const refresh = useCallback(() => {
		setLoading(true);
		void fetchChatSessionCapabilityGrants(sessionId)
			.then(setGrants)
			.catch(() => setGrants([]))
			.finally(() => setLoading(false));
	}, [sessionId]);

	// Re-fetch when opened or when the session changes; collapse resets the cached list.
	useEffect(() => {
		setGrants(null);
		if (open) {
			refresh();
		}
	}, [open, refresh]);

	const revoke = useCallback(
		async (key: string) => {
			setRevoking(key);
			try {
				await revokeChatSessionCapabilityGrant(sessionId, key);
				// Drop it optimistically so the change is immediate; refresh re-syncs the authoritative list (and any
				// grants that expired meanwhile) rather than trusting the local edit.
				setGrants((prev) => (prev ? prev.filter((grant) => grant.key !== key) : prev));
				refresh();
			} catch {
				// Leave it in place; the next open/refresh re-syncs. A failed revoke must never look like a success.
			} finally {
				setRevoking(null);
			}
		},
		[sessionId, refresh],
	);

	const now = Date.now();

	return (
		<div className="rounded-md border border-border bg-surface-2" data-testid="chat-capability-grants">
			<button
				type="button"
				data-testid="chat-capability-grants-toggle"
				className="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-[11px] font-medium text-text-secondary"
				onClick={() => setOpen((current) => !current)}
			>
				<KeyRound size={12} className="shrink-0" />
				<span>Active permissions</span>
				{grants !== null ? <span className="text-text-tertiary">({grants.length})</span> : null}
			</button>
			{open ? (
				<div className="border-t border-border px-2 py-1.5 text-[11px]">
					{loading ? <div className="text-text-secondary">Loading…</div> : null}
					{!loading && (grants ?? []).length === 0 ? (
						<div className="text-text-tertiary">
							No standing permissions. Approving a host action grants one here until it expires.
						</div>
					) : null}
					{!loading
						? (grants ?? []).map((grant) => (
								<div
									key={grant.key}
									className="flex min-w-0 items-center gap-2 border-b border-border/60 py-1 last:border-b-0"
									title={grant.key}
								>
									<span className="min-w-0 flex-1 truncate font-mono text-text-primary">{grant.key}</span>
									<span className="shrink-0 text-text-tertiary">{formatExpiry(grant.expiresAt, now)}</span>
									<Button
										variant="ghost"
										size="sm"
										disabled={revoking === grant.key}
										data-testid="chat-capability-grant-revoke"
										onClick={() => void revoke(grant.key)}
									>
										Revoke
									</Button>
								</div>
							))
						: null}
				</div>
			) : null}
		</div>
	);
}
