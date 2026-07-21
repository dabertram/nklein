import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { fetchPendingEgressConfirms, resolveEgressConfirm } from "@/runtime/queries/task-control";
import { useInterval } from "@/utils/react-use";

type PendingConfirm = Awaited<ReturnType<typeof fetchPendingEgressConfirms>>[number];
const POLL_INTERVAL_MS = 2_000;

/** F2.3b one-shot sandbox-network confirmation; the proxy itself owns timeout/deny fail-closed behavior. */
export function EgressConfirmDialog({ workspaceId }: { workspaceId: string | null }): React.ReactElement | null {
	const [pending, setPending] = useState<PendingConfirm[]>([]);
	const [resolving, setResolving] = useState(false);
	const workspaceIdRef = useRef(workspaceId);
	workspaceIdRef.current = workspaceId;

	const poll = useCallback(() => {
		if (!workspaceId) {
			setPending([]);
			return;
		}
		const requestedWorkspaceId = workspaceId;
		void fetchPendingEgressConfirms(workspaceId)
			.then((next) => {
				if (workspaceIdRef.current === requestedWorkspaceId) setPending(next);
			})
			.catch(() => {});
	}, [workspaceId]);

	useEffect(() => {
		setPending([]);
		poll();
	}, [poll]);
	useInterval(poll, POLL_INTERVAL_MS);
	const current = pending[0] ?? null;

	const decide = useCallback(
		async (approve: boolean) => {
			if (!current || !workspaceId) return;
			setResolving(true);
			try {
				await resolveEgressConfirm(workspaceId, current, approve);
				setPending((previous) => previous.filter((entry) => entry.attemptId !== current.attemptId));
				poll();
			} catch {
				// Retain the entry; the next poll reconciles and the proxy timeout remains fail-closed.
			} finally {
				setResolving(false);
			}
		},
		[current, poll, workspaceId],
	);

	if (!current) return null;

	return (
		<Dialog open onOpenChange={() => {}}>
			<DialogHeader title="Allow one network connection?" />
			<DialogBody>
				<p className="m-0 text-[13px] text-text-secondary">
					A sandboxed {current.role} is waiting to connect to an allowlisted public endpoint:
				</p>
				<div
					data-testid="egress-confirm-detail"
					className="mt-2 rounded-md border border-border bg-surface-0 p-2 text-[12px]"
				>
					<div className="flex min-w-0 gap-2">
						<span className="shrink-0 text-text-tertiary">Destination</span>
						<span className="min-w-0 break-all font-mono text-text-primary">
							{current.host}:{current.port}
						</span>
					</div>
					<div className="mt-1 flex gap-2">
						<span className="text-text-tertiary">Role</span>
						<span className="font-mono text-text-primary">{current.role}</span>
					</div>
				</div>
				<p className="mb-0 mt-2 text-[12px] text-text-tertiary">
					Approval applies only to this connection attempt. Deny or no response blocks it automatically.
				</p>
			</DialogBody>
			<DialogFooter>
				<Button
					variant="ghost"
					disabled={resolving}
					data-testid="egress-confirm-deny"
					onClick={() => void decide(false)}
				>
					Deny
				</Button>
				<Button
					variant="primary"
					disabled={resolving}
					data-testid="egress-confirm-approve"
					onClick={() => void decide(true)}
				>
					Allow once
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
