import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { fetchPendingHostActionConfirms, resolveHostActionConfirm } from "@/runtime/runtime-config-query";
import { useInterval } from "@/utils/react-use";

/**
 * F2.2b/F2.12b — the host-action CONFIRM dialog. When a chat turn hits a `confirm`-tier host action (legitimate but
 * not pre-authorized) it parks awaiting the operator; this polls those pending confirmations and prompts the
 * operator to approve or deny. Fail-closed lives server-side (the parked turn times out to deny), so a dismissed or
 * missed prompt simply denies. Mounted once globally (any chat's confirm surfaces here).
 */

type PendingConfirm = Awaited<ReturnType<typeof fetchPendingHostActionConfirms>>[number];

const POLL_INTERVAL_MS = 2000;

export function HostActionConfirmDialog(): React.ReactElement | null {
	const [pending, setPending] = useState<PendingConfirm[]>([]);
	const [resolving, setResolving] = useState(false);

	const poll = useCallback(() => {
		void fetchPendingHostActionConfirms()
			.then(setPending)
			.catch(() => {});
	}, []);

	useEffect(() => poll(), [poll]);
	useInterval(poll, POLL_INTERVAL_MS);

	const current = pending[0] ?? null;

	const decide = useCallback(
		async (approve: boolean) => {
			if (!current) {
				return;
			}
			setResolving(true);
			try {
				await resolveHostActionConfirm(current, approve);
				// Optimistically drop it so the next queued confirm (if any) surfaces immediately.
				setPending((prev) => prev.filter((entry) => entry.attemptId !== current.attemptId));
				poll();
			} catch {
				// Leave it in place; the next poll re-syncs (the parked turn fails closed on timeout regardless).
			} finally {
				setResolving(false);
			}
		},
		[current, poll],
	);

	if (!current) {
		return null;
	}

	return (
		<Dialog open onOpenChange={() => {}}>
			<DialogHeader title="Approve host action?" />
			<DialogBody>
				<p className="m-0 text-[13px] text-text-secondary">
					An agent wants to run a host action that isn&apos;t pre-authorized. It&apos;s waiting for your OK:
				</p>
				<div
					data-testid="host-action-confirm-detail"
					className="mt-2 rounded-md border border-border bg-surface-0 p-2 text-[12px]"
				>
					<div className="flex gap-2">
						<span className="text-text-tertiary">Action</span>
						<span className="font-mono text-text-primary">{current.action}</span>
					</div>
					<div className="mt-1 flex min-w-0 gap-2">
						<span className="shrink-0 text-text-tertiary">Target</span>
						<span className="min-w-0 break-all font-mono text-text-primary">{current.target}</span>
					</div>
				</div>
				<p className="mb-0 mt-2 text-[12px] text-text-tertiary">
					Approve to let it run this once, or deny to block it. No response denies it automatically.
				</p>
			</DialogBody>
			<DialogFooter>
				<Button
					variant="ghost"
					disabled={resolving}
					data-testid="host-action-confirm-deny"
					onClick={() => void decide(false)}
				>
					Deny
				</Button>
				<Button
					variant="primary"
					disabled={resolving}
					data-testid="host-action-confirm-approve"
					onClick={() => void decide(true)}
				>
					Approve
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
